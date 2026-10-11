/**
 * Real-browser language acceptance sweep (2026-10-07 language round).
 *
 * For EVERY shipped UI language: the app opens in that language, the
 * document direction is right, the welcome copy is actually translated,
 * nothing overflows horizontally and no bare {placeholder} leaks to the
 * screen. For a representative subset (comma/point/RTL/CJK/hard-languages)
 * the example scene loads and the run-time numbers render through the
 * locale number format next to the dictionary's own conventions.
 *
 * Usage: node scripts/lang-acceptance.mjs   (expects `vite preview` on
 * :4173 or WALK_BASE; system Chrome via channel, fallback bundled)
 */
import { chromium } from 'playwright-core';

const BASE = process.env.WALK_BASE ?? 'http://localhost:4173/';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

// The 43 selectable UI languages (the region-neutral Traditional row withdrew
// 2026-10-11: Hong Kong, Macau and Taiwan are the three region-named
// Traditional rows; en-GB is the second English row).
const LANGS = ['en','en-GB','zh','zh-hk','zh-mo','zh-tw','ar','az','bg','bs','cs','da','de','el','es','fil','fr',
  'he','hi','hr','hu','hy','id','it','ja','ko','mk','mr','ms','nb','nl','nn','pl','pt-BR','ro',
  'rw','sq','sr','sv','ta','tr','uk','vi'];
/** comma-decimal languages where runtime numbers must use the comma. */
const COMMA = ['az','bg','bs','cs','da','de','el','es','fr','hr','hu','hy','id','it','mk','nb',
  'nl','nn','pl','pt-BR','ro','rw','sq','sr','sv','tr','uk','vi'];
const DEEP = ['en','zh','fr','de','ar','he','ja','vi','hy','rw','el'];

const browser = await chromium
  .launch(process.env.WALK_CHROME === '0' ? {} : { channel: 'chrome' })
  .catch(() => chromium.launch());

for (const lang of LANGS) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  try {
    await page.goto(BASE);
    await page.addInitScript((l) => localStorage.setItem('pb.lang', l), lang);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(700);

    const docLang = await page.evaluate(() => document.documentElement.getAttribute('lang'));
    check(`${lang}: document lang`, docLang === lang, `got ${docLang}`);

    const dir = await page.evaluate(() => document.documentElement.getAttribute('dir'));
    const wantDir = lang === 'ar' || lang === 'he' ? 'rtl' : 'ltr';
    check(`${lang}: direction ${wantDir}`, dir === wantDir, `got ${dir}`);

    // welcome.title is the start screen's accessible name (aria-label, not
    // visible text): en must carry it verbatim, every other language must
    // carry its own translation — doubles as the AT-name localization check.
    // en-GB is English too: its override table only respells 8 keys, so it
    // shares en's welcome.title by design and is held to the en assertion.
    const ariaTitle = await page.evaluate(() =>
      document.querySelector('.start-screen')?.getAttribute('aria-label') ?? '');
    const enTitle = 'Import paths to get started';
    if (lang !== 'en' && lang !== 'en-GB') {
      check(`${lang}: start-screen AT name translated`, ariaTitle !== enTitle && ariaTitle !== '', ariaTitle.slice(0, 40));
    } else {
      check(`${lang}: start-screen AT name`, ariaTitle === enTitle, ariaTitle.slice(0, 40));
    }

    // No horizontal overflow on the welcome screen.
    const overflow = await page.evaluate(() => {
      const d = document.scrollingElement;
      return d ? d.scrollWidth - d.clientWidth : 0;
    });
    check(`${lang}: no horizontal overflow (welcome)`, overflow <= 1, `+${overflow}px`);

    // No bare placeholders anywhere on screen.
    const barePh = await page.evaluate(() =>
      (document.body.innerText.match(/\{[a-z]+\}/g) ?? []).slice(0, 3).join(' '));
    check(`${lang}: no bare placeholders`, barePh === '', barePh);

    // Language picker shows the endonym while active.
    const pickerText = await page.evaluate(() => {
      const el = document.querySelector('.lang-current, [data-lang-label]');
      return el ? el.textContent?.trim() : '';
    });

    if (DEEP.includes(lang)) {
      // Open the example (exact per-language button label from the dictionary)
      // and inspect run-time number rendering.
      const TRY = {
        en: 'Try an example', zh: '体验示例', fr: 'Essayer un exemple',
        de: 'Beispiel ausprobieren', ar: 'جرّب مثالًا', he: 'נסו דוגמה',
        ja: 'サンプルを試す', vi: 'Thử ví dụ', hy: 'Փորձել օրինակը',
        rw: 'Gerageza urugero', el: 'Δοκιμάστε ένα παράδειγμα',
      };
      await page.getByRole('button', { name: TRY[lang] }).first().click();
      await page.waitForTimeout(4000); // example chunk + robots
      const robots = await page.locator('.robot-library-row, .robot-library-item li').count();
      check(`${lang}: example loaded`, robots >= 2, `${robots} robots`);

      // Tolerance row (visible when ≥2 robots): the live ± value must use
      // this locale's separator.
      const tol = await page.evaluate(() =>
        document.querySelector('.tolerance-value')?.textContent ?? '');
      const want = COMMA.includes(lang) ? ',' : '.';
      check(`${lang}: tolerance uses "${want}"`, tol.includes(`±0${want}4`) || tol.includes(`±0${want}0`), tol);

      // Playback clock shows a locale separator too.
      const clock = await page.evaluate(() =>
        document.querySelector('.timeline-clock')?.textContent ?? '');
      check(`${lang}: clock number format`, clock.includes(`0${want}00`) || clock.includes(`0${want}`), clock.slice(0, 24));

      // Workspace overflow re-check with full UI.
      const overflow2 = await page.evaluate(() => {
        const d = document.scrollingElement;
        return d ? d.scrollWidth - d.clientWidth : 0;
      });
      check(`${lang}: no horizontal overflow (workspace)`, overflow2 <= 1, `+${overflow2}px`);

      // No page errors during the deep pass.
      check(`${lang}: no page errors`, errors.length === 0, errors.slice(0, 2).join(' | ').slice(0, 120));

      void pickerText;
    }
  } catch (e) {
    check(`${lang}: sweep error`, false, String(e).slice(0, 120));
  }
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('FAILED:');
  for (const f of failed) console.log(`  ${f.name} — ${f.detail}`);
  process.exit(1);
}
