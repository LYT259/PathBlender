import { chromium } from 'playwright-core';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.field-canvas-3d canvas');
await page.waitForTimeout(6000);
// camera right behind tag 1 looking along its normal: the structure face should fill the view
const r = await page.evaluate(() => {
  const t = window.__pb3d.scene.getObjectByName('apriltag-1');
  const V = Object.getPrototypeOf(t.position).constructor;
  const n = new V(0, 0, 1).applyQuaternion(t.quaternion);
  const c = window.__pb3d.camera;
  c.position.copy(t.position).add(n.clone().multiplyScalar(1.2));
  c.lookAt(t.position);
  return { cam: [c.position.x.toFixed(2), c.position.y.toFixed(2), c.position.z.toFixed(2)] };
});
console.log('cam behind tag1:', JSON.stringify(r));
await page.waitForTimeout(700);
await page.screenshot({ path: '/tmp/ghpb-shots/tag1-behind.png' });
// from in front (inside the structure? through it?) — 0.5m in front of the face
const r2 = await page.evaluate(() => {
  const t = window.__pb3d.scene.getObjectByName('apriltag-1');
  const V = Object.getPrototypeOf(t.position).constructor;
  const n = new V(0, 0, 1).applyQuaternion(t.quaternion);
  const c = window.__pb3d.camera;
  c.position.copy(t.position).add(n.clone().multiplyScalar(-0.8));
  c.lookAt(t.position);
});
await page.waitForTimeout(700);
await page.screenshot({ path: '/tmp/ghpb-shots/tag1-front.png' });
await browser.close();
console.log('done');
