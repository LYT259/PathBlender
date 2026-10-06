import { describe, expect, it } from 'vitest';
import { type Lang } from '../src/i18n';
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
 * Serbian is written in both alphabets, so a dictionary can drift into a mix
 * without any structural check noticing — and 36 of sr's 342 rows did exactly
 * that, which meant one panel could show "Opseg reprodukcije" above
 * "Опсег репродукције". The project chose Latin for this dictionary (it is what
 * 306 of its rows already use); this pins the choice so a later paste cannot
 * reintroduce the mix.
 */
describe('Serbian ships one script', () => {
  it('sr has no Cyrillic letters', () => {
    for (const key of KEYS) {
      const cyr = DICTS.sr![key].match(/[\u0400-\u04FF]/);
      expect(cyr, `sr:${key} is Cyrillic inside a Latin dictionary: ${DICTS.sr![key]}`).toBe(null);
    }
  });
});

/**
 * One concept, one word per language. The audit's single largest finding was
 * the same object named two, three or four different ways inside one dictionary
 * — fr used five words for "path", tr ran yol/rota across the path/route split
 * backwards, id mixed jalur/rute/lintasan, hi mixed पथ/रूट/मार्ग — because
 * nothing checked it. The family below is every key whose English source names a
 * path or route (the file-format `.path` mention and "trajectory" keys are out,
 * they are different objects), and each language declares the stems it uses for
 * it. A new language without a row is a compile error.
 */
const PATH_STEMS: Record<Lang, string[]> = {
  en: ['path', 'route'], ar: ['مسار'], az: ['marşrut'], bg: ['маршрут'], bs: ['rut'],
  cs: ['tras'], da: ['rut'], de: ['pfad', 'route'], el: ['διαδρομ'], es: ['rut'],
  fil: ['path', 'ruta'], fr: ['parcours'], he: ['מסלול'], hi: ['पथ', 'मार्ग'],
  hr: ['rut'], hu: ['útvonal'], hy: ['երթուղ'], id: ['jalur', 'rute'], it: ['percors'],
  ja: ['パス', 'ルート'], ko: ['경로'], mk: ['рут'], mr: ['मार्ग'], ms: ['laluan'],
  nb: ['rut'], nn: ['rut'], nl: ['route'], pl: ['tras'], 'pt-BR': ['trajet', 'rota'],
  ro: ['rut'], rw: ['inzira'], sq: ['rrug'], sr: ['rut'], sv: ['rut'],
  ta: ['பாதை', 'வழித்தட'], tr: ['yol', 'rota'], uk: ['маршрут'], vi: ['đường đi', 'tuyến'],
  zh: ['路径', '路线'], 'zh-hk': ['路徑', '路線'], 'zh-tw': ['路徑', '路線'],
};

/**
 * Rows still waiting on a decision only a native reviewer can make — the
 * replacement needs a case or number form the file cannot prove. Listing them
 * here keeps the debt visible, and the dead-entry check below fails when one is
 * fixed, so the list can only shrink.
 */
const PENDING_PATH_STEMS: Partial<Record<Lang, string[]>> = {
  // ուղի (road) and հետագիծ (trajectory) in three sequence rows; unifying them
  // needs the Armenian accusative/plural of երթուղի.
  hy: ['sequence.replaceRoute', 'sequence.replaced', 'toast.pkgNeedRobots'],
  // The whole Kinyarwanda dictionary needs a native re-pass (inzira / Inziga /
  // umuhanda all name the same object today).
  rw: ['welcome.exampleHint', 'onboarding.play', 'workspace.imported', 'sequence.replaceRoute', 'sequence.replaced'],
};

const pathFamily = KEYS.filter(
  (k) => /\b(paths?|routes?)\b/i.test((en as Record<string, string>)[k]) && !/trajector|\.path/i.test((en as Record<string, string>)[k]),
);

describe('one concept, one term per language', () => {
  it('paths and routes are named with the stems each language declares', () => {
    for (const code of CODES) {
      const stems = PATH_STEMS[code as Lang];
      const pending = PENDING_PATH_STEMS[code as Lang] ?? [];
      for (const key of pathFamily) {
        if (pending.includes(key)) continue;
        const v = DICTS[code]![key].toLowerCase();
        expect(
          stems.some((s) => v.includes(s.toLowerCase())),
          `${code}:${key} uses a term outside "${stems.join('|')}" — ${DICTS[code]![key]}`,
        ).toBe(true);
      }
    }
  });

  it('the pending list carries no dead entries', () => {
    for (const [code, keys] of Object.entries(PENDING_PATH_STEMS)) {
      for (const key of keys) {
        const v = DICTS[code]![key].toLowerCase();
        expect(
          PATH_STEMS[code as Lang].some((s) => v.includes(s.toLowerCase())),
          `${code}:${key} is unified now — drop it from PENDING_PATH_STEMS`,
        ).toBe(false);
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

describe('the out-of-bounds row reads correctly in every language', () => {  it('matches the pinned rendering in test/i18n-edge-render.json', () => {
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

