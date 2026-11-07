/**
 * WHO RUNS THIS: developers recording the onboarding demo video (Task 3 of
 * docs/superpowers/plans/2026-11-07-onboarding-demo-video.md). Never ships.
 *
 * Drives the real production build in headed system Chrome through the nine
 * storyboard scenes from scripts/demo-video-captions.mjs, records each
 * language pass with context.recordVideo, and asserts the live UI at every
 * step so example-data or UI drift fails the take loudly instead of shipping
 * a video that contradicts the app. It then re-encodes the WebM to H.264
 * MP4 locally, writes the VTT sidecar, and reads the result back (ffprobe
 * duration/codec, blackdetect, pairwise-distinct scene-midpoint frames).
 *
 * The conflict counts asserted here are the re-measured facts of 2026-11-07
 * (.superpowers/sdd/2026-11-07-onboarding-demo-video/task-1-report.md, ruling
 * in progress.md): the sample pair reports 1; the welcome example reports 3;
 * the compare round trip is only demonstrable on 8814 (FCeSt → other route →
 * FCeSt gives 3 → 1 → 3 — the 11019 originals are composer-blocked, so they
 * cannot be swapped back); mirroring the pinned 11019 row takes the check
 * 3 → 2; the alliance switch never changes a verdict. Nothing here claims
 * any operation clears the check.
 *
 * Usage:
 *   npm run build -w @pathblender/web && npm run preview -w @pathblender/web
 *   DEMO_PROBE=1 node scripts/capture-demo-video.mjs        # calibration probe
 *   node scripts/capture-demo-video.mjs --langs en,zh \
 *        --compare-robot 8814 --compare-route MSm           # recorded take
 * Env: WALK_BASE (default http://localhost:4173/), DEMO_OUT (default
 * docs/screenshots), DEMO_PROBE=1 (probe mode: drives scenes, prints
 * route-swap findings, writes no video), FFMPEG_BIN/FFPROBE_BIN overrides.
 *
 * Import-safe for unit tests (SDD ruling R2): the only top-level code is
 * pure function definitions; playwright, the browser, ffmpeg and all file
 * writes live behind the CLI-entry guard below.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENES, toVtt } from './demo-video-captions.mjs';

// Live-measured 2026-11-07 (task-1-report.md); change these only with a new
// real-app measurement plus a caption update, never to make a take pass.
const MEASURED = {
  sampleConflicts: '1',
  exampleBaseline: '3',
  compareAfterSwap: '1',
  mirrorAfter: '2',
};
// The mirror scene pins this exact example row (display name from
// welcome-example.ts; both 11019 rows measure 3→2, the plain one is pinned
// so the take is deterministic — '11019 Champs' must not match).
const MIRROR_ROBOT = '11019';
const SAMPLE_FILES = [
  'samples/ghostauto/straight_run.ghostauto',
  'samples/ghostauto/stop_and_score.ghostauto',
];
const VIEWPORT = { width: 1440, height: 900 };

export function isLocalRequest(url, base) {
  let u;
  let b;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  // data:/blob: resources are produced by the page itself — always local.
  if (u.protocol === 'data:' || u.protocol === 'blob:') return true;
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  try {
    b = new URL(base);
  } catch {
    return false;
  }
  if (u.origin === b.origin) return true;
  const loopback = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
  // localhost and 127.0.0.1 are different origins but the same machine: the
  // preview server answers on both, so treat loopback-with-same-port as
  // local while any other host or port stays nonlocal.
  return loopback.has(u.hostname) && loopback.has(b.hostname) && u.port === b.port;
}

export function outputPaths(lang, outDir) {
  return {
    webm: `${outDir}/demo-video.${lang}.webm`,
    mp4: `${outDir}/demo-video.${lang}.mp4`,
    vtt: `${outDir}/demo-video.${lang}.vtt`,
  };
}

// Scene midpoints for the frame-distinct readback, derived from the times
// the take actually held each scene (actions can overrun the storyboard
// targets) — not from the storyboard's targetSeconds.
export function sceneMidpoints(marks) {
  return marks.map((mark) => (mark.start + mark.end) / 2);
}

const sceneById = new Map(SCENES.map((scene) => [scene.id, scene]));

// --- check() PASS/FAIL accumulator (scripts/browser-walkthrough.mjs shape) ---
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const fail = (msg) => {
  check(msg, false);
  throw new Error(msg);
};
const summarize = () => {
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  if (failed > 0) process.exitCode = 1;
};

function parseArgs(argv) {
  const opts = { langs: 'en,zh', compareRobot: '', compareRoute: '' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === '--langs' && value) { opts.langs = value; i++; }
    else if (arg === '--compare-robot' && value) { opts.compareRobot = value; i++; }
    else if (arg === '--compare-route' && value) { opts.compareRoute = value; i++; }
    else if (arg === '--help' || arg === '-h') {
      console.log('usage: node scripts/capture-demo-video.mjs [--langs en,zh] [--compare-robot <row name>] [--compare-route <route>]\n' +
        '       DEMO_PROBE=1 node scripts/capture-demo-video.mjs   (calibration probe, no video)');
      process.exit(0);
    } else {
      console.error(`unknown or incomplete argument: ${arg}`);
      process.exit(2);
    }
  }
  return opts;
}

async function launchBrowser(chromium) {
  const platformFlags = {
    darwin: ['--use-angle=metal'],
    win32: ['--use-angle=d3d11', '--ignore-gpu-blocklist'],
    linux: ['--use-angle=gl', '--ignore-gpu-blocklist'],
  }[process.platform] ?? [];
  const launchOpts = { headless: false, args: platformFlags };
  // System Chrome through the channel (no 150 MB download), bundled Chromium
  // as fallback — same convention as scripts/capture-readme-shots.mjs.
  return chromium.launch({ ...launchOpts, channel: 'chrome' })
    .catch(() => chromium.launch(launchOpts));
}

// Shared page-driving helpers speaking the same selectors as the browser
// walkthrough and the 2026-11-07 measurement harness (task-1-report.md).
function makePageHelpers(page, base) {
  const rows = () => page.locator('.robot-library-row');
  const rowNames = () => page.$$eval('.robot-library-row', (els) => els.map(
    (el) => el.querySelector('.robot-library-name')?.getAttribute('title') ?? '',
  ));
  const clockText = () => page.locator('.clock').textContent().then((t) => parseFloat(t ?? '0'));
  // The Checks tab owns the .conflict-count badge and does not stay active
  // across composer round trips — re-assert it before every read.
  const ensureChecksTab = async () => {
    const tab = page.locator('.inspector-tabs button', { hasText: /^Checks|^检查/i });
    if (await tab.count()) await tab.click().catch(() => {});
    await page.locator('.conflict-count').first().waitFor({ timeout: 15000 });
  };
  const conflictCount = () => page.locator('.conflict-count').first().textContent().then((t) => t?.trim());
  const waitForCount = (n) => page.waitForFunction(
    (v) => document.querySelector('.conflict-count')?.textContent?.trim() === v,
    String(n), { timeout: 15000 },
  );
  // Recompute is async; the badge must hold the same value across two polls.
  const settleCount = async () => {
    await ensureChecksTab();
    let prev = await conflictCount();
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(250);
      const now = await conflictCount();
      if (now === prev) return now;
      prev = now;
    }
    return prev;
  };
  const closeTourCardIfPresent = async () => {
    if (await page.locator('.tour-card').count()) {
      await page.locator('.tour-card .tour-close').click();
      await page.waitForSelector('.tour-card', { state: 'detached', timeout: 5000 }).catch(() => {});
    }
  };
  const openComposer = async (row) => {
    await row.locator('.robot-arrange-button').click();
    await page.waitForSelector('.sequence-composer', { timeout: 8000 });
    await page.waitForSelector('.sequence-route-source', { timeout: 8000 });
  };
  const backToPlayback = async () => {
    await page.getByRole('button', { name: /^Back to playback$|^返回回放$/ }).click();
    await page.waitForSelector('.sequence-composer', { state: 'detached', timeout: 8000 });
    await page.waitForTimeout(250);
  };
  // A route "swap" in the real composer is remove-clip → click source (the
  // click appends, SequenceTimelineComposer.tsx:547) — the same pointer path
  // the walkthrough uses. Blocked candidates leave the lane empty.
  const removeCurrentClip = async () => {
    const clip = page.locator('.sequence-track.is-editing .sequence-clip').first();
    if (!(await clip.count())) return;
    await clip.click({ button: 'right' });
    await page.waitForSelector('.sequence-clip-menu', { timeout: 5000 });
    await page.getByRole('menuitem', { name: /^Remove route$|^移除路线$/ }).click();
    await page.waitForTimeout(300);
  };
  const sourceMeta = () => page.$$eval('.sequence-route-source', (els) => els.map(
    (b) => (b.getAttribute('aria-label') ?? '').split(': ')[0],
  ));
  const sourceByLabel = (label) => page.locator(`.sequence-route-source[aria-label^="${label}: "]`).first();
  // The editing clip's aria-label starts with its route name ("FCeSt, 0.00–…").
  const clipRouteLabel = async () => {
    const label = await page.locator('.sequence-track.is-editing .sequence-clip').first().getAttribute('aria-label');
    return label ? label.split(', ')[0] : null;
  };
  const rowFor = async (token) => {
    const names = await rowNames();
    let idx = names.findIndex((n) => n === token);
    if (idx === -1) {
      const hits = names.flatMap((n, i) => (n && n.includes(token) ? [i] : []));
      if (hits.length === 1) idx = hits[0];
      else fail(`robot "${token}" matches ${hits.length} rows [${names.join(', ')}] — pass the exact row name`);
    }
    return rows().nth(idx);
  };
  return {
    page, base, rows, rowNames, clockText, ensureChecksTab, conflictCount,
    waitForCount, settleCount, closeTourCardIfPresent, openComposer, backToPlayback,
    removeCurrentClip, sourceMeta, sourceByLabel, clipRouteLabel, rowFor,
  };
}

// Import scene without any OS dialog: a real `drop` event on body with a
// DataTransfer holding Files built from the sample files' actual bytes —
// the app's whole-window handler (App.tsx:702) consumes it. No native
// picker is shown or faked.
async function dropImportFiles(page) {
  const payloads = SAMPLE_FILES.map((file) => ({
    name: basename(file),
    b64: readFileSync(resolve(process.cwd(), file)).toString('base64'),
  }));
  const dataTransfer = await page.evaluateHandle((files) => {
    const dt = new DataTransfer();
    for (const { name, b64 } of files) {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      dt.items.add(new File([bytes], name));
    }
    return dt;
  }, payloads);
  await page.dispatchEvent('body', 'drop', { dataTransfer });
}

// --- probe mode (DEMO_PROBE=1): calibration, no recording, no writes ---
async function runProbe(base) {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal'] })
    .catch(() => chromium.launch({ headless: true }));
  const ctx = await browser.newContext({ viewport: VIEWPORT, locale: 'en-US' });
  ctx.setDefaultTimeout(60000);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const h = makePageHelpers(page, base);

  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('.workspace-empty');
  const startFreshExample = async () => {
    if (await page.getByRole('button', { name: /end example/i }).count()) {
      await page.getByRole('button', { name: /end example/i }).click();
      await page.waitForSelector('.workspace-empty', { timeout: 8000 });
    }
    await page.locator('.welcome-try-example').click();
    await page.waitForSelector('.robot-library-row', { timeout: 10000 });
    await page.waitForFunction(() => document.querySelectorAll('.robot-library-row').length === 3, undefined, { timeout: 10000 });
    await h.closeTourCardIfPresent();
    await h.ensureChecksTab();
    const baseline = await h.settleCount();
    if (baseline !== MEASURED.exampleBaseline) {
      fail(`example baseline is ${baseline}, measured ${MEASURED.exampleBaseline} — example data drifted, re-measure before recording`);
    }
    return baseline;
  };
  const baseline = await startFreshExample();
  console.log(`probe: example baseline conflicts ${baseline} (rows: ${(await h.rowNames()).join(', ')})`);

  let minimum = Number.POSITIVE_INFINITY;
  const zeroSwaps = [];
  for (let i = 0; i < 3; i++) {
    // A fresh example per robot: probing leaves the previous robot's lane
    // empty (its original may be composer-blocked), and every candidate must
    // be measured from the pristine 3-conflict baseline, not a mutated one —
    // createWelcomeExample() rebuilds it exactly.
    await startFreshExample();
    const robot = (await h.rowNames())[i];
    await h.openComposer(h.rows().nth(i));
    const sources = await h.sourceMeta();
    const original = (await h.clipRouteLabel()) ?? sources[0];
    let best = null;
    for (const label of sources) {
      // Every candidate starts from an empty lane (the pointer path the
      // walkthrough uses); blocked-on-empty-lane is read live after the
      // removal — an aria-disabled snapshot taken with the original clip
      // still present reflects occupancy, not the candidate's real gating.
      await h.removeCurrentClip();
      if ((await h.sourceByLabel(label).getAttribute('aria-disabled')) === 'true') {
        console.log(`probe: ${robot} route ${label} -> blocked`);
        continue;
      }
      await h.sourceByLabel(label).click();
      await page.waitForTimeout(350);
      await h.backToPlayback();
      const count = await h.settleCount();
      const n = Number(count);
      if (Number.isFinite(n)) minimum = Math.min(minimum, n);
      if (count === '0') zeroSwaps.push(`${robot} route ${label}`);
      if (!best || n < best.n) best = { label, n };
      console.log(`probe: ${robot} route ${label} -> conflict ${count}`);
      await h.openComposer(h.rows().nth(i));
    }
    await h.removeCurrentClip();
    const originalBlocked = (await h.sourceByLabel(original).getAttribute('aria-disabled')) === 'true';
    console.log(`probe: ${robot} original ${original} re-addable: ${originalBlocked ? 'no' : 'yes'}`);
    if (best) console.log(`probe: best single swap for ${robot}: ${best.label} -> conflict ${best.n}`);
  }
  if (zeroSwaps.length) {
    console.log(`probe: 0-conflict swap found: ${zeroSwaps.join('; ')}`);
  } else {
    console.log(`probe: no single-route swap reaches 0 (minimum seen: ${minimum})`);
  }
  check('probe collected no console/page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();
}

// --- recorded take: the nine scenes, live-asserted, on camera ---
async function recordLanguage(browser, lang, base, outDir, compareRobot, compareRoute) {
  console.log(`\n=== recording ${lang} ===`);
  const videoDir = mkdtempSync(join(tmpdir(), `pb-demo-video-${lang}-`));
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    locale: lang === 'zh' ? 'zh-CN' : 'en-US',
    recordVideo: { dir: videoDir, size: VIEWPORT },
  });
  ctx.setDefaultTimeout(60000);
  const page = await ctx.newPage();
  // Request gate lives on the context: it sees every page in this context
  // plus service-worker-issued requests that page-level events miss.
  const nonlocal = [];
  const errors = [];
  ctx.on('request', (r) => { if (!isLocalRequest(r.url(), base)) nonlocal.push(r.url()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const h = makePageHelpers(page, base);

  // Hold each scene to its storyboard target and record the times the take
  // actually held (video-relative) so the frame readback extracts at real
  // scene midpoints even when actions overrun a target.
  const videoOrigin = Date.now();
  const sceneMarks = [];
  let sceneStart;
  const startScene = (id) => {
    if (!sceneById.has(id)) fail(`unknown scene id ${id}`);
    sceneStart = Date.now();
  };
  const held = () => (Date.now() - videoOrigin) / 1000;
  const holdScene = async (id) => {
    const targetMs = sceneById.get(id).targetSeconds * 1000;
    const remain = targetMs - (Date.now() - sceneStart);
    if (remain > 0) await page.waitForTimeout(remain);
    sceneMarks.push({ id, start: (sceneStart - videoOrigin) / 1000, end: held() });
    console.log(`scene ${id} held ${(sceneMarks.at(-1).end - sceneMarks.at(-1).start).toFixed(1)}s`);
  };

  // welcome
  startScene('welcome');
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('.workspace-empty');
  check('page loads with the welcome state', true);
  await holdScene('welcome');

  // import: real drag-and-drop of the two verified sample files
  startScene('import');
  await dropImportFiles(page);
  await page.waitForSelector('.robot-library-row', { timeout: 10000 });
  await page.waitForSelector('.field-canvas');
  check('drop import yields the two sample robots', (await h.rows().count()) === 2, `rows=${await h.rows().count()}`);
  if (lang === 'zh') {
    const heading = await page.locator('.robot-library-heading h2').first().textContent();
    check('zh pass renders the zh UI', /机器人/.test(heading ?? ''), `heading=${heading}`);
  }
  await h.waitForCount(MEASURED.sampleConflicts);
  check(`sample pair reports the measured ${MEASURED.sampleConflicts} conflicts`, true, `count=${await h.conflictCount()}`);
  await holdScene('import');

  // playback: play on the shared clock, then pause
  startScene('playback');
  const clockBefore = await h.clockText();
  await page.locator('.timeline-play').click();
  await page.waitForTimeout(1500);
  await page.locator('.timeline-play').click();
  const clockAfter = await h.clockText();
  check('playback advances the shared clock then pauses', clockAfter > clockBefore, `clock ${clockBefore.toFixed(2)} → ${clockAfter.toFixed(2)}`);
  await holdScene('playback');

  // locate: click a check entry, the clock jumps to that moment
  startScene('locate');
  await h.ensureChecksTab();
  await page.waitForSelector('.conflict-jump', { timeout: 8000 });
  const jumpEntries = await page.locator('.conflict-jump').count();
  const clockTextBefore = ((await page.locator('.clock').textContent()) ?? '').trim();
  await page.locator('.conflict-jump').first().click();
  await page.waitForTimeout(400);
  const clockTextAfter = ((await page.locator('.clock').textContent()) ?? '').trim();
  check('conflict jump moves the clock to the conflict', clockTextAfter !== clockTextBefore,
    `${clockTextBefore} → ${clockTextAfter} (${jumpEntries} entries)`);
  await holdScene('locate');

  // to-example: back to home, load the bundled example
  startScene('to-example');
  await page.getByRole('button', { name: /^Back to home$|^回到首页$/ }).click();
  await page.waitForSelector('.workspace-empty');
  await page.locator('.welcome-try-example').click();
  await page.waitForSelector('.robot-library-row', { timeout: 10000 });
  await page.waitForFunction(() => document.querySelectorAll('.robot-library-row').length === 3, undefined, { timeout: 10000 });
  await h.closeTourCardIfPresent();
  const baseline = await h.settleCount();
  check(`example loads three robots with the measured ${MEASURED.exampleBaseline} conflicts`,
    baseline === MEASURED.exampleBaseline, `rows=${await h.rows().count()} count=${baseline}`);
  await holdScene('to-example');

  // compare: swap in the probed route on the probed robot, then swap back
  startScene('compare');
  const compareRow = await h.rowFor(compareRobot);
  await h.openComposer(compareRow);
  const original = (await h.clipRouteLabel()) ?? (await h.sourceMeta())[0];
  if (!(await h.sourceByLabel(original).count())) {
    fail(`original route "${original}" not found in the composer for ${compareRobot}`);
  }
  await h.removeCurrentClip();
  if ((await h.sourceByLabel(compareRoute).getAttribute('aria-disabled')) === 'true') {
    fail(`--compare-route ${compareRoute} is composer-blocked for ${compareRobot}; pick a probed candidate`);
  }
  await h.sourceByLabel(compareRoute).click();
  await page.waitForTimeout(350);
  await h.backToPlayback();
  const swapped = await h.settleCount();
  check(`swapping ${compareRobot} to ${compareRoute} takes the check ${MEASURED.exampleBaseline} → ${MEASURED.compareAfterSwap}`,
    swapped === MEASURED.compareAfterSwap, `count=${swapped}`);
  await h.openComposer(compareRow);
  await h.removeCurrentClip();
  if ((await h.sourceByLabel(original).getAttribute('aria-disabled')) === 'true') {
    fail(`original route ${original} is composer-blocked on ${compareRobot}; the round trip needs a re-addable original (ledger: 8814)`);
  }
  await h.sourceByLabel(original).click();
  await page.waitForTimeout(350);
  await h.backToPlayback();
  const restored = await h.settleCount();
  check(`swapping ${original} back restores ${MEASURED.exampleBaseline}`,
    restored === MEASURED.exampleBaseline, `count=${restored}`);
  await holdScene('compare');

  // mirror: the pinned 11019 row flips to the mirrored side
  startScene('mirror');
  const names = await h.rowNames();
  const mirrorIdx = names.findIndex((n) => n === MIRROR_ROBOT);
  if (mirrorIdx === -1) {
    fail(`mirror row "${MIRROR_ROBOT}" not found [${names.join(', ')}] — example data drifted`);
  }
  const mirrorBefore = await h.settleCount();
  await h.rows().nth(mirrorIdx).getByRole('button', { name: /mirror|镜像/i }).first().click();
  const mirrorAfter = await h.settleCount();
  check(`mirroring ${MIRROR_ROBOT} takes the check ${MEASURED.exampleBaseline} → ${MEASURED.mirrorAfter}`,
    mirrorBefore === MEASURED.exampleBaseline && mirrorAfter === MEASURED.mirrorAfter,
    `count=${mirrorBefore}→${mirrorAfter}`);
  await holdScene('mirror');

  // alliance: whole session red then blue — verdicts must not move
  startScene('alliance');
  const allianceBefore = await h.settleCount();
  await page.locator('.alliance-red').click();
  const afterRed = await h.settleCount();
  await page.locator('.alliance-blue').click();
  const afterBlue = await h.settleCount();
  check('alliance round trip leaves the check unchanged',
    afterRed === allianceBefore && afterBlue === allianceBefore,
    `${allianceBefore}→${afterRed}→${afterBlue}`);
  await holdScene('alliance');

  // closing: settle on the final state
  startScene('closing');
  check('recording made zero nonlocal requests', nonlocal.length === 0, nonlocal.slice(0, 5).join(' | ') || 'none');
  check('recording collected zero console/page errors', errors.length === 0, errors.slice(0, 5).join(' | ') || 'none');
  await holdScene('closing');

  const video = page.video();
  await ctx.close();
  const webmSrc = await video.path();
  mkdirSync(outDir, { recursive: true });
  const paths = outputPaths(lang, outDir);
  copyFileSync(webmSrc, paths.webm);
  console.log(`wrote ${paths.webm}`);
  if (sceneMarks.length !== SCENES.length) {
    fail(`${lang} take recorded ${sceneMarks.length} scene marks, expected ${SCENES.length}`);
  }
  return { paths, sceneMarks };
}

function run(binary, args, opts = {}) {
  const r = spawnSync(binary, args, { encoding: 'utf8', ...opts });
  if (r.error) fail(`cannot run ${binary} — ${r.error.message}`);
  return r;
}

function postProcess(lang, paths, sceneMarks) {
  const ffmpeg = process.env.FFMPEG_BIN ?? 'ffmpeg';
  const ffprobe = process.env.FFPROBE_BIN ?? 'ffprobe';

  const enc = run(ffmpeg, ['-y', '-i', paths.webm, '-an', '-c:v', 'libx264', '-crf', '23',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', paths.mp4], { stdio: ['ignore', 'pipe', 'pipe'] });
  if (enc.status !== 0) fail(`${lang} ffmpeg encode failed: ${enc.stderr.slice(-400)}`);
  console.log(`wrote ${paths.mp4}`);

  writeFileSync(paths.vtt, toVtt(lang));
  console.log(`wrote ${paths.vtt}`);

  const probe = run(ffprobe, ['-v', 'error', '-show_entries', 'format=duration',
    '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height',
    '-of', 'json', paths.mp4]);
  if (probe.status !== 0) fail(`${lang} ffprobe failed: ${probe.stderr}`);
  const info = JSON.parse(probe.stdout);
  const duration = Number(info.format?.duration);
  check(`${lang} mp4 duration is within 75–105 s`, duration >= 75 && duration <= 105, `${duration.toFixed(2)}s`);
  const v = info.streams?.[0] ?? {};
  check(`${lang} mp4 is h264 1440×900`, v.codec_name === 'h264' && v.width === VIEWPORT.width && v.height === VIEWPORT.height,
    `${v.codec_name} ${v.width}×${v.height}`);

  const black = run(ffmpeg, ['-hide_banner', '-i', paths.mp4, '-vf', 'blackdetect=d=0.5', '-an', '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const blacks = black.stderr.split('\n').filter((l) => l.includes('black_start')).map((l) => l.trim());
  check(`${lang} mp4 has no black interval ≥ 0.5 s`, blacks.length === 0, blacks.join(' | ') || 'none');

  const frameDir = mkdtempSync(join(tmpdir(), `pb-demo-frames-${lang}-`));
  const digests = [];
  const framePaths = [];
  sceneMidpoints(sceneMarks).forEach((t, i) => {
    const png = join(frameDir, `scene-${i}.png`);
    const fr = run(ffmpeg, ['-hide_banner', '-y', '-ss', String(t), '-i', paths.mp4, '-frames:v', '1', png], { stdio: ['ignore', 'pipe', 'pipe'] });
    if (fr.status !== 0) fail(`${lang} frame extraction failed at ${t}s: ${fr.stderr.slice(-300)}`);
    digests.push(createHash('md5').update(readFileSync(png)).digest('hex'));
    framePaths.push(png);
  });
  check(`${lang} scene-midpoint frames are pairwise distinct`,
    new Set(digests).size === digests.length, `${new Set(digests).size}/${digests.length} distinct`);
  console.log(`${lang} frame readback PNGs: ${framePaths.join(' ')}`);
}

async function main() {
  const base = process.env.WALK_BASE ?? 'http://localhost:4173/';
  const outDir = resolve(process.cwd(), process.env.DEMO_OUT ?? 'docs/screenshots');
  const opts = parseArgs(process.argv.slice(2));
  try {
    if (process.env.DEMO_PROBE === '1') {
      await runProbe(base);
      return;
    }
    if (!opts.compareRobot || !opts.compareRoute) {
      console.error('a recorded take needs --compare-robot and --compare-route (no hard-coded guess); '
        + 'run DEMO_PROBE=1 first to measure them from the live app');
      process.exit(2);
    }
    const langs = opts.langs.split(',').map((s) => s.trim()).filter(Boolean);
    for (const lang of langs) {
      if (lang !== 'en' && lang !== 'zh') {
        console.error(`unsupported language "${lang}" (en, zh)`);
        process.exit(2);
      }
    }
    const { chromium } = await import('playwright-core');
    const browser = await launchBrowser(chromium);
    for (const lang of langs) {
      const { paths, sceneMarks } = await recordLanguage(browser, lang, base, outDir, opts.compareRobot, opts.compareRoute);
      postProcess(lang, paths, sceneMarks);
    }
    await browser.close();
  } finally {
    summarize();
  }
}

// CLI-entry guard (SDD ruling R2): importing this module (unit tests, Task 3
// tooling) must not launch a browser or write anything.
const isCliEntry = (() => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (isCliEntry) await main();
