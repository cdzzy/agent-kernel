/**
 * Agent OS Flagship Example
 * =========================
 *
 * One runnable story wiring three layers of the stack together:
 *
 *   agent-kernel   — schedules a researcher → writer → reviewer pipeline
 *   traceshield    — audits every task into a tamper-evident trace log
 *   engram         — the agents share findings through long-term memory
 *
 * The pipeline:
 *   1. researcher  investigates a topic, writes findings into memory
 *   2. writer      recalls the findings from memory, drafts a brief
 *   3. reviewer    checks the draft against a pricing ban, files a review
 *
 * At the end you get:
 *   - the full audit trail (hash-chain verified) as a Mermaid attribution graph
 *   - the shared memory contents
 *   - a budget-exceeded violation, demonstrating kernel → audit flow
 *
 * Run:
 *   npm install
 *   npm start
 */

import { AgentKernel, ResourceBudgetManager, attachTraceShield } from 'agent-kernel';
import { MemoryStorage, TraceRecorder, buildAttributionGraph, renderMermaid, verifySpanChain } from 'traceshield';
import { MemoryManager } from 'engram';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

async function main(): Promise<void> {
  // ── 1. Memory layer (engram): agents share findings here ────────────────
  const memoryDir = path.join(os.tmpdir(), 'agent-os-flagship-memory');
  fs.mkdirSync(memoryDir, { recursive: true });
  const { FileStore } = await import('engram');
  const memoryStore = new FileStore(memoryDir);
  await memoryStore.init();
  const memory = new MemoryManager({}, memoryStore);

  // ── 2. Kernel (agent-kernel): scheduling + budgets ──────────────────────
  const kernel = new AgentKernel({
    resources: {
      'llm-pool': { type: 'semaphore', permits: 2 },
    },
  });
  const budgets = new ResourceBudgetManager(kernel, { maxTokens: 500 });

  for (const agent of ['researcher', 'writer', 'reviewer']) {
    kernel.register(agent, { priority: agent === 'reviewer' ? 'high' : 'medium' });
  }

  // ── 3. Audit layer (traceshield): every task is traced ──────────────────
  const storage = new MemoryStorage();
  await storage.initialize();
  const recorder = new TraceRecorder({ storage });
  attachTraceShield(kernel, recorder, {
    sessionId: 'flagship-run',
    violations: { deadlocks: true, budgets: true, health: true, taskFailures: true },
  });

  kernel.start();

  // ── 4. The pipeline: researcher → writer → reviewer ─────────────────────
  const TOPIC = 'renewable energy trends 2026';

  // Researcher — produces findings, shares them through memory
  const researcher = kernel.submit('researcher', {
    name: 'research',
    handler: async () => {
      const findings =
        'Solar costs fell 12% YoY; grid storage deployments doubled; ' +
        'offshore wind permits accelerated in Q3; policy support remains strong.';
      const m = await memory.encode({
        content: findings,
        type: 'semantic',
        importance: 'high',
        source: 'researcher',
        tags: ['findings', TOPIC],
      });
      budgets.consume('researcher', 'maxTokens', 320); // LLM usage
      return { memoryId: m.id };
    },
  });

  // Writer — recalls findings from memory, drafts a brief
  const writer = kernel.submit('writer', {
    name: 'write-brief',
    dependencies: [researcher.id],
    handler: async () => {
      const recalled = await memory.query({ text: 'solar storage wind', limit: 3 });
      const brief = `Brief on ${TOPIC}:\n` + recalled.map((r) => `- ${r.engram.content}`).join('\n');
      const m = await memory.encode({
        content: brief,
        type: 'episodic',
        importance: 'medium',
        source: 'writer',
        tags: ['draft'],
      });
      budgets.consume('writer', 'maxTokens', 900); // blows the 500-token budget!
      return { memoryId: m.id };
    },
  });

  // Reviewer — checks the draft for banned pricing content, files a review
  const reviewer = kernel.submit('reviewer', {
    name: 'review',
    dependencies: [writer.id],
    handler: async () => {
      const drafts = await memory.query({ tags: ['draft'], limit: 1 });
      const draft = drafts[0]?.engram.content ?? '(no draft found)';
      const banned = ['price', '$', 'cost'];
      const flagged = banned.filter((word) => draft.toLowerCase().includes(word));
      const verdict = flagged.length > 0 ? 'REVISED (pricing mentions removed)' : 'APPROVED';
      const safeDraft = flagged.length > 0 ? draft.replace(/costs?/gi, 'benefits') : draft;
      const m = await memory.encode({
        content: `Review verdict: ${verdict}\n\n${safeDraft}`,
        type: 'episodic',
        importance: 'high',
        source: 'reviewer',
        tags: ['review'],
      });
      return { verdict, memoryId: m.id };
    },
  });

  // ── 5. Wait for the pipeline and print the results ──────────────────────
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const reviewerTask = kernel.scheduler.getTask(reviewer.id);
    const status = reviewerTask?.status ?? 'pending';
    if (status === 'completed' || status === 'failed') break;
    await new Promise((r) => setTimeout(r, 100));
  }

  console.log('\n========== Shared memory (engram) ==========');
  const memories = await memory.query({ limit: 10 });
  for (const { engram } of memories) {
    console.log(`  [${engram.source}] ${engram.tags.join(',') || '(no tags)'}: ${engram.content.slice(0, 80)}...`);
  }

  console.log('\n========== Audit trail (traceshield) ==========');
  const traces = await storage.queryTraces({});
  console.log(`  traces: ${traces.length}, spans: ${traces.reduce((s, t) => s + t.spans.length, 0)}`);

  const graph = buildAttributionGraph(traces);
  console.log('\n========== Attribution graph (Mermaid) ==========');
  console.log(renderMermaid(graph));

  // Verify each trace's hash chain independently (spans chain within a trace)
  let valid = 0;
  let totalSpans = 0;
  for (const trace of traces) {
    const v = verifySpanChain(trace.spans);
    totalSpans += v.span_count;
    if (v.valid) valid += 1;
  }
  console.log(`\nAudit integrity: ${valid}/${traces.length} traces VALID (${totalSpans} spans)`);

  console.log('\nCleanup...');
  kernel.shutdown();
  fs.rmSync(memoryDir, { recursive: true, force: true });
}

void main();
