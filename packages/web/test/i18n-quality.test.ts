import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { en, type MessageKey } from '../src/i18n/en';
import { ar } from '../src/i18n/ar';
import { az } from '../src/i18n/az';
import { bg } from '../src/i18n/bg';
import { bs } from '../src/i18n/bs';
import { cs } from '../src/i18n/cs';
import { da } from '../src/i18n/da';
import { de } from '../src/i18n/de';
import { el } from '../src/i18n/el';
import { es } from '../src/i18n/es';
import { fil } from '../src/i18n/fil';
import { fr } from '../src/i18n/fr';
import { he } from '../src/i18n/he';
import { hi } from '../src/i18n/hi';
import { hr } from '../src/i18n/hr';
import { hu } from '../src/i18n/hu';
import { hy } from '../src/i18n/hy';
import { id } from '../src/i18n/id';
import { it as itDict } from '../src/i18n/it';
import { ja } from '../src/i18n/ja';
import { ko } from '../src/i18n/ko';
import { mk } from '../src/i18n/mk';
import { mr } from '../src/i18n/mr';
import { ms } from '../src/i18n/ms';
import { nb } from '../src/i18n/nb';
import { nl } from '../src/i18n/nl';
import { nn } from '../src/i18n/nn';
import { pl } from '../src/i18n/pl';
import { ptBR } from '../src/i18n/pt-br';
import { ro } from '../src/i18n/ro';
import { rw } from '../src/i18n/rw';
import { sq } from '../src/i18n/sq';
import { sr } from '../src/i18n/sr';
import { sv } from '../src/i18n/sv';
import { ta } from '../src/i18n/ta';
import { tr } from '../src/i18n/tr';
import { uk } from '../src/i18n/uk';
import { vi } from '../src/i18n/vi';
import { zh } from '../src/i18n/zh';
import { zhHk } from '../src/i18n/zh-hk';
import { zhTw } from '../src/i18n/zh-tw';

/**
 * Wording-hygiene gates from the 2026-10-06 41-language audit.
 *
 * `i18n.test.ts` proves a dictionary is *structurally* complete — keys, blanks,
 * placeholders, English residue. Everything below is a class of defect that
 * passes all of those checks and still shows up broken on screen, so each one
 * got a real user-visible bug in the audit. They are cheap to hold forever and
 * they are the reason the fixes cannot quietly rot back.
 */
const DICTS: Record<string, Record<string, string>> = {
  en, ar, az, bg, bs, cs, da, de, el, es, fil, fr, he, hi, hr, hu, hy, id, it: itDict,
  ja, ko, mk, mr, ms, nb, nl, nn, pl, 'pt-BR': ptBR, ro, rw, sq, sr, sv, ta,
  tr, uk, vi, zh, 'zh-hk': zhHk, 'zh-tw': zhTw,
};
const CODES = Object.keys(DICTS) as (keyof typeof DICTS)[];
const KEYS = Object.keys(en);

describe('values carry no stray whitespace', () => {
  it('no value starts or ends with whitespace, none has a double space', () => {
    for (const code of CODES) {
      for (const key of KEYS) {
        const v = DICTS[code]![key];
        expect(v, `${code}:${key} has stray whitespace`).toBe(v.trim());
        expect(v, `${code}:${key} has a double space`).not.toMatch(/  /);
      }
    }
  });
});

/**
 * `formatLength()` returns "0.93 m" — the unit is already in the substituted
 * text (length-units.ts, used by ConflictPanel.tsx for {d}/{depth} and
 * SequenceTimelineComposer.tsx for the position gap). A dictionary that also
 * spells the unit out prints it twice, and prints it in metres even when the
 * user picked feet. So: for these keys, no unit word may sit next to the
 * placeholder. Which words count is read back from each language's own
 * "Meters (m)" entry, so the list needs no maintenance as languages are added.
 */
const PREFORMATTED: Record<string, string> = {
  'conflicts.item': '{d}',
  'bounds.item': '{depth}',
  'sequence.joinPosition': '{d}',
};

describe('pre-formatted measurements are not given a second unit', () => {
  for (const code of CODES) {
    it(`${code}: no literal unit next to an already-formatted placeholder`, () => {
      // Tokens this dictionary uses for the metre: its own unit-picker label.
      const label = DICTS[code]!['prefs.unit.m'];
      const unitWords = new Set(
        label.replace(/\(.*?\)/g, '').split(/[\s,()/×]+/).filter((w) => w.length > 0),
      );
      for (const [key, ph] of Object.entries(PREFORMATTED)) {
        const v = DICTS[code]![key];
        const at = v.indexOf(ph);
        const before = v.slice(0, at).trim().split(/[\s·—–]+/).pop() ?? '';
        const after = v.slice(at + ph.length).trim().split(/[\s·—–(]/)[0] ?? '';
        for (const [side, token] of [['before', before], ['after', after]] as const) {
          if (token && unitWords.has(token)) {
            expect.fail(`${code}:${key} — "${token}" (${side} ${ph}) doubles the unit; {d}/{depth} already carry it`);
          }
        }
      }
    });
  }
});

/**
 * Hard-coded decimals in labels must follow the locale's separator, or the
 * step buttons read "0.5" next to every app-formatted "0,5". `es` and `ar` are
 * deliberately unenforced: one Spanish dictionary serves both comma (Spain)
 * and point (Latin America) countries, and Arabic accepts both in tech UI.
 */
const COMMA = ['az', 'bg', 'bs', 'cs', 'da', 'de', 'el', 'fr', 'hu', 'id', 'it', 'mk',
  'nb', 'nl', 'nn', 'pl', 'pt-BR', 'ro', 'rw', 'sq', 'sr', 'sv', 'tr', 'uk', 'vi', 'hy'];
const POINT = ['fil', 'hi', 'ja', 'ko', 'mr', 'ms', 'ta', 'zh', 'zh-hk', 'zh-tw'];
const DECIMAL_KEYS = ['timeline.stepBack', 'timeline.stepForward'];

describe('hard-coded decimals match the locale separator', () => {
  for (const code of CODES) {
    const want = COMMA.includes(code) ? ',' : POINT.includes(code) ? '.' : null;
    if (!want) continue;
    it(`${code}: uses "${want}"`, () => {
      for (const key of DECIMAL_KEYS) {
        const found = DICTS[code]![key].match(/0[.,]5/);
        if (found) expect(found[0], `${code}:${key}`).toBe(`0${want}5`);
      }
    });
  }
});

/**
 * `onboarding.play` tells the user to press a named button, so it has to name
 * the label that button actually carries in the same language. Nine
 * dictionaries said "Play" over a localised Play button in the audit.
 */
describe('copy that names a button names the real one', () => {
  it('onboarding.play contains this language’s timeline.play label', () => {
    for (const code of CODES) {
      const label = DICTS[code]!['timeline.play'].trim().toLowerCase();
      const tip = DICTS[code]!['onboarding.play'].toLowerCase();
      expect(tip, `${code}: tip says "${DICTS[code]!['onboarding.play']}" but the button is "${DICTS[code]!['timeline.play']}"`).toContain(label);
    }
  });
});

/**
 * Brand tokens are the only words allowed a capital inside. Everything else
 * that mixes case mid-word is an English identifier pasted into translated
 * prose (`pixelImmagine`, `BildPixel`, `пикселиСнимка`) — thirteen dictionaries
 * had one in `customField.note`, where it also breaks the formula's reading.
 * `imagePixels` itself is allowed through: it is a field name from the file
 * format and the English source prints it that way.
 */
const BRANDS = [
  'pathblender', 'pathplanner', 'github', 'apriltag', 'andymark', 'viewcube',
  'imagepixels', 'solidworks', 'okabe', 'choreo', 'onshape',
];

describe('no camelCase leftovers in translated prose', () => {
  it('every value is free of mid-word capitals outside brand names', () => {
    for (const code of CODES) {
      for (const key of KEYS) {
        let v = DICTS[code]![key];
        for (const brand of BRANDS) v = v.replace(new RegExp(brand, 'gi'), '');
        const hit = v.match(/\p{Ll}\p{Lu}/gu);
        expect(hit, `${code}:${key} has a mid-word capital: ${JSON.stringify(v)}`).toBe(null);
      }
    }
  });
});

/**
 * `bounds.item` interpolates `edges.*` into a fixed frame, and that frame
 * governs a case / article pattern English does not show ("uden for **den**
 * fjerne væg", "jenseits der hinteren Wand", "za дальньою стіною",
 * "preko udaljenog zida"). 17 languages shipped citation forms and printed
 * "past left wall", which no placeholder or key check can see. So the fully
 * composed row is pinned for every language: changing either half fails here
 * with the whole sentence in the diff, and a reviewer — not a regex — decides
 * whether the new wording still reads.
 */
const EDGES = ['far', 'left', 'near', 'right'] as const;

describe('the out-of-bounds row reads correctly in every language', () => {
  it('matches the pinned rendering in test/i18n-edge-render.json', () => {
    const expected = JSON.parse(
      readFileSync(resolve(__dirname, 'i18n-edge-render.json'), 'utf8'),
    ) as Record<string, string[]>;
    expect([...CODES].sort(), 'fixture covers every shipped language').toEqual(
      Object.keys(expected).sort(),
    );
    for (const code of CODES) {
      const rendered = EDGES.map((edge) =>
        DICTS[code]!['bounds.item']
          .replaceAll('{start}', '1.20')
          .replaceAll('{end}', '3.40')
          .replaceAll('{depth}', '0.12 m')
          .replaceAll('{edge}', DICTS[code]![`edges.${edge}`]),
      );
      expect(rendered, code).toEqual(expected[code]);
    }
  });
});

