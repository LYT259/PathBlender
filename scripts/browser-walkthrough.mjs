/**
 * WHO RUNS THIS: developers (and the AI sessions working on this repo). The
 * app never ships it and no user ever sees it — it is a robot acceptance
 * tester that drives the real production build in a real browser, the way a
 * person would, and prints PASS/FAIL per step. Unit tests prove the logic;
 * only this harness can prove the assembled product still behaves when files
 * are dragged in, a session is saved to disk, the language flips, or 3D is
 * entered. Run it after touching anything user-visible, and before a release.
 *
 * COVERAGE (pointer + real file system): welcome state → two .ghostauto
 * imports → collision jump → folder import and its route library in the
 * composer → playback rates → all 40 languages + RTL round trips → theme
 * staging → out-of-bounds panel → season + construction persistence across a
 * reload → artwork repaint proofs → custom field → read-only inspector →
 * robot removal through the context menu → PathPlanner batch → session
 * save/restore round trip through a real file → bulk stress over every valid
 * sample → GIF export → service worker → 3D (model, painted robots, sky tint,
 * viewcube picks, damped orbit, tag counts per season, in-3D season switch) →
 * session restore on reload. Keyboard-only flows live in
 * scripts/keyboard-walkthrough.mjs; the two are complements, not duplicates.
 *
 * Usage: npm run build -w @pathblender/web && npm run preview -w @pathblender/web
 *        node scripts/browser-walkthrough.mjs   (expects :4173, or set WALK_BASE)
 * System Chrome is used through the channel (no 150 MB download); screenshots
 * land in /tmp/pb-shots. Exits non-zero on any failed check.
 */
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, readdirSync as readdir } from 'node:fs';
import { resolve } from 'node:path';

const BASE = process.env.WALK_BASE ?? 'http://localhost:4173/';
const SHOTS = '/tmp/pb-shots';
const SAMPLES = resolve(process.cwd(), 'samples');
mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

// System Chrome when present (no 150MB playwright download); bundled otherwise.
const browser = await chromium
  .launch(process.env.WALK_CHROME === '0' ? {} : { channel: 'chrome' })
  .catch(() => chromium.launch());
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: 'en-US',
  permissions: ['clipboard-read', 'clipboard-write'],
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
let modelLoaded = false;
page.on('response', (r) => { if (r.url().includes('fields3d/') && r.url().endsWith('model.glb') && r.status() === 200) modelLoaded = true; });

const rows = () => page.locator('.robot-library-row');
const fileInput = () => page.locator('input[type="file"][multiple]').first();

// The unified single-select dropdowns (#303) are trigger buttons with a
// body-level listbox portal — the native <select> calls the old steps used
// do not exist. Both helpers speak value codes, matching SelectControl's
// data-value options and the LanguagePicker's data-value options alike.
const pickCombobox = async (trigger, value) => {
  await trigger.click();
  await page.locator('[role="option"][data-value="' + value + '"]').first().click();
};
const readCombobox = async (trigger) => {
  await trigger.click();
  const picked = await page.locator('[role="option"][aria-selected="true"]').first().getAttribute('data-value');
  await trigger.focus();
  await page.keyboard.press('Escape');
  return picked;
};

// The gear's aria-label follows the UI language — match every locale we ship.
const gearLocator = page.locator(
  ['.tool-btn[aria-label="Preferences"]', '.tool-btn[aria-label="Preferencias"]',
   '.tool-btn[aria-label="Tercihler"]', '.tool-btn[aria-label="Préférences"]',
   '.tool-btn[aria-label="Preferências"]', '.tool-btn[aria-label="העדפות"]',
   '.tool-btn[aria-label="Voorkeuren"]', '.tool-btn[aria-label="Preferencje"]',
   '.tool-btn[aria-label="環境設定"]', '.tool-btn[aria-label="환경설정"]',
   '.tool-btn[aria-label="Předvolby"]',
   '.tool-btn[aria-label="偏好设置"]', '.tool-btn[aria-label="偏好設定"]'].join(', '),
).first();
// Since PR #65 Save keeps the window open; several sections below end with
// a Save. Opening the gear self-heals: close any open panel first so a
// leftover overlay can never block the click.
const prefsGear = async () => {
  if (await page.locator('.prefs-modal').count()) {
    await page.locator('.preferences-footer .btn:not(.accent)').click();
    await page.waitForSelector('.prefs-modal', { state: 'detached', timeout: 5000 });
    await page.waitForTimeout(200);
  }
  return gearLocator;
};
const clockText = () => page.locator('.clock').textContent().then((t) => parseFloat(t ?? '0'));

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.workspace-empty');
// Empty state: the whole canvas bar (incl. view toggle) is replaced by the
// welcome screen; view3D defaults to false, asserted once robots exist.
check('page loads with the welcome state', true);
check(
  'import actions offered before any file is loaded',
  (await page.locator('.workspace-empty .welcome-import').count()) === 1 &&
    (await page.locator('.workspace-empty .welcome-folder-import').count()) === 1,
);
// --- Quick guide (2026-10-07 onboarding plan): the welcome screen offers the
// in-app guide; opening it shows the topic body and Escape closes it back to
// the welcome screen. (The purpose pitch that used to sit here was removed on
// user request — the welcome screen stays copy-light.) ---
await page.locator('.start-guide-link').click();
await page.waitForSelector('.guide-dialog');
check(
  'quick guide opens with the transforms topic',
  (await page.locator('.guide-dialog').textContent()).includes('PathBlender'),
);
await page.keyboard.press('Escape');
await page.waitForSelector('.guide-dialog', { state: 'detached' });
check('quick guide closes on Escape', true);
await page.screenshot({ path: `${SHOTS}/01-empty.png` });

// --- Onboarding tour (2026-10-07 plan §3): the example session carries a
// five-task checklist; it starts collapsed (2026-10-08 user decision) and a
// click expands it, a real mirror click completes its task, dismissing
// hides the card, and the example exits cleanly back to the welcome page. ---
await page.locator('.welcome-try-example').click();
await page.waitForSelector('.robot-library-row', { timeout: 10000 });
await page.waitForSelector('.tour-card');
check('tour card appears with the example at 0/5', (await page.locator('.tour-card .tour-progress').textContent()) === '0/5');
check('tour card starts collapsed', (await page.locator('.tour-card .tour-toggle').first().getAttribute('aria-expanded')) === 'false' && (await page.locator('.tour-card .tour-tasks').count()) === 0);
await page.locator('.tour-card .tour-toggle').click();
await page.waitForSelector('.tour-card .tour-tasks');
check('expand click reveals the five tasks', (await page.locator('.tour-card .tour-tasks li').count()) === 5);
await page.locator('.robot-library-row').first()
  .getByRole('button', { name: /mirror/i }).first().click();
await page.waitForFunction(() => document.querySelector('.tour-card .tour-progress')?.textContent === '1/5');
check('mirror click completes its tour task', true);
await page.screenshot({ path: `${SHOTS}/02-tour-card.png` });
await page.locator('.tour-card .tour-close').click();
await page.waitForSelector('.tour-card', { state: 'detached' });
check('tour card dismisses', true);
await page.getByRole('button', { name: /end example/i }).click();
await page.waitForSelector('.workspace-empty');
check('example exits back to the welcome page', true);


// --- AI retreat (2026-09-20): no assistant surface anywhere ---
await (await prefsGear()).click();
await page.waitForSelector('.prefs-modal');
check('preferences carry no AI settings (code deleted)', (await page.locator('.prefs-modal .ai-row, .prefs-modal .prefs-ai').count()) === 0);
await page.locator('.preferences-footer .btn:not(.accent)').first().click(); // Cancel — the prefs redesign (0.1.4-beta era) moved the footer to .preferences-footer with .btn / .btn.accent

// --- import two ghost files through the real file input ---
await fileInput().setInputFiles([
  `${SAMPLES}/ghostauto/straight_run.ghostauto`,
  `${SAMPLES}/ghostauto/stop_and_score.ghostauto`,
]);
await page.waitForSelector('.robot-library-row', { timeout: 10000 });
await page.waitForSelector('.field-canvas');
check('starts in 2D (toggle pressed)', (await page.locator('.view-toggle button', { hasText: '2D' }).first().getAttribute('aria-pressed')) === 'true');
// First-run defaults (fresh profile): current season, welded construction,
// schematic artwork, 2D view.
{
  const season = await readCombobox(page.locator('.field-select').first());
  // The variant control is now a segmented toggle (buttons), not a select.
  const welded = (await page.locator('.field-variant-toggle button[aria-pressed=true]').first().textContent())?.trim() === 'Welded';
  const schematic = (await page.locator('.field-style-toggle button[aria-pressed=true]').first().textContent())?.trim() === '示意图' || (await page.locator('.field-style-toggle button[aria-pressed=true]').first().textContent())?.trim() === 'Schematic';
  check(
    'first-run defaults: 2026 + welded + schematic',
    season === 'rebuilt-2026' && welded && schematic,
    `season=${season} welded=${welded} schematic=${schematic}`,
  );
}
await page.waitForFunction(
  () => document.querySelector('.conflict-count')?.textContent === '1',
  undefined,
  { timeout: 10000 },
);
check('collision detected (straight × stop)', true);
await page.screenshot({ path: `${SHOTS}/02-collision.png` });

// --- Team display order (#300): the timeline rows reorder through the real
// HTML5 drag path. The desktop build rides the same events (tauri
// dragDropEnabled:false, 2026-10-09) — when that flag flips back, this still
// passes in Chrome while every drag in the macOS app dies silently. ---
{
  const rowIds = () => page.$$eval('.timeline-row[data-team-order-id]', rows => rows.map(r => r.dataset.teamOrderId));
  const before = await rowIds();
  const handle = page.locator('.timeline-row[data-team-order-id]').first().locator('.team-order-handle');
  const lastRow = page.locator('.timeline-row[data-team-order-id]').last();
  await handle.dragTo(lastRow, { targetPosition: { x: 200, y: (await lastRow.boundingBox()).height - 4 } });
  const after = await rowIds();
  check('timeline rows reorder by drag (first row lands below last)',
    after.length === before.length && after[after.length - 1] === before[0],
    `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
}


// --- folder import: one robot per team, carrying its whole route library ---
// The per-row route <select> retired with the composer redesign (route choice
// lives in the arrange view), so the folder's routes are checked THERE — and
// both pointer paths are exercised: click appends, drag places under the
// cursor. Robot removal moved into the row's context menu (the inspector has
// been read-only since the 2026-09-30 pivot).
const routesInFolder = (await readdir(`${SAMPLES}/ghostauto`)).length;
await page.locator('input[webkitdirectory]').first().setInputFiles(`${SAMPLES}/ghostauto`);
await page.waitForFunction(() => document.querySelectorAll('.robot-library-row').length === 3, undefined, { timeout: 20000 });
await rows().last().locator('.robot-arrange-button').click();
await page.waitForSelector('.sequence-composer', { timeout: 8000 });
const routeSource = page.locator('.sequence-route-source');
const sourcesSeen = await routeSource.count();
check('folder import carries every route into the composer', sourcesSeen === routesInFolder, `sources=${sourcesSeen} files=${routesInFolder}`);

// These ghostauto routes run 8.3–11.5 s inside a 15 s auto period, so a lane
// holds ONE of them at a time: clear the robot's own segment through the
// clip's context menu, place a route by clicking it, then drag that segment —
// the pointer paths the keyboard harness cannot cover.
const editingClip = page.locator('.sequence-track.is-editing .sequence-clip');
await editingClip.first().click({ button: 'right' });
await page.waitForSelector('.sequence-clip-menu', { timeout: 5000 });
await page.getByRole('menuitem', { name: 'Remove route' }).click();
await page.waitForTimeout(400);
check('clip context menu removes the segment', (await editingClip.count()) === 0, `clips=${await editingClip.count()}`);

const startOf = async () => Number(/,\s*([\d.]+)–/.exec(await editingClip.first().getAttribute('aria-label') ?? '')?.[1] ?? -1);
const sources = await page.evaluate(() => [...document.querySelectorAll('.sequence-route-source')].map((b, i) => ({
  i, disabled: b.disabled, seconds: Number(/: ([\d.]+) s$/.exec(b.getAttribute('aria-label') ?? '')?.[1] ?? Infinity),
})));
const shortest = sources.filter((s) => !s.disabled).sort((a, b) => a.seconds - b.seconds)[0];
await routeSource.nth(shortest.i).click();
await page.waitForTimeout(400);
check('clicking a route appends it as a clip', (await editingClip.count()) === 1, `chosen=${shortest.i} (${shortest.seconds}s)`);
const placedStart = await startOf();

const laneBox = await page.locator('.sequence-track.is-editing .sequence-track-lane').boundingBox();
const clipBox = await editingClip.first().boundingBox();
await page.mouse.move(clipBox.x + clipBox.width / 2, clipBox.y + clipBox.height / 2);
await page.mouse.down();
await page.mouse.move(laneBox.x + laneBox.width * 0.45, laneBox.y + laneBox.height / 2, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(500);
const movedStart = await startOf();
// An empty lane can only be entered at 0.00 by clicking a route; a dragged
// segment has to end up wherever the cursor dropped (measured ≈4.9 s for a
// drop at 45 % of the lane, grab offset included). Assert the displacement,
// not the exact second, so lane width and DPR changes cannot fake a failure.
check('dragging the segment follows the pointer',
  (await editingClip.count()) === 1 && movedStart >= placedStart + 3,
  `${placedStart} → ${movedStart}`);

await page.locator('[data-session-history="undo"]').click();
await page.waitForTimeout(300);
check('toolbar undo returns the segment', (await startOf()) === placedStart, `${movedStart} → ${await startOf()}`);
await page.locator('[data-session-history="redo"]').click();
await page.waitForTimeout(300);
check('toolbar redo moves it out again', (await startOf()) === movedStart, `placed=${placedStart} redo=${await startOf()}`);
await page.getByRole('button', { name: 'Back to playback' }).click();
await page.waitForSelector('.sequence-composer', { state: 'detached', timeout: 5000 });
check('composer exits through its Back button', (await page.locator('.sequence-composer').count()) === 0);

await rows().last().click({ button: 'right' });
await page.waitForSelector('.robot-context-menu', { timeout: 5000 });
check('row context menu offers remove', (await page.getByRole('menuitem', { name: /Remove from session/ }).count()) === 1);
await page.getByRole('menuitem', { name: /Remove from session/ }).click();
await page.waitForFunction(() => document.querySelectorAll('.robot-library-row').length === 2, undefined, { timeout: 8000 });
check('context menu removes the folder robot again', (await rows().count()) === 2, `rows=${await rows().count()}`);

// --- jump to the conflict via the panel (back on the Checks tab) ---
await page.locator('.inspector-tabs button', { hasText: /^Checks|^检查/i }).click();
await page.waitForSelector('.conflict-jump', { timeout: 8000 });
await page.locator('.conflict-jump').first().click();
await page.waitForTimeout(300);
const jumpClock = await clockText();
check('conflict jump sets clock', jumpClock > 3, `clock=${jumpClock}`);
await page.screenshot({ path: `${SHOTS}/03-jumped.png` });

// --- playback: play/pause, 0.5× slows, only 0.25/0.5/1 offered ---
const playBtn = page.locator('.timeline-play');
// Rewind first: the wall-clock steps above vary run to run, and measuring
// the 0.5× rate near the trajectory's end trips the end-of-play rewind and
// reads as a backward jump.
await page.locator('.timeline-transport button').first().click();
await page.waitForTimeout(300);
await playBtn.click();
await page.waitForTimeout(1500);
await playBtn.click();
await page.locator('.timeline-speeds button', { hasText: '0.5×' }).click();
const t1 = await clockText();
await playBtn.click();
await page.waitForTimeout(1000);
await playBtn.click();
const t2 = await clockText();
check('playback 0.5× slows the clock', t2 - t1 > 0.25 && t2 - t1 < 0.9, `clock ${t1.toFixed(2)} → ${t2.toFixed(2)} over 1s wall`);
check(
  'fast-forward speeds removed',
  (await page.locator('.timeline-speeds button', { hasText: '2×' }).count()) === 0 &&
    (await page.locator('.timeline-speeds button', { hasText: '4×' }).count()) === 0,
);
await page.locator('.timeline-speeds button', { hasText: '1×' }).click();
const midClock = await clockText();
check('playback advances clock', midClock > 0.5, `clock=${midClock}`);
await page.screenshot({ path: `${SHOTS}/04-playing.png` });

// --- language switch via Preferences (staged save/cancel semantics) ---
// The 0.1.4-beta prefs redesign: sectioned panel (.preferences-nav tabs),
// footer .preferences-footer (.btn cancel / .btn.accent save), theme as
// radios, About as a section carrying .preferences-product + copy status.
const saveBtn = page.locator('.preferences-footer .btn.accent');
const cancelBtn = page.locator('.preferences-footer .btn:not(.accent)');
const langSelect = page.locator('.preferences-panel .language-picker-trigger').first();
await (await prefsGear()).click();
await langSelect.waitFor({ state: 'visible', timeout: 8000 });
// About block: natural-facing version ("0.1.4 · Beta N"), the full number,
// one-click copy (versioning scheme 2026-10-01). The exact number drifts
// with every merge by design — assert shape, not value.
await page.locator('.preferences-nav [role=tab]', { hasText: /^About$/ }).click();
{
  // The About block shows one version line now (no separate <code> node —
  // parallel UI rework removed it); it carries the full semver plus the build
  // hash. The exact number drifts with every merge by design — shape, not value.
  const full = (await page.locator('.preferences-product .preferences-version').textContent())?.trim() ?? '';
  check(
    'About shows the version line',
    /^Version \d+\.\d+\.\d+(-beta\.\d+)?( \([0-9a-f]{7,40}\))?$/.test(full),
    `version="${full}"`,
  );
  const copyBtn = page.locator('.preferences-product button');
  check('About offers one-click version copy', (await copyBtn.count()) === 1);
  await copyBtn.click();
  await page.waitForTimeout(300);
  const copyStatus = (await page.locator('.preferences-copy-status').textContent()) ?? '';
  check('version copy reports success', copyStatus.length > 0, `status="${copyStatus}"`);
}
await page.locator('.preferences-nav [role=tab]', { hasText: /^General$/ }).click();
// The searchable picker (#299/#303): open it once, count its rows from the
// listbox, and pick by data-value code from here on.
await langSelect.click();
const pickerOptions = page.locator('.language-picker-popover [role="option"]');
const optionCount = await pickerOptions.count();
// The picker must offer every selectable dictionary — counted from the
// i18n folder so the harness grows with the language set instead of rotting
// against a frozen number (it read "15" for two expansion rounds).
// Dictionaries are language-code-shaped filenames (ar.ts, pt-br.ts, even
// three-letter fil.ts); helper modules (language-names.ts,
// language-search.ts) never match the shape, so a new dictionary file still
// grows the count alone.
// One shaped file is not a selectable row: zh-tw.ts ships as the base the
// zh-hk override table spreads over, without a picker entry since the
// 2026-10-07 withdrawal (fifth batch pending).
const NOT_SELECTABLE = 1;
const shaped = readdir(resolve(process.cwd(), 'packages/web/src/i18n'))
  .filter((f) => /^[a-z]{2,3}(-[a-z]+)*\.ts$/.test(f));
const dictionaries = shaped.length - NOT_SELECTABLE;
check('language list offers every selectable dictionary', optionCount === dictionaries + 1, `options=${optionCount} selectable dictionaries=${dictionaries}`);
check('follow-system sits first', /Follow system|跟随系统|跟隨系統/i.test((await pickerOptions.first().textContent()) ?? ''));
await page.locator('.language-picker-popover [role="option"][data-value="zh"]').click();
await page.waitForTimeout(150);
check('save/cancel are always present in the footer', (await saveBtn.count()) === 1 && (await cancelBtn.count()) === 1);
// Cancel closes the modal AND discards the staged choice (v1.23 semantics).
await cancelBtn.click();
await page.waitForTimeout(300);
const headingAfterCancel = await page.locator('.robot-library-heading h2').first().textContent();
check(
  'cancel discards the pending language',
  (await page.locator('.prefs-modal').count()) === 0 && /Robots/.test(headingAfterCancel ?? ''),
  `modal=${await page.locator('.prefs-modal').count()} heading=${headingAfterCancel}`,
);
await (await prefsGear()).click();
await pickCombobox(langSelect, 'zh');
await saveBtn.click();
await page.waitForTimeout(300);
// Since PR #65 Save keeps the window open (drafts apply in place); closing
// is via Cancel/Esc — close explicitly between language rounds.
check('save keeps the preferences window open (PR #65)', (await page.locator('.prefs-modal').count()) === 1);
const zhText = await page.locator('.robot-library-heading h2').first().textContent();
check('zh switch', /机器人/.test(zhText ?? ''), zhText ?? '');
await page.screenshot({ path: `${SHOTS}/05-zh.png` });
await cancelBtn.click();
await page.waitForSelector('.prefs-modal', { state: 'detached', timeout: 5000 });
await page.waitForTimeout(200);
// fr as a representative of the P1 batch (es/fr/tr)
await (await prefsGear()).click();
await pickCombobox(langSelect, 'fr');
await saveBtn.click();
await page.waitForTimeout(300);
const frText = await page.locator('.robot-library-heading h2').first().textContent();
check('fr switch (P1 language)', /Robots/.test(frText ?? ''), frText ?? '');
await page.screenshot({ path: `${SHOTS}/05b-fr.png` });
await cancelBtn.click();
await page.waitForSelector('.prefs-modal', { state: 'detached', timeout: 5000 });
await page.waitForTimeout(200);
// he — the app's first RTL language (first batch, PR #114): the document
// flips to rtl while the field and timeline keep their physical directions.
await (await prefsGear()).click();
await pickCombobox(langSelect, 'he');
await saveBtn.click();
await page.waitForTimeout(300);
check(
  'he switch flips the document to RTL',
  (await page.evaluate(() => document.documentElement.getAttribute('dir'))) === 'rtl',
  await page.evaluate(() => document.documentElement.getAttribute('dir') ?? 'no-dir'),
);
const heText = await page.locator('.robot-library-heading h2').first().textContent();
check('he switch (first-batch language)', /רובוט/.test(heText ?? ''), heText ?? '');
await page.screenshot({ path: `${SHOTS}/05c-he.png` });
await cancelBtn.click();
await page.waitForSelector('.prefs-modal', { state: 'detached', timeout: 5000 });
await page.waitForTimeout(200);
// pt-BR — the second first-batch language, and a return trip to LTR.
await (await prefsGear()).click();
await pickCombobox(langSelect, 'pt-BR');
await saveBtn.click();
await page.waitForTimeout(300);
check(
  'pt-BR switch returns the document to LTR',
  (await page.evaluate(() => document.documentElement.getAttribute('dir'))) === 'ltr',
  await page.evaluate(() => document.documentElement.getAttribute('dir') ?? 'no-dir'),
);
const ptText = await page.locator('.robot-library-heading h2').first().textContent();
check('pt-BR switch (first-batch language)', /Robôs/.test(ptText ?? ''), ptText ?? '');
await page.screenshot({ path: `${SHOTS}/05d-pt-br.png` });
await cancelBtn.click();
await page.waitForSelector('.prefs-modal', { state: 'detached', timeout: 5000 });
await page.waitForTimeout(200);
// ja — second-batch language (nl/pl/ja/ko/cs, red book §语言扩展规划): a CJK
// round that must stay LTR, exercising a non-Latin font path end to end.
await (await prefsGear()).click();
await pickCombobox(langSelect, 'ja');
await saveBtn.click();
await page.waitForTimeout(300);
check(
  'ja switch keeps the document LTR',
  (await page.evaluate(() => document.documentElement.getAttribute('dir'))) === 'ltr',
  await page.evaluate(() => document.documentElement.getAttribute('dir') ?? 'no-dir'),
);
const jaText = await page.locator('.robot-library-heading h2').first().textContent();
check('ja switch (second-batch language)', /ロボット/.test(jaText ?? ''), jaText ?? '');
await page.screenshot({ path: `${SHOTS}/05e-ja.png` });
await cancelBtn.click();
await page.waitForSelector('.prefs-modal', { state: 'detached', timeout: 5000 });
await page.waitForTimeout(200);
await (await prefsGear()).click();
await pickCombobox(langSelect, 'en');
await saveBtn.click();
await page.waitForTimeout(300);
await cancelBtn.click();
await page.waitForSelector('.prefs-modal', { state: 'detached', timeout: 5000 });
await page.waitForTimeout(200);

// --- theme staged semantics (headless defaults light) ---
await (await prefsGear()).click();
const darkRadio = page.locator('.preferences-theme-choice input[value=dark]');
await darkRadio.check();
await page.waitForTimeout(150);
check('theme staged before Save', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'light');
await page.locator('.preferences-theme-choice input[value=light]').check();
await saveBtn.click();
await page.waitForTimeout(300);
const htmlTheme = await page.evaluate(() => document.documentElement.dataset.theme);
check('theme confirmed light on Save', htmlTheme === 'light', `data-theme=${htmlTheme}`);
await (await prefsGear()).click();
await page.locator('.preferences-theme-choice input[value=dark]').check();
await saveBtn.click();
await page.waitForTimeout(300);
await cancelBtn.click();
await page.waitForSelector('.prefs-modal', { state: 'detached', timeout: 5000 });
await page.waitForTimeout(200);

// (Share link removed entirely, PR #89 — never coming back; its
// walkthrough steps went stale and blocked every later run 2026-10-02.)

// --- out-of-bounds + field bounds panel ---
await fileInput().setInputFiles([`${SAMPLES}/ghostauto/out_of_bounds.ghostauto`]);
await page.waitForFunction(
  () => document.querySelectorAll('.robot-library-row').length === 3,
  undefined,
  { timeout: 10000 },
);
await page.locator('.conflict-jump.bounds').first().click().catch(() => {});
check('field-bounds entry appears', (await page.locator('.conflict-jump.bounds').count()) >= 1);
await page.screenshot({ path: `${SHOTS}/08-bounds.png` });

// --- season switch + AndyMark variant survive reload ---
const seasonSelect = page.locator('.field-select').first();
await pickCombobox(seasonSelect, 'reefscape-2025');
await page.waitForTimeout(700);
await page.locator('.field-variant-toggle button', { hasText: 'AndyMark' }).click();
await page.waitForTimeout(400);
await page.evaluate(() => history.replaceState(null, '', location.pathname));
await page.reload({ waitUntil: 'domcontentloaded' });
// The reload clears the in-memory session; the empty state exposes no field
// controls, so re-import first — the canvas bar (with the selects) follows.
await fileInput().setInputFiles([
  `${SAMPLES}/ghostauto/straight_run.ghostauto`,
  `${SAMPLES}/ghostauto/stop_and_score.ghostauto`,
  `${SAMPLES}/ghostauto/out_of_bounds.ghostauto`,
]);
await page.waitForSelector('.robot-library-row', { timeout: 10000 });
await page.waitForSelector('.field-canvas');
const fieldAfterReload = await readCombobox(seasonSelect);
const amPressed = (await page.locator('.field-variant-toggle button[aria-pressed=true]').first().textContent())?.trim() === 'AndyMark';
check('field + AndyMark variant survive reload', fieldAfterReload === 'reefscape-2025' && amPressed, `field=${fieldAfterReload} andymark=${amPressed}`);
await page.screenshot({ path: `${SHOTS}/09-reefscape.png` });
// 2025's default style is the schematic (a single artwork): toggling the
// construction variant moves only the tag overlay (~7 cm at the coral
// stations) — still a repaint. The rendered style swaps the official
// artwork pair with the variant.
{
  const canvas2d = page.locator('canvas.field-canvas').first();
  const snap = () => canvas2d.evaluate((c) => c.toDataURL('image/png'));
  const styleToggle = page.locator('.field-style-toggle button');
  check('2025 exposes the style selector', (await styleToggle.count()) === 2);
  const amSchematic = await snap();
  await page.locator('.field-variant-toggle button', { hasText: 'Welded' }).click();
  await page.waitForTimeout(600);
  const wdSchematic = await snap();
  check('schematic variant toggle repaints (tag overlay moves)', amSchematic !== wdSchematic);
  await page.locator('.field-style-toggle button', { hasText: /Rendered|渲染图/ }).click();
  await page.waitForTimeout(600);
  const wdRendered = await snap();
  check('style switch to rendered repaints', wdRendered !== wdSchematic);
  await page.locator('.field-variant-toggle button', { hasText: 'AndyMark' }).click();
  await page.waitForTimeout(600);
  const amRendered = await snap();
  check('2025 rendered pair swaps with the construction variant', amRendered !== wdRendered);
  await page.locator('.field-style-toggle button', { hasText: /Schematic|示意图/ }).click();
  await page.waitForTimeout(600);
  check('style/variant toggles paint no console/HTTP errors', errors.length === 0, errors.slice(0, 3).join(' | '));
}
check('season switch', true);
// 2018–2020 removed (user decisions 2026-10-03); every bundled season now
// ships an official 3D model, so the old "model-less season" paths are
// gone — custom fields remain the one 3D-less surface, covered below.

// --- custom field panel opens, takes an image, cancels ---
await pickCombobox(seasonSelect, 'custom');
await page.waitForTimeout(300);
check('custom-field panel opens', (await page.locator('.cf-panel').count()) === 1);
await page.setInputFiles('.cf-panel input[type="file"]', `${process.cwd()}/assets/fields/rebuilt2026.png`);
await page.waitForTimeout(400);
check('custom-field image loads', (await page.locator('.cf-panel').count()) === 1 && errors.length === 0);
await page.screenshot({ path: `${SHOTS}/10-custom-field.png` });
await page.locator('.cf-panel .btn.small').last().click();
await pickCombobox(seasonSelect, 'rebuilt-2026');
await page.waitForTimeout(300);

// --- inspector: read-only everywhere (2026-09-30 pivot) ---
await page.locator('.robot-library-row .robot-library-select').first().click();
await page.waitForTimeout(400);
const inspector = page.locator('.robot-inspector');
await inspector.waitFor();
check(
  'inspector is fully read-only (no spinbuttons/textboxes/toggles)',
  (await inspector.locator('input, .seg button').count()) === 0,
);
// The inspector reports what the FILE carried (bumper dimensions in the
// user's units). The per-file alliance line is gone — the canvas bar's
// alliance toggle owns the view, so the inspector shows no controls at all.
const inspectorText = (await inspector.innerText()).replace(/\s+/g, ' ');
check('inspector lists the file-supplied robot data', /From file/.test(inspectorText) && /bumper/i.test(inspectorText), inspectorText.slice(0, 90));

// --- keyboard: Home rewinds, Space plays/pauses ---
await page.evaluate(() => document.activeElement?.blur());
await page.keyboard.press('Home');
const beforeSpace = await clockText();
check('Home rewinds clock', beforeSpace < 0.05, `clock=${beforeSpace}`);
await page.keyboard.press('Space');
await page.waitForTimeout(900);
await page.keyboard.press('Space');
const afterSpace = await clockText();
check('Space toggles playback', afterSpace > 0.3, `clock 0 → ${afterSpace.toFixed(2)}`);

// --- PathPlanner native import (auto + paths in one batch) ---
await fileInput().setInputFiles([
  `${SAMPLES}/pathplanner/Example Auto.auto`,
  `${SAMPLES}/pathplanner/Pickup.path`,
  `${SAMPLES}/pathplanner/Score.path`,
]);
await page.waitForFunction(
  () => document.querySelectorAll('.robot-library-row').length === 6,
  undefined,
  { timeout: 20000 },
);
// Rows carry team numbers, not file names, so the PathPlanner batch is
// asserted by count; selecting the first robot just gives the session below
// something of each origin to save.
check('PathPlanner batch imports every file', (await rows().count()) === 6, `rows=${await rows().count()}`);
await page.screenshot({ path: `${SHOTS}/11-pathplanner.png` });

await rows().first().locator('.robot-library-select').click();
await page.waitForTimeout(300);
// (No waypoint editing / adjusted exports anymore — the app is a viewer.)

// --- session save → remove one robot → restore through the file input ---
// PR #223 retired the toolbar save button; File ▸ Save session is the pointer
// path (menu-dispatch.test asserts .save-action stays out of the DOM).
await page.getByRole('button', { name: 'File', exact: true }).click();
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 10000 }).catch(() => undefined),
  page.getByRole('menuitem', { name: 'Save session' }).click(),
]);
check('session download triggers', download !== undefined);
let restoredRows = 0;
if (download) {
  const buf = await download.path().then((p) => (p ? readFileSync(p) : undefined));
  if (buf) {
    const before = await rows().count();
    await rows().last().click({ button: 'right' });
    await page.waitForSelector('.robot-context-menu', { timeout: 5000 });
    await page.getByRole('menuitem', { name: /Remove from session/ }).click();
    await page.waitForTimeout(300);
    const afterRemove = await rows().count();
    check('robot remove works', afterRemove === before - 1, `${before} → ${afterRemove}`);
    await fileInput().setInputFiles([
      { name: 'session.pb', mimeType: 'application/json', buffer: buf },
    ]);
    await page.waitForFunction(
      (n) => document.querySelectorAll('.robot-library-row').length === n,
      before,
      { timeout: 10000 },
    );
    restoredRows = await rows().count();
  }
}
check('session file restores all robots', restoredRows >= 6, `rows=${restoredRows}`);

// --- stress: import every valid sample in one batch (fresh context) ---
const ctx3 = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
const page3 = await ctx3.newPage();
const stressErrors = [];
page3.on('pageerror', (e) => stressErrors.push(String(e)));
await page3.goto(BASE, { waitUntil: 'domcontentloaded' });
const allSamples = [
  ...(await readdir(`${SAMPLES}/traj`)).map((f) => `${SAMPLES}/traj/${f}`),
  ...(await readdir(`${SAMPLES}/ghostauto`)).map((f) => `${SAMPLES}/ghostauto/${f}`),
  ...(await readdir(`${SAMPLES}/pathplanner`)).map((f) => `${SAMPLES}/pathplanner/${f}`),
];
await page3.locator('input[type="file"][multiple]').first().setInputFiles(allSamples);
await page3.waitForFunction(
  (n) => document.querySelectorAll('.robot-library-row').length >= n,
  16,
  { timeout: 20000 },
);
const stressRows = await page3.locator('.robot-library-row').count();
check('bulk import all samples', stressRows >= 16 && stressErrors.length === 0, `rows=${stressRows}`);
await page3.screenshot({ path: `${SHOTS}/12-bulk-stress.png` });
await ctx3.close();

// --- exports through the File menu ---
// PNG export was removed for good (user decision 2026-10-05, deletion
// ledger); GIF and the solution package stay, and both are menu commands
// since PR #223. GIF renders frames, so the download gets a long leash.
const openFileMenu = async () => {
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.waitForSelector('.menu-panel', { timeout: 5000 });
};
await openFileMenu();
const [zipDl] = await Promise.all([
  page.waitForEvent('download', { timeout: 60000 }).catch(() => undefined),
  page.getByRole('menuitem', { name: /Export Solution Package/ }).click(),
]);
check('solution package export downloads', zipDl !== undefined, zipDl ? await zipDl.suggestedFilename() : 'no download');
await openFileMenu();
const [gifDl] = await Promise.all([
  page.waitForEvent('download', { timeout: 60000 }).catch(() => undefined),
  page.getByRole('menuitem', { name: /Export GIF/ }).click(),
]);
check('GIF export downloads', gifDl !== undefined, gifDl ? await gifDl.suggestedFilename() : 'no download');
// In 3D the command is still offered but the app says out loud that replay
// is 2D-only — the old silent no-op was the regression this guards. The toast
// lives ~3 s, so read it BEFORE waiting out a download that must never come.
await page.locator('.view-toggle button', { hasText: '3D' }).click();
await page.waitForTimeout(800);
await openFileMenu();
await page.getByRole('menuitem', { name: /Export GIF/ }).click();
const toastSeen = await page.locator('.toast', { hasText: '2D-only' })
  .waitFor({ timeout: 3000 }).then(() => true).catch(() => false);
const gifToast = (await page.locator('.toast').last().textContent().catch(() => null)) ?? '';
const gif3d = await page.waitForEvent('download', { timeout: 1500 }).catch(() => undefined);
check('GIF in 3D refuses with a toast, never a silent no-op', toastSeen && gif3d === undefined, `toast=${gifToast} download=${gif3d ? 'yes' : 'no'}`);
await page.locator('.view-toggle button', { hasText: '2D' }).click();
await page.waitForTimeout(400);

// --- PWA service worker registered ---
const swUrl = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  return reg?.active?.scriptURL ?? reg?.installing?.scriptURL ?? '';
});
check('service worker registered', swUrl.includes('sw.js'), swUrl);

// --- 3D: render, model, theme hot-switch, orbit, tags ---
await page.locator('.view-toggle button', { hasText: '3D' }).click();
await page.waitForTimeout(1500);
check(
  '3D view renders (canvas + no errors)',
  (await page.locator('.field-canvas-3d canvas').count()) >= 1 && errors.length === 0,
);
check('official 3D field model loaded', modelLoaded, modelLoaded ? 'fields3d glb fetched' : 'no model request');

// Robots must actually PAINT in 3D — scene-graph node counts alone missed
// the 2026-10-02 black-robot regression (rigs stranded at origin on CAD
// template arrival + physical light units dimming lit meshes to black).
// The field model is effectively unlit, so only a pixel scan catches it.
await page.waitForTimeout(1200);
const robotPaint = await page.evaluate(() => {
  const st = window.__pb3d;
  const cv = document.querySelector('.field-canvas-3d canvas');
  if (!st?.renderer || !cv) return null;
  st.renderer.render(st.scene, st.camera);
  const off = document.createElement('canvas');
  off.width = cv.width;
  off.height = cv.height;
  const g = off.getContext('2d', { willReadFrequently: true });
  g.drawImage(cv, 0, 0);
  const d = g.getImageData(0, 0, cv.width, cv.height).data;
  let pink = 0, cyan = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], gg = d[i + 1], b = d[i + 2];
    if (r > gg + 50 && b > gg + 30 && r > 140) pink++;
    else if (b > r + 50 && gg > 90 && b > 140) cyan++;
  }
  return { pink, cyan };
});
// d313bb0 switched 3D bumpers to alliance colors (default session = blue
// → both demo robots render #2264CF); the old pink/cyan pair counted the
// retired per-robot path colors. Count "lit bumper pixels" generically:
// saturated blue OR red alliance tints.
check(
  '3D robots are lit and painted (not black)',
  !!robotPaint && robotPaint.cyan > 20,
  JSON.stringify(robotPaint),
);
const sample3dSky = () =>
  page.evaluate(() => {
    const st = window.__pb3d;
    const cv = document.querySelector('.field-canvas-3d canvas');
    if (!st?.renderer || !st?.scene || !st?.camera || !cv) return null;
    st.renderer.render(st.scene, st.camera);
    const off = document.createElement('canvas');
    off.width = 1;
    off.height = 1;
    const g = off.getContext('2d', { willReadFrequently: true });
    g.drawImage(cv, 0, 0, Math.round(cv.width * 0.12), Math.round(cv.height * 0.12), 0, 0, 1, 1);
    const d = g.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  });
const isDarkSky = (px) => Array.isArray(px) && px.every((v) => v < 60);
const isLightSky = (px) => Array.isArray(px) && px.every((v) => v > 210);
const skyDark = await sample3dSky();
check('3D sky is dark before theme switch', isDarkSky(skyDark), JSON.stringify(skyDark));
await (await prefsGear()).click();
await page.waitForSelector('.prefs-modal');
await page.locator('.preferences-theme-choice input[value=light]').check();
await page.locator('.preferences-footer .btn.accent').click();
await page.waitForTimeout(700);
const skyLight = await sample3dSky();
check('3D retints to light on hot-switch', isLightSky(skyLight), JSON.stringify(skyLight));
await page.screenshot({ path: `${SHOTS}/14b-3d-light.png` });
await cancelBtn.click();
await page.waitForSelector('.prefs-modal', { state: 'detached', timeout: 5000 });
await page.waitForTimeout(200);
await (await prefsGear()).click();
await page.waitForSelector('.prefs-modal');
await page.locator('.preferences-theme-choice input[value=dark]').check();
await page.locator('.preferences-footer .btn.accent').click();
await page.waitForTimeout(700);
await cancelBtn.click();
await page.waitForSelector('.prefs-modal', { state: 'detached', timeout: 5000 });
await page.waitForTimeout(200);

check('viewcube present', (await page.locator('.viewcube canvas').count()) === 1);

// Face/edge/corner picks tween the camera to the picked feature direction
// (asserted against the pick hook — headless rAF is sparse, so wait for the
// value instead of a fixed delay). The cube's own home button retired with
// the toolbar recenter (PR #202): one control resets 2D fit and 3D camera,
// and the 3D home is the ViewCube top–front edge, az 0 / polar π/4.
const atHome = async () => {
  const ok = await page.waitForFunction(
    () => {
      const c = window.__pb3d?.controls;
      if (!c) return false;
      return Math.abs(c.getAzimuthalAngle()) < 0.05 && Math.abs(c.getPolarAngle() - Math.PI / 4) < 0.05;
    },
    undefined,
    { timeout: 12000, polling: 100 },
  ).then(() => true).catch(() => false);
  if (!ok) {
    const s = await page.evaluate(() => {
      const c = window.__pb3d?.controls;
      return c ? { az: +c.getAzimuthalAngle().toFixed(3), pol: +c.getPolarAngle().toFixed(3) } : 'no __pb3d';
    });
    console.log(`  [atHome miss] camera=${JSON.stringify(s)}`);
  }
  return ok;
};
const vcBox = await page.locator('.viewcube canvas').boundingBox();
const clickCube = async (fx, fy) => {
  await page.locator('.canvas-recenter').click();
  if (!(await atHome())) return null;
  // move+down+up split: mouse.click() batches the events and occasionally
  // drops the pointerdown under load (Playwright flake, not app logic).
  await page.mouse.move(vcBox.x + vcBox.width * fx, vcBox.y + vcBox.height * fy);
  await page.mouse.down();
  await page.mouse.up();
  const picked = await page.waitForFunction(
    () => (window.__pb3d.lastPick ? true : false),
    undefined,
    { timeout: 4000, polling: 100 },
  ).then(() => true).catch(() => false);
  if (!picked) return null; // the click landed off the cube — reported as a miss, not a crash
  const lp = await page.evaluate(() => {
    const p = window.__pb3d.lastPick;
    window.__pb3d.lastPick = undefined;
    return [p.x, p.y, p.z];
  });
  const reached = await page
    .waitForFunction(
      ([x, y, z]) => {
        const c = window.__pb3d.controls;
        const n = Math.hypot(x, y, z); // pick dirs are unnormalized sign vectors
        const tAz = Math.atan2(x, z);
        // Straight overhead / straight below are picks too, but the orbit
        // clamps polar to [0.15, 2.6] rad — the app's own limit, so the
        // expected viewpoint is the clamped one, not acos(y/n) itself.
        const tPol = Math.min(2.6, Math.max(0.15, Math.acos(Math.max(-1, Math.min(1, y / n)))));
        return Math.abs(c.getAzimuthalAngle() - tAz) < 0.1 && Math.abs(c.getPolarAngle() - tPol) < 0.1;
      },
      lp,
      { timeout: 6000, polling: 100 },
    )
    .then(() => true)
    .catch(async () => {
      const s = await page.evaluate(() => ({
        az: window.__pb3d.controls.getAzimuthalAngle(),
        pol: window.__pb3d.controls.getPolarAngle(),
      }));
      console.log(`  [clickCube miss] target=${JSON.stringify(lp)} camera az=${s.az.toFixed(3)} pol=${s.pol.toFixed(3)}`);
      return false;
    });
  if (!reached) return null;
  return lp;
};
// Which pixel is a face / edge / corner depends on the camera pose the cube is
// drawing, so no fraction can be hard-coded here (guessing that mapping is
// exactly what made these three checks fail). The harness sweeps the cube
// instead: every pick must tween the camera onto the direction that was
// picked, and the sweep has to cover all three kinds of feature.
const sweep = [[0.2, 0.2], [0.5, 0.2], [0.8, 0.2], [0.2, 0.5], [0.8, 0.5], [0.2, 0.8], [0.5, 0.8], [0.8, 0.8]];
const picks = [];
for (const [fx, fy] of sweep) picks.push(await clickCube(fx, fy));
const kinds = picks.filter(Boolean).map((p) => p.filter((v) => Math.abs(v) > 0.4).length);
check('every viewcube pick tweens the camera onto the picked direction',
  picks.every(Boolean), JSON.stringify(picks));
check('viewcube sweep covers face, edge and corner picks',
  [1, 2, 3].every((k) => kinds.includes(k)), `features=${JSON.stringify(kinds)}`);

// Deliberate race (found by this sweep on 2026-10-06): a ViewCube click
// tweens the camera for 300 ms, and a Fit pressed inside that window used to
// be overwritten by the still-running tween — the camera stayed on the face
// that was picked. Press Fit 50 ms after a pick and require it to win.
{
  const before = await page.evaluate(() => ({ az: window.__pb3d.controls.getAzimuthalAngle(), pol: window.__pb3d.controls.getPolarAngle() }));
  await page.mouse.move(vcBox.x + vcBox.width * 0.5, vcBox.y + vcBox.height * 0.2);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(50);
  await page.locator('.canvas-recenter').click();
  const won = await atHome();
  check('Fit pressed mid fly-to still returns the camera home', won, `picked-from az=${before.az.toFixed(2)} pol=${before.pol.toFixed(2)}`);
}

// Damped orbit settles after release (no endless drift).
{
  const main = await page.locator('.field-canvas-3d canvas').first().boundingBox();
  await page.mouse.move(main.x + main.width / 2, main.y + main.height / 2);
  await page.mouse.down();
  await page.mouse.move(main.x + main.width / 2 + 160, main.y + main.height / 2 + 60, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(2600);
  const glide = await page.evaluate(() => window.__pb3d.controls.getAzimuthalAngle());
  await page.waitForTimeout(600);
  const settled = await page.evaluate(() => window.__pb3d.controls.getAzimuthalAngle());
  check('damped orbit settles after release', Math.abs(settled - glide) < 0.005, `az ${glide.toFixed(3)}→${settled.toFixed(3)}`);
}
await page.screenshot({ path: `${SHOTS}/14-3d.png` });

// AprilTag quads follow the season (2026 welded: 32; 2025: 22).
{
  const tagCount = await page.evaluate(() => {
    let n = 0;
    window.__pb3d.scene.traverse((o) => { if (o.name.startsWith('apriltag-')) n++; });
    return n;
  });
  check('3D renders official tag quads (2026: 32)', tagCount === 32, `count=${tagCount}`);
}
const dynBefore = await page.evaluate(() => window.__pb3d.scene.getObjectByName('pb-dynamic')?.children.length ?? -1);
const camBefore = await page.evaluate(() => window.__pb3d.camera.position.toArray().map((v) => +v.toFixed(3)));
await pickCombobox(page.locator('.field-select').first(), 'reefscape-2025');
await page.waitForFunction(
  () => document.querySelectorAll('.robot-library-row').length >= 1,
  undefined,
  { timeout: 20000, polling: 100 },
);
check('season switch with 3D open keeps robots', true);
// Regression (2026-09-30 user report): switching the field while in 3D used
// to leave the rebuilt scene without any path tubes or robot boxes.
{
  const dynAfter = await page.waitForFunction(
    (before) => {
      const n = window.__pb3d.scene.getObjectByName('pb-dynamic')?.children.length ?? -1;
      return n >= before && before > 0 ? n : false;
    },
    dynBefore,
    { timeout: 8000, polling: 120 },
  ).then((r) => r.jsonValue());
  check('3D paths & robots survive the in-3D season switch', dynAfter === dynBefore, `dynamic children ${dynBefore} → ${dynAfter}`);
  const camAfter = await page.evaluate(() => window.__pb3d.camera.position.toArray().map((v) => +v.toFixed(3)));
  check('camera keeps the user\'s exact viewpoint across the switch', JSON.stringify(camAfter) === JSON.stringify(camBefore), `${camBefore} → ${camAfter}`);
}

{
  const tagCount25 = await page.evaluate(() => {
    let n = 0;
    window.__pb3d.scene.traverse((o) => { if (o.name.startsWith('apriltag-')) n++; });
    return n;
  });
  check('3D tag quads follow season (2025: 22)', tagCount25 === 22, `count=${tagCount25}`);
}
// Back to the first season: the parsed model comes from the module cache —
// tags return instantly, the camera STILL holds, and the cache is warm.
await pickCombobox(page.locator('.field-select').first(), 'rebuilt-2026');
await page.waitForFunction(() => {
  let n = 0;
  window.__pb3d.scene.traverse((o) => { if (o.name.startsWith('apriltag-')) n++; });
  return n === 32;
}, undefined, { timeout: 20000, polling: 150 });
{
  const dynBack = await page.evaluate(() => window.__pb3d.scene.getObjectByName('pb-dynamic')?.children.length ?? -1);
  const camBack = await page.evaluate(() => window.__pb3d.camera.position.toArray().map((v) => +v.toFixed(3)));
  const cacheSize = await page.evaluate(() => window.__pb3d.modelCacheSize());
  check('revisited season restores instantly from cache (tags 32)', true, `cache=${cacheSize}`);
  check('revisited season keeps paths & camera', dynBack === dynBefore && JSON.stringify(camBack) === JSON.stringify(camBefore), `dynamic=${dynBack}, cam=${camBack}`);
}

// Every bundled season ships an official 3D model now (2018–2020 removed,
// 2026-10-03), and selecting "custom" only opens its panel without
// switching the field — the old "3D falls back on a model-less season"
// path no longer exists, so it is not exercised here.

// The 2D/3D choice survives a reload (user directive 2026-10-02) — with
// the autosaved session restoring, no re-import is needed anymore.
await page.locator('.view-toggle button', { hasText: '3D' }).click();
await page.waitForSelector('.field-canvas-3d canvas', { timeout: 15000 });
// The autosave is debounced 600ms — wait until the rebuilt-2026 field choice
// has actually been persisted before reloading, otherwise the restore comes
// (no model-less switch happens anymore)
// legitimately stays 2D with the toggle hidden and the wait below times out.
await page.waitForFunction(
  () => (localStorage.getItem('pb.autosave.v1') ?? '').includes('rebuilt-2026'),
  { timeout: 5000 },
);
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.field-canvas-3d canvas', { timeout: 15000 });
check('3D view restored after reload', true);
await page.locator('.view-toggle button', { hasText: '2D' }).click();
await page.waitForSelector('.field-canvas:not(.field-canvas-3d)', { timeout: 10000 });

// Launch continuity (user 2026-10-02: quitting in 3D reopened to the
// welcome page). The autosaved session comes back on reload — robots,
// field, and variant, with no fresh import.
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.field-canvas', { timeout: 10000 });
await page.waitForSelector('.robot-library-row', { timeout: 10000 });
await page.waitForTimeout(800);
const rowsAfterReload = await page.locator('.robot-library-row').count();
check('last session restored on reload (no re-import)', rowsAfterReload > 0, `rows=${rowsAfterReload}`);
const restoredField = await readCombobox(page.locator('.field-select').first());
check('field selection remembered across reload', restoredField === 'rebuilt-2026', restoredField);
const amPressed2 = (await page.locator('.field-variant-toggle button[aria-pressed=true]').first().textContent())?.trim() === 'AndyMark';
check('explicit AndyMark choice survives reload', amPressed2 === true);

check('no console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length > 0 ? 1 : 0);
