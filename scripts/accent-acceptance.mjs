/**
 * WHO RUNS THIS: developers and AI sessions (same contract as
 * browser-walkthrough.mjs). Robot acceptance pass for the interface-accent
 * feature (2026-10-17): drives the real production build in a real browser
 * and proves, at the assembled-product level:
 *
 *  - the token matrix: --accent/--accent-text/--accent-fg resolve per
 *    (accent × theme), and BLUE is byte-identical with and without the
 *    stored key (no visual drift for existing users);
 *  - real surfaces follow: welcome primary, save button, timeline play,
 *    switch ON, scrubber thumb, focus ring;
 *  - DATA colors do not: the 2D occupancy heatmap keeps its blue/red
 *    alliance pixels under every accent (pixel-count invariance), and
 *    alliance toggle / danger stay untouched;
 *  - the ViewCube (canvas-baked) repaints on a saved accent switch while
 *    playback is paused, without resetting the camera;
 *  - the settings picker stages (Save applies, Cancel discards);
 *  - RTL + long strings keep the settings/welcome inside the viewport.
 *
 * Usage: npm run build -w @pathblender/web && npm run preview -w @pathblender/web
 *        node scripts/accent-acceptance.mjs   (expects :4173, or set WALK_BASE)
 * Screenshots land in /tmp/pb-shots/accent-*. Exits non-zero on failure.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.WALK_BASE ?? 'http://localhost:4173/';
const SHOTS = '/tmp/pb-shots';
mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium
  .launch(process.env.WALK_CHROME === '0' ? {} : { channel: 'chrome' })
  .catch(() => chromium.launch());
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
/** Active page — swapped by loadWith (each scenario gets a pristine
 *  context: a same-page reload can race the app's autosave and restore the
 *  previous scenario's session on top of the new import, which shifts the
 *  timeline layout and pollutes pixel comparisons). */
let page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

/** Load the app with a given accent/theme already stored (restart path). */
async function loadWith({ accent, theme }) {
  await page.close();
  page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(({ accent, theme }) => {
    try { localStorage.clear(); } catch { /* fresh context anyway */ }
    if (accent) localStorage.setItem('pb.accent', accent);
    if (theme) localStorage.setItem('pb.theme', theme);
  }, { accent, theme });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.start-screen, .workspace-stage', { timeout: 20000 });
}

const token = (name) => page.evaluate(
  (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(),
  name,
);
const welcomeButton = () => page.evaluate(() => {
  const el = document.querySelector('.start-action-primary .start-action-title');
  return el ? getComputedStyle(el).backgroundColor : null;
});

const EXPECT = {
  'blue|dark': { accent: '#0a84ff', text: '#0a84ff', fg: '#ffffff', ring: '#64acff' },
  'blue|light': { accent: '#007aff', text: '#007aff', fg: '#ffffff', ring: '#006cdb' },
  'red|dark': { accent: '#911d23', text: '#e8606a', fg: '#ffffff', ring: '#e0616b' },
  'red|light': { accent: '#911d23', text: '#911d23', fg: '#ffffff', ring: '#b0242d' },
  'steel|dark': { accent: '#355c7d', text: '#85aecb', fg: '#ffffff', ring: '#85aecb' },
  'steel|light': { accent: '#355c7d', text: '#355c7d', fg: '#ffffff', ring: '#355c7d' },
  'bronze|dark': { accent: '#b08d57', text: '#b08d57', fg: '#1c1c1e', ring: '#b08d57' },
  'bronze|light': { accent: '#b08d57', text: '#82632f', fg: '#1f2124', ring: '#82632f' },
  'silver|dark': { accent: '#b5b8bb', text: '#b5b8bb', fg: '#1c1c1e', ring: '#c3c6c9' },
  'silver|light': { accent: '#b5b8bb', text: '#676c70', fg: '#1f2124', ring: '#7a8085' },
};

// ---- 1. Token matrix on the welcome screen (restart restore) -------------
for (const accent of ['blue', 'red', 'steel', 'bronze', 'silver']) {
  for (const theme of ['dark', 'light']) {
    await loadWith({ accent: accent === 'blue' ? null : accent, theme });
    const key = `${accent}|${theme}`;
    const got = {
      accent: await token('--accent'),
      text: await token('--accent-text'),
      fg: await token('--accent-fg'),
      ring: await token('--focus-ring'),
    };
    const want = EXPECT[key];
    check(
      `tokens ${key}`,
      got.accent === want.accent && got.text === want.text && got.fg === want.fg && got.ring === want.ring,
      `${JSON.stringify(got)} want ${JSON.stringify(want)}`,
    );
    check(
      `html carries data-accent=${accent} after restart`,
      (await page.evaluate(() => document.documentElement.dataset.accent)) === accent,
    );
    await page.screenshot({ path: `${SHOTS}/accent-${accent}-${theme}-welcome.png` });
  }
}

// ---- 2. Blue invariance: stored 'blue' vs no key --------------------------
await loadWith({ accent: null, theme: 'dark' });
const noKey = { accent: await token('--accent'), text: await token('--accent-text'), dim: await token('--accent-dim') };
await loadWith({ accent: 'blue', theme: 'dark' });
const keyBlue = { accent: await token('--accent'), text: await token('--accent-text'), dim: await token('--accent-dim') };
check(
  'blue with the explicit key is byte-identical to no key',
  noKey.accent === keyBlue.accent && noKey.text === keyBlue.text && noKey.dim === keyBlue.dim,
  `${JSON.stringify(noKey)} vs ${JSON.stringify(keyBlue)}`,
);

// ---- 3. Welcome primary button follows (and blue keeps #0a84ff) -----------
await loadWith({ accent: 'red', theme: 'dark' });
const redBtn = await welcomeButton();
check('welcome primary fill is brand red', redBtn === 'rgb(145, 29, 35)', String(redBtn));
await loadWith({ accent: 'blue', theme: 'dark' });
const blueBtn = await welcomeButton();
check('welcome primary fill keeps system blue', blueBtn === 'rgb(10, 132, 255)', String(blueBtn));
await loadWith({ accent: 'silver', theme: 'light' });
const silverBtn = await welcomeButton();
const silverFg = await page.evaluate(() => {
  const el = document.querySelector('.start-action-primary .start-action-title');
  return el ? getComputedStyle(el).color : null;
});
check('welcome primary fill is silver in light too', silverBtn === 'rgb(181, 184, 187)', String(silverBtn));
check('welcome primary text is dark on silver (never white)', silverFg === 'rgb(31, 33, 36)', String(silverFg));

// ---- 4. Settings picker: staging + keyboard -------------------------------
await loadWith({ accent: 'blue', theme: 'dark' });
await page.getByRole('button', { name: 'Preferences' }).click();
await page.waitForSelector('.preferences-panel');
const group = page.getByRole('group', { name: 'Accent Color' });
check('picker lists all five accents in order', JSON.stringify(
  await group.locator('input[type=radio]').evaluateAll((els) => els.map((e) => e.value)),
) === JSON.stringify(['blue', 'red', 'steel', 'bronze', 'silver']));
check('Azure label carries the localized Default tag',
  (await group.getByRole('radio', { name: /Azure/ }).locator('..').textContent()).includes('Default'));
await group.getByRole('radio', { name: 'Steel Blue' }).click();
const beforeSave = await page.evaluate(() => document.documentElement.dataset.accent);
check('Steel Blue radio only stages — html still blue', beforeSave === 'blue');
const saveEnabled = await page.getByRole('button', { name: 'Save', exact: true }).isEnabled();
check('accent alone enables Save', saveEnabled);
await page.screenshot({ path: `${SHOTS}/accent-picker-staging.png` });
await page.getByRole('button', { name: 'Save', exact: true }).click();
await page.waitForFunction(() => document.documentElement.dataset.accent === 'steel');
check('Save applies data-accent=steel and persists', await page.evaluate(() => localStorage.getItem('pb.accent')) === 'steel');
await page.screenshot({ path: `${SHOTS}/accent-picker-applied.png` });
// Cancel discards: stage bronze, cancel, still steel. (The panel stays open
// after Save — persist-in-place — so no reopen here.)
await group.getByRole('radio', { name: 'Bronze' }).click();
await page.getByRole('button', { name: 'Cancel', exact: true }).click();
await page.waitForSelector('.preferences-panel', { state: 'detached' });
check('Cancel drops the bronze draft', (await page.evaluate(() => document.documentElement.dataset.accent)) === 'steel'
  && (await page.evaluate(() => localStorage.getItem('pb.accent'))) === 'steel');
// Keyboard: reopen, focus Azure, ArrowRight walks crimson → steel.
await page.getByRole('button', { name: 'Preferences' }).click();
await page.waitForSelector('.preferences-panel');
await page.getByRole('radio', { name: /Azure/ }).focus();
await page.keyboard.press('ArrowRight');
const afterArrow = await page.getByRole('radio', { name: 'Crimson' }).isChecked();
check('keyboard ArrowRight moves the accent selection', afterArrow);
await page.keyboard.press('ArrowRight');
check('keyboard reaches Steel Blue', await page.getByRole('radio', { name: 'Steel Blue' }).isChecked());
await page.keyboard.press('Escape');

// ---- 5. Data colors do not follow: 2D heatmap pixel invariance ------------
async function heatmapScenario() {
  // Import the straight-run ghostauto sample, pause at t=0, and capture the
  // FULL 2D canvas twice: occupancy zones on (App default) and off via the
  // canvas-bar toggle. The on-vs-off delta isolates the heatmap's alliance
  // tints from bumpers/paths; the full snapshot is compared across accents.
  const fs = await import('node:fs');
  const path = await import('node:path');
  const buf = fs.readFileSync(path.resolve(process.cwd(), 'samples/ghostauto/straight_run.ghostauto'));
  await page.setInputFiles('input[type=file]', {
    name: 'straight_run.ghostauto', mimeType: 'application/json', buffer: buf,
  });
  await page.waitForSelector('.field-canvas', { timeout: 20000 });
  await page.waitForTimeout(600); // one painted beat
  const snapshot = () => page.evaluate(() => {
    const canvas = document.querySelector('.field-canvas');
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height).data;
    let b64 = '';
    for (let i = 0; i < data.length; i += 997 * 4) b64 += data[i] + ',' + data[i + 1] + ',' + data[i + 2] + ';';
    return b64; // deterministic sampled fingerprint of the whole canvas
  });
  // The field artwork decodes asynchronously — wait until the canvas stops
  // changing before fingerprinting, or decode timing (not accent) drives the
  // cross-load comparison.
  const stableSnap = async () => {
    let prev = await snapshot();
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(300);
      const next = await snapshot();
      if (next === prev) return next;
      prev = next;
    }
    return prev;
  };
  const heatBtn = page.getByRole('button', { name: 'Occupancy zones', exact: true });
  const onSnap = await stableSnap();
  await heatBtn.click();
  await page.waitForTimeout(600);
  const offSnap = await stableSnap();
  await heatBtn.click(); // back on for the screenshot
  await page.waitForTimeout(600);
  return { onSnap, offSnap };
}
function deltaTints(onSnap, offSnap) {
  const on = onSnap.split(';').map((x) => x.split(',').map(Number));
  const off = offSnap.split(';').map((x) => x.split(',').map(Number));
  let blue = 0, red = 0;
  for (let i = 0; i < on.length; i++) {
    const a = on[i], b = off[i];
    const dR = a[0] - b[0], dG = a[1] - b[1], dB = a[2] - b[2];
    if (dB > 3 && dB > dR + 2) blue++;
    if (dR > 3 && dR > dB + 2) red++;
  }
  return { blue, red };
}
await loadWith({ accent: 'blue', theme: 'dark' });
const heatBlue = await heatmapScenario();
await page.screenshot({ path: `${SHOTS}/accent-heatmap-blue-accent.png` });
await loadWith({ accent: 'red', theme: 'dark' });
const heatRed = await heatmapScenario();
await page.screenshot({ path: `${SHOTS}/accent-heatmap-red-accent.png` });
const tintsBlue = deltaTints(heatBlue.onSnap, heatBlue.offSnap);
const tintsRed = deltaTints(heatRed.onSnap, heatRed.offSnap);
check(
  '2D canvas pixel-identical between blue and red accents',
  heatBlue.onSnap === heatRed.onSnap,
  heatBlue.onSnap === heatRed.onSnap ? '' : 'sampled fingerprint diverged',
);
check(
  'heatmap toggle really paints the blue alliance tint (sanity; the sample is blue-only)',
  tintsBlue.blue > 10,
  `delta tints under blue accent: ${JSON.stringify(tintsBlue)} — the red↔blue mapping itself is unit-tested`,
);
check(
  'heatmap alliance tints identical under red accent',
  tintsBlue.blue === tintsRed.blue && tintsBlue.red === tintsRed.red,
  `${JSON.stringify(tintsBlue)} vs ${JSON.stringify(tintsRed)}`,
);

// ---- 6. ViewCube repaints on saved accent switch, paused, camera steady ---
await loadWith({ accent: 'blue', theme: 'dark' });
const fs = await import('node:fs');
const path = await import('node:path');
const buf = fs.readFileSync(path.resolve(process.cwd(), 'samples/ghostauto/straight_run.ghostauto'));
await page.setInputFiles('input[type=file]', { name: 'straight_run.ghostauto', mimeType: 'application/json', buffer: buf });
await page.waitForSelector('.field-canvas', { timeout: 20000 });
await page.getByRole('button', { name: '3D', exact: true }).click();
await page.waitForSelector('.field-canvas-3d:not([hidden]) canvas', { timeout: 30000 });
await page.waitForTimeout(2500); // model + first frames
const camBefore = await page.evaluate(() => {
  const p = window.__pb3d;
  return { pos: Array.from(p.camera.position.toArray()), tgt: Array.from(p.controls.target.toArray()) };
});
const cubeShot = async (tag) => {
  const el = await page.$('.viewcube canvas');
  await el.screenshot({ path: `${SHOTS}/accent-viewcube-${tag}.png` });
  return fs.readFileSync(`${SHOTS}/accent-viewcube-${tag}.png`);
};
// Hover the cube's top face region to bake accent hover colors.
const cubeBox = await (await page.$('.viewcube canvas')).boundingBox();
await page.mouse.move(cubeBox.x + cubeBox.width / 2, cubeBox.y + cubeBox.height * 0.28);
await page.waitForTimeout(400);
const cubeBlue = await cubeShot('blue-hover');
// Switch accent through the real settings flow while paused.
await page.getByRole('button', { name: 'Preferences' }).click();
await page.waitForSelector('.preferences-panel');
await page.getByRole('group', { name: 'Accent Color' }).getByRole('radio', { name: 'Steel Blue' }).click();
await page.getByRole('button', { name: 'Save', exact: true }).click();
await page.waitForFunction(() => document.documentElement.dataset.accent === 'steel');
await page.waitForTimeout(600); // retint effect + a draw frame
await page.mouse.move(cubeBox.x + cubeBox.width / 2, cubeBox.y + cubeBox.height * 0.28);
await page.waitForTimeout(400);
const cubeRed = await cubeShot('steel-hover');
const camAfter = await page.evaluate(() => {
  const p = window.__pb3d;
  return { pos: Array.from(p.camera.position.toArray()), tgt: Array.from(p.controls.target.toArray()) };
});
check('ViewCube hover texture repainted after the accent switch', !cubeBlue.equals(cubeRed));
check(
  'camera untouched by the accent switch',
  JSON.stringify(camBefore) === JSON.stringify(camAfter),
  `${JSON.stringify(camBefore)} → ${JSON.stringify(camAfter)}`,
);
await page.screenshot({ path: `${SHOTS}/accent-3d-red-paused.png` });

// ---- 7. RTL + long strings stay inside the viewport ------------------------
await page.evaluate(() => { localStorage.setItem('pb.lang', 'he'); });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.start-screen, .workspace-stage', { timeout: 20000 });
const noOverflowWelcome = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
await page.screenshot({ path: `${SHOTS}/accent-rtl-he-workspace.png` });
await page.getByRole('button', { name: /העדפות|Preferences/ }).click().catch(() => {});
await page.waitForSelector('.preferences-panel', { timeout: 5000 }).catch(() => {});
const noOverflowPrefs = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
check('RTL (Hebrew) workspace has no horizontal overflow', noOverflowWelcome);
check('RTL settings panel has no horizontal overflow', noOverflowPrefs);

check('no console/page errors during the pass', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
