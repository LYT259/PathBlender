/**
 * Solution package export (2026-10-06, user-confirmed spec): one ZIP with
 * everything a strategy group needs to review an alliance plan offline —
 *
 *   README.md          fixed name, bilingual (EN + 中文) summary
 *   完整方案.pb        the full session, exactly what File ▸ Save writes
 *   回放.mp4           2D full-field replay, fixed 0–20 s, normal speed,
 *                      H.264 preferred (webm fallback where the engine
 *                      cannot record mp4; documented in the README)
 *   路线总览.png       2D full-field overview at t=0
 *   各队方案/<队>.pb   one session per team slot — delays, sequences,
 *                      routes, profiles, colors and mirroring preserved
 *   原始导入文件/<队>/ the original imported files, byte-identical
 *                      (only when they were imported in this app session)
 *
 * Pure browser APIs only — no new npm dependencies. The replay is recorded
 * in real time off-screen with MediaRecorder (H.264/AVC in mp4 first), so
 * export takes ~20 s and the window must stay visible while it runs.
 */

import type {
  CollisionInterval,
  FieldPackage,
  OutOfBoundsInterval,
  SessionTrajectory,
} from '@pathblender/core';
import { serializeSession } from '@pathblender/core';
import { renderFieldFrame, fitViewFor } from './canvas2d-render';
import { MK5I_MODULE_TOP_URL } from './robot-sprites';
import { buildZip, type ZipEntry } from './zip';

const FIXED_VIDEO_SECONDS = 20;
const VIDEO_WIDTH = 1920;
const VIDEO_HEIGHT = 1080;
const VIDEO_BITRATE = 8_000_000;

export interface SolutionCapture {
  renderPng?: (
    ctx: ExportScene,
  ) => Promise<Uint8Array | null>;
  recordVideo?: (
    ctx: ExportScene,
    mime: string,
    seconds: number,
  ) => Promise<{ bytes: Uint8Array; mime: string; ext: string } | null>;
}

interface ExportScene {
  field: FieldPackage;
  fieldImg: HTMLImageElement | null;
  sprite: HTMLImageElement | null;
  robots: SessionTrajectory[];
  conflicts: CollisionInterval[];
  bounds: OutOfBoundsInterval[];
  width: number;
  height: number;
}

export interface SolutionPackageOptions {
  /** Alliance-view robots — the same array File ▸ Save serializes. */
  robots: SessionTrajectory[];
  /** The replay image set: exactly what the 2D workspace shows (visible robots). */
  visibleRobots: SessionTrajectory[];
  field: FieldPackage;
  fieldId: string;
  /** serializeSession's field argument (custom-field calibration only). */
  customFieldForSession: FieldPackage | undefined;
  fieldImageUrl?: string;
  /** relPath → File, captured at import time (App keeps the store). */
  rawFiles: ReadonlyMap<string, File>;
  /** robot id → applied settings.json file. */
  settingsFiles: ReadonlyMap<string, File>;
  conflicts: CollisionInterval[];
  bounds: OutOfBoundsInterval[];
  appVersion: string;
  now?: Date;
  onProgress?: (stage: 'rendering' | 'recording' | 'saving') => void;
  capture?: SolutionCapture;
}

export interface SolutionPackageResult {
  zip: Uint8Array;
  /** Archive paths, in write order. */
  entries: string[];
  videoMime: string | null;
  suggestedName: string;
}

/* ------------------------------------------------------------------ */
/* Team naming                                                         */
/* ------------------------------------------------------------------ */

/** Characters Windows forbids in file names, plus control chars. */
const UNSAFE_NAME = /[\\/:*?"<>|\u0000-\u001f]/g;

export function sanitizeFileName(raw: string): string {
  const cleaned = raw.replace(UNSAFE_NAME, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned.slice(0, 64) : '';
}

const ORDINAL_FALLBACK = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export interface TeamArtifact {
  robot: SessionTrajectory;
  /** File-name-safe identity: team number, display name, or 队伍A fallback. */
  dirName: string;
  /** Original imported files with their import-time relative paths. */
  originalFiles: Array<{ relPath: string; file: File }>;
}

/**
 * One artifact per team slot. Identity prefers the team number, then the
 * display name, then the route file stem; collisions get a -2 suffix and
 * nameless slots fall back to 队伍A/队伍B/… ordinals (the spec's generic
 * example names).
 */
export function teamArtifacts(
  robots: readonly SessionTrajectory[],
  rawFiles: ReadonlyMap<string, File>,
  settingsFiles: ReadonlyMap<string, File>,
): TeamArtifact[] {
  const used = new Set<string>();
  return robots.map((robot, index) => {
    const traj = robot.trajectory;
    const identity = sanitizeFileName(
      traj.teamNumber || traj.displayName || traj.teamName || traj.name.split('/').pop() || '',
    );
    let dirName = identity || `队伍${ORDINAL_FALLBACK[index % ORDINAL_FALLBACK.length]}`;
    for (let n = 2; used.has(dirName); n++) dirName = `${identity || dirName}-${n}`;
    used.add(dirName);

    const relPaths: string[] = [];
    for (const option of robot.routeOptions ?? []) relPaths.push(option.relPath);
    for (const option of robot.profileOptions ?? []) relPaths.push(option.relPath);
    const originalFiles: Array<{ relPath: string; file: File }> = [];
    const seen = new Set<string>();
    for (const relPath of relPaths) {
      const file = rawFiles.get(relPath);
      if (file && !seen.has(relPath)) {
        seen.add(relPath);
        originalFiles.push({ relPath, file });
      }
    }
    const settings = settingsFiles.get(traj.id);
    if (settings) originalFiles.push({ relPath: settings.name, file: settings });
    return { robot, dirName, originalFiles };
  });
}

/* ------------------------------------------------------------------ */
/* Video codec pick                                                    */
/* ------------------------------------------------------------------ */

/**
 * H.264/AVC in an mp4 shell first (the spec's preference); VP9/VP8 webm as
 * the honest fallback where the engine cannot record mp4 (older WebKitGTK,
 * Firefox). null = this engine has no MediaRecorder canvas recording at all.
 */
export function pickVideoMime(supported: (mime: string) => boolean): { mime: string; ext: string } | null {
  const candidates: Array<[string, string]> = [
    ['video/mp4;codecs=avc1.42E01E', 'mp4'],
    ['video/mp4;codecs=avc1', 'mp4'],
    ['video/mp4', 'mp4'],
    ['video/webm;codecs=vp9', 'webm'],
    ['video/webm;codecs=vp8', 'webm'],
    ['video/webm', 'webm'],
  ];
  for (const [mime, ext] of candidates) {
    try {
      if (supported(mime)) return { mime, ext };
    } catch {
      // isTypeSupported itself missing/throwing — keep probing.
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Off-screen rendering                                                */
/* ------------------------------------------------------------------ */

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function makeSceneCanvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(1, 0, 0, 1, 0, 0); // 1:1 backing store, no DPR scaling
  return { canvas, ctx };
}

function drawScene(ctx: CanvasRenderingContext2D, scene: ExportScene, t: number, clockLabel: string | null): void {
  renderFieldFrame(ctx, {
    w: scene.width,
    h: scene.height,
    view: fitViewFor(scene.field, scene.width, scene.height),
    field: scene.field,
    fieldImg: scene.fieldImg,
    sprite: scene.sprite,
    robots: scene.robots,
    currentT: t,
    conflicts: scene.conflicts,
    bounds: scene.bounds,
    showTrail: true,
    showHeatmap: false,
    clockLabel,
  });
}

async function defaultRenderPng(scene: ExportScene): Promise<Uint8Array | null> {
  const made = makeSceneCanvas(scene.width, scene.height);
  if (!made || typeof made.canvas.toBlob !== 'function') return null;
  drawScene(made.ctx, scene, 0, `t = 0.00 s`);
  const blob = await new Promise<Blob | null>((resolve) => made.canvas.toBlob(resolve, 'image/png'));
  if (!blob) return null;
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Real-time MediaRecorder capture: the replay is exactly normal speed, so
 * the recording runs for `seconds` wall-clock seconds while a rAF loop
 * renders the off-screen canvas at the elapsed time. Returns null when the
 * engine cannot record (no captureStream / MediaRecorder / codec).
 */
async function defaultRecordVideo(
  scene: ExportScene,
  mime: string,
  seconds: number,
): Promise<{ bytes: Uint8Array; mime: string; ext: string } | null> {
  const canvas = document.createElement('canvas');
  if (typeof canvas.captureStream !== 'function' || typeof MediaRecorder === 'undefined') return null;
  const made = makeSceneCanvas(scene.width, scene.height);
  if (!made) return null;
  let stream: MediaStream;
  try {
    stream = canvas.captureStream(30);
  } catch {
    return null;
  }
  const ext = mime.includes('mp4') ? 'mp4' : 'webm';
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: VIDEO_BITRATE });
  } catch {
    return null;
  }
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
  const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });
  drawScene(made.ctx, scene, 0, 't = 0.00 s');
  recorder.start(500);
  const started = performance.now();
  await new Promise<void>((resolve) => {
    const step = () => {
      const elapsed = (performance.now() - started) / 1000;
      if (elapsed >= seconds) {
        drawScene(made.ctx, scene, seconds, `t = ${seconds.toFixed(2)} s`);
        resolve();
        return;
      }
      drawScene(made.ctx, scene, elapsed, `t = ${elapsed.toFixed(2)} s`);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  recorder.stop();
  await stopped;
  stream.getTracks().forEach((track) => track.stop());
  const blob = new Blob(chunks, { type: mime });
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime, ext };
}

/* ------------------------------------------------------------------ */
/* README                                                              */
/* ------------------------------------------------------------------ */

function formatDelay(robot: SessionTrajectory): string {
  if (robot.sequence && robot.sequence.segments.length > 0) {
    return `${Math.max(0, robot.sequence.segments[0]!.waitBeforeS).toFixed(2)} s`;
  }
  return `${robot.startDelayS.toFixed(2)} s`;
}function readmeText(o: {
  dateText: string;
  appVersion: string;
  fieldName: string;
  teams: TeamArtifact[];
  conflicts: number;
  bounds: number;
  videoMime: string | null;
  videoExt: string | null;
  videoSeconds: number;
  customField: boolean;
  hiddenCount: number;
}): string {
  const teamLinesEn = o.teams.map((team) => {
    const traj = team.robot.trajectory;
    const segments = team.robot.sequence?.segments.length ?? 1;
    return `| ${team.dirName} | ${traj.teamNumber || '—'} | ${traj.source} | ${formatDelay(team.robot)} | ${segments} | ${team.originalFiles.length} |`;
  });
  const videoDescEn = o.videoMime
    ? `${o.videoExt?.toUpperCase()} (${o.videoMime}), ${o.videoSeconds} s at 30 fps, 2D full-field view, normal speed.`
    : 'Not included — this browser could not record video. Open the .pb session in PathBlender and replay there instead.';
  const videoDescZh = o.videoMime
    ? `${o.videoExt?.toUpperCase()}（${o.videoMime}），时长 ${o.videoSeconds} 秒、30 fps、2D 全场视角、正常速度。`
    : '未包含——当前浏览器无法录制视频。请在 PathBlender 中打开 .pb 会话直接回放。';
  return `# PathBlender Solution Package 方案包

Generated 生成: ${o.dateText} · PathBlender v${o.appVersion}
Field 场地: ${o.fieldName}${o.customField ? ' (custom field 自定义场地)' : ''}

## Contents 包内内容

| File 文件 | What it is 说明 |
| --- | --- |
| \`完整方案.pb\` | Full session — open in PathBlender (File ▸ Import files). All teams, delays, sequences and settings. 完整会话，用 PathBlender 打开即可复现全场回放。 |
| \`回放.${o.videoExt ?? 'mp4'}\` | Replay video 回放视频 — ${videoDescEn} |
| \`路线总览.png\` | Static 2D overview of all routes at the start position. 全部路线的 2D 全场总览（起点状态）。 |
| \`各队方案/\` | One .pb session per team — that team's routes, start delay, sequence and profile only. 每队一份独立会话（只含该队的路线、等待、编排队列与配置）。 |
| \`原始导入文件/\` | The original imported files, byte-identical. 各队原始导入文件（与导入时逐字节一致）。 |

## Teams 各队

| Team 队伍 | Number 队号 | Source 来源 | Start delay 起步等待 | Segments 段数 | Original files 原始文件 |
| --- | --- | --- | --- | --- | --- |
${teamLinesEn.join('\n')}

## Checks 检查结果

- Collision intervals 碰撞区间: ${o.conflicts}
- Out-of-bounds intervals 出界区间: ${o.bounds}

Numbers reflect PathBlender's tolerance-scan at export time; the .pb sessions
recompute live. 以上数字为导出时的检查结果；在 PathBlender 中打开 .pb 会实时重算。

## Replay video 说明

${videoDescZh}
${o.videoMime && !o.videoMime.includes('mp4') ? '\nThe browser could not record H.264/MP4, so the video fell back to WebM — most players open it, but it is not the preferred MP4 container. 当前浏览器不支持录制 H.264/MP4，已回退为 WebM。\n' : ''}
## Notes 注意事项

- Sessions are self-contained: samples ride inside the .pb files, no original
  path files needed to open them. 会话文件自包含：采样点已内嵌，无需原始路径文件。
- The replay shows the visible robots exactly as the 2D workspace does${o.hiddenCount > 0 ? ` (${o.hiddenCount} hidden robot(s) excluded 隐藏的机器人未出现在视频中)` : ''}.
- ${o.customField ? 'Custom-field calibration is stored, but the field image itself is not embedded — re-pick the image after opening. 自定义场地只保存标定参数，不含图片本身。' : 'Standard season fields render from the built-in artwork. 官方赛季场地使用内置底图。'}
- Original files are included only for files imported in this app session. 原始文件仅收录本次应用会话中导入过的文件。
`;
}

/* ------------------------------------------------------------------ */
/* Orchestration                                                       */
/* ------------------------------------------------------------------ */

export async function buildSolutionPackage(o: SolutionPackageOptions): Promise<SolutionPackageResult> {
  const now = o.now ?? new Date();
  const videoSeconds = FIXED_VIDEO_SECONDS;
  const teams = teamArtifacts(o.robots, o.rawFiles, o.settingsFiles);
  const capture = o.capture ?? {};

  o.onProgress?.('rendering');
  // With both capture producers injected (tests, jsdom) the shared renderer
  // is never called, so the images it would need are not loaded at all —
  // a jsdom Image never fires load/error and would hang the await forever.
  // A jsdom Image never fires load/error, so images load only when a
  // default producer will actually consume them (tests inject both).
  const needsImages = !capture.renderPng ||
    (!capture.recordVideo && typeof MediaRecorder !== 'undefined');
  const [fieldImg, sprite] = needsImages
    ? await Promise.all([
        o.fieldImageUrl ? loadImage(o.fieldImageUrl) : Promise.resolve(null),
        loadImage(MK5I_MODULE_TOP_URL),
      ])
    : [null, null];
  const scene: ExportScene = {
    field: o.field,
    fieldImg,
    sprite,
    robots: o.visibleRobots,
    conflicts: o.conflicts,
    bounds: o.bounds,
    width: VIDEO_WIDTH,
    height: VIDEO_HEIGHT,
  };

  const png = capture.renderPng
    ? await capture.renderPng(scene)
    : await defaultRenderPng(scene);

  o.onProgress?.('recording');
  let video: { bytes: Uint8Array; mime: string; ext: string } | null = null;
  if (capture.recordVideo) {
    const picked = pickVideoMime(() => true);
    video = picked ? await capture.recordVideo(scene, picked.mime, videoSeconds) : null;
  } else if (typeof MediaRecorder !== 'undefined') {
    const picked = pickVideoMime((mime) => MediaRecorder.isTypeSupported(mime));
    video = picked ? await defaultRecordVideo(scene, picked.mime, videoSeconds) : null;
  }

  const entries: ZipEntry[] = [];
  entries.push({ name: 'README.md', data: new TextEncoder().encode(readmeText({
    dateText: now.toISOString().slice(0, 10),
    appVersion: o.appVersion,
    fieldName: `${o.field.name} ${o.field.year}`,
    teams,
    conflicts: o.conflicts.length,
    bounds: o.bounds.length,
    videoMime: video?.mime ?? null,
    videoExt: video?.ext ?? null,
    videoSeconds,
    customField: o.fieldId === 'custom',
    hiddenCount: o.robots.length - o.visibleRobots.length,
  })) });
  entries.push({ name: '完整方案.pb', data: new TextEncoder().encode(serializeSession(o.robots, o.fieldId, o.customFieldForSession)) });
  if (video) entries.push({ name: `回放.${video.ext}`, data: video.bytes });
  if (png) entries.push({ name: '路线总览.png', data: png });
  for (const team of teams) {
    entries.push({
      name: `各队方案/${team.dirName}.pb`,
      data: new TextEncoder().encode(serializeSession([team.robot], o.fieldId, o.customFieldForSession)),
    });
    for (const entry of team.originalFiles) {
      // Byte-identical: the File's own bytes, never a re-serialization.
      entries.push({ name: `原始导入文件/${team.dirName}/${entry.relPath}`, data: new Uint8Array(await entry.file.arrayBuffer()) });
    }
  }

  o.onProgress?.('saving');
  const zip = await buildZip(entries, now);
  return {
    zip,
    entries: entries.map((e) => e.name),
    videoMime: video?.mime ?? null,
    suggestedName: `pathblender-solution-${now.toISOString().slice(0, 10)}.zip`,
  };
}
