/**
 * Tab icon (favicon) for browser builds, resolved from the same app-icon
 * preference that drives the desktop Dock tile:
 *
 * 1. `applySiteIcon` picks day vs night artwork for 'system' (mirrors the OS)
 *    and pins the chosen artwork for fixed light/dark, reusing the single
 *    `<link rel="icon">` rather than stacking one per flip.
 * 2. The shipped artwork carries no alpha channel at all. A transparent margin
 *    is what made Chrome composite a white plate behind the mark at 16px — the
 *    ring that reads as "the logo inside a second border". Colour type 2 with
 *    no tRNS chunk makes that class of regression structurally impossible.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import { applySiteIcon } from '../src/site-icon';

const DAY = 'favicon-day.png';
const NIGHT = 'favicon-night.png';
const hrefs = { day: 'https://cdn/pb/day.png', night: 'https://cdn/pb/night.png' };

function pngShape(file: string) {
  const buf = readFileSync(resolve(__dirname, '../src/assets', file));
  expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  let off = 8;
  const shape = { bitDepth: 0, colourType: -1, interlace: 1, hasTRNS: false, width: 0, height: 0 };
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      shape.width = data.readUInt32BE(0);
      shape.height = data.readUInt32BE(4);
      shape.bitDepth = data[8]!;
      shape.colourType = data[9]!;
      shape.interlace = data[12]!;
    } else if (type === 'tRNS') {
      shape.hasTRNS = true;
    }
    off += 12 + len;
  }
  return shape;
}

function iconLinks() {
  return [...document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')];
}

beforeEach(() => {
  document.head.innerHTML = '';
});

describe('shipped tab artwork', () => {
  it.each([DAY, NIGHT])('%s is an opaque square plate — no alpha, no tRNS', (file) => {
    const shape = pngShape(file);
    expect(shape).toMatchObject({ bitDepth: 8, colourType: 2, interlace: 0, hasTRNS: false });
    expect(shape.width).toBe(shape.height);
  });

  it('day and night are the same geometry, so a swap never shifts the mark', () => {
    expect(pngShape(DAY)).toEqual(pngShape(NIGHT));
  });
});

describe('applySiteIcon', () => {
  it("'system' follows the OS and re-resolves on every flip", () => {
    applySiteIcon('system', false, hrefs, true);
    expect(iconLinks()).toHaveLength(1);
    expect(iconLinks()[0]!.getAttribute('href')).toBe(hrefs.day);

    applySiteIcon('system', true, hrefs, true);
    expect(iconLinks()).toHaveLength(1);
    expect(iconLinks()[0]!.getAttribute('href')).toBe(hrefs.night);
  });

  it('fixed light/dark pins that artwork regardless of the OS', () => {
    applySiteIcon('light', true, hrefs, true);
    expect(iconLinks()[0]!.getAttribute('href')).toBe(hrefs.day);
    applySiteIcon('dark', false, hrefs, true);
    expect(iconLinks()[0]!.getAttribute('href')).toBe(hrefs.night);
  });

  it('adds the link when the document has none', () => {
    applySiteIcon('dark', false, hrefs, true);
    expect(iconLinks()).toHaveLength(1);
    expect(iconLinks()[0]!.parentNode).toBe(document.head);
  });

  it('re-writing the same artwork leaves the document untouched', () => {
    applySiteIcon('system', true, hrefs, true);
    const before = iconLinks()[0]!;
    applySiteIcon('system', true, hrefs, true);
    expect(iconLinks()).toEqual([before]);
  });

  it('desktop shells never rewrite the document (the native Dock owns the icon)', () => {
    applySiteIcon('system', true, hrefs, false);
    expect(iconLinks()).toHaveLength(0);
  });
});
