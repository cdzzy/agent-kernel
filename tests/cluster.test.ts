/**
 * Tests for the distributed cluster nodes (v0.7.0).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { AgentKernel } from '../src/kernel.js';
import { ClusterHandlerRegistry, KernelHttpEndpoint, RemoteKernelClient } from '../src/cluster.js';

const endpoints: KernelHttpEndpoint[] = [];

async function makeNode(options: { token?: string } = {}): Promise<{ endpoint: KernelHttpEndpoint; client: RemoteKernelClient; handlers: ClusterHandlerRegistry }> {
  const kernel = new AgentKernel();
  kernel.register('worker');
  kernel.start();

  const handlers = new ClusterHandlerRegistry();
  handlers.register('greet', async (input: unknown) => `hello ${(input as { who: string }).who}`);

  const endpoint = new KernelHttpEndpoint({ kernel, handlers, port: 0, token: options.token });
  await endpoint.start();
  endpoints.push(endpoint);

  const client = new RemoteKernelClient(endpoint.url, { token: options.token });
  return { endpoint, client, handlers };
}

afterEach(async () => {
  for (const endpoint of endpoints.splice(0)) {
    await endpoint.stop();
  }
});

describe('KernelHttpEndpoint + RemoteKernelClient', () => {
  it('executes a task on the remote kernel and returns the result', async () => {
    const { client } = await makeNode();

    const info = await client.execute({
      agentId: 'worker',
      name: 'greet-task',
      handlerRef: 'greet',
      input: { who: 'world' },
    }, { timeoutMs: 5000 });

    expect(info.status).toBe('completed');
    expect(info.result).toBe('hello world');
  });

  it('submit + waitFor as separate calls', async () => {
    const { client } = await makeNode();

    const { taskId } = await client.submit({
      agentId: 'worker',
      name: 'greet-2',
      handlerRef: 'greet',
      input: { who: 'world' },
    });
    expect(taskId).toBeTruthy();

    const info = await client.waitFor(taskId, { timeoutMs: 5000 });
    expect(info.status).toBe('completed');
  });

  it('rejects unknown handlers with 400', async () => {
    const { client } = await makeNode();

    await expect(client.submit({
      agentId: 'worker',
      name: 'x',
      handlerRef: 'nonexistent',
    })).rejects.toThrow(/unknown handler/);
  });

  it('enforces bearer-token auth', async () => {
    const { client } = await makeNode({ token: 's3cret' });

    // No token ->unauthorized
    const unauthorized = new RemoteKernelClient(client['baseUrl']);
    await expect(unauthorized.submit({
      agentId: 'worker', name: 'x', handlerRef: 'greet',
    })).rejects.toThrow(/401/);

    // Correct token ->works
    const info = await client.execute({
      agentId: 'worker', name: 'greet-3', handlerRef: 'greet', input: { who: 'world' },
    }, { timeoutMs: 5000 });
    expect(info.result).toBe('hello world');
  });

  it('health reports agents and registered handlers', async () => {
    const { client } = await makeNode();

    const health = await client.health();
    expect(health.ok).toBe(true);
    expect(health.agents).toBe(1);
    expect(health.handlers).toContain('greet');
  });

  it('getTask returns 404 as null for unknown ids', async () => {
    const { client } = await makeNode();
    expect(await client.getTask('nonexistent-id')).toBeNull();
  });

  it('propagates remote task failures', async () => {
    const kernel = new AgentKernel();
    kernel.register('worker');
    const handlers = new ClusterHandlerRegistry();
    handlers.register('explode', async () => {
      throw new Error('remote boom');
    });
    const endpoint = new KernelHttpEndpoint({ kernel, handlers, port: 0 });
    await endpoint.start();
    endpoints.push(endpoint);

    const client = new RemoteKernelClient(endpoint.url);
    const info = await client.execute({
      agentId: 'worker', name: 'bad', handlerRef: 'explode',
    }, { timeoutMs: 5000 });

    expect(info.status).toBe('failed');
    expect(info.error?.message).toBe('remote boom');
  });
});
