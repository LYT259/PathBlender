/**
 * CTRE .hoot probe (2026-11, HOOT desktop import). Work-package verified
 * facts: the compliancy field sits at byte offset 70, and no owlet release
 * converts compliancy < 6. Per plan ruling R1 the field is read as a
 * single unsigned byte (getUint8) — the plan's earlier u32-LE reading was
 * speculative and is not implemented. Real-sample validation is still
 * pending; this probe only gates converter eligibility by file name and
 * header byte.
 */

export const HOOT_COMPLIANCY_OFFSET = 70;
export const HOOT_MIN_COMPLIANCY = 6;

export type HootProbeResult =
  | { kind: 'convertible'; compliancy: number }
  | { kind: 'rejected'; reason: 'truncated' | 'compliancy-too-old'; compliancy: number | null };

/** File-name check used by the UI to route .hoot files to the converter. */
export function isHootFileName(name: string): boolean {
  return /\.hoot$/i.test(name);
}

export function probeHootFile(bytes: Uint8Array): HootProbeResult {
  if (bytes.length <= HOOT_COMPLIANCY_OFFSET) {
    return { kind: 'rejected', reason: 'truncated', compliancy: null };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const compliancy = view.getUint8(HOOT_COMPLIANCY_OFFSET);
  if (compliancy < HOOT_MIN_COMPLIANCY) {
    return { kind: 'rejected', reason: 'compliancy-too-old', compliancy };
  }
  return { kind: 'convertible', compliancy };
}
