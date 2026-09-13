import { chromium } from 'playwright-core';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.field-canvas-3d canvas');
await page.waitForTimeout(2500);
const res = await page.evaluate(() => {
  const Q = Object.getPrototypeOf(window.__pb3d.camera.quaternion).constructor;
  const V = Object.getPrototypeOf(window.__pb3d.camera.position).constructor;
  const qx = (a) => new Q().setFromAxisAngle(new V(1, 0, 0), a);
  const qy = (a) => new Q().setFromAxisAngle(new V(0, 1, 0), a);
  const qz = (a) => new Q().setFromAxisAngle(new V(0, 0, 1), a);
  const HP = Math.PI / 2;
  // 2026 welded data: id → (x, y, rot) WPILib
  const tags = [];
  for (let id = 1; id <= 32; id++) tags.push(null);
  // read from the rendered scene instead: positions already known correct; we need raw rot
  // hardcode from field.ts (id: rot): 1:π 2:π/2 3:π 4:π 5:−π/2 6:π 7:0 8:−π/2 9:0 10:0 11:−π/2
  const rot = {1:Math.PI, 2:HP, 3:Math.PI, 4:Math.PI, 5:-HP, 6:Math.PI, 7:0, 8:-HP, 9:0, 10:0, 11:-HP, 12:Math.PI, 13:0, 14:0, 15:0, 16:0, 17:Math.PI, 18:HP, 19:Math.PI, 20:Math.PI, 21:-HP, 22:Math.PI, 23:0, 24:-HP, 25:0, 26:0, 27:HP, 28:Math.PI, 29:Math.PI, 30:Math.PI, 31:Math.PI, 32:Math.PI};
  // anchors (render frame) from the audit: read from scene
  const anchors = {};
  const stack = [...window.__pb3d.scene.children];
  while (stack.length) {
    const o = stack.pop();
    if (o.children) for (const c of o.children) stack.push(c);
    if (o.isMesh && o.name.startsWith('apriltag-')) {
      const id = +o.name.slice(9);
      anchors[id] = o.position.clone();
    }
  }
  // enumerate: rest direction r ∈ {−Z, +Z, −X, +X}, yaw sign ∈ {+,−}, compose = toYUp∘qy(yaw*s)∘face vs qy∘…
  // We solve analytically instead: for each tag, required normal n must be horizontal,
  // perpendicular to the wall it sits on, pointing to field center (0,0).
  // tag anchors: those with |z| > 3 sit on Z-walls (normal ±Z); |x−0| ~3.6 tower wall (normal ±X);
  // |x| ~8.2 alliance walls (normal ∓X toward center i.e. +X for x<0, −X for x>0).
  // Field center = (0, 0).
  const need = {};
  for (const [idStr, pos] of Object.entries(anchors)) {
    const id = +idStr;
    const toC = new V(-pos.x, 0, -pos.z).normalize();
    if (Math.abs(pos.x) > 6) need[id] = [Math.sign(toC.x), 0, 0];      // alliance wall
    else if (Math.abs(pos.z) > 2.5) need[id] = [0, 0, Math.sign(toC.z)]; // end walls
    else need[id] = [Math.sign(toC.x), 0, 0];                            // tower wall
  }
  // candidate: normal(yaw, s, mirror) = Ry(-s*yaw) applied to rest, rest ∈ {−Z,+Z}
  const scores = [];
  let solved = null;
  for (const rest of [[0,0,-1],[0,0,1]]) {
    for (const s of [1, -1]) {
      let ok = 0;
      for (const [idStr, n] of Object.entries(need)) {
        const id = +idStr;
        const normal = new V(...rest).applyQuaternion(qy(s * rot[id]));
        if (normal.x * n[0] + normal.z * n[2] > 0.5) ok++;
      }
      scores.push({ rest, s, ok });
      if (ok === 32) solved = { rest, s, ok };
    }
  }
  return { solved, scores, sample: Object.entries(need).slice(0, 6) };
});
console.log('SOLVED:', JSON.stringify(res));
await browser.close();
