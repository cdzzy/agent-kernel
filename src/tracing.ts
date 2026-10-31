/**
 * OpenTelemetry tracing integration (Roadmap).
 *
 * Bridges AgentKernel onto the OpenTelemetry ecosystem through the stable,
 * zero-transitive-dependency `@opentelemetry/api`. When the host application
 * registers a `TracerProvider`, spans flow to any OTEL backend (Jaeger, Tempo,
 * Datadog, Grafana, Honeycomb, ...); with no provider registered, every call
 * in this module is a safe no-op — the OTEL API returns non-recording spans
 * and non-recording contexts, so AgentKernel works with and without tracing.
 *
 * The integration is intentionally non-invasive. It does not patch the
 * scheduler or message bus; instead it exposes a small, high-level surface the
 * host (or the kernel itself) can use to wrap agent/task work in spans:
 *
 *   const tracer = new KernelTracer();
 *   await tracer.runInSpan('task.execute', async (span) => {
 *     span.setAttribute('task.id', 't-1');
 *     return await scheduler.submit(task);
 *   }, { 'task.priority': 'high' });
 */

import {
  ROOT_CONTEXT,
  SpanStatusCode,
  context,
  propagation,
  trace,
} from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { installW3CTraceContextPropagator } from './w3c-trace-context.js';
import type {
  Attributes,
  Context,
  Span,
  SpanOptions,
  TextMapGetter,
  TextMapSetter,
  Tracer,
} from '@opentelemetry/api';

/** Tracer/service name used when the caller does not override it. */
export const KERNEL_TRACER_NAME = 'agent-kernel';

/**
 * Scheduled span/attribute naming convention is documented so backends and
 * dashboards can build consistent queries against agent-kernel traces.
 * Everything AgentKernel-internal is namespaced `agent.*` / `task.*`.
 */
export const TRACING_ATTRIBUTE_PREFIX = 'agent';

let _asyncLocalStorageInstalled = false;

/**
 * Idempotently install the AsyncLocalStorage context manager so span context
 * propagates across `await` boundaries.
 *
 * `@opentelemetry/api` ships a no-op context manager by default; without ALS,
 * `context.active()` returns the root context inside async continuations and
 * parent→child span linkage is lost. This installs the standard manager once
 * (a no-op on subsequent calls). When the host already uses the OpenTelemetry
 * NodeSDK, that registration is equivalent and this stays inert.
 */
export function installAsyncLocalStorage(): void {
  if (_asyncLocalStorageInstalled) {
    return;
  }
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  _asyncLocalStorageInstalled = true;
}

export interface KernelTracingConfig {
  /** Opens `service.name` span scope; defaults to {@link KERNEL_TRACER_NAME}. */
  serviceName?: string;
  /** Extra attributes applied to every span started by this tracer. */
  defaultAttributes?: Attributes;
}

/**
 * High-level OpenTelemetry bridge for AgentKernel.
 *
 * Wraps the OTEL API so callers never touch the low-level `trace`/`context`
 * globals directly, while remaining a thin layer: the underlying tracer is
 * still accessible via {@link KernelTracer.getTracer} for advanced use.
 */
export class KernelTracer {
  private readonly tracer: Tracer;
  private readonly defaultAttributes: Attributes;

  constructor(config: KernelTracingConfig = {}) {
    installAsyncLocalStorage();
    installW3CTraceContextPropagator();
    this.tracer = trace.getTracer(config.serviceName ?? KERNEL_TRACER_NAME);
    this.defaultAttributes = config.defaultAttributes ?? {};
  }

  /** Return the underlying OpenTelemetry ``Tracer`` for advanced usage. */
  getTracer(): Tracer {
    return this.tracer;
  }

  /** Start a span named ``<name>`` with the configured default attributes. */
  startSpan(name: string, attributes?: Attributes, options?: SpanOptions): Span {
    return this.tracer.startSpan(name, {
      attributes: { ...this.defaultAttributes, ...attributes },
      ...options,
    });
  }

  /** Start a span for an agent-scoped operation. */
  startAgentSpan(
    agentId: string,
    action: string,
    attributes?: Attributes,
    options?: SpanOptions,
  ): Span {
    return this.startSpan(
      `agent.${action}`,
      { 'agent.id': agentId, 'agent.action': action, ...attributes },
      options,
    );
  }

  /** Start a span for a task-scoped operation. */
  startTaskSpan(
    taskId: string,
    operation: string,
    attributes?: Attributes,
    options?: SpanOptions,
  ): Span {
    return this.startSpan(
      `task.${operation}`,
      { 'task.id': taskId, 'task.operation': operation, ...attributes },
      options,
    );
  }

  /**
   * Execute ``fn`` inside an active span, emitting an OK/ERROR status based on
   * whether it resolves or rejects. The span is always ended, and the
   * exception is re-thrown so control flow is unchanged.
   */
  async runInSpan<T>(
    name: string,
    fn: (span: Span) => T | Promise<T>,
    attributes?: Attributes,
    options?: SpanOptions,
  ): Promise<T> {
    const span = this.startSpan(name, attributes, options);
    return await context.with(trace.setSpan(context.active(), span), async () => {
      try {
        const result = await fn(span);
        if (span.isRecording()) {
          span.setStatus({ code: SpanStatusCode.OK });
        }
        return result;
      } catch (err) {
        if (span.isRecording()) {
          this.recordException(span, err);
        }
        throw err;
      } finally {
        span.end();
      }
    });
  }

  /**
   * Wrap ``fn`` as a task span ``task.<operation>`` tagged with ``task.id``.
   * Convenience for the most common kernel pattern: instrumenting a submitted
   * task's execution without touching the scheduler.
   */
  runTaskInSpan<T>(
    taskId: string,
    operation: string,
    fn: (span: Span) => T | Promise<T>,
    attributes?: Attributes,
    options?: SpanOptions,
  ): Promise<T> {
    return this.runInSpan(
      `task.${operation}`,
      fn,
      { 'task.id': taskId, 'task.operation': operation, ...attributes },
      options,
    );
  }

  /** Record an exception on ``span`` and mark it as erroneous. */
  recordException(span: Span, error: unknown): void {
    const exception =
      error instanceof Error
        ? error
        : { name: 'Error', message: String(error), stack: undefined };
    span.recordException(exception);
    const message = error instanceof Error ? error.message : String(error);
    span.setStatus({ code: SpanStatusCode.ERROR, message });
  }

  /** Mark ``span`` as a successful operation. */
  setOk(span: Span): void {
    span.setStatus({ code: SpanStatusCode.OK });
  }

  /** Inject the current trace context into a carrier (W3C Trace Context). */
  inject(carrier: Record<string, string>, setter?: TextMapSetter): void {
    propagation.inject(context.active(), carrier, setter);
  }

  /**
   * Extract a trace context from a carrier (W3C Trace Context), returning the
   * parent context to bind to new spans with {@link runInSpanAsChild}.
   */
  extract(carrier: Record<string, string>, getter?: TextMapGetter): Context {
    return propagation.extract(context.active(), carrier, getter);
  }

  /** Bind ``parent`` as the active context and run ``fn`` under it. */
  async runInContext<T>(
    parent: Context,
    fn: () => T | Promise<T>,
  ): Promise<T> {
    return await context.with(parent, fn);
  }

  /** Run a span as a child of ``parent`` (from {@link extract}). */
  async runInSpanAsChild<T>(
    parent: Context,
    name: string,
    fn: (span: Span) => T | Promise<T>,
    attributes?: Attributes,
    options?: SpanOptions,
  ): Promise<T> {
    return await context.with(parent, () =>
      this.runInSpan(name, fn, attributes, options),
    );
  }

  /** The currently active span, or ``undefined`` when there is none. */
  activeSpan(): Span | undefined {
    return trace.getSpan(context.active());
  }

  /** The root OpenTelemetry context (propagation baseline). */
  rootContext(): Context {
    return ROOT_CONTEXT;
  }
}

export { SpanStatusCode, ROOT_CONTEXT };
export type { Attributes, Context, Span, SpanOptions, TextMapGetter, TextMapSetter, Tracer };

/**
 * Convenience factory: build a {@link KernelTracer} with fluent defaults.
 */
export function createTracer(config?: KernelTracingConfig): KernelTracer {
  return new KernelTracer(config);
}