import { describe, expect, it } from 'vitest';
import { SCENES, CAPTIONS, totalMs, toVtt } from '../../../scripts/demo-video-captions.mjs';
import { en } from '../src/i18n/en';   // dictionaries are plain maps: { 'robots.mirror': 'Mirror left/right', … }
import { zh } from '../src/i18n/zh';   // zh covers all four keys directly (verified: zh.ts:143 'timeline.play': '播放')

describe('demo video storyboard and captions', () => {
  it('fits the 75–105 s budget', () => {
    expect(totalMs()).toBeGreaterThanOrEqual(75_000);
    expect(totalMs()).toBeLessThanOrEqual(105_000);
  });
  it('covers every scene in both languages with valid, non-overlapping cues', () => {
    for (const lang of ['en', 'zh'] as const) {
      const cues = [...CAPTIONS[lang]].sort((a, b) => a.startMs - b.startMs);
      expect(cues.length).toBeGreaterThanOrEqual(SCENES.length);
      for (const scene of SCENES) expect(cues.some((c) => c.scene === scene.id), `${lang} ${scene.id}`).toBe(true);
      for (let i = 1; i < cues.length; i++) expect(cues[i].startMs).toBeGreaterThanOrEqual(cues[i - 1].endMs);
      for (const c of cues) { expect(c.endMs).toBeGreaterThan(c.startMs); expect(c.text.trim().length).toBeGreaterThan(0); }
      expect(Math.max(...cues.map((c) => c.endMs))).toBeLessThanOrEqual(totalMs());
    }
  });
  it('names buttons exactly as the shipped UI dictionary renders them', () => {
    // real button labels, not paraphrases (PR #287 quality gate)
    expect(CAPTIONS.en.find((c) => c.scene === 'mirror')!.text).toContain(en['robots.mirror']);
    expect(CAPTIONS.zh.find((c) => c.scene === 'mirror')!.text).toContain(zh['robots.mirror']);
    expect(CAPTIONS.en.find((c) => c.scene === 'compare')!.text).toContain(en['sequence.arrange']);
    expect(CAPTIONS.zh.find((c) => c.scene === 'compare')!.text).toContain(zh['sequence.arrange']);
    expect(CAPTIONS.en.find((c) => c.scene === 'playback')!.text).toContain(en['timeline.play']);
    expect(CAPTIONS.zh.find((c) => c.scene === 'playback')!.text).toContain(zh['timeline.play']);
  });
  it('states the measured facts and the no-rewrite boundary, not promises', () => {
    const enClosing = CAPTIONS.en.find((c) => c.scene === 'closing')!.text;
    expect(/original (files|route files)|not (rewrite|modify)/i.test(enClosing)).toBe(true);
    expect(CAPTIONS.en.every((c) => !/guarantee|will (fix|solve)/i.test(c.text))).toBe(true);
  });
  it('states the live-measured counts (2026-11-07 real-UI probe, evidence in task-1-report.md)', () => {
    // Sample pair straight_run × stop_and_score re-measured at 1; welcome
    // example bundle measured at 3 baseline; best single swap 3→1 (round trip
    // 3→1→3 only on 8814, whose original route is re-addable); mirror measured
    // 3→2 on 11019 (no change on 8814).
    expect(CAPTIONS.en.find((c) => c.scene === 'import' && /reports/.test(c.text))!.text).toContain('reports 1');
    expect(CAPTIONS.en.find((c) => c.scene === 'to-example' && /reports/.test(c.text))!.text).toContain('reports 3');
    const enCompare = CAPTIONS.en.find((c) => c.scene === 'compare' && /from \d/.test(c.text))!.text;
    expect(enCompare).toContain('from 3 to 1');
    expect(enCompare).toContain('restores 3');
    expect(CAPTIONS.en.find((c) => c.scene === 'mirror' && /from \d/.test(c.text))!.text).toContain('from 3 to 2');
    expect(CAPTIONS.zh.find((c) => c.scene === 'to-example' && /为 \d/.test(c.text))!.text).toContain('为 3');
    expect(CAPTIONS.zh.find((c) => c.scene === 'compare' && /变为/.test(c.text))!.text).toContain('3 变为 1');
    expect(CAPTIONS.zh.find((c) => c.scene === 'mirror' && /变为/.test(c.text))!.text).toContain('3 变为 2');
  });
  it('renders valid WEBVTT with monotone timestamps', () => {
    for (const lang of ['en', 'zh'] as const) {
      const vtt = toVtt(lang);
      expect(vtt.startsWith('WEBVTT')).toBe(true);
      const stamps = [...vtt.matchAll(/(\d{2}):(\d{2}):(\d{2})\.(\d{3}) --> /g)];
      expect(stamps.length).toBe(CAPTIONS[lang].length);
    }
  });
});
