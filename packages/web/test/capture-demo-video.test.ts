import { describe, expect, it } from 'vitest';
// @ts-expect-error repository scripts are plain JavaScript
import { blackIntervals, isLocalRequest, outputPaths, sceneMidpoints, trimSeconds } from '../../../scripts/capture-demo-video.mjs';
// @ts-expect-error repository scripts are plain JavaScript
import { SCENES } from '../../../scripts/demo-video-captions.mjs';

describe('capture-demo-video helpers', () => {
  it('a failed blackdetect run throws instead of reading as no black interval', () => {
    // FFmpeg exiting nonzero without emitting black_start must never record
    // a PASS — the scan failed, it did not come back clean.
    expect(() => blackIntervals({ status: 1, stderr: '' })).toThrow(/blackdetect failed/);
    expect(() => blackIntervals({ status: null, stderr: 'killed' })).toThrow(/blackdetect failed/);
  });
  it('parses black intervals on success and stays empty when clean', () => {
    const lines = '[blackdetect @ 0x1] black_start:0 black_end:1.04\nother noise\n';
    expect(blackIntervals({ status: 0, stderr: lines })).toHaveLength(1);
    expect(blackIntervals({ status: 0, stderr: 'clean run' })).toEqual([]);
  });
  it('classifies only same-origin, data and blob requests as local', () => {
    const base = 'http://localhost:4173/';
    for (const ok of ['http://localhost:4173/', 'http://localhost:4173/assets/field.glb',
                      'http://127.0.0.1:4173/sw.js', 'data:text/css,.', 'blob:http://localhost:4173/x'])
      expect(isLocalRequest(ok, base), ok).toBe(true);
    for (const bad of ['https://cdn.example.com/font.woff2', 'http://localhost:9999/other',
                       'https://lyt259.github.io/PathBlender/feed.json', 'file:///etc/passwd'])
      expect(isLocalRequest(bad, base), bad).toBe(false);
  });
  it('derives scene midpoints from the actually held scene times, not storyboard targets', () => {
    const marks = [
      { id: 'welcome', start: 0, end: 6.4 },
      { id: 'import', start: 6.4, end: 19.3 },
      { id: 'playback', start: 19.3, end: 28.3 },
    ];
    const midpoints = sceneMidpoints(marks);
    expect(midpoints).toHaveLength(3);
    expect(midpoints[0]).toBeCloseTo(3.2);
    expect(midpoints[1]).toBeCloseTo(12.85);
    expect(midpoints[2]).toBeCloseTo(23.8);
  });
  it('bounds the encoded mp4 at the storyboard content end plus a 1 s tail', () => {
    expect(trimSeconds([
      { id: 'a', targetSeconds: 6 },
      { id: 'b', targetSeconds: 10 },
    ])).toBe(17);
    expect(trimSeconds(SCENES)).toBe(83);
  });
  it('pairs mp4 and vtt outputs per language in the shared screenshots dir', () => {
    const p = outputPaths('en', 'docs/screenshots');
    expect(p.mp4).toBe('docs/screenshots/demo-video.en.mp4');
    expect(p.vtt).toBe('docs/screenshots/demo-video.en.vtt');
    expect(outputPaths('zh', 'docs/screenshots').mp4).toBe('docs/screenshots/demo-video.zh.mp4');
  });
});
