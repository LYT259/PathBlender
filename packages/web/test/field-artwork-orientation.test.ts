/**
 * Artwork orientation guard (2026-10-14 orientation audit).
 *
 * Every shipped field PNG must be authored in the WPILib blue-origin frame
 * as displayed — blue alliance at LOW x (left), red at high x. The
 * AdvantageScope Field2d render family ships its sheets drawn from the RED
 * end; 2022–2025 shipped flipped that way (v0.1.5 → fixed here by rotating
 * the PNGs 180° in-repo), which put the alliance stations on the wrong ends
 * the moment a user selected the rendered style, while paths and tag
 * overlays — drawn from coordinates — stayed put.
 *
 * A rotationally symmetric tag layout cannot catch this class of flip (the
 * 2022/2025 decal sets map onto themselves under 180°, so id-free decal
 * probes passed on flipped sheets), so this test asserts the one signal
 * that always flips with orientation: the alliance-colour pixel centroids.
 * Measured on the shipped files, blue sits left of red by ≥ 0.10 of the
 * image width everywhere except the 2025 renders (alliance colour lives
 * mostly mid-field there — barge cages and reef trim — separation ≈ 0.10,
 * budget 0.02; a flip still reads as −0.10 and fails).
 */
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodePng } from './png';

const asset = (name: string) => resolve(__dirname, `../../../assets/fields/${name}`);

/** FRC alliance blue/red classifiers used by the audit — deliberately loose. */
function classifyBlue(r: number, g: number, b: number): boolean {
  return b > 50 && b - r > 30 && b - g > 15;
}
function classifyRed(r: number, g: number, b: number): boolean {
  return r > 60 && r - b > 30 && r - g > 20;
}

/** Mean x (0..1) of alliance-coloured pixels, sampled every 2nd px. */
function colourCentroids(file: string): { blueCx: number; redCx: number; blueN: number; redN: number } {
  const png = decodePng(file);
  let bsx = 0;
  let bn = 0;
  let rsx = 0;
  let rn = 0;
  const { rgb, bpp, width, height } = png;
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * bpp;
      const r = rgb[i]!;
      const g = rgb[i + 1]!;
      const b = rgb[i + 2]!;
      if (classifyBlue(r, g, b)) {
        bsx += x;
        bn++;
      } else if (classifyRed(r, g, b)) {
        rsx += x;
        rn++;
      }
    }
  }
  // Vacuous passes are worse than failures: if a future artwork stops
  // matching the colour classifiers at all, say so loudly.
  expect(bn, `${file}: no blue pixels found`).toBeGreaterThan(1000);
  expect(rn, `${file}: no red pixels found`).toBeGreaterThan(1000);
  return { blueCx: bsx / bn / width, redCx: rsx / rn / width, blueN: bn, redN: rn };
}

const CASES: ReadonlyArray<{ file: string; label: string; margin: number }> = [
  { file: 'rapidreact2022.png', label: '2022 schematic', margin: 0.08 },
  { file: 'chargedup2023.png', label: '2023 schematic', margin: 0.08 },
  { file: 'crescendo2024.png', label: '2024 schematic', margin: 0.08 },
  { file: 'reefscape2025-schematic.png', label: '2025 schematic', margin: 0.08 },
  { file: 'rebuilt2026.png', label: '2026 schematic', margin: 0.08 },
  { file: 'rapidreact2022-rendered.png', label: '2022 rendered', margin: 0.08 },
  { file: 'chargedup2023-rendered.png', label: '2023 rendered', margin: 0.08 },
  { file: 'crescendo2024-rendered.png', label: '2024 rendered', margin: 0.08 },
  { file: 'reefscape2025-welded.png', label: '2025 rendered (welded)', margin: 0.02 },
  { file: 'reefscape2025-andymark.png', label: '2025 rendered (AndyMark)', margin: 0.02 },
  { file: 'rebuilt2026-rendered.png', label: '2026 rendered', margin: 0.08 },
];

describe('field artwork orientation: blue sits left of red in every PNG', () => {
  for (const c of CASES) {
    it(`${c.label} — ${c.file}`, () => {
      const { blueCx, redCx } = colourCentroids(asset(c.file));
      expect(
        redCx - blueCx,
        `${c.label}: blue centroid ${blueCx.toFixed(3)} vs red ${redCx.toFixed(3)} — artwork flipped? (2026-10-14 audit)`,
      ).toBeGreaterThan(c.margin);
    });
  }
});
