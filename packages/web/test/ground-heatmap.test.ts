import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeSession, parseGhostAuto } from '@pathblender/core';
import { HEATMAP_HEIGHT_M, createGroundHeatmap } from '../src/ground-trail3d';
import { heatmapColor } from '../src/robot-identity';

const robot = () => makeSession(parseGhostAuto(readFileSync(resolve(__dirname, '../../../samples/ghostauto/straight_run.ghostauto'), 'utf8'), 'straight'));

describe('alliance heatmap tint', () => {
  it('maps each alliance to the injected pair, with no accent input at all', () => {
    // The signature is the decoupling contract (2026-10-17): there is no
    // accent parameter to misuse — the caller feeds the dedicated alliance
    // tokens, and the UI accent cannot reach this function.
    expect(heatmapColor('blue', '#0a84ff', '#ff453a')).toBe('#0a84ff');
    expect(heatmapColor('red', '#0a84ff', '#ff453a')).toBe('#ff453a');
  });

  it('backs the alliance pair with dedicated tokens, byte-identical to the accent-era colors', () => {
    const css = readFileSync(resolve(__dirname, '../src/app.css'), 'utf8');
    const darkBlock = css.slice(0, css.indexOf("[data-theme='light']"));
    const lightBlock = css.slice(css.indexOf("[data-theme='light']"), css.indexOf('html, body'));
    // Blue keeps its former --accent values; red keeps --danger's.
    expect(darkBlock).toContain('--heatmap-blue: #0a84ff;');
    expect(darkBlock).toContain('--heatmap-red: #ff453a;');
    expect(lightBlock).toContain('--heatmap-blue: #007aff;');
    expect(lightBlock).toContain('--heatmap-red: #ff3b30;');
  });

  it('keeps the heatmap tokens outside every accent variant block', () => {
    const css = readFileSync(resolve(__dirname, '../src/app.css'), 'utf8');
    const variants = css.slice(css.indexOf("accent color variants"));
    expect(variants).toMatch(/\[data-accent='red'\]/);
    expect(variants).toMatch(/\[data-accent='silver'\]/);
    expect(variants).not.toContain('--heatmap-blue');
    expect(variants).not.toContain('--heatmap-red');
    // …while the accent system provably moves --accent itself, so the
    // separation is real, not vacuous.
    expect(variants).toContain('--accent: #911d23;');
    expect(variants).toContain('--accent: #b5b8bb;');
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
