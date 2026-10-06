/**
 * Real-browser KEYBOARD walkthrough (2026-10-06 keyboard pass): the main
 * workflows driven with page.keyboard only — no mouse anywhere. Complements
 * browser-walkthrough.mjs (which covers pointer flows).
 *
 * Usage: node scripts/keyboard-walkthrough.mjs  (expects `vite preview` on
 * :4173 or WALK_BASE; system Chrome via channel, fallback bundled).
 */
import { chromium } from 'playwright-core';

const BASE = process.env.WALK_BASE ?? 'http://localhost:4173/';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium
  .launch(process.env.WALK_CHROME === '0' ? {} : { channel: 'chrome' })
  .catch(() => chromium.launch());
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const active = () => page.evaluate(() => {
  const el = document.activeElement;
  if (!el) return 'none';
  return `${el.tagName}:${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 60)}`;
});
const composerOpen = () => page.locator('.sequence-composer').count();
const clips = () => page.locator('.sequence-clip').count();
const clipLabels = () => page.evaluate(() => [...document.querySelectorAll('.sequence-clip')].map((el) => el.getAttribute('aria-label') ?? ''));
const activeLabel = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '');
/** Walk Tab (or Shift+Tab) until `pred` says the active element matches. */
const walk = async (pred, { max = 40, back = false } = {}) => {
  for (let i = 0; i < max; i++) {
    if (await pred()) return true;
    await page.keyboard.press(back ? 'Shift+Tab' : 'Tab');
    await page.waitForTimeout(40);
  }
  return await pred();
};
const focusCanvas = () => walk(
  () => page.evaluate(() => document.activeElement?.className?.includes('field-canvas') ?? false),
  { max: 60 },
);

await page.goto(BASE);
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(800);

// 1 — Welcome page: Tab to "Try an example", Enter. No mouse.
let reached = await walk(() => page.evaluate(() => document.activeElement?.tagName === 'BUTTON' && /Try an example/i.test(document.activeElement.textContent ?? '')), { max: 15 });
check('welcome: Tab reaches the example button', reached, await active());
await page.keyboard.press('Enter');
await page.waitForSelector('.robot-library-row', { timeout: 15000 });
const robotCount = await page.locator('.robot-library-row').count();
check('welcome: Enter loads the example (keyboard only)', robotCount === 2, `${robotCount} robots`);
// Nothing may auto-focus when the workspace appears (2026-10-06: an earlier
// build landed focus on the first robot card, which painted a focus ring on a
// freshly opened app). The keyboard walks in from the top instead.
check('welcome: no control is focused on load',
  (await page.evaluate(() => document.activeElement?.tagName)) === 'BODY', await active());
const reachedLibrary = await walk(
  () => page.evaluate(() => document.activeElement?.classList?.contains('robot-library-select') ?? false),
  { max: 30 },
);
check('Tab reaches the robot library', reachedLibrary, await active());

// 2 — ? opens the shortcut help; Tab stays inside; Escape closes.
await page.keyboard.press('?');
const helpOpen = await page.getByRole('dialog', { name: 'Keyboard shortcuts' }).count();
check('? opens the shortcut-help dialog', helpOpen === 1);
await page.keyboard.press('Tab');
await page.keyboard.press('Tab');
check('help dialog: Tab stays inside the modal', (await page.getByRole('dialog', { name: 'Keyboard shortcuts' }).count()) === 1);
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
check('help dialog: Escape closes it', (await page.getByRole('dialog', { name: 'Keyboard shortcuts' }).count()) === 0);

// 3 — E enters the composer; focus lands on the editing lane.
await page.keyboard.press('e');
await page.waitForSelector('.sequence-composer', { timeout: 5000 });
const laneFocused = await page.evaluate(() => document.activeElement?.className?.includes('sequence-track-lane') ?? false);
check('E enters the composer', (await composerOpen()) === 1);
check('composer: focus lands on the editing lane', laneFocused);

// 4 — Shift+Tab back into the route library, Enter appends a segment. The
// example ships 22 routes for team 8814, so which entry the tab order hands
// us is not fixed: the appended clip is read back from the DOM rather than
// hard-coded, and every later check follows that real label.
const labelsBefore = await clipLabels();
const baseline = labelsBefore.length;
const reachedRoute = await walk(
  () => page.evaluate(() => document.activeElement?.className?.includes('sequence-route-source') ?? false),
  { max: 6, back: true },
);
check('composer: Shift+Tab reaches a route-library entry', reachedRoute, await active());
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
const labelsAfter = await clipLabels();
const appended = labelsAfter.find((label) => !labelsBefore.includes(label)) ?? '';
check('composer: Enter appends the route as a clip',
  labelsAfter.length === baseline + 1 && appended !== '', `${baseline} → ${labelsAfter.length}: ${appended}`);

// 5 — Tab forward to the APPENDED clip: it is the last segment on the lane,
// so a nudge has free room on at least the right side. Arrows move, Delete
// removes, Meta+Z restores.
const clipFocused = await walk(
  () => page.evaluate((want) => {
    const el = document.activeElement;
    return !!el?.className?.includes('sequence-clip') && el.getAttribute('aria-label') === want;
  }, appended),
  { max: 45 },
);
check('composer: Tab reaches the appended clip', clipFocused, await active());
const start = (label) => { const m = /,\s*([\d.]+)–/.exec(label); return m ? Number(m[1]) : null; };
const start0 = start(appended);
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(200);
const start1 = start(await activeLabel());
check('composer: ArrowRight nudges the focused clip +0.1 s',
  start0 !== null && start1 !== null && Math.abs(start1 - start0 - 0.1) <= 0.02, `${start0} → ${start1}`);
await page.keyboard.press('ArrowLeft');
await page.waitForTimeout(200);
check('composer: ArrowLeft returns it to its exact start', (await activeLabel()) === appended, await activeLabel());
// The neighbour to its LEFT is flush against it, so a −1 s nudge would
// overlap — and placeClip refuses: the clip must not move.
await page.keyboard.press('Shift+ArrowLeft');
await page.waitForTimeout(200);
check('composer: an overlapping −1 s nudge is refused', (await activeLabel()) === appended, await activeLabel());
await page.keyboard.press('Delete');
await page.waitForTimeout(400);
check('composer: Delete removes the focused clip', (await clips()) === baseline);
await page.keyboard.press('Meta+z');
await page.waitForTimeout(400);
check('composer: Meta+Z restores the deleted clip', (await clips()) === baseline + 1);

// 6 — Escape returns to playback; focus lands on a real control (never body).
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
check('composer: Escape returns to playback', (await composerOpen()) === 0);
const triggerAfter = await active();
check('composer: focus restored after Escape (not body)', !/BODY:/.test(triggerAfter), triggerAfter);

// 7 — Focus the 2D canvas, then global playback keys work (the design keeps
// them inert while buttons/sliders own focus).
const onCanvas = await focusCanvas();
check('Tab reaches the 2D canvas', onCanvas, await active());
const clockBefore = await page.locator('.clock').textContent();
await page.keyboard.press('End');
await page.waitForTimeout(300);
const clockAfter = await page.locator('.clock').textContent();
check('End jumps the playhead to the range end', clockBefore !== clockAfter, `${clockBefore?.trim()} → ${clockAfter?.trim()}`);
await page.keyboard.press('ArrowLeft');
await page.waitForTimeout(200);
const clockScrub = await page.locator('.clock').textContent();
check('ArrowLeft scrubs while the canvas is focused', clockScrub !== clockAfter, clockScrub?.trim());
const speed = () => page.locator('.timeline-speeds button[aria-pressed="true"]').textContent();
const s0 = await speed();
await page.keyboard.press('Shift+,');
await page.waitForTimeout(200);
const s1 = await speed();
await page.keyboard.press('Shift+.');
await page.waitForTimeout(200);
const s2 = await speed();
check('Shift+, / Shift+. step playback speed', s0 !== s1 && s2 === s0, `${s0} → ${s1} → ${s2}`);

// 8 — Robot shortcuts: H, M, , / . (any non-input focus).
const eye = page.locator('.robot-library-visibility').first();
const eyeBefore = await eye.getAttribute('aria-pressed');
await page.keyboard.press('h');
await page.waitForTimeout(300);
const eyeAfter = await eye.getAttribute('aria-pressed');
check('H toggles robot visibility', eyeBefore !== eyeAfter, `${eyeBefore} → ${eyeAfter}`);
await page.keyboard.press('h');
await page.waitForTimeout(200);
const mirror = page.locator('.robot-mirror-button').first();
const mBefore = await mirror.getAttribute('aria-pressed');
await page.keyboard.press('m');
await page.waitForTimeout(300);
check('M toggles the team mirror', (await mirror.getAttribute('aria-pressed')) !== mBefore);
await page.keyboard.press('m');
await page.waitForTimeout(200);
const selBefore = await page.evaluate(() => document.querySelector('.robot-library-select[aria-pressed="true"]')?.getAttribute('aria-label'));
await page.keyboard.press(',');
await page.waitForTimeout(300);
const selMid = await page.evaluate(() => document.querySelector('.robot-library-select[aria-pressed="true"]')?.getAttribute('aria-label'));
await page.keyboard.press('.');
await page.waitForTimeout(300);
const selAfter = await page.evaluate(() => document.querySelector('.robot-library-select[aria-pressed="true"]')?.getAttribute('aria-label'));
check(', / . cycle the robot selection', selBefore !== selMid && selAfter === selBefore, `${selBefore} → ${selMid} → ${selAfter}`);

// 9 — V / 0: 2D↔3D and view reset.
await page.keyboard.press('v');
await page.waitForSelector('.view-toggle button[aria-pressed="true"]:has-text("3D")', { timeout: 8000 }).catch(() => {});
check('V switches to 3D', (await page.locator('.view-toggle button[aria-pressed="true"]').textContent()) === '3D');
await page.keyboard.press('ArrowLeft');
await page.waitForTimeout(300);
check('3D: no page errors after orbit keys', errors.length === 0, errors[0] ?? '');
await page.keyboard.press('0');
await page.waitForTimeout(300);
await page.keyboard.press('v');
await page.waitForSelector('.view-toggle button[aria-pressed="true"]:has-text("2D")', { timeout: 8000 }).catch(() => {});
check('V switches back to 2D', (await page.locator('.view-toggle button[aria-pressed="true"]').textContent()) === '2D');

// 10 — Settings via keyboard: Tab to the gear, Enter, Escape.
const gearReached = await walk(() => page.evaluate(() => /Preferences/i.test(document.activeElement?.getAttribute('aria-label') ?? '')), { max: 45 });
check('Tab reaches the settings gear', gearReached, await active());
await page.keyboard.press('Enter');
await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
check('Enter opens preferences', (await page.locator('[role="dialog"]').count()) >= 1);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
check('Escape closes preferences', (await page.locator('[role="dialog"]').count()) === 0);

// 11 — Save from the keyboard. PR #223 retired the toolbar save button (the
// data-driven menu owns it now, and app.e2e asserts it stays out of the DOM),
// so Cmd/Ctrl+S is the keyboard path — asserted here by the download it fires.
const downloadPromise = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
await page.keyboard.press('ControlOrMeta+s');
const download = await downloadPromise;
check('Cmd/Ctrl+S saves the session (.pb download)', download !== null, download ? await download.suggestedFilename() : 'no download');

await page.screenshot({ path: '/tmp/pb-shots/keyboard-final.png' }).catch(() => {});
check('no page errors during the whole keyboard flow', errors.length === 0, errors[0] ?? '');

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
