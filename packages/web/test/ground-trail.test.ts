import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeSession, parseGhostAuto } from '@pathblender/core';
import { groundTrailData, TRAIL_HEIGHT_M, TRAIL_WIDTH_M } from '../src/ground-trail';
import { createGroundTrail } from '../src/ground-trail3d';

const robot = () => makeSession(parseGhostAuto(readFileSync(resolve(__dirname, '../../../samples/ghostauto/straight_run.ghostauto'), 'utf8'), 'straight'));

describe('full-route ground tape', () => {
  it('builds a flat 10 cm strip without smoothing away a sharp corner', () => {
    const data = groundTrailData([{x:0,y:0,t:0},{x:2,y:0,t:1},{x:2,y:2,t:2}]);
    expect(data.positions.every(Number.isFinite)).toBe(true);
    expect(data.positions[1]! - data.positions[3]!).toBeCloseTo(TRAIL_WIDTH_M);
    expect(Math.max(...data.times)).toBe(2);
    expect(Math.min(...data.times)).toBe(0);
    expect(Math.max(...data.positions.filter((_,i)=>i%2===0))).toBeLessThanOrEqual(2 + TRAIL_WIDTH_M / 2);
  });
  it('handles empty, one-point and stationary paths without invalid geometry', () => {
    for (const samples of [[], [{x:1,y:1,t:0}], [{x:1,y:1,t:0},{x:1,y:1,t:2}]]) {
      expect(groundTrailData(samples)).toEqual({positions:[],times:[]});
    }
  });
  it('keeps every 3D vertex at the same ground height and disposes normally', () => {
    const {mesh} = createGroundTrail(robot(), 8, 4);
    const pos = mesh.geometry.getAttribute('position');
    expect(pos.count).toBeGreaterThan(0);
    for(let i=0;i<pos.count;i++)expect(pos.getY(i)).toBeCloseTo(TRAIL_HEIGHT_M, 6);
    expect(mesh.geometry.getAttribute('trailTime').count).toBe(pos.count);
    mesh.geometry.dispose(); mesh.material.dispose();
  });
  it('reveals the whole 3D tape from the start — no clock-driven cutoff', () => {
    const {mesh} = createGroundTrail(robot(), 8, 4);
    const material = mesh.material as { uniforms: { cutoff: { value: number } } };
    expect(material.uniforms.cutoff.value).toBe(Infinity);
    const times = mesh.geometry.getAttribute('trailTime');
    expect(Math.max(...Array.from({ length: times.count }, (_, i) => times.getX(i))))
      .toBeCloseTo(robot().trajectory.samples.at(-1)!.t, 6);
    mesh.geometry.dispose(); mesh.material.dispose();
  });
});
