/** Defensive JSON field readers: external files are untrusted. */

import { ParseError } from './parse-error';

export function asRecord(v: unknown): Record<string, unknown> | undefined {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

export function asArray(v: unknown): unknown[] | undefined {
  return Array.isArray(v) ? v : undefined;
}

export function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

export function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

/** Parse JSON text with a clear error kind. */
export function parseJson(text: string, fileName: string): unknown {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new ParseError(
      'invalid-json',
      fileName,
      e instanceof Error ? e.message : String(e),
    );
  }
}
