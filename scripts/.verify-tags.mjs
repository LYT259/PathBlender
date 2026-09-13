import { chromium } from 'playwright-core';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.field-canvas-3d canvas');
await page.waitForTimeout(5000);
await page.locator('select').first().selectOption('rebuilt-2026');
await page.waitForTimeout(4500);
const n26 = await page.evaluate(() => {
  const V = Object.getPrototypeOf(window.__pb3d.camera.position).constructor;
  const Q = Object.getPrototypeOf(window.__pb3d.camera.quaternion).constructor;
  const out = {};
  for (const id of [1, 2, 7]) {
    const t = window.__pb3d.scene.getObjectByName(`apriltag-${id}`);
    t.updateWorldMatrix(true, false);
    const n = new V(0, 0, 1).applyQuaternion(t.getWorldQuaternion(new Q()));
    out[id] = [n.x.toFixed(2), n.y.toFixed(2), n.z.toFixed(2)];
  }
  return out;
});
console.log('2026 normals:', JSON.stringify(n26));
await page.evaluate(() => { const c = window.__pb3d.camera; c.position.set(-6.2, 1.5, -3.4); c.lookAt(-3.5, 1.0, -3.4); });
await page.waitForTimeout(700);
await page.screenshot({ path: '/tmp/ghpb-shots/solved-26.png' });
await page.locator('select').first().selectOption('reefscape-2025');
await page.waitForTimeout(5500);
await page.evaluate(() => { const c = window.__pb3d.camera; c.position.set(-4.2, 2.4, -4.8); c.lookAt(-3.3, 1.2, -3.4); });
await page.waitForTimeout(800);
await page.screenshot({ path: '/tmp/ghpb-shots/solved-25.png' });
await browser.close();
console.log('done');
