/**
 * OpenTelemetry tracing example — wrap agent/task work in spans and export.
 *
 * Demonstrates the three core capabilities of the OTEL integration:
 *   1. `runTaskInSpan` / `runInSpan` wrap work in named, attributed spans
 *      (with OK/ERROR status and exception recording).
 *   2. Spans flow to any OTEL backend through a standard TracerProvider
 *      (here we use the zero-dependency ConsoleSpanExporter).
 *   3. W3C `traceparent` propagation lets a trace cross process boundaries
 *      via `inject` / `extract`.
 *
 * Usage:
 *   npx tsx examples/08_otel_tracing.ts
 *
 * Production backends only differ in the exporter — swap ConsoleSpanExporter
 * for an OTLP exporter (Jaeger / Tempo / Datadog / Grafana) and no
 * AgentKernel code changes.
 */

import { trace } from '@opentelemetry/api';
import {
  AlwaysOnSampler,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
} from '@opentelemetry/sdk-trace';
import { AgentKernel } from '../src/kernel';
import { KernelTracer } from '../src/tracing';

async function main(): Promise<void> {
  // 1. Register a real provider. In production, point this at OTLP instead.
  const provider = new TracerProvider({
    sampler: new AlwaysOnSampler(),
    spanProcessors: [new SimpleSpanProcessor({ exporter: new ConsoleSpanExporter() })],
  });
  trace.setGlobalTracerProvider(provider);

  // 2. A trivial kernel to give the spans some real agent context.
  const kernel = new AgentKernel();
  kernel.register('researcher');

  // 3. KernelTracer bridges AgentKernel onto OTEL (also installs the W3C
  //    propagator + AsyncLocalStorage context manager idempotently).
  const tracer = new KernelTracer({ serviceName: 'agent-kernel-demo' });

  await tracer.runTaskInSpan(
    'task-001',
    'execute',
    async (span) => {
      span.setAttribute('task.input', 'summarize the changelog');
      span.setAttribute('task.agent', 'researcher');
      await new Promise((resolve) => setTimeout(resolve, 15));
      return 'summary';
    },
    { 'task.priority': 'high' },
  );

  // 4. Agent-scoped span, toggled to ERROR when work fails.
  const agentSpan = tracer.startAgentSpan('researcher', 'retrieve');
  try {
    tracer.recordException(agentSpan, new Error('upstream timeout'));
  } finally {
    agentSpan.end();
  }

  // 5. W3C trace parent for downstream services (the traceId/spanId above).
  const carrier: Record<string, string> = {};
  await tracer.runInSpan('emit.traceparent', async () => {
    tracer.inject(carrier);
  });
  console.log('\npropagated traceparent:', carrier['traceparent']);

  await provider.forceFlush();
  console.log('\nDone. Spans were printed to stdout via ConsoleSpanExporter.');
}

void main();