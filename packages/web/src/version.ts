/**
 * Version arithmetic and display formatting for the release scheme
 * `0.1.4-beta.1 → 0.1.4-beta.2 → … → 0.1.4` (user directive 2026-10-01:
 * every merge into beta allocates the next number; a release drops the
 * suffix; a number never maps to two different contents).
 *
 * Semver note: `-beta.N` is a prerelease identifier, so `0.1.4-beta.2 <
 * 0.1.4` compares correctly and the Tauri updater / tag routing accept it.
 * Build-metadata suffixes (`0.1.4+5`) are deliberately NOT used — semver
 * ignores them in precedence, which would break update offers.
 */

export interface ParsedVersion {
  /** The `0.1.4` part. */
  core: string;
  /** The `beta.2` part without the dash, or null for a release. */
  prerelease: string | null;
}

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-(beta)\.(\d+))?$/;

export function parseVersion(v: string): ParsedVersion | null {
  const m = VERSION_RE.exec(v);
  if (!m) return null;
  return { core: `${m[1]}.${m[2]}.${m[3]}`, prerelease: m[4] && m[5] ? `beta.${m[5]}` : null };
}

/** Next beta number: `0.1.3 → 0.1.4-beta.1`, `0.1.4-beta.2 → 0.1.4-beta.3`. */
export function nextBetaVersion(current: string): string {
  const p = parseVersion(current);
  if (!p) throw new Error(`unrecognised version: ${current}`);
  if (p.prerelease) return `${p.core}-beta.${Number(p.prerelease.split('.')[1]) + 1}`;
  const [maj = 0, min = 0, patch = 0] = p.core.split('.').map(Number);
  return `${maj}.${min}.${patch + 1}-beta.1`;
}

/** Release promotion: `0.1.4-beta.2 → 0.1.4`. Errors on an already-clean version. */
export function releaseVersion(current: string): string {
  const p = parseVersion(current);
  if (!p) throw new Error(`unrecognised version: ${current}`);
  if (!p.prerelease) throw new Error(`${current} carries no -beta.N suffix — nothing to promote`);
  return p.core;
}

/** `0.1.4-beta.2` → `0.1.4 · Beta 2`; a release renders bare (`0.1.4`). */
export function formatVersionDisplay(v: string): string {
  const p = parseVersion(v);
  if (!p) return v;
  return p.prerelease ? `${p.core} · Beta ${p.prerelease.split('.')[1]}` : p.core;
}
