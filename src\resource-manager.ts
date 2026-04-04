import { randomUUID } from 'node:crypto';
import type {
  AgentId,
  ResourceId,
  ResourceConfig,
  ResourceDescriptor,
  ResourceHandle,
  WaitEntry,
  TypedEventEmitter,
  PRIORITY_VALUES,
} from './types.js';
import { AgentMutex } from './concurrency/mutex.js';
import { AgentSemaphore } from './concurrency/semaphore.js';
import { RateLimiter } from './rate-limiter.js';

/**
 * ResourceManager — manages shared resources with typed concurrency controls.
 *
 * Resource types:
 * - mutex: exclusive access (1 agent at a time)
 * - semaphore: counted permits (N agents at a time)
 * - pool: same as semaphore but semantically a "resource pool"
 * - rate-limit: token-bucket rate limiting
 */
export class ResourceManager {
  private resources = new Map<ResourceId, ManagedResource>();
  private handles = new Map<string, ResourceHandle>();
  private emitter?: TypedEventEmitter;

  constructor(
    configs?: Record<ResourceId, ResourceConfig>,
    emitter?: TypedEventEmitter,
  ) {
    this.emitter = emitter;
    if (configs) {
      for (const [id, config] of Object.entries(configs)) {
        this.register(id, config);
      }
    }
  }

  register(id: ResourceId, config: ResourceConfig): void {
    if (this.resources.has(id)) {
      throw new Error(`Resource "${id}" already registered`);
    }

    let primitive: AgentMutex | AgentSemaphore | RateLimiter;

    switch (config.type) {
      case 'mutex':
        primitive = new AgentMutex();
        break;
      case 'semaphore':
        primitive = new AgentSemaphore(config.permits);
        break;
      case 'pool':
        primitive = new AgentSemaphore(config.capacity);
        break;
      case 'rate-limit':
        primitive = new RateLimiter(config.maxTokens, config.refillRate);
        break;
    }

    this.resources.set(id, {
      id,
      config,
      primitive,
      owners: new Set(),
      totalAcquires: 0,
      totalReleases: 0,
    });
  }

  async acquire(
    agentId: AgentId,
    resourceId: ResourceId,
    timeoutMs?: number,
  ): Promise<ResourceHandle> {
    const resource = this.resources.get(resourceId);
    if (!resource) throw new Error(`Resource "${resourceId}" not found`);

    this.emitter?.emit('resource:waiting', agentId, resourceId);

    const { primitive } = resource;

    if (primitive instanceof AgentMutex) {
      await primitive.acquire(agentId, timeoutMs);
    } else if (primitive instanceof AgentSemaphore) {
      await primitive.acquire(agentId, 1, timeoutMs);
    } else if (primitive instanceof RateLimiter) {
      await primitive.acquire(1, timeoutMs);
    }

    resource.owners.add(agentId);
    resource.totalAcquires++;

    const handle: ResourceHandle = {
      id: randomUUID(),
      resourceId,
      agentId,
      acquiredAt: Date.now(),
    };

    this.handles.set(handle.id, handle);
    this.emitter?.emit('resource:acquired', handle);
    return handle;
  }

  release(handle: ResourceHandle): void {
    const existing = this.handles.get(handle.id);
    if (!existing) throw new Error(`Handle "${handle.id}" not found`);

    const resource = this.resources.get(handle.resourceId);
    if (!resource) throw new Error(`Resource "${handle.resourceId}" not found`);

    const { primitive } = resource;

    if (primitive instanceof AgentMutex) {
      primitive.release(handle.agentId);
    } else if (primitive instanceof AgentSemaphore) {
      primitive.release(handle.agentId, 1);
    }
    // RateLimiter doesn't need explicit release

    resource.owners.delete(handle.agentId);
    resource.totalReleases++;
    this.handles.delete(handle.id);
    this.emitter?.emit('resource:released', handle);
  }

  releaseAll(agentId: AgentId): void {
    for (const [handleId, handle] of this.handles) {
      if (handle.agentId === agentId) {
        try { this.release(handle); } catch { /* ignore */ }
      }
    }
  }

  /**
   * Scoped resource usage — acquire, run handler, then auto-release.
   */
  async withResource<T>(
    agentId: AgentId,
    resourceId: ResourceId,
    handler: () => T | Promise<T>,
    timeoutMs?: number,
  ): Promise<T> {
    const handle = await this.acquire(agentId, resourceId, timeoutMs);
    try {
      return await handler();
    } finally {
      this.release(handle);
    }
  }

  getResourceInfo(resourceId: ResourceId): {
    owners: AgentId[];
    waiters: AgentId[];
    totalAcquires: number;
    config: ResourceConfig;
  } | null {
    const resource = this.resources.get(resourceId);
    if (!resource) return null;

    let waiters: AgentId[] = [];
    const { primitive } = resource;
    if (primitive instanceof AgentMutex) {
      waiters = primitive.getWaiters();
    } else if (primitive instanceof AgentSemaphore) {
      waiters = primitive.getWaiters();
    }

    return {
      owners: [...resource.owners],
      waiters,
      totalAcquires: resource.totalAcquires,
      config: resource.config,
    };
  }

  getWaitGraph(): Map<AgentId, { waitingFor: ResourceId; heldBy: AgentId[] }> {
    const graph = new Map<AgentId, { waitingFor: ResourceId; heldBy: AgentId[] }>();

    for (const [resourceId, resource] of this.resources) {
      const { primitive } = resource;
      let waiters: AgentId[] = [];

      if (primitive instanceof AgentMutex) {
        waiters = primitive.getWaiters();
      } else if (primitive instanceof AgentSemaphore) {
        waiters = primitive.getWaiters();
      }

      for (const waiter of waiters) {
        graph.set(waiter, {
          waitingFor: resourceId,
          heldBy: [...resource.owners],
        });
      }
    }

    return graph;
  }

  getResourceIds(): ResourceId[] {
    return [...this.resources.keys()];
  }

  has(resourceId: ResourceId): boolean {
    return this.resources.has(resourceId);
  }

  cancelAllWaiters(resourceId: ResourceId, reason?: string): void {
    const resource = this.resources.get(resourceId);
    if (!resource) return;

    const { primitive } = resource;
    if (primitive instanceof AgentMutex) {
      primitive.cancelAll(reason);
    } else if (primitive instanceof AgentSemaphore) {
      primitive.cancelAll(reason);
    } else if (primitive instanceof RateLimiter) {
      primitive.cancelAll(reason);
    }
  }
}

interface ManagedResource {
  id: ResourceId;
  config: ResourceConfig;
  primitive: AgentMutex | AgentSemaphore | RateLimiter;
  owners: Set<AgentId>;
  totalAcquires: number;
  totalReleases: number;
}
