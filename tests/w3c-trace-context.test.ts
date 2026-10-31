import { describe, expect, it } from 'vitest';
import {
  parseTraceparent,
  TRACEPARENT_HEADER,
  W3CTraceContextPropagator,
} from '../src/w3c-trace-context.js';

describe('parseTraceparent', () => {
  const validTraceId = '4bf92f3577b34da6a3ce929d0e0e4736';
  const validSpanId = '00f067aa0ba902b7';

  it('parses a valid version-00 traceparent', () => {
    const sc = parseTraceparent(`00-${validTraceId}-${validSpanId}-01`);
    expect(sc).toBeDefined();
    expect(sc!.traceId).toBe(validTraceId);
    expect(sc!.spanId).toBe(validSpanId);
    expect(sc!.traceFlags).toBe(1);
    expect(sc!.isRemote).toBe(true);
  });

  it('parses unsampled flags (00)', () => {
    const sc = parseTraceparent(`00-${validTraceId}-${validSpanId}-00`);
    expect(sc!.traceFlags).toBe(0);
  });

  it('rejects a malformed header (wrong segment count)', () => {
    expect(parseTraceparent(`00-${validTraceId}-${validSpanId}`)).toBeUndefined();
  });

  it('rejects an unsupported version', () => {
    expect(parseTraceparent(`01-${validTraceId}-${validSpanId}-01`)).toBeUndefined();
  });

  it('rejects an all-zero trace id', () => {
    expect(parseTraceparent(`00-${'0'.repeat(32)}-${validSpanId}-01`)).toBeUndefined();
  });

  it('rejects an all-zero span id', () => {
    expect(parseTraceparent(`00-${validTraceId}-${'0'.repeat(16)}-01`)).toBeUndefined();
  });

  it('rejects non-hex ids', () => {
    expect(parseTraceparent(`00-${'z'.repeat(32)}-${validSpanId}-01`)).toBeUndefined();
    expect(parseTraceparent(`00-${validTraceId}-${'g'.repeat(16)}-01`)).toBeUndefined();
  });

  it('rejects invalid trace flags', () => {
    expect(parseTraceparent(`00-${validTraceId}-${validSpanId}-zz`)).toBeUndefined();
  });

  it('accepts surrounding whitespace', () => {
    const sc = parseTraceparent(`  00-${validTraceId}-${validSpanId}-01  `);
    expect(sc).toBeDefined();
    expect(sc!.spanId).toBe(validSpanId);
  });
});

describe('W3CTraceContextPropagator', () => {
  it('advertises the traceparent field', () => {
    const propagator = new W3CTraceContextPropagator();
    expect(propagator.fields()).toEqual([TRACEPARENT_HEADER]);
  });

  it('has a constant header name of traceparent', () => {
    expect(TRACEPARENT_HEADER).toBe('traceparent');
  });
});