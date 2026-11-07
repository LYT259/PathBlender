/**
 * HOOT probe tests. 合成桩，无真实样本：every buffer below is synthetic
 * (all-zero bytes with a single compliancy byte); per plan ruling R1 the
 * field is the verified unsigned byte at offset 70 — no real .hoot sample
 * has been validated yet, so these tests pin routing and thresholds only.
 */

import { describe, expect, it } from 'vitest';
import { HOOT_COMPLIANCY_OFFSET, isHootFileName, probeHootFile } from '../src/parsers/hoot';

/** 合成 .hoot 桩：全零字节，仅在 compliancy 偏移写入一个无符号字节（截断桩放不下该字节）。 */
function stubHoot(compliancy: number, len = 128): Uint8Array {
  const b = new Uint8Array(len);
  if (len > HOOT_COMPLIANCY_OFFSET) {
    new DataView(b.buffer).setUint8(HOOT_COMPLIANCY_OFFSET, compliancy);
  }
  return b;
}

describe('hoot probe (synthetic stubs only)', () => {
  it('routes by file name', () => {
    expect(isHootFileName('Log.hoot')).toBe(true);
    expect(isHootFileName('a.hoot.bak')).toBe(false);
  });
  it('accepts compliancy >= 6 and reports the number', () => {
    expect(probeHootFile(stubHoot(6))).toEqual({ kind: 'convertible', compliancy: 6 });
    expect(probeHootFile(stubHoot(13))).toEqual({ kind: 'convertible', compliancy: 13 });
  });
  it('rejects compliancy < 6 (no owlet supports it)', () => {
    expect(probeHootFile(stubHoot(5))).toEqual({ kind: 'rejected', reason: 'compliancy-too-old', compliancy: 5 });
    expect(probeHootFile(stubHoot(0))).toEqual({ kind: 'rejected', reason: 'compliancy-too-old', compliancy: 0 });
  });
  it('rejects files shorter than offset+1 as truncated', () => {
    expect(probeHootFile(stubHoot(9, HOOT_COMPLIANCY_OFFSET)))
      .toEqual({ kind: 'rejected', reason: 'truncated', compliancy: null });
    // Exact boundary: offset+1 bytes still reach the compliancy byte.
    expect(probeHootFile(stubHoot(6, HOOT_COMPLIANCY_OFFSET + 1)))
      .toEqual({ kind: 'convertible', compliancy: 6 });
  });
});
