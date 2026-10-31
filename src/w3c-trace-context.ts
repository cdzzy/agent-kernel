/**
 * W3C Trace Context propagator (zero-dependency).
 *
 * Implements the `traceparent` header of the W3C Trace Context spec so
 * AgentKernel spans can cross process/service boundaries without pulling in
 * the heavier `@opentelemetry/core` package. The format is fixed by the spec:
 *
 *   traceparent: 00-{trace-id:32hex}-{parent-id:16hex}-{trace-flags:2hex}
 *
 * This is intentionally a small, spec-complete implementation of the version
 * `00` header (the only version currently defined). Hosts that already run the
 * OpenTelemetry NodeSDK get an equivalent propagator out of the box; this one
 * exists so the `agent-kernel` tracer is propagation-capable on its own.
 */

import { propagation, trace } from '@opentelemetry/api';
import type {
  Context,
  SpanContext,
  TextMapGetter,
  TextMapPropagator,
  TextMapSetter,
} from '@opentelemetry/api';

export const TRACEPARENT_HEADER = 'traceparent';

const TRACE_ID_LENGTH = 32;
const SPAN_ID_LENGTH = 16;
const VERSION = '00';

/** True when ``id`` is a full-length, non-zero lowercase hex string. */
function isValidHexId(id: string, length: number): boolean {
  return new RegExp(`^[0-9a-f]{${length}}$`).test(id) && id !== '0'.repeat(length);
}

/** Format a span context as a ``traceparent`` value. */
function formatTraceparent(spanContext: SpanContext): string {
  const flags = spanContext.traceFlags.toString(16).padStart(2, '0');
  return `${VERSION}-${spanContext.traceId}-${spanContext.spanId}-${flags}`;
}

/**
 * Parse a ``traceparent`` value into a remote {@link SpanContext}, or
 * ``undefined`` when the header is missing, malformed, or an unsupported
 * version.
 */
export function parseTraceparent(header: string): SpanContext | undefined {
  const parts = header.trim().split('-');
  if (parts.length !== 4) {
    return undefined;
  }
  const [version, traceId, spanId, traceFlagsRaw] = parts;

  if (version !== VERSION) {
    return undefined;
  }
  if (!isValidHexId(traceId, TRACE_ID_LENGTH)) {
    return undefined;
  }
  if (!isValidHexId(spanId, SPAN_ID_LENGTH)) {
    return undefined;
  }
  if (!/^[0-9a-f]{2}$/.test(traceFlagsRaw)) {
    return undefined;
  }

  const traceFlags = parseInt(traceFlagsRaw, 16);
  return {
    traceId,
    spanId,
    traceFlags,
    isRemote: true,
  };
}

/** Pick the first scalar value from a getter result (may be a list). */
function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * A spec-compliant W3C Trace Context propagator for ``Record<string, string>``
 * carriers (e.g. HTTP headers).
 */
export class W3CTraceContextPropagator implements TextMapPropagator {
  inject(context: Context, carrier: Record<string, string>, setter: TextMapSetter): void {
    const spanContext = trace.getSpanContext(context);
    if (!spanContext || !trace.isSpanContextValid(spanContext)) {
      return;
    }
    setter.set(carrier, TRACEPARENT_HEADER, formatTraceparent(spanContext));
  }

  extract(context: Context, carrier: Record<string, string>, getter: TextMapGetter): Context {
    const header = firstValue(getter.get(carrier, TRACEPARENT_HEADER));
    if (!header) {
      return context;
    }
    const spanContext = parseTraceparent(header);
    if (!spanContext) {
      return context;
    }
    return trace.setSpanContext(context, spanContext);
  }

  fields(): string[] {
    return [TRACEPARENT_HEADER];
  }
}

let _w3cPropagatorInstalled = false;

/**
 * Idempotently register the {@link W3CTraceContextPropagator} as the global
 * propagator. Called automatically when a {@link KernelTracer} is constructed;
 * safe to call directly when a host wants the propagator on its own.
 */
export function installW3CTraceContextPropagator(): void {
  if (_w3cPropagatorInstalled) {
    return;
  }
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  _w3cPropagatorInstalled = true;
}