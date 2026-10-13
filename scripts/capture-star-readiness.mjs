/** Local-only browser verification + reproducible screenshots for the first-check guide.
 * Run against a DEV server (WALK_BASE, default :4196). No external navigation.
 * CAPTURE_BASELINE=1 also captures the unchanged main checkout on :4197.
 * Frames stay in the ignored engineering-log; README media are separate outputs.
 */
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const base = process.env.WALK_BASE ?? 'http://127.0.0.1:4196/';
const out = resolve('engineering-log/attachments/star-readiness');
const screenshots = resolve('docs/screenshots');
await mkdir(out, { recursive: true });
await mkdir(resolve(out, 'frames'), { recursive: true });
await mkdir(resolve('docs/media'), { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
const findings = [];
const issues = [];
const external = new Set();
async function fresh(url, scheme = 'light', viewport = { width: 1440, height: 1000 }, lang = 'en') {
  const ctx = await browser.newContext({ viewport, colorScheme: scheme, locale: 'en-US', reducedMotion: 'reduce' });
  await ctx.addInitScript((value) => localStorage.setItem('pb.lang', value), lang);
  const page = await ctx.newPage();
  page.on('pageerror', e => issues.push(e.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol) && url.hostname !== '127.0.0.1') { external.add(url.origin); return route.abort(); }
    return route.continue();
  });
  await page.goto(url, { waitUntil: 'networkidle' });
  return { page, ctx };
}
async function check(condition, label) { assert.ok(condition, label); findings.push(label); }
try {
  if (process.env.CAPTURE_BASELINE === '1') {
    const {page,ctx} = await fresh('http://127.0.0.1:4197/');
    await page.screenshot({ path: `${out}/welcome-before.png` });
    await ctx.close();
  }
  {
    const { page, ctx } = await fresh(base);
    await check(await page.getByRole('link', { name: 'Star on GitHub' }).count() === 1, 'Public-ready default: welcome Star link without preview param');
    await page.screenshot({ path: `${out}/welcome-default.png` });
    await ctx.close();
  }
  const { page, ctx } = await fresh(`${base}?support-preview=1`);
  await check(await page.getByRole('link', { name: 'Star on GitHub' }).count() === 1, 'Development preview: welcome Star link');
  await page.screenshot({ path: `${out}/welcome-public-preview.png` });
  await page.getByRole('button', {name:'Try your first path check'}).click();
  await page.locator('.first-check-guide').waitFor();
  await check(await page.locator('.conflict-count').first().innerText() === '1', 'Practice: one actual crossing');
  let index = 0;
  const frame = async () => { await page.screenshot({ path: `${out}/frames/${String(index++).padStart(3,'0')}.png` }); };
  await frame();
  await page.getByRole('button', {name:'Play the routes',exact:true}).click();
  for(let i=0;i<9;i++) { await page.waitForTimeout(250); await frame(); }
  await page.getByRole('button', {name:'Show the conflict',exact:true}).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${screenshots}/first-check-still.png` });
  await page.screenshot({ path: `${out}/practice-conflict.png` });
  for(let i=0;i<8;i++) await frame();
  await page.getByRole('button', {name:'Start B two seconds later',exact:true}).click();
  await check(await page.locator('.conflict-count').first().innerText() === '0', 'Delay B: checks recalculate to zero');
  await page.getByRole('button', {name:'Replay the changed plan',exact:true}).click();
  for(let i=0;i<12;i++) { await page.waitForTimeout(250); await frame(); }
  await page.getByRole('button', {name:'Pause',exact:true}).click();
  await page.screenshot({ path: `${out}/practice-result.png` });
  const invitation = page.getByRole('button', {name:'Dismiss this invitation'});
  await check(await invitation.count() === 1, 'Support appears only after comparison and replay');
  await invitation.click();
  // Re-open through a browser reload: the ordinary autosave preserves the exercise.
  await page.waitForTimeout(600);
  await page.reload({waitUntil:'networkidle'});
  await page.locator('.first-check-guide').waitFor();
  await check(await page.locator('.conflict-count').first().innerText() === '0', 'Reload preserves changed timing');
  await page.getByRole('button', {name:'Replay the changed plan',exact:true}).click();
  await check(await page.getByRole('button', {name:'Dismiss this invitation'}).count() === 0, 'Dismissal survives reload and repeat replay');
  await check(await page.getByRole('link', {name:'Star on GitHub'}).count() === 1, 'Toolbar link stays after dismissal');
  await page.getByRole('button', {name:'End practice',exact:true}).click();
  await page.getByRole('button', {name:'Preferences',exact:true}).click();
  await page.getByRole('tab', {name:'About',exact:true}).click();
  await check(await page.getByRole('complementary', {name:'Finding PathBlender useful?'}).count() === 1, 'About contains support copy');
  await page.screenshot({ path: `${out}/about-public-preview.png` });
  await ctx.close();
  for (const [scheme,lang,width,height] of [['dark','en',1440,1000],['light','zh',1440,1000],['light','en',390,844]]) {
    const {page,ctx} = await fresh(`${base}?support-preview=1`,scheme,{width,height},lang);
    const name = `${scheme}-${lang}-${width}`;
    await page.screenshot({path:`${out}/welcome-${name}.png`});
    await check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: welcome has no horizontal overflow`);
    await page.getByRole('button',{name:lang==='zh'?'试做第一次路径检查':'Try your first path check'}).click();
    await page.getByRole('button',{name:lang==='zh'?'播放路线':'Play the routes',exact:true}).click({trial:true});
    await page.screenshot({path:`${out}/practice-${name}.png`});
    await check(await page.locator('.first-check-guide').evaluate(el => el.scrollWidth <= el.clientWidth), `${name}: guide fits its container`);
    if (width < 900) {
      await page.getByRole('button',{name:'Play the routes',exact:true}).click();
      await page.getByRole('button',{name:'Show the conflict',exact:true}).click();
      await page.getByRole('button',{name:'Start B two seconds later',exact:true}).click();
      await check(await page.locator('.conflict-count').first().innerText() === '0', `${name}: all practice actions reachable and collision cleared`);
    }
    await ctx.close();
  }
  // RTL + long-copy passes for the new engagement copy (ar/he are the RTL UI
  // locales; the buttons below must match engagement-copy.ts exactly).
  const rtl = [
    ['ar', 'جرّب أول فحص مسارات لك', 'تشغيل المسارات', 'إظهار التعارض', 'اجعل B يبدأ بعد ثانيتين'],
    ['he', 'נסו את בדיקת המסלולים הראשונה שלכם', 'השמיעו את המסלולים', 'הציגו את ההתנגשות', 'התחילו את B שתי שניות מאוחר יותר'],
  ];
  for (const [lang, firstCheck, play, find, compare] of rtl) {
    const { page, ctx: rtlCtx } = await fresh(`${base}?support-preview=1`, 'light', { width: 390, height: 844 }, lang);
    await check(await page.evaluate(() => document.documentElement.getAttribute('dir')), `${lang}: document runs RTL`);
    await check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${lang}: welcome has no horizontal overflow`);
    await page.getByRole('button', { name: firstCheck }).click();
    await page.locator('.first-check-guide').waitFor();
    await check(await page.locator('.first-check-guide').evaluate(el => el.scrollWidth <= el.clientWidth), `${lang}: guide fits its container at 390px`);
    await page.getByRole('button', { name: play, exact: true }).click();
    await page.getByRole('button', { name: find, exact: true }).click();
    await page.getByRole('button', { name: compare, exact: true }).click();
    await check(await page.locator('.conflict-count').first().innerText() === '0', `${lang}: exercise completes and collision clears`);
    await page.screenshot({ path: `${out}/practice-rtl-${lang}-390.png` });
    await rtlCtx.close();
  }
  if (process.env.WALK_PRODUCTION) {
    for (const query of ['', '?support-preview=1']) {
      const {page,ctx} = await fresh(`${process.env.WALK_PRODUCTION}${query}`);
      await check(await page.getByRole('link',{name:'Star on GitHub'}).count() === 1, `Production ${query || 'default'}: Star link visible (public-ready)`);
      await page.getByRole('button',{name:'Try your first path check'}).click();
      await page.getByRole('button',{name:'Play the routes',exact:true}).click();
      await page.getByRole('button',{name:'Show the conflict',exact:true}).click();
      await page.getByRole('button',{name:'Start B two seconds later',exact:true}).click();
      await page.getByRole('button',{name:'Replay the changed plan',exact:true}).click();
      await check(await page.locator('.conflict-count').first().innerText() === '0' && await page.getByRole('button',{name:'Dismiss this invitation'}).count() === 1, `Production ${query || 'default'}: exercise works and invitation appears after replay`);
      await ctx.close();
    }
  }
  await check(issues.length === 0, `No browser exceptions: ${issues.join('; ')}`);
  await check(external.size === 0, `No third-party requests: ${[...external].join(', ')}`);
  // 4 fps is an editorial preview setting, not a change to application playback.
  execFileSync('ffmpeg',['-y','-framerate','4','-i',`${out}/frames/%03d.png`,'-filter_complex','[0:v]scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=3','-loop','0',`${screenshots}/first-check.gif`],{stdio:'pipe'});
  await writeFile(`${out}/browser-checks.json`,JSON.stringify({base,findings,issues,external:[...external],frames:index},null,2)+'\n');
  console.log(JSON.stringify({passed:findings.length,frames:index,out},null,2));
} finally { await browser.close(); }
