import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const doc = readFileSync(resolve(__dirname, '../../../docs/user-research/onboarding-observation-protocol.md'), 'utf8');
describe('§六 observation materials', () => {
  it('is prepared but explicitly not executed', () => {
    expect(doc).toContain('Status: NOT EXECUTED');
  });
  it('promises no telemetry and voluntary anonymized participation', () => {
    expect(/no telemetry/i.test(doc)).toBe(true);
    expect(/voluntar/i.test(doc)).toBe(true);
    expect(/anonymi[sz]ed/i.test(doc)).toBe(true);
  });
  it('carries all six §六 success criteria and both entry cohorts', () => {
    for (const marker of ['own words', 'import', 'replay', 'mirror', 'alliance', 'help', 'README/download', 'directly'])
      expect(doc.includes(marker) || doc.includes(marker.toLowerCase()), marker).toBe(true);
  });
  it('is bilingual', () => {
    expect(doc).toMatch(/# .*[Oo]bservation/);
    expect(doc).toMatch(/观察|知情同意/);
  });
});
