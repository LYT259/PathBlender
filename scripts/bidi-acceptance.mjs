/**
 * Real-browser RTL/LTR acceptance for the bidirectional CSS audit
 * (red book item ② second half, 2026-11-09). Runs the app in English (ltr)
 * and Hebrew (rtl) and asserts the reading-direction mirror at the layout
 * level: menus stay inside the viewport, the panel separators paint on the
 * content-facing edge, the timeline keeps its physical ltr axis, the switch
 * knob mirrors, and the language picker's mark column stays on the physical
 * right — the design decision recorded in LanguagePicker.css.
 *
 * Usage: node scripts/bidi-acceptance.mjs   (expects `vite preview` on :4173
 * or WALK_BASE; system Chrome via channel, fallback bundled). Screenshots
 * land in .bidi-acceptance/shots/ (untracked).
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const BASE = process.env.WALK_BASE ?? 'http://localhost:4173/';
const SHOTS = join(dirname(fileURLToPath(import.meta.url)), '..', '.bidi-acceptance', 'shots');
mkdirSync(SHOTS, { recursive: true });

const ROUNDS = [
  { lang: 'en', dir: 'ltr', tryLabel: 'Try an example' },
  { lang: 'he', dir: 'rtl', tryLabel: 'נסו דוגמה' },
];

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const inViewport = (b, vw) => b.x >= -0.5 && b.y >= -0.5 && b.x + b.width <= vw + 0.5 && b.height > 0;

const browser = await chromium
  .launch(process.env.WALK_CHROME === '0' ? {} : { channel: 'chrome' })
  .catch(() => chromium.launch());

try {
  for (const { lang, dir, tryLabel } of ROUNDS) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(BASE);
    await page.addInitScript((l) => localStorage.setItem('pb.lang', l), lang);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(700);
    const vw = page.viewportSize().width;

    check(`${lang}: direction ${dir}`, (await page.evaluate(() => document.documentElement.getAttribute('dir'))) === dir);

    const welcomeOverflow = await page.evaluate(() => {
      const d = document.scrollingElement;
      return d ? d.scrollWidth - d.clientWidth : 0;
    });
    check(`${lang}: no horizontal overflow (welcome)`, welcomeOverflow <= 1, `+${welcomeOverflow}px`);
    await page.screenshot({ path: join(SHOTS, `welcome-${lang}.png`) });

    // First Tab lands on the first menu-bar control with a visible ring.
    await page.keyboard.press('Tab');
    const focusInfo = await page.evaluate(() => {
      const el = document.activeElement;
      const cs = getComputedStyle(el);
      return { cls: el?.className ?? '', outline: cs.outlineStyle !== 'none' && cs.outlineWidth !== '0px' };
    });
    check(`${lang}: first Tab focuses the first menu`, focusInfo.cls.includes('menu-top'), focusInfo.cls.slice(0, 40));
    check(`${lang}: focus ring visible after Tab`, focusInfo.outline === true);

    // Every menu panel — first, last — must fit the viewport in both directions.
    for (const which of ['first', 'last']) {
      const top = which === 'first' ? page.locator('.menu-top').first() : page.locator('.menu-top').last();
      await top.click();
      await page.waitForTimeout(150);
      const panel = page.locator('.menu-panel').last();
      const box = await panel.boundingBox();
      const ok = box !== null && inViewport(box, vw);
      check(`${lang}: ${which} menu panel inside viewport`, ok, box ? `x=${box.x.toFixed(1)} w=${box.width.toFixed(1)}` : 'no panel');
      if (which === 'last') await page.screenshot({ path: join(SHOTS, `menu-${which}-${lang}.png`) });
      await page.keyboard.press('Escape');
    }

    // Load the example scene, then re-check the full workspace.
    await page.getByRole('button', { name: tryLabel }).first().click();
    await page.waitForTimeout(4000);
    const robots = await page.locator('.robot-library-row').count();
    check(`${lang}: example loaded`, robots >= 2, `${robots} robots`);
    const wsOverflow = await page.evaluate(() => {
      const d = document.scrollingElement;
      return d ? d.scrollWidth - d.clientWidth : 0;
    });
    check(`${lang}: no horizontal overflow (workspace)`, wsOverflow <= 1, `+${wsOverflow}px`);
    await page.screenshot({ path: join(SHOTS, `workspace-${lang}.png`) });

    // Panel geometry: the reading-direction mirror of the three columns.
    const geo = await page.evaluate(() => {
      const b = (sel) => {
        const el = document.querySelector(sel);
        return el ? el.getBoundingClientRect().toJSON() : null;
      };
      return { lib: b('.robot-library'), canvas: b('.field-canvas-wrap'), insp: b('.workspace-inspector') };
    });
    check(`${lang}: three columns present`, !!(geo.lib && geo.canvas && geo.insp));
    if (geo.lib && geo.canvas && geo.insp) {
      const libRight = geo.lib.x > geo.canvas.x;
      const inspLeft = geo.insp.x + geo.insp.width < geo.canvas.x + geo.canvas.width;
      check(`${lang}: library on ${dir === 'rtl' ? 'right' : 'left'}`, dir === 'rtl' ? libRight : !libRight,
        `lib.x=${geo.lib.x.toFixed(0)}`);
      check(`${lang}: inspector on ${dir === 'rtl' ? 'left' : 'right'}`, dir === 'rtl' ? inspLeft : !inspLeft,
        `insp.x=${geo.insp.x.toFixed(0)}`);
    }

    // The inspector separator paints on the content-facing edge in both directions.
    const border = await page.evaluate(() => {
      const el = document.querySelector('.workspace-inspector');
      const cs = getComputedStyle(el);
      return { start: cs.borderInlineStartWidth, left: cs.borderLeftWidth, right: cs.borderRightWidth };
    });
    check(`${lang}: inspector separator on inline-start edge`,
      border.start === '1px' && border[dir === 'rtl' ? 'right' : 'left'] === '1px' && border[dir === 'rtl' ? 'left' : 'right'] === '0px',
      JSON.stringify(border));

    // The time axis keeps its physical ltr direction whatever the UI reads.
    const timelineDir = await page.evaluate(() => {
      const el = document.querySelector('.timeline-workspace');
      return el ? getComputedStyle(el).direction : '';
    });
    check(`${lang}: timeline axis stays ltr`, timelineDir === 'ltr', timelineDir);

    // View menu submenu flies out on the reading side and stays on screen.
    const viewTop = page.locator('.menu-top').nth(2);
    await viewTop.click();
    await page.waitForTimeout(150);
    const sub = page.locator('.menu-panel .menu-sub').first();
    const subCount = await sub.count();
    if (subCount > 0) {
      await sub.hover();
      await page.waitForTimeout(200);
      const subBox = await page.locator('.menu-sub-panel').last().boundingBox();
      const wrapBox = await sub.boundingBox();
      const ok = subBox !== null && wrapBox !== null && inViewport(subBox, vw)
        && (dir === 'rtl' ? subBox.x + subBox.width <= wrapBox.x + 2 : subBox.x >= wrapBox.x + wrapBox.width - 2);
      check(`${lang}: submenu opens ${dir === 'rtl' ? 'left' : 'right'} and fits`, ok,
        subBox ? `sub.x=${subBox.x.toFixed(1)} w=${subBox.width.toFixed(1)}` : 'no submenu');
      await page.screenshot({ path: join(SHOTS, `submenu-${lang}.png`) });
    } else {
      check(`${lang}: submenu present in View menu`, false, 'no .menu-sub');
    }
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    // Preferences: switch knob mirrors; language picker keeps mark physical right.
    await page.locator('.menu-top').last().click();
    await page.waitForTimeout(150);
    await page.locator('.menu-panel button').last().click(); // Help → About opens prefs on web
    await page.waitForTimeout(400);
    const panelThere = await page.locator('.preferences-panel').count();
    check(`${lang}: preferences dialog opens`, panelThere === 1);
    if (panelThere) {
      // The mouse section carries the slide-switch checkboxes; walk the nav if needed.
      if ((await page.locator('.preferences-checkbox input').count()) === 0) {
        const navCount = await page.locator('.preferences-nav button').count();
        for (let i = 0; i < navCount && (await page.locator('.preferences-checkbox input').count()) === 0; i++) {
          await page.locator('.preferences-nav button').nth(i).click();
          await page.waitForTimeout(150);
        }
      }
      const sw = page.locator('.preferences-checkbox input').first();
      const knob = async () => page.evaluate((sel) => {
        const el = document.querySelector(sel);
        return getComputedStyle(el, '::after').getPropertyValue('inset-inline-start');
      }, '.preferences-checkbox input');
      if ((await sw.count()) > 0) {
        const offPos = await knob();
        await sw.click();
        await page.waitForTimeout(250);
        const onPos = await knob();
        await sw.click(); // restore
        check(`${lang}: switch knob slides 2px→13px via inline-start`, offPos.trim() === '2px' && onPos.trim() === '13px',
          `${offPos.trim()}→${onPos.trim()}`);
      } else {
        check(`${lang}: switch knob present`, false, 'no preferences-checkbox');
      }

      // Language picker: mark column stays on the physical right in both directions.
      // (.language-picker-trigger is also reused by SelectControl; the language
      // picker's own trigger is the one without the select-control classes.)
      await page.locator('.language-picker-trigger:not(.select-control-trigger)').click();
      await page.waitForTimeout(250);
      const markGeo = await page.evaluate(() => {
        const b = (sel) => document.querySelector(sel)?.getBoundingClientRect().toJSON() ?? null;
        const row = document.querySelector('.language-picker-option');
        return { names: b('.language-picker-names'), mark: b('.language-picker-mark'), check: b('.language-picker-check'), anyRow: !!row };
      });
      if (markGeo.anyRow && markGeo.names && markGeo.mark && markGeo.check) {
        const physicalRight = markGeo.check.x > markGeo.mark.x && markGeo.mark.x > markGeo.names.x;
        check(`${lang}: picker mark/check stay physical right`, physicalRight,
          `names.x=${markGeo.names.x.toFixed(0)} mark.x=${markGeo.mark.x.toFixed(0)} check.x=${markGeo.check.x.toFixed(0)}`);
      } else {
        check(`${lang}: picker rows present`, false, 'no picker row geometry');
      }
      await page.screenshot({ path: join(SHOTS, `prefs-${lang}.png`) });
      await page.keyboard.press('Escape');
    }

    check(`${lang}: no page errors`, errors.length === 0, errors.slice(0, 2).join(' | ').slice(0, 120));
    await ctx.close();
  }
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) process.exit(1);
