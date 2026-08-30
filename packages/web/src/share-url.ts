/**
 * URL-hash session sharing: the session file, gzip-compressed and
 * base64url-encoded after the '#'. Privacy-friendly — the whole session
 * lives in the link, nothing is uploaded anywhere.
 */

import { deserializeSession, serializeSession } from '@pathblender/core';
import type { FieldPackage, SessionTrajectory } from '@pathblender/core';

const PREFIX = '#s=';

export async function sessionToHash(
  robots: readonly SessionTrajectory[],
  fieldId: string,
  field?: FieldPackage,
): Promise<string> {
  const json = serializeSession(robots, fieldId, field);
  const bytes = new TextEncoder().encode(json);
  const compressed = await gzip(bytes);
  return PREFIX + toBase64Url(compressed);
}

export async function hashToSession(
  hash: string,
): Promise<
  | {
      fieldId: string;
      field?: FieldPackage;
      robots: SessionTrajectory[];
    }
  | undefined
> {
  if (!hash.startsWith(PREFIX)) return undefined;
  try {
    const bytes = fromBase64Url(hash.slice(PREFIX.length));
    const json = await gunzip(bytes);
    return deserializeSession(new TextDecoder().decode(json));
  } catch {
    return undefined;
  }
}

export function sessionUrlFromHash(hash: string): string {
  return `${location.origin}${location.pathname}${location.search}${hash}`;
}

async function gzip(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('gzip');
  const src = new Response(new Uint8Array(data)).body!;
  return new Uint8Array(await new Response(src.pipeThrough(cs)).arrayBuffer());
}

async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('gzip');
  const src = new Response(new Uint8Array(data)).body!;
  return new Uint8Array(await new Response(src.pipeThrough(ds)).arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
