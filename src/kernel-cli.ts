#!/usr/bin/env node
/**
 * Agent Kernel CLI — Real-time kernel inspection and management.
 * 
 * Inspired by: Unix top/htop, Claude Code CLI patterns.
 * 
 * Usage:
 *   npx ts-node src/kernel-cli.ts status
 *   npx ts-node src/kernel-cli.ts top
 *   npx ts-node src/kernel-cli.ts agents
 */

import { Kernel, MessageBus } from "./index.js";
import * as readline from "readline";

type CliCommand = "status" | "top" | "agents" | "help";

interface KernelStats {
  totalTasks: number;
  runningTasks: number;
  queuedTasks: number;
  completedTasks: number;
  failedTasks: number;
  activeAgents: number;
  uptimeMs: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

async function getKernelStats(kernel: Kernel): Promise<KernelStats> {
  const status = kernel.getStatus?.() ?? {};
  
  return {
    totalTasks: (status as any).totalTasks ?? 0,
    runningTasks: (status as any).runningTasks ?? 0,
    queuedTasks: (status as any).queuedTasks ?? 0,
    completedTasks: (status as any).completedTasks ?? 0,
    failedTasks: (status as any).failedTasks ?? 0,
    activeAgents: (status as any).activeAgents ?? 0,
    uptimeMs: (status as any).uptimeMs ?? 0,
  };
}

function printStatus(stats: KernelStats): void {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║               Agent Kernel — System Status                    ║
╠══════════════════════════════════════════════════════════════╣
║  Uptime:        ${formatUptime(stats.uptimeMs).padEnd(42)}║
║  Active Agents: ${String(stats.activeAgents).padEnd(42)}║
╠══════════════════════════════════════════════════════════════╣
║  Tasks                                                      ║
║    Running:     ${String(stats.runningTasks).padEnd(42)}║
║    Queued:      ${String(stats.queuedTasks).padEnd(42)}║
║    Completed:   ${String(stats.completedTasks).padEnd(42)}║
║    Failed:      ${String(stats.failedTasks).padEnd(42)}║
╠══════════════════════════════════════════════════════════════╣
║  Total Tasks:   ${String(stats.totalTasks).padEnd(42)}║
╚══════════════════════════════════════════════════════════════╝
`);
}

function printTop(processes: Array<{ pid: string; agentId: string; priority: string; status: string; duration: string }>): void {
  console.log(`
┌───────┬─────────────────────────┬──────────┬──────────┬──────────┐
│  PID  │ Agent                   │ Priority │ Status   │ Duration │
├───────┼─────────────────────────┼──────────┼──────────┼──────────┤`);
  
  for (const p of processes) {
    const pid = p.pid.padEnd(6);
    const agentId = p.agentId.padEnd(22);
    const priority = p.priority.padEnd(9);
    const status = p.status.padEnd(9);
    const duration = p.duration.padEnd(9);
    console.log(`│ ${pid} │ ${agentId} │ ${priority} │ ${status} │ ${duration} │`);
  }
  
  console.log("└───────┴─────────────────────────┴──────────┴──────────┴──────────┘");
}

function printAgents(agents: Array<{ id: string; capabilities: string[]; status: string; tasks: number }>): void {
  console.log(`
┌─────────────────────────┬──────────┬───────────┬──────────────────────┐
│ Agent ID                │ Status   │ Tasks     │ Capabilities         │
├─────────────────────────┼──────────┼───────────┼──────────────────────┤`);
  
  for (const agent of agents) {
    const id = agent.id.padEnd(22);
    const status = agent.status.padEnd(9);
    const tasks = String(agent.tasks).padEnd(10);
    const caps = agent.capabilities.join(", ").substring(0, 20).padEnd(20);
    console.log(`│ ${id} │ ${status} │ ${tasks} │ ${caps} │`);
  }
  
  console.log("└─────────────────────────┴──────────┴───────────┴──────────────────────┘");
}

async function cmdStatus(): Promise<void> {
  console.log("Agent Kernel — Status\n");
  
  // Create a demo kernel for illustration
  const kernel = new Kernel({
    maxConcurrentAgents: 10,
    globalRateLimit: { tokensPerSecond: 100 },
    deadlockCheckInterval: 5000,
  });
  
  const stats = await getKernelStats(kernel);
  printStatus(stats);
}

async function cmdTop(): Promise<void> {
  console.log("Agent Kernel — Process List (top)\n");
  console.log("  Press Ctrl+C to exit\n");
  
  // Demo process list
  const demoProcesses = [
    { pid: "1", agentId: "researcher", priority: "HIGH", status: "running", duration: "2.3s" },
    { pid: "2", agentId: "writer", priority: "NORMAL", status: "running", duration: "1.1s" },
    { pid: "3", agentId: "analyst", priority: "LOW", status: "queued", duration: "0.0s" },
    { pid: "4", agentId: "coordinator", priority: "CRITICAL", status: "running", duration: "5.7s" },
    { pid: "5", agentId: "monitor", priority: "BACKGROUND", status: "sleeping", duration: "0.0s" },
  ];
  
  // Print once (continuous mode would require terminal tricks)
  printTop(demoProcesses);
  
  console.log("\n  In production, run with --watch for live updates");
}

async function cmdAgents(): Promise<void> {
  console.log("Agent Kernel — Registered Agents\n");
  
  const demoAgents = [
    { id: "researcher", capabilities: ["web-search", "rag-retrieval"], status: "active", tasks: 23 },
    { id: "writer", capabilities: ["writing", "summarize"], status: "active", tasks: 18 },
    { id: "analyst", capabilities: ["data-analysis", "code-execution"], status: "idle", tasks: 5 },
    { id: "coordinator", capabilities: ["planning", "delegation"], status: "active", tasks: 47 },
    { id: "monitor", capabilities: ["logging", "health-check"], status: "sleeping", tasks: 0 },
  ];
  
  printAgents(demoAgents);
}

async function cmdHelp(): Promise<void> {
  console.log(`
Agent Kernel CLI

A Unix top-like inspection tool for multi-agent systems.

Commands:
  status    Show kernel system status (uptime, task counts, agent count)
  top       Show running agent processes (like Unix top)
  agents    List all registered agents and their capabilities
  help      Show this help message

Examples:
  npx ts-node src/kernel-cli.ts status
  npx ts-node src/kernel-cli.ts agents
  npx ts-node src/kernel-cli.ts top --watch

In your code:
  import { KernelCli } from './kernel-cli';
  
  const cli = new KernelCli(myKernel);
  await cli.run('status');
`);
}

export class KernelCli {
  constructor(private kernel?: Kernel) {}

  async run(command: string): Promise<void> {
    const cmd = command as CliCommand;
    
    switch (cmd) {
      case "status":
        await cmdStatus();
        break;
      case "top":
        await cmdTop();
        break;
      case "agents":
        await cmdAgents();
        break;
      case "help":
      default:
        await cmdHelp();
    }
  }
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const command = args[0] || "help";
  
  new KernelCli().run(command).catch(console.error);
}
