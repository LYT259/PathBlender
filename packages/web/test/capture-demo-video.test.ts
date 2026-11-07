import { describe, expect, it } from 'vitest';
// @ts-expect-error repository scripts are plain JavaScript
import { isLocalRequest, outputPaths } from '../../../scripts/capture-demo-video.mjs';

describe('capture-demo-video helpers', () => {
  it('classifies only same-origin, data and blob requests as local', () => {
    const base = 'http://localhost:4173/';
    for (const ok of ['http://localhost:4173/', 'http://localhost:4173/assets/field.glb',
                      'http://127.0.0.1:4173/sw.js', 'data:text/css,.', 'blob:http://localhost:4173/x'])
      expect(isLocalRequest(ok, base), ok).toBe(true);
    for (const bad of ['https://cdn.example.com/font.woff2', 'http://localhost:9999/other',
                       'https://lyt259.github.io/PathBlender/feed.json', 'file:///etc/passwd'])
      expect(isLocalRequest(bad, base), bad).toBe(false);
  });
  it('pairs mp4 and vtt outputs per language in the shared screenshots dir', () => {
    const p = outputPaths('en', 'docs/screenshots');
    expect(p.mp4).toBe('docs/screenshots/demo-video.en.mp4');
    expect(p.vtt).toBe('docs/screenshots/demo-video.en.vtt');
    expect(outputPaths('zh', 'docs/screenshots').mp4).toBe('docs/screenshots/demo-video.zh.mp4');
  });
});
