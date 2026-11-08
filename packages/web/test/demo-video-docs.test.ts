import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../../..'); // repo root
describe('demo video guide links', () => {
  it('both guides link their language pair of mp4 + vtt with existing files', () => {
    for (const [guide, lang] of [['docs/user-guide.en.md', 'en'], ['docs/user-guide.zh.md', 'zh']] as const) {
      const md = readFileSync(resolve(root, guide), 'utf8');
      expect(md, `${guide} mp4`).toContain(`(screenshots/demo-video.${lang}.mp4)`);
      expect(md, `${guide} vtt`).toContain(`(screenshots/demo-video.${lang}.vtt)`);
      for (const f of [`docs/screenshots/demo-video.${lang}.mp4`, `docs/screenshots/demo-video.${lang}.vtt`])
        expect(existsSync(resolve(root, f)), f).toBe(true);
    }
  });
});
