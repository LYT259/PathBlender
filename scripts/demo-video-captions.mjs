// Storyboard and bilingual captions for the onboarding demo video.
// Pure data plus one generator: no browser, media, or file side effects.
// Copy states only measured facts, and button names must match the shipped
// i18n dictionaries (packages/web/src/i18n/{en,zh}.ts) — pinned by
// packages/web/test/demo-video-captions.test.ts. Counts re-measured against
// the live app on 2026-11-07 (example bundle baseline 3, swap 3→1, mirror
// 3→2); evidence in .superpowers/sdd/…/task-1-report.md.

export const SCENES = [
  { id: 'welcome', targetSeconds: 6 },
  { id: 'import', targetSeconds: 10 },
  { id: 'playback', targetSeconds: 10 },
  { id: 'locate', targetSeconds: 10 },
  { id: 'to-example', targetSeconds: 8 },
  { id: 'compare', targetSeconds: 14 },
  { id: 'mirror', targetSeconds: 10 },
  { id: 'alliance', targetSeconds: 8 },
  { id: 'closing', targetSeconds: 6 },
];

export const CAPTIONS = {
  en: [
    { scene: 'welcome', startMs: 500, endMs: 5500, text: "PathBlender blends each team's route files into one field view." },
    { scene: 'import', startMs: 6500, endMs: 11000, text: "Both teams' exported files are processed locally in the browser." },
    { scene: 'import', startMs: 11500, endMs: 15500, text: 'Two robots appear, and the conflict check reports 1.' },
    { scene: 'playback', startMs: 16500, endMs: 21000, text: 'Press Play to move both robots on one shared clock.' },
    { scene: 'playback', startMs: 21500, endMs: 25500, text: 'Pause anywhere to inspect a single moment.' },
    { scene: 'locate', startMs: 26500, endMs: 31000, text: 'The checks panel lists each conflict moment.' },
    { scene: 'locate', startMs: 31500, endMs: 35500, text: 'Click an entry to jump the clock right to it.' },
    { scene: 'to-example', startMs: 36500, endMs: 40000, text: '"Try an example" loads three real robots with routes.' },
    { scene: 'to-example', startMs: 40500, endMs: 43500, text: 'The conflict check reports 3.' },
    { scene: 'compare', startMs: 44500, endMs: 51000, text: '"Arrange timeline" swaps in another route from the library.' },
    { scene: 'compare', startMs: 51500, endMs: 57500, text: 'The check goes from 3 to 1; swapping back restores 3.' },
    { scene: 'mirror', startMs: 58500, endMs: 63000, text: '"Mirror left/right" flips robot 11019 to the mirrored side.' },
    { scene: 'mirror', startMs: 63500, endMs: 67500, text: 'The check goes from 3 to 2.' },
    { scene: 'alliance', startMs: 68500, endMs: 75500, text: 'Switch the whole session red or blue: verdicts stay the same.' },
    { scene: 'closing', startMs: 76500, endMs: 79000, text: 'The analysis view never rewrites your original files or robot programs.' },
    { scene: 'closing', startMs: 79500, endMs: 81500, text: 'Learn more in Help → Quick guide.' },
  ],
  zh: [
    { scene: 'welcome', startMs: 500, endMs: 5500, text: 'PathBlender 把各队导出的路线文件融合到同一场地视图。' },
    { scene: 'import', startMs: 6500, endMs: 11000, text: '两支队伍导出的文件全部在浏览器本地处理。' },
    { scene: 'import', startMs: 11500, endMs: 15500, text: '两台机器人出现，冲突检查结果为 1。' },
    { scene: 'playback', startMs: 16500, endMs: 21000, text: '按下“播放”，两台机器人在同一时钟上移动。' },
    { scene: 'playback', startMs: 21500, endMs: 25500, text: '可随时暂停，检视任意时刻。' },
    { scene: 'locate', startMs: 26500, endMs: 31000, text: '检查面板列出每个冲突时刻。' },
    { scene: 'locate', startMs: 31500, endMs: 35500, text: '点击条目，时钟直接跳到该时刻。' },
    { scene: 'to-example', startMs: 36500, endMs: 40000, text: '“体验示例”载入三台真实机器人的路线。' },
    { scene: 'to-example', startMs: 40500, endMs: 43500, text: '示例的冲突检查为 3。' },
    { scene: 'compare', startMs: 44500, endMs: 51000, text: '“编排时间轴”可从路线库换入另一条路线。' },
    { scene: 'compare', startMs: 51500, endMs: 57500, text: '检查从 3 变为 1；换回原路线又回到 3。' },
    { scene: 'mirror', startMs: 58500, endMs: 63000, text: '“左右镜像”把 11019 翻转到镜像一侧。' },
    { scene: 'mirror', startMs: 63500, endMs: 67500, text: '检查从 3 变为 2。' },
    { scene: 'alliance', startMs: 68500, endMs: 75500, text: '整个会话切换红方或蓝方：检查结论保持不变。' },
    { scene: 'closing', startMs: 76500, endMs: 79000, text: '分析视图绝不改写你的原始文件或机器人程序。' },
    { scene: 'closing', startMs: 79500, endMs: 81500, text: '更多内容见“帮助 → 快速指南”。' },
  ],
};

export function totalMs() {
  return SCENES.reduce((sum, scene) => sum + scene.targetSeconds * 1000, 0);
}

function stamp(ms) {
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  const millis = ms % 1000;
  const two = (n) => String(n).padStart(2, '0');
  return `${two(hours)}:${two(minutes)}:${two(seconds)}.${String(millis).padStart(3, '0')}`;
}

export function toVtt(lang) {
  const blocks = CAPTIONS[lang].map((cue) => `${stamp(cue.startMs)} --> ${stamp(cue.endMs)}\n${cue.text}`);
  return `WEBVTT\n\n${blocks.join('\n\n')}\n`;
}
