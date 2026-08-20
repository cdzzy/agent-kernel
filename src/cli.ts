/**
 * agent-kernel CLI — real-time kernel inspection.
 *
 * Commands:
 *   agent-kernel status [--register A,B,...]   kernel + fleet summary
 *   agent-kernel agents [--register A,B,...]   list registered agents
 *   agent-kernel top   [--register A,B,...]   running tasks (top-style)
 *
 * By default the CLI runs against an empty kernel. Use --register to spawn a
 * few demo agents so there is something to inspect.
 */

import { AgentKernel } from './kernel.js';
import type { AgentId } from './types.js';

export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode: number = 1,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

interface CliArgs {
  command: string;
  register: AgentId[];
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const out: CliArgs = { command: args[0] ?? 'help', register: [] };

  for (let i = 1; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--register' || a === '-r') {
      const names = args[++i] ?? '';
      out.register = names.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (a === '--help' || a === '-h') {
      out.command = 'help';
    } else if (a.startsWith('-')) {
      throw new CliError(`unknown option: ${a}`);
    }
  }
  return out;
}

function makeKernel(args: CliArgs): AgentKernel {
  const kernel = new AgentKernel({
    resources: {
      'llm-pool': { type: 'semaphore', permits: 3 },
      'db-lock': { type: 'mutex' },
    },
  });
  const names = args.register.length > 0 ? args.register : ['planner', 'worker-1', 'worker-2', 'analyst'];
  for (const name of names) {
    kernel.register(name);
  }
  return kernel;
}

// ── Commands ─────────────────────────────────────────────────────────────

function cmdStatus(args: CliArgs): number {
  const kernel = makeKernel(args);
  const metrics = kernel.getMetrics();
  const agents = kernel.listAgents();

  process.stdout.write(`Agent Kernel status\n\n`);
  process.stdout.write(`  agents:     ${metrics.agents.total} (running ${metrics.agents.running}, waiting ${metrics.agents.waiting})\n`);
  process.stdout.write(`  tasks:      ${metrics.tasks.total} (${metrics.tasks.running} running, ${metrics.tasks.pending} pending, ${metrics.tasks.completed} done, ${metrics.tasks.failed} failed)\n`);
  process.stdout.write(`  deadlocks:  detected ${metrics.deadlocks.detected}, resolved ${metrics.deadlocks.resolved}\n`);
  if (Object.keys(metrics.resources).length > 0) {
    process.stdout.write(`\n  resources:\n`);
    for (const [id, info] of Object.entries(metrics.resources)) {
      process.stdout.write(`    ${id}: owners=${info.owners}, waiters=${info.waitQueue}\n`);
    }
  }
  process.stdout.write(`\n  agents (${agents.length}):\n`);
  for (const a of agents) {
    const status = kernel.getAgentStatus(a.id) ?? 'unknown';
    process.stdout.write(`    ${String(a.id).padEnd(16)} ${String(status).padEnd(10)} prio=${a.priority}\n`);
  }
  return 0;
}

function cmdAgents(args: CliArgs): number {
  const kernel = makeKernel(args);
  const agents = kernel.listAgents();
  if (agents.length === 0) {
    process.stdout.write('No agents registered.\n');
    return 0;
  }
  process.stdout.write(`${agents.length} agent(s)\n\n`);
  for (const a of agents) {
    const status = kernel.getAgentStatus(a.id) ?? 'unknown';
    const group = a.group ? ` group=${a.group}` : '';
    process.stdout.write(`  ${String(a.id).padEnd(16)} ${String(status).padEnd(10)} priority=${a.priority}${group}\n`);
  }
  return 0;
}

function cmdTop(args: CliArgs): number {
  const kernel = makeKernel(args);
  const metrics = kernel.getMetrics();
  const agents = kernel.listAgents();

  process.stdout.write(`Agent Kernel — tasks (${metrics.tasks.running} running / ${metrics.tasks.pending} queued)\n\n`);
  if (metrics.tasks.total === 0) {
    process.stdout.write('  No tasks in flight. Submit tasks via kernel.submit() to see them here.\n');
  }
  process.stdout.write(`  agents: ${agents.map((a) => a.id).join(', ') || '(none)'}\n`);
  process.stdout.write(`  resources: ${Object.keys(metrics.resources).join(', ') || '(none)'}\n`);
  return 0;
}

function cmdHelp(): number {
  process.stdout.write(`agent-kernel — kernel inspection

Usage:
  agent-kernel status [--register A,B,...]
  agent-kernel agents [--register A,B,...]
  agent-kernel top   [--register A,B,...]

Options:
  --register, -r A,B  register demo agents (default: planner,worker-1,worker-2,analyst)
`);
  return 0;
}

export async function main(argv: string[] = process.argv): Promise<number> {
  const args = parseArgs(argv);
  switch (args.command) {
    case 'status': return cmdStatus(args);
    case 'agents': return cmdAgents(args);
    case 'top': return cmdTop(args);
    case 'help': case '--help': case '-h': return cmdHelp();
    default:
      throw new CliError(`unknown command: ${args.command} (see 'agent-kernel help')`);
  }
}
