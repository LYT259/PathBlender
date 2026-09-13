import { chromium } from 'playwright-core';
const browser = await chromium.launch();
const grab = async (url) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('.field-canvas-3d canvas', { timeout: 30000 });
  await page.waitForTimeout(8000);
  const r = await page.evaluate(() => {
    const t = window.__pb3d.scene.getObjectByName('apriltag-1');
    if (!t) return null;
    return { q: [t.quaternion.x.toFixed(3), t.quaternion.y.toFixed(3), t.quaternion.z.toFixed(3), t.quaternion.w.toFixed(3)], pos: t.position.toArray().map(v => +v.toFixed(2)) };
  });
  await page.close();
  return r;
};
const local = await grab('http://localhost:4173/');
const live = await grab('https://pathblender.pages.dev/');
console.log('local tag1:', JSON.stringify(local));
console.log('live  tag1:', JSON.stringify(live));
await browser.close();
