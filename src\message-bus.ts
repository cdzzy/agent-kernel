import { randomUUID } from 'node:crypto';
import type {
  AgentId,
  AgentMessage,
  MessageHandler,
  MessagePayload,
  TypedEventEmitter,
} from './types.js';

/**
 * Message Bus — inter-agent communication.
 *
 * Supports:
 * - Direct messaging (agent-to-agent)
 * - Pub/sub topics (broadcast)
 * - Request/response pattern with reply correlation
 */
export class MessageBus {
  private subscriptions = new Map<string, Map<AgentId, MessageHandler>>(); // topic -> agent -> handler
  private directHandlers = new Map<AgentId, MessageHandler>(); // agent -> handler for direct messages
  private pendingReplies = new Map<string, {
    resolve: (msg: AgentMessage) => void;
    reject: (err: Error) => void;
    timer?: ReturnType<typeof setTimeout>;
  }>();
  private emitter?: TypedEventEmitter;
  private history: AgentMessage[] = [];
  private maxHistory: number;

  constructor(emitter?: TypedEventEmitter, maxHistory = 1000) {
    this.emitter = emitter;
    this.maxHistory = maxHistory;
  }

  /**
   * Register a handler for direct messages sent to this agent.
   */
  onDirectMessage(agentId: AgentId, handler: MessageHandler): void {
    this.directHandlers.set(agentId, handler);
  }

  /**
   * Subscribe to a topic.
   */
  subscribe(agentId: AgentId, topic: string, handler: MessageHandler): void {
    if (!this.subscriptions.has(topic)) {
      this.subscriptions.set(topic, new Map());
    }
    this.subscriptions.get(topic)!.set(agentId, handler);
  }

  /**
   * Unsubscribe from a topic.
   */
  unsubscribe(agentId: AgentId, topic: string): void {
    this.subscriptions.get(topic)?.delete(agentId);
  }

  /**
   * Unsubscribe agent from everything.
   */
  unsubscribeAll(agentId: AgentId): void {
    this.directHandlers.delete(agentId);
    for (const [, subs] of this.subscriptions) {
      subs.delete(agentId);
    }
  }

  /**
   * Send a direct message to a specific agent.
   */
  async send(from: AgentId, to: AgentId, payload: MessagePayload, topic?: string): Promise<void> {
    const message: AgentMessage = {
      id: randomUUID(),
      from,
      to,
      topic,
      payload,
      timestamp: Date.now(),
    };

    this.record(message);
    this.emitter?.emit('message', message);

    const handler = this.directHandlers.get(to);
    if (handler) {
      await handler(message);
    }

    // Also check if it's a reply
    if (message.topic === '__reply__' && typeof message.payload === 'object' && message.payload !== null) {
      const replyTo = (message.payload as Record<string, unknown>)['replyTo'] as string | undefined;
      if (replyTo && this.pendingReplies.has(replyTo)) {
        const pending = this.pendingReplies.get(replyTo)!;
        this.pendingReplies.delete(replyTo);
        if (pending.timer) clearTimeout(pending.timer);
        pending.resolve(message);
      }
    }
  }

  /**
   * Publish a message to a topic (broadcast to all subscribers).
   */
  async publish(from: AgentId, topic: string, payload: MessagePayload): Promise<void> {
    const message: AgentMessage = {
      id: randomUUID(),
      from,
      to: null,
      topic,
      payload,
      timestamp: Date.now(),
    };

    this.record(message);
    this.emitter?.emit('message', message);

    const subscribers = this.subscriptions.get(topic);
    if (subscribers) {
      const promises: Promise<void>[] = [];
      for (const [agentId, handler] of subscribers) {
        if (agentId !== from) { // don't send to self
          promises.push(Promise.resolve(handler(message)));
        }
      }
      await Promise.allSettled(promises);
    }
  }

  /**
   * Request/response pattern: send a message and wait for a reply.
   */
  async request(
    from: AgentId,
    to: AgentId,
    payload: MessagePayload,
    timeoutMs = 30000,
  ): Promise<AgentMessage> {
    const message: AgentMessage = {
      id: randomUUID(),
      from,
      to,
      topic: '__request__',
      payload,
      timestamp: Date.now(),
    };

    this.record(message);
    this.emitter?.emit('message', message);

    return new Promise<AgentMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingReplies.delete(message.id);
        reject(new Error(`Request from "${from}" to "${to}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingReplies.set(message.id, { resolve, reject, timer });

      // Deliver the request to the target agent
      const handler = this.directHandlers.get(to);
      if (handler) {
        // Attach replyTo for the handler to use
        message.replyTo = message.id;
        handler(message);
      }
    });
  }

  /**
   * Reply to a request message.
   */
  async reply(originalMessage: AgentMessage, from: AgentId, payload: MessagePayload): Promise<void> {
    if (!originalMessage.replyTo && !originalMessage.id) return;

    const replyTo = originalMessage.replyTo ?? originalMessage.id;

    await this.send(from, originalMessage.from, { replyTo, payload }, '__reply__');
  }

  getHistory(limit?: number): AgentMessage[] {
    const l = limit ?? this.history.length;
    return this.history.slice(-l);
  }

  getTopics(): string[] {
    return [...this.subscriptions.keys()];
  }

  getSubscribers(topic: string): AgentId[] {
    return [...(this.subscriptions.get(topic)?.keys() ?? [])];
  }

  private record(message: AgentMessage): void {
    this.history.push(message);
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }
  }

  clear(): void {
    for (const [, pending] of this.pendingReplies) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(new Error('Message bus cleared'));
    }
    this.pendingReplies.clear();
    this.subscriptions.clear();
    this.directHandlers.clear();
    this.history = [];
  }
}
