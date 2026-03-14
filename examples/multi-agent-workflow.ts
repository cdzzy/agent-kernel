/**
 * AgentKernel - Multi-Agent Workflow Example
 *
 * Simulates a research pipeline with 3 agents:
 * - Researcher: searches and gathers data (high priority)
 * - Writer: synthesizes findings (medium priority)
 * - Reviewer: reviews the output (low priority)
 *
 * Shared resources:
 * - llm-api: pool of 2 concurrent LLM slots
 * - database: exclusive access (mutex)
 * - search-api: rate-limited (10 req/s)
 */

import { AgentKernel } from '../src/index.js';

async function main() {
  console.log('=== AgentKernel Multi-Agent Workflow ===\n');

  // 1. Create the kernel with resource definitions
  const kernel = new AgentKernel({
    scheduler: { strategy: 'priority', maxConcurrent: 5 },
    resources: {
      'llm-api': { type: 'pool', capacity: 2 },
      'database': { type: 'mutex' },
      'search-api': { type: 'rate-limit', maxTokens: 10, refillRate: 10 },
    },
    deadlock: { enabled: true, interval: 1000, resolution: 'abort-lowest' },
  });

  // 2. Wire up event listeners
  kernel.on('task:started', (task) => {
    console.log(`  [START] ${task.agentId} -> "${task.name}"`);
  });
  kernel.on('task:completed', (task) => {
    console.log(`  [DONE]  ${task.agentId} -> "${task.name}" (${task.completedAt! - task.startedAt!}ms)`);
  });
  kernel.on('task:failed', (task) => {
    console.log(`  [FAIL]  ${task.agentId} -> "${task.name}": ${task.error?.message}`);
  });
  kernel.on('resource:acquired', (handle) => {
    console.log(`  [LOCK]  ${handle.agentId} acquired "${handle.resourceId}"`);
  });
  kernel.on('resource:released', (handle) => {
    console.log(`  [FREE]  ${handle.agentId} released "${handle.resourceId}"`);
  });
  kernel.on('deadlock:detected', (cycle) => {
    console.log(`  [DEADLOCK] Cycle: ${cycle.agents.join(' -> ')}`);
  });

  // 3. Register agents
  kernel.register('researcher', { priority: 'high', group: 'research' });
  kernel.register('writer', { priority: 'medium', group: 'content' });
  kernel.register('reviewer', { priority: 'low', group: 'qa' });

  // 4. Set up inter-agent messaging
  const messages: string[] = [];
  kernel.subscribe('writer', 'research-results', async (msg) => {
    messages.push(`Writer received: ${JSON.stringify(msg.payload)}`);
  });
  kernel.subscribe('reviewer', 'draft-ready', async (msg) => {
    messages.push(`Reviewer received: ${JSON.stringify(msg.payload)}`);
  });

  kernel.start();

  console.log('--- Submitting tasks ---');

  // 5. Submit tasks with dependencies
  const searchTask = kernel.submit('researcher', {
    name: 'search-papers',
    resources: ['search-api'],
    handler: async () => {
      await sleep(50);
      return { papers: ['Paper A', 'Paper B', 'Paper C'] };
    },
  });

  const analyzeTask = kernel.submit('researcher', {
    name: 'analyze-data',
    resources: ['llm-api'],
    dependencies: [searchTask.id],
    handler: async () => {
      await sleep(30);
      await kernel.publish('researcher', 'research-results', { summary: 'Key findings...' });
      return { analysis: 'Revenue grew 20%' };
    },
  });

  const writeTask = kernel.submit('writer', {
    name: 'write-draft',
    resources: ['llm-api', 'database'],
    dependencies: [analyzeTask.id],
    handler: async () => {
      await sleep(40);
      await kernel.publish('writer', 'draft-ready', { draft: 'First draft...' });
      return { draft: 'Complete draft document' };
    },
  });

  const reviewTask = kernel.submit('reviewer', {
    name: 'review-draft',
    resources: ['llm-api'],
    dependencies: [writeTask.id],
    handler: async () => {
      await sleep(20);
      return { approved: true, comments: 'Looks good!' };
    },
  });

  // Also submit a concurrent low-priority task
  kernel.submit('reviewer', {
    name: 'background-check',
    handler: async () => {
      await sleep(10);
      return { status: 'ok' };
    },
  });

  // 6. Wait for pipeline
  await sleep(500);

  // 7. Print metrics
  console.log('\n--- Metrics ---');
  const metrics = kernel.getMetrics();
  console.log('Agents:', metrics.agents);
  console.log('Tasks:', metrics.tasks);
  console.log('Resources:');
  for (const [id, info] of Object.entries(metrics.resources)) {
    console.log(`  ${id}: owners=${info.owners}, waitQueue=${info.waitQueue}, acquires=${info.totalAcquires}, util=${(info.utilization * 100).toFixed(0)}%`);
  }
  console.log('Deadlocks:', metrics.deadlocks);

  // 8. Print messages
  console.log('\n--- Inter-Agent Messages ---');
  for (const msg of messages) {
    console.log(`  ${msg}`);
  }

  console.log('\n--- Message Bus History ---');
  const history = kernel.messageBus.getHistory();
  console.log(`  ${history.length} message(s) exchanged`);

  // 9. Shutdown
  kernel.shutdown();
  console.log('\nKernel shut down.');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch(console.error);
