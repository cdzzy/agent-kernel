import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import {
  AlwaysOnSampler,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
} from '@opentelemetry/sdk-trace';
import {
  KernelTracer,
  KERNEL_TRACER_NAME,
  createTracer,
} from '../src/tracing.js';
import { KernelTracer as IndexedKernelTracer } from '../src/index.js';

/** Register a real, in-memory-recording TracerProvider for span assertions. */
function setupProvider() {
  const exporter = new InMemorySpanExporter();
  const provider = new TracerProvider({
    sampler: new AlwaysOnSampler(),
    spanProcessors: [new SimpleSpanProcessor({ exporter })],
  });
  trace.setGlobalTracerProvider(provider);
  return { exporter, provider };
}

function finishedSpans(exporter: InMemorySpanExporter) {
  return exporter.getFinishedSpans();
}

afterEach(() => {
  // Detach any provider registered per-test so the no-op defaults return.
  trace.disable();
});

describe('KernelTracer — no provider (no-op safety)', () => {
  it('does not throw when no TracerProvider is registered', () => {
    const tracer = new KernelTracer();
    const span = tracer.startSpan('noop.here');
    expect(() => span.setAttribute('a', 'b')).not.toThrow();
    expect(() => tracer.setOk(span)).not.toThrow();
    expect(() => span.end()).not.toThrow();
    expect(span.isRecording()).toBe(false);
  });

  it('runInSpan resolves normally and re-throws without a provider', async () => {
    const tracer = new KernelTracer();
    const value = await tracer.runInSpan('noop.ok', async () => 42);
    expect(value).toBe(42);

    await expect(
      tracer.runInSpan('noop.err', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });

  it('uses the default service name', () => {
    const tracer = new KernelTracer();
    expect(tracer.getTracer()).toBeDefined();
    expect(KERNEL_TRACER_NAME).toBe('agent-kernel');
  });

  it('customizes the service name', () => {
    const tracer = new KernelTracer({ serviceName: 'my-kernel' });
    expect(tracer.getTracer()).toBeDefined();
  });
});

describe('KernelTracer — span creation & attributes', () => {
  let exporter: InMemorySpanExporter;

  beforeEach(() => {
    ({ exporter } = setupProvider());
  });

  it('creates a span with name and attributes', () => {
    const tracer = new KernelTracer();
    const span = tracer.startSpan('work', { 'k': 'v' });
    span.end();

    const [finished] = finishedSpans(exporter);
    expect(finished.name).toBe('work');
    expect(finished.attributes['k']).toBe('v');
  });

  it('applies defaultAttributes to every span', () => {
    const tracer = new KernelTracer({ defaultAttributes: { 'service.version': '1.0.0' } });
    tracer.startSpan('a').end();
    tracer.startSpan('b').end();

    const spans = finishedSpans(exporter);
    expect(spans).toHaveLength(2);
    for (const s of spans) {
      expect(s.attributes['service.version']).toBe('1.0.0');
    }
  });

  it('startAgentSpan names and tags the span', () => {
    const tracer = new KernelTracer();
    tracer.startAgentSpan('agent-1', 'execute').end();

    const [finished] = finishedSpans(exporter);
    expect(finished.name).toBe('agent.execute');
    expect(finished.attributes['agent.id']).toBe('agent-1');
    expect(finished.attributes['agent.action']).toBe('execute');
  });

  it('startTaskSpan names and tags the span', () => {
    const tracer = new KernelTracer();
    tracer.startTaskSpan('task-9', 'run', { 'task.priority': 'critical' }).end();

    const [finished] = finishedSpans(exporter);
    expect(finished.name).toBe('task.run');
    expect(finished.attributes['task.id']).toBe('task-9');
    expect(finished.attributes['task.operation']).toBe('run');
    expect(finished.attributes['task.priority']).toBe('critical');
  });
});

describe('KernelTracer — runInSpan lifecycle', () => {
  let exporter: InMemorySpanExporter;

  beforeEach(() => {
    ({ exporter } = setupProvider());
  });

  it('marks a successful span OK', async () => {
    const tracer = new KernelTracer();
    const result = await tracer.runInSpan('job.ok', async (span) => {
      span.setAttribute('returned', 'yes');
      return 'done';
    });

    expect(result).toBe('done');
    const [finished] = finishedSpans(exporter);
    expect(finished.status.code).toBe(SpanStatusCode.OK);
    expect(finished.attributes['returned']).toBe('yes');
  });

  it('records exceptions and marks the span ERROR', async () => {
    const tracer = new KernelTracer();
    await expect(
      tracer.runInSpan('job.fail', async () => {
        throw new Error('kaboom');
      }),
    ).rejects.toThrow('kaboom');

    const [finished] = finishedSpans(exporter);
    expect(finished.status.code).toBe(SpanStatusCode.ERROR);
    expect(finished.status.message).toBe('kaboom');
    expect(finished.events.some((e) => e.name === 'exception')).toBe(true);
  });

  it('re-throws non-Error throwables and still records', async () => {
    const tracer = new KernelTracer();
    await expect(
      tracer.runInSpan('job.throw', async () => {
        // eslint-disable-next-line no-throw-literal
        throw 'plain-string';
      }),
    ).rejects.toBe('plain-string');

    const [finished] = finishedSpans(exporter);
    expect(finished.status.code).toBe(SpanStatusCode.ERROR);
    expect(finished.events.some((e) => e.name === 'exception')).toBe(true);
  });

  it('runTaskInSpan produces a task.* span tagged with task.id', async () => {
    const tracer = new KernelTracer();
    await tracer.runTaskInSpan('t-42', 'decompose', async () => undefined);

    const [finished] = finishedSpans(exporter);
    expect(finished.name).toBe('task.decompose');
    expect(finished.attributes['task.id']).toBe('t-42');
    expect(finished.attributes['task.operation']).toBe('decompose');
  });

  it('nests child spans under the active parent', async () => {
    const tracer = new KernelTracer();
    await tracer.runInSpan('parent', async (parentSpan) => {
      const child = tracer.startSpan('child');
      child.end();
      return parentSpan;
    });

    const spans = finishedSpans(exporter);
    const parent = spans.find((s) => s.name === 'parent');
    const child = spans.find((s) => s.name === 'child');
    expect(parent).toBeDefined();
    expect(child).toBeDefined();
    expect(child!.parentSpanContext?.spanId).toBe(parent!.spanContext().spanId);
  });

  it('activeSpan() returns the current span inside the wrapped fn', async () => {
    const tracer = new KernelTracer();
    let inside: string | undefined;
    await tracer.runInSpan('active.check', async () => {
      inside = tracer.activeSpan()?.spanContext().spanId;
    });

    const [finished] = finishedSpans(exporter);
    expect(inside).toBe(finished.spanContext().spanId);
  });
});

describe('KernelTracer — W3C trace context propagation', () => {
  it('injects traceparent into a carrier and extracts it back', async () => {
    const { exporter } = setupProvider();
    const tracer = new KernelTracer();

    const carrier: Record<string, string> = {};
    await tracer.runInSpan('propagate', async () => {
      tracer.inject(carrier);
    });

    expect(carrier['traceparent'] ?? carrier.traceparent).toBeDefined();

    // Extract in a *fresh* tracer (still the same global provider) and assert
    // a child of the extracted context links back to the original span.
    const parentContext = tracer.extract(carrier);
    await tracer.runInSpanAsChild(parentContext, 'child.after.extract', async () => undefined);

    const spans = finishedSpans(exporter);
    const original = spans.find((s) => s.name === 'propagate');
    const child = spans.find((s) => s.name === 'child.after.extract');
    expect(original).toBeDefined();
    expect(child).toBeDefined();
    expect(child!.spanContext().traceId).toBe(original!.spanContext().traceId);
  });

  it('rootContext() returns the propagation baseline', () => {
    const tracer = new KernelTracer();
    expect(tracer.rootContext()).toBeDefined();
  });
});

describe('tracing module exports', () => {
  it('exposes the factory and re-exports via the package index', () => {
    const a = createTracer();
    const b = new KernelTracer();
    const c = new IndexedKernelTracer();
    expect(a.getTracer()).toBeDefined();
    expect(b.getTracer()).toBeDefined();
    expect(c.getTracer()).toBeDefined();
  });
});