import { chromium } from 'playwright-core';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.field-canvas-3d canvas');
await page.waitForTimeout(6000);
const bb = await page.evaluate(() => {
  const box = new (Object.getPrototypeOf(window.__pb3d.camera).constructor === undefined ? Object : Object)();
  return null;
});
// use three's Box3 via scene root children — evaluate manually
const dims = await page.evaluate(() => {
  // find the model root: the Group with many children added by the model effect
  let best = null;
  window.__pb3d.scene.traverse((o) => {
    if (o.isGroup && o.children.length > 1) {
      // crude: compute bounds by iterating positions
    }
  });
  // compute bounds of ALL non-tag, non-light objects
  const pts = [];
  window.__pb3d.scene.traverse((o) => {
    if (o.isMesh && !o.name.startsWith('apriltag') && o.parent?.type === 'Group') {
      o.updateWorldMatrix(true, false);
      const g = o.geometry;
      if (!g?.attributes?.position) return;
      const v = new (Object.getPrototypeOf(window.__pb3d.camera.position).constructor)();
      for (let i = 0; i < g.attributes.position.count; i += Math.ceil(g.attributes.position.count / 200)) {
        v.fromBufferAttribute(g.attributes.position, i).applyMatrix4(o.matrixWorld);
        pts.push([v.x, v.y, v.z]);
      }
    }
  });
  if (!pts.length) return 'no pts';
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), zs = pts.map(p => p[2]);
  return {
    x: [Math.min(...xs).toFixed(2), Math.max(...xs).toFixed(2)],
    y: [Math.min(...ys).toFixed(2), Math.max(...ys).toFixed(2)],
    z: [Math.min(...zs).toFixed(2), Math.max(...zs).toFixed(2)],
  };
});
console.log('model world bounds:', JSON.stringify(dims));
await browser.close();
