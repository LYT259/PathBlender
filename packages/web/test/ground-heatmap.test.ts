import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeSession, parseGhostAuto } from '@pathblender/core';
import { HEATMAP_HEIGHT_M, createGroundHeatmap } from '../src/ground-trail3d';
import { heatmapColor } from '../src/robot-identity';

const robot = () => makeSession(parseGhostAuto(readFileSync(resolve(__dirname, '../../../samples/ghostauto/straight_run.ghostauto'), 'utf8'), 'straight'));

describe('alliance heatmap tint', () => {
  it('keeps blue on the accent and gives red the theme red', () => {
    expect(heatmapColor('blue', '#0a84ff', '#ff453a')).toBe('#0a84ff');
    expect(heatmapColor('red', '#0a84ff', '#ff453a')).toBe('#ff453a');
  });
});

describe('3D ground heatmap', () => {
  it('merges one footprint quad per strided sample into a single indexed mesh', () => {
    const r = robot();
    const samples = r.trajectory.samples;
    const expectedQuads = Math.ceil(samples.length / Math.max(1, Math.ceil(samples.length / 120)));
    const { mesh } = createGroundHeatmap(r, 8, 4, '#0a84ff', '#ff453a');
    const pos = mesh.geometry.getAttribute('position');
    expect(pos.count).toBe(expectedQuads * 4);
    expect(mesh.geometry.getIndex()!.count).toBe(expectedQuads * 6);
    mesh.geometry.dispose(); mesh.material.dispose();
  });

  it('keeps every vertex flat at the heatmap height, below the trail tape', () => {
    const { mesh } = createGroundHeatmap(robot(), 8, 4, '#0a84ff', '#ff453a');
    const pos = mesh.geometry.getAttribute('position');
    expect(pos.count).toBeGreaterThan(0);
    for (let i = 0; i < pos.count; i++) expect(pos.getY(i)).toBeCloseTo(HEATMAP_HEIGHT_M, 6);
    expect(HEATMAP_HEIGHT_M).toBeLessThan(0.006);
    mesh.geometry.dispose(); mesh.material.dispose();
  });

  it('paints with the alliance tint at the shared low alpha', () => {
    const blue = createGroundHeatmap(robot(), 8, 4, '#0a84ff', '#ff453a');
    const mat = blue.mesh.material as { color: { getHexString(): string }, opacity: number, depthWrite: boolean, transparent: boolean };
    expect(mat.color.getHexString()).toBe('0a84ff');
    expect(mat.opacity).toBeCloseTo(0.06);
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);
    blue.mesh.geometry.dispose(); blue.mesh.material.dispose();
  });

  it('caps the quad budget at 120 per robot like the 2D renderer', () => {
    const r = robot();
    // Synthesize a long trajectory by duplicating the sample list with new timestamps.
    const base = r.trajectory.samples;
    const long = Array.from({ length: base.length * 5 }, (_, i) => ({ ...base[i % base.length]!, t: i * 0.01 }));
    r.trajectory.samples = long;
    const { mesh } = createGroundHeatmap(r, 8, 4, '#0a84ff', '#ff453a');
    expect(mesh.geometry.getAttribute('position').count).toBeLessThanOrEqual(120 * 4);
    mesh.geometry.dispose(); mesh.material.dispose();
  });
});
