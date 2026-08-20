/**
 * Tests for the agent-kernel CLI (v0.3.0).
 */

import { describe, it, expect } from 'vitest';
import { main, CliError } from '../src/cli.js';

function capture(fn: () => Promise<number>): Promise<{ code: number; out: string; err: string }> {
  const chunks: string[] = [];
  const errChunks: string[] = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);

  (process.stdout as unknown as { write: unknown }).write = (chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
    return true;
  };
  (process.stderr as unknown as { write: unknown }).write = (chunk: string | Uint8Array) => {
    errChunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
    return true;
  };

  function restore(): void {
    (process.stdout as unknown as { write: unknown }).write = origWrite;
    (process.stderr as unknown as { write: unknown }).write = origErr;
  }

  return fn().then(
    code => { restore(); return { code, out: chunks.join(''), err: errChunks.join('') }; },
    err => {
      restore();
      if (err instanceof CliError) {
        errChunks.unshift(`agent-kernel: ${err.message}\n`);
        return { code: err.exitCode, out: chunks.join(''), err: errChunks.join('') };
      }
      throw err;
    },
  );
}

describe('agent-kernel CLI', () => {
  it('status reports kernel metrics', async () => {
    const { code, out } = await capture(() => main(['node', 'agent-kernel', 'status', '--register', 'planner,worker-1']));
    expect(code).toBe(0);
    expect(out).toContain('Agent Kernel status');
    expect(out).toContain('agents:');
    expect(out).toContain('planner');
    expect(out).toContain('worker-1');
  });

  it('status shows resources', async () => {
    const { out } = await capture(() => main(['node', 'agent-kernel', 'status']));
    expect(out).toContain('llm-pool');
    expect(out).toContain('db-lock');
  });

  it('agents lists registered agents', async () => {
    const { code, out } = await capture(() => main(['node', 'agent-kernel', 'agents', '--register', 'researcher,writer']));
    expect(code).toBe(0);
    expect(out).toContain('agent(s)');
    expect(out).toContain('researcher');
    expect(out).toContain('writer');
  });

  it('agents defaults to demo names', async () => {
    const { out } = await capture(() => main(['node', 'agent-kernel', 'agents']));
    expect(out).toContain('planner');
    expect(out).toContain('analyst');
  });

  it('top shows task summary', async () => {
    const { code, out } = await capture(() => main(['node', 'agent-kernel', 'top', '--register', 'a,b']));
    expect(code).toBe(0);
    expect(out).toContain('tasks (');
    expect(out).toContain('No tasks in flight');
  });

  it('help exits cleanly', async () => {
    const { code, out } = await capture(() => main(['node', 'agent-kernel', 'help']));
    expect(code).toBe(0);
    expect(out).toContain('Usage:');
  });

  it('unknown command fails', async () => {
    const { code, err } = await capture(() => main(['node', 'agent-kernel', 'bogus']));
    expect(code).toBe(1);
    expect(err).toContain('unknown command');
  });

  it('unknown option fails', async () => {
    const { code, err } = await capture(() => main(['node', 'agent-kernel', 'status', '--bogus']));
    expect(code).toBe(1);
    expect(err).toContain('unknown option');
  });
});
