import { afterEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { en, type MessageKey } from '../src/i18n/en';
import { enGb, enGbOverrides } from '../src/i18n/en-gb';
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
// `it` is vitest's test function — the Italian dictionary imports under an alias.
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
import { zhHk, zhHkOverrides } from '../src/i18n/zh-hk';
import { zhMo } from '../src/i18n/zh-mo';
import { zhTw } from '../src/i18n/zh-tw';
import { I18nProvider, isRtl, LANGUAGES, LANG_META, langLabel, langFromTags, type Lang } from '../src/i18n';

/**
 * Every shipped dictionary. Adding a *selectable* language means adding one
 * row here (plus `DICTS`, a `LANG_META` row and a `langFromTags` branch in
 * `src/i18n/index.tsx`, and a menu table in `packages/desktop`); these tests
 * then hold it to the same bar as English. Each full dictionary is typed
 * `Record<MessageKey, string>`, so a missing key is a compile error too —
 * the runtime checks below cover the blanks and the placeholders a type cannot.
 */
const DICTS: Record<string, Record<string, string>> = {
  en, 'en-GB': enGb, ar, az, bg, bs, cs, da, de, el, es, fil, fr, he, hi, hr, hu, hy, id, it: itDict,
  ja, ko, mk, mr, ms, nb, nl, nn, pl, 'pt-BR': ptBR, ro, rw, sq, sr, sv, ta,
  tr, uk, vi, zh, 'zh-hk': zhHk, 'zh-mo': zhMo, 'zh-tw': zhTw,
};
const CODES = Object.keys(DICTS) as (keyof typeof DICTS)[];
const KEYS = Object.keys(en);
/** What the picker shows, in the order it shows it ('system' is a mode). */
const pickerLabels = LANGUAGES.flatMap((l) => (l === 'system' ? [] : [langLabel(l)]));
const placeholders = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort().join(',');

describe('i18n dictionaries', () => {
  it('every language covers the English key set and nothing more', () => {
    for (const code of CODES) {
      expect(Object.keys(DICTS[code]!).sort(), code).toEqual([...KEYS].sort());
    }
  });

  it('no value is missing or blank', () => {
    for (const code of CODES) {
      for (const key of KEYS) {
        const value = DICTS[code]![key];
        expect(typeof value, `${code}:${key}`).toBe('string');
        expect(value?.trim(), `${code}:${key}`).not.toBe('');
      }
    }
  });

  it('placeholders in translations match the English source', () => {
    for (const code of CODES) {
      for (const [key, source] of Object.entries(en)) {
        expect(placeholders(DICTS[code]![key]!), `${code}:${key}`).toBe(placeholders(source));
      }
    }
  });

  /**
   * Untranslated-residue gate (report §7.2 v1.20, item ③ — adapted to this
   * project's source dictionary, which is `en.ts`): a translated value that is
   * still byte-identical to English is a missed translation unless it is
   * deliberately verbatim. The whitelist is the whole allow-list, so a new key
   * that ships as its own English text fails the run.
   */
  // Brand names, mathematical templates and symbols are language-independent.
  const UNIVERSAL_VERBATIM = new Set<MessageKey>([
    'app.title', 'conflicts.pair', 'customField.ppm', 'timeline.speed',
    'timeline.clock', 'timeline.activity', 'timeline.band', 'canvas.clock',
    'rail.png', 'actions.gif', 'prefs.mouse.onshape', 'prefs.mouse.solidworks',
    'prefs.mouse.solidworks.right', 'sequence.seconds', 'tour.progress',
  ]);

  // Pin exemptions to the language in which the previous audit accepted a
  // loanword or the existing view-cube convention. Do not derive this table
  // from dictionaries at runtime: that would bless every new English leak.
  const KEEP_VERBATIM = {
    'ar': [],
    'az': ["vc.top","vc.bottom","vc.front","vc.back","vc.left","vc.right","workspace.details","prefs.channel.beta"],
    'bg': ['sequence.startGroupHub'],
    'bs': ["vc.top","vc.bottom","vc.front","vc.back","vc.left","vc.right","workspace.details","prefs.channel.beta",
    'sequence.startGroupHub'],
    'cs': ["vc.top","vc.bottom","vc.front","vc.back","vc.left","vc.right","workspace.details","prefs.channel.stable","prefs.channel.beta","sequence.start",
    'sequence.startGroupHub'],
    'da': ["prefs.mouse.onshape.wheel","prefs.mouse.solidworks.wheel","prefs.mouse.zoom","vc.top","vc.bottom","vc.front","vc.back","vc.left","vc.right","menu.zoom","workspace.details","robots.alliance","timeline.pause","about.version","robots.driveDifferential","robots.timing","prefs.channel.beta","sequence.start",
    'sequence.startGroupHub'],
    'de': ["accent.bronze", "vc.top","vc.bottom","vc.front","vc.back","vc.left","vc.right","menu.zoom","about.version","prefs.section.updates","prefs.channel.beta","sequence.start",
    'sequence.startGroupHub', 'sequence.startGroupTrench'],
    'el': ["prefs.channel.beta",
    'sequence.startGroupHub'],
    'es': ["prefs.mouse.onshape.wheel","prefs.mouse.solidworks.wheel","prefs.mouse.zoom","vc.top","vc.bottom","vc.front","vc.back","vc.left","vc.right","menu.zoom","prefs.section.general","workspace.details","robots.title","prefs.channel.beta",
    'sequence.startGroupHub'],
    'fil': ["prefs.mouse.onshape.wheel","prefs.mouse.solidworks.wheel","prefs.mouse.zoom","vc.top","vc.bottom","vc.front","vc.back","vc.left","vc.right","menu.file","menu.window","workspace.details","robots.collision","robots.timing","prefs.channel.stable","prefs.channel.beta",
    'sequence.startGroupHub'],
    'fr': ["accent.bronze", "prefs.mouse.onshape.wheel","prefs.mouse.solidworks.wheel","prefs.mouse.zoom","vc.top","vc.bottom","vc.front","vc.back","vc.left","vc.right","menu.zoom","workspace.details","robots.title","robots.collision","robots.alliance","timeline.pause","about.version","prefs.unit.yd","prefs.channel.stable","sequence.count",
    'sequence.startGroupHub', 'sequence.startGroupTrench',
    // French spells "monochrome" exactly like English (same Greek-derived
    // word in both languages) — accepted loan, not a missed translation.
    'prefs.iconStyle.monochrome'],
    'he': ["prefs.channel.stable","prefs.channel.beta",
    'sequence.startGroupHub'],
    'hi': ['sequence.startGroupHub'],
    'hr': ["vc.top","vc.bottom","vc.front","vc.back","vc.left","vc.right","workspace.details","prefs.channel.beta",
    'sequence.startGroupHub'],
    'hu': ["vc.top","vc.bottom","vc.front","vc.back","vc.left","vc.right","workspace.details",
    'sequence.startGroupHub'],
    'hy': ['sequence.startGroupHub'],
    'id': ["vc.top","vc.bottom","vc.front","vc.back","vc.left","vc.right","workspace.details","prefs.channel.beta","prefs.mouse.onshape.wheel","prefs.mouse.solidworks.wheel","prefs.mouse.zoom",
    'sequence.startGroupHub'],
    'it': ["prefs.mouse.onshape.wheel","prefs.mouse.solidworks.wheel","prefs.mouse.zoom","vc.top","vc.bottom","vc.front","vc.back","vc.left","vc.right","menu.zoom","menu.file","workspace.details","prefs.channel.beta",
    'sequence.startGroupHub'],
    'ja': ["prefs.channel.stable","prefs.channel.beta",
    'sequence.startGroupHub'],
    'ko': ["prefs.channel.stable","prefs.channel.beta",
    'sequence.startGroupHub'],
    'mk': ['sequence.startGroupHub'],
    'mr': ['sequence.startGroupHub'],
    'ms': ["vc.top","vc.bottom","vc.front","vc.back","vc.left","vc.right","workspace.details","robots.uploadSettings","prefs.channel.beta","library.importFolder","rail.import",
    'sequence.startGroupHub'],
    'nb': ["prefs.mouse.onshape.wheel","prefs.mouse.solidworks.wheel","prefs.mouse.zoom","vc.top","vc.bottom","vc.front","vc.back","vc.left","vc.right","menu.zoom","workspace.details","timeline.pause","robots.timing","prefs.channel.beta","sequence.start",
    'sequence.startGroupHub'],
    'nl': ["vc.top","vc.bottom","vc.front","vc.back","vc.left","vc.right","menu.zoom","menu.help","workspace.details","robots.title","robots.timing","prefs.section.updates","robots.profileEntry","prefs.channel.beta","sequence.start","canvas.trail",
    'sequence.startGroupHub', 'sequence.startGroupTrench'],
    'nn': ["prefs.mouse.onshape.wheel","prefs.mouse.solidworks.wheel","prefs.mouse.zoom","vc.top","vc.bottom","vc.front","vc.back","vc.left","vc.right","menu.zoom","workspace.details","timeline.pause","prefs.channel.beta","sequence.start",
    'sequence.startGroupHub'],
    'pl': ["vc.top","vc.bottom","vc.front","vc.back","vc.left","vc.right","workspace.details","prefs.channel.stable","prefs.channel.beta","sequence.start",
    'sequence.startGroupHub'],
    'pt-BR': ["accent.bronze", "prefs.mouse.onshape.wheel","prefs.mouse.solidworks.wheel","prefs.mouse.zoom","vc.top","vc.bottom","vc.front","vc.back","vc.left","vc.right","menu.zoom","prefs.channel.beta", "sequence.startGroupHub"],
    'ro': ["vc.top","vc.bottom","vc.front","vc.back","vc.left","vc.right","menu.zoom","prefs.section.general","workspace.details","prefs.channel.beta","sequence.start","field.style.schematic",
    'sequence.startGroupHub'],
    'rw': ["vc.top","vc.bottom","vc.front","vc.back","vc.left","vc.right","canvas.heatmap","canvas.overlays","prefs.channel.beta","actions.heatmapOn","field.style.rendered","prefs.channel.stable",
    'sequence.startGroupHub', 'sequence.startGroupTrench'],
    'sq': ["vc.top","vc.bottom","vc.front","vc.back","vc.left","vc.right","workspace.details","prefs.channel.beta",
    'sequence.startGroupHub'],
    'sr': ["vc.top","vc.bottom","vc.front","vc.back","vc.left","vc.right","workspace.details","prefs.channel.beta",
    'sequence.startGroupHub'],
    'sv': ["vc.top","vc.bottom","vc.front","vc.back","vc.left","vc.right","menu.zoom","workspace.details","about.version","robots.driveDifferential","robots.timing","prefs.channel.beta","sequence.start",
    'sequence.startGroupHub'],
    'ta': ['sequence.startGroupHub'],
    'tr': ["vc.top","vc.bottom","vc.front","vc.back","vc.left","vc.right","workspace.details","prefs.channel.beta",
    'sequence.startGroupHub', 'sequence.startGroupTrench'],
    'uk': ['sequence.startGroupHub'],
    'vi': ["vc.top","vc.bottom","vc.front","vc.back","vc.left","vc.right","workspace.details","prefs.channel.beta",
    'sequence.startGroupHub'],
    'zh': ['sequence.startGroupHub',
    'sequence.startGroupTrench'],
    'zh-hk': ["sequence.startGroupHub","sequence.startGroupTrench"],
    'zh-mo': ["sequence.startGroupHub","sequence.startGroupTrench"],
    'zh-tw': ['sequence.startGroupHub',
    'sequence.startGroupTrench'],
    // en-GB is English by construction (an 8-row override table over en), so
    // the residue gate is meaningless for it and it is skipped below; its own
    // suite ("English (United Kingdom) dictionary") pins the override shape.
    'en-GB': [],
  } satisfies Record<Exclude<Lang, 'en'>, readonly MessageKey[]>;

  function englishResidue(code: Exclude<Lang, 'en'>, dictionary: Record<string, string>): string[] {
    const allowed: readonly string[] = KEEP_VERBATIM[code];
    return Object.entries(en)
      .filter(([key, source]) => !UNIVERSAL_VERBATIM.has(key as MessageKey) && !allowed.includes(key) && dictionary[key] === source)
      .map(([key]) => key);
  }

  it('nothing is left sitting on the English text', () => {
    for (const code of CODES) {
      // en-GB inherits en verbatim on purpose — its gate is the override suite.
      if (code === 'en' || code === 'en-GB') continue;
      expect(englishResidue(code, DICTS[code]!), code).toEqual([]);
    }
  });

  it('an exemption in one language never hides a leak in another', () => {
    expect(englishResidue('es', DICTS.es!)).toEqual([]); // Spanish General.
    expect(englishResidue('nl', { ...DICTS.nl, 'prefs.section.general': en['prefs.section.general'] }))
      .toContain('prefs.section.general');
    expect(englishResidue('zh', { ...DICTS.zh, 'vc.top': en['vc.top'] })).toContain('vc.top');
  });

  it('the verbatim whitelist does not carry dead entries', () => {
    for (const [code, keys] of Object.entries(KEEP_VERBATIM)) {
      for (const key of keys) {
        expect(KEYS, code + ':' + key).toContain(key);
        expect(DICTS[code]![key], code + ':' + key + ' is translated now; drop its exemption').toBe(en[key as MessageKey]);
      }
    }
    for (const key of UNIVERSAL_VERBATIM) {
      expect(KEYS).toContain(key);
      expect(CODES.some((c) => c !== 'en' && DICTS[c]![key] === en[key])).toBe(true);
    }
  });
});

describe('language picker', () => {
  /**
   * Order comes from the registry's ASCII English sort key, not from a
   * collator — see the comment on LANGUAGES (report §7.2 v1.20). 'system' is a
   * mode and stays pinned first; Chinese sorts first, so the four Chinese
   * names head the list and the rest keep their own alphabetical order. The
   * two English rows sort UK before US ('United Kingdom' < 'United States').
   */
  it('offers the languages in a fixed alphabetical order after “system”', () => {
    expect([...LANGUAGES]).toEqual([
      'system',
      // English-name sort of the shipped registry — the stable, engine-
      // independent order the picker promises (2026-10-04, batch 3+4;
      // 2026-10-11 region versions: zh-hk/zh-mo/zh-tw selectable, en-GB added).
      'sq', 'ar', 'hy', 'az', 'bs', 'bg', 'zh', 'zh-hk', 'zh-mo', 'zh-tw', 'hr',
      'cs', 'da', 'nl', 'en-GB', 'en', 'fil', 'fr', 'de', 'el', 'he', 'hi', 'hu',
      'id', 'it', 'ja', 'rw', 'ko', 'mk', 'ms', 'mr', 'nb', 'nn', 'pl', 'pt-BR',
      'ro', 'sr', 'es', 'sv', 'ta', 'tr', 'uk', 'vi',
    ]);
  });

  it('lists every selectable dictionary, and nothing the picker cannot honour', () => {
    for (const code of CODES) {
      expect(LANGUAGES).toContain(code);
    }
    expect(LANGUAGES).toHaveLength(CODES.length + 1); // 43 dictionaries + the 'system' mode
  });

it('labels each language in its own language', () => {
    // Self-maintaining: every selectable code must render its own endonym
    // (no English fallthrough in the picker) — the shipped set order is
    // pinned by the dedicated ordering test above.
    for (const code of LANGUAGES) {
      if (code === 'system') continue;
      const meta = LANG_META[code];
      expect(meta, code).toBeDefined();
      expect(langLabel(code), code).toBe(meta.endonym);
    }
  });

  it('is hand-owned order, not a collator’s opinion', () => {
    // No ICU collation reproduces this list: `en`/`tr` keep the Latin names
    // first, `zh` sorts by pinyin and swaps the two Chinese names. That is the
    // point — a collator would let V8 and WebKit disagree between the dev
    // server and the desktop WKWebView, and let the UI language move rows under
    // the user's cursor.
    for (const locale of ['en', 'zh', 'tr', 'es']) {
      const collator = new Intl.Collator(locale, { sensitivity: 'base' });
      expect([...pickerLabels].sort(collator.compare), locale).not.toEqual(pickerLabels);
    }
  });
});

describe('system language detection', () => {
  it('maps the tags the shipped communities send', () => {
    expect(langFromTags(['es-MX', 'es'])).toBe('es');
    expect(langFromTags(['fr-CA', 'en'])).toBe('fr');
    expect(langFromTags(['tr-TR'])).toBe('tr');
    expect(langFromTags(['zh-CN'])).toBe('zh');
    expect(langFromTags(['en-GB'])).toBe('en-GB');
    expect(langFromTags(['pt-BR'])).toBe('pt-BR');
    expect(langFromTags(['he-IL'])).toBe('he');
    // Anything unsupported still lands on English rather than undefined.
    expect(langFromTags(['fr-FR'])).toBe('fr');
    expect(langFromTags(['ca-ES', 'en'])).toBe('en');
    expect(langFromTags([])).toBe('en');
  });

  it('maps the second-batch language tags (nl/pl/ja/ko/cs)', () => {
    // Bare tags and the regions those communities actually send.
    expect(langFromTags(['nl'])).toBe('nl');
    expect(langFromTags(['nl-NL'])).toBe('nl');
    expect(langFromTags(['nl-BE'])).toBe('nl');
    expect(langFromTags(['pl'])).toBe('pl');
    expect(langFromTags(['pl-PL'])).toBe('pl');
    expect(langFromTags(['ja'])).toBe('ja');
    expect(langFromTags(['ja-JP'])).toBe('ja');
    expect(langFromTags(['ko'])).toBe('ko');
    expect(langFromTags(['ko-KR'])).toBe('ko');
    expect(langFromTags(['cs'])).toBe('cs');
    expect(langFromTags(['cs-CZ'])).toBe('cs');
    // Preference order still wins over any single tag.
    expect(langFromTags(['en-US', 'ja-JP'])).toBe('en');
    expect(langFromTags(['ru-RU', 'ko-KR', 'en'])).toBe('ko');
  });

  it('routes every Portuguese tag to the one shipped Portuguese dictionary', () => {
    // Only Brazilian Portuguese ships, so a bare `pt` or an unshipped region
    // like `pt-PT` lands on it — Portuguese wording beats English for a
    // Portuguese speaker.
    expect(langFromTags(['pt'])).toBe('pt-BR');
    expect(langFromTags(['pt-PT', 'en'])).toBe('pt-BR');
  });

  it('matches Hebrew under its historical iw alias too', () => {
    // Pre-2004 browsers/OS locales still send `iw` for Hebrew.
    expect(langFromTags(['iw-IL'])).toBe('he');
    expect(langFromTags(['iw'])).toBe('he');
  });

  it('maps the third-batch language tags (de/it/ar/hi/mr/ms/ta/fil/vi/id)', () => {
    // Bare tags and the regions those communities actually send.
    expect(langFromTags(['de'])).toBe('de');
    expect(langFromTags(['de-DE'])).toBe('de');
    expect(langFromTags(['de-CH'])).toBe('de');
    expect(langFromTags(['it'])).toBe('it');
    expect(langFromTags(['it-IT'])).toBe('it');
    expect(langFromTags(['ar'])).toBe('ar');
    expect(langFromTags(['ar-SA'])).toBe('ar');
    expect(langFromTags(['ar-MA'])).toBe('ar');
    expect(langFromTags(['arq-DZ'])).toBe('ar');
    expect(langFromTags(['ars-DZ'])).toBe('ar');
    expect(langFromTags(['hi'])).toBe('hi');
    expect(langFromTags(['hi-IN'])).toBe('hi');
    expect(langFromTags(['mr'])).toBe('mr');
    expect(langFromTags(['mr-IN'])).toBe('mr');
    expect(langFromTags(['ms'])).toBe('ms');
    expect(langFromTags(['ms-MY'])).toBe('ms');
    expect(langFromTags(['ta'])).toBe('ta');
    expect(langFromTags(['ta-IN'])).toBe('ta');
    expect(langFromTags(['ta-SG'])).toBe('ta');
    expect(langFromTags(['fil'])).toBe('fil');
    expect(langFromTags(['fil-PH'])).toBe('fil');
    expect(langFromTags(['vi'])).toBe('vi');
    expect(langFromTags(['vi-VN'])).toBe('vi');
    expect(langFromTags(['id'])).toBe('id');
    expect(langFromTags(['id-ID'])).toBe('id');
    // Preference order beats a later tag, as in the earlier batches.
    expect(langFromTags(['en-US', 'de-DE'])).toBe('en');
    expect(langFromTags(['fr-FR', 'ta'])).toBe('fr');
  });

  /** Fourth-batch ISO-639 tags (ro/bg/hr/sv/el/az/hy/hu/mk/sq/sr/bs/da/nb/nn/uk/rw). */
  it('maps the fourth-batch language tags', () => {
    expect(langFromTags(['ro'])).toBe('ro');
    expect(langFromTags(['ro-RO'])).toBe('ro');
    expect(langFromTags(['bg'])).toBe('bg');
    expect(langFromTags(['bg-BG'])).toBe('bg');
    expect(langFromTags(['hr'])).toBe('hr');
    expect(langFromTags(['hr-HR'])).toBe('hr');
    expect(langFromTags(['sv'])).toBe('sv');
    expect(langFromTags(['sv-SE'])).toBe('sv');
    expect(langFromTags(['el'])).toBe('el');
    expect(langFromTags(['el-GR'])).toBe('el');
    expect(langFromTags(['az'])).toBe('az');
    expect(langFromTags(['hy'])).toBe('hy');
    expect(langFromTags(['hu'])).toBe('hu');
    expect(langFromTags(['hu-HU'])).toBe('hu');
    expect(langFromTags(['mk'])).toBe('mk');
    expect(langFromTags(['mk-MK'])).toBe('mk');
    expect(langFromTags(['sq'])).toBe('sq');
    expect(langFromTags(['sr'])).toBe('sr');
    expect(langFromTags(['sr-RS'])).toBe('sr');
    expect(langFromTags(['bs'])).toBe('bs');
    expect(langFromTags(['bs-BA'])).toBe('bs');
    expect(langFromTags(['da'])).toBe('da');
    expect(langFromTags(['da-DK'])).toBe('da');
    expect(langFromTags(['nb'])).toBe('nb');
    expect(langFromTags(['nn'])).toBe('nn');
    expect(langFromTags(['uk'])).toBe('uk');
    expect(langFromTags(['uk-UA'])).toBe('uk');
    expect(langFromTags(['rw'])).toBe('rw');
    expect(langFromTags(['rw-RW'])).toBe('rw');
    // Preference still wins over a later tag.
    expect(langFromTags(['en-US', 'ro-RO'])).toBe('en');
    expect(langFromTags(['de-DE', 'hr'])).toBe('de');
  });

  it('matches Filipino under its historical tl alias too', () => {
    // Pre-2013 OS locale tags still send `tl` (Tagalog) for Filipino.
    expect(langFromTags(['tl-PH'])).toBe('fil');
    expect(langFromTags(['tl'])).toBe('fil');
  });

  it('routes Traditional readers to their region dictionary: HK, Macau and Taiwan each read their own', () => {
    // Region versions (2026-10-11): the three Traditional rows are selectable
    // and each region tag reads its own dictionary. The region-neutral generic
    // row (zh-hant) was withdrawn the same day — it was a byte-identical
    // snapshot of the Taiwan dictionary, so bare `zh-Hant` tags land on zh-tw
    // with identical wording.
    expect(langFromTags(['zh-HK'])).toBe('zh-hk');
    expect(langFromTags(['zh-Hant-HK'])).toBe('zh-hk');
    expect(langFromTags(['zh-MO'])).toBe('zh-mo');
    expect(langFromTags(['zh-Hant-MO'])).toBe('zh-mo');
    expect(langFromTags(['zh-TW'])).toBe('zh-tw');
    expect(langFromTags(['zh-Hant-TW'])).toBe('zh-tw');
    expect(langFromTags(['zh-Hant'])).toBe('zh-tw');
    // Hans always wins over the region: a Simplified-Chrome install in Hong
    // Kong (`zh-Hans-HK`) must not open in Traditional.
    expect(langFromTags(['zh-Hans-HK'])).toBe('zh');
    expect(langFromTags(['zh-Hans-MO'])).toBe('zh');
    expect(langFromTags(['en-GB', 'zh-HK'])).toBe('en-GB');
  });

  it('routes English tags to their region dictionary, script subtags included', () => {
    // Only an explicit GB tag reads the UK dictionary — and a script subtag
    // does not hide the region: macOS/Windows can send `en-Latn-GB`.
    expect(langFromTags(['en-GB'])).toBe('en-GB');
    expect(langFromTags(['en-Latn-GB'])).toBe('en-GB');
    expect(langFromTags(['en-latn-gb'])).toBe('en-GB');
    // Every other English region — and bare English — reads US English.
    expect(langFromTags(['en-US'])).toBe('en');
    expect(langFromTags(['en-AU'])).toBe('en');
    expect(langFromTags(['en-Latn-US'])).toBe('en');
    expect(langFromTags(['en'])).toBe('en');
    expect(langFromTags([])).toBe('en');
  });

  it('matches region tags case-insensitively, extension subtags included', () => {
    // Every region branch carries /i — casing must never be load-bearing
    // (lowercase tags do arrive, e.g. from POSIX-style locale ids).
    expect(langFromTags(['zh-hant'])).toBe('zh-tw');
    expect(langFromTags(['zh-hk'])).toBe('zh-hk');
    expect(langFromTags(['zh-mo'])).toBe('zh-mo');
    expect(langFromTags(['zh-tw'])).toBe('zh-tw');
    expect(langFromTags(['ZH-Hant-MO'])).toBe('zh-mo');
    expect(langFromTags(['en-gb'])).toBe('en-GB');
    // Variant and private-use subtags qualify the tag, not the region: an
    // extended Hong Kong tag still reads the Hong Kong dictionary.
    expect(langFromTags(['zh-Hant-HK-x-private'])).toBe('zh-hk');
    expect(langFromTags(['zh-Hant-MO-x-private'])).toBe('zh-mo');
    // en-GB-oed (Oxford-spelling variant) is British English all the same.
    expect(langFromTags(['en-GB-oed'])).toBe('en-GB');
    // A Traditional reader in an unlisted region follows the script, like
    // bare zh-Hant: zh-Hant-CN lands on zh-tw, never on 简体.
    expect(langFromTags(['zh-Hant-CN'])).toBe('zh-tw');
  });

  it('honours the browser preference order instead of scanning for a favourite', () => {
    // Regression: 'en' had no branch at all, so ['en-US', 'zh-CN'] — a Chrome
    // list that means "English, then Chinese" — opened in Chinese.
    expect(langFromTags(['en-US', 'zh-CN'])).toBe('en');
    expect(langFromTags(['ru-RU', 'fr-FR', 'en'])).toBe('fr');
  });
});

describe('RTL (Arabic and Hebrew)', () => {
  it('flags the RTL languages and nothing else', () => {
    expect(isRtl('he')).toBe(true);
    expect(isRtl('ar')).toBe(true);
    for (const code of CODES) {
      if (code === 'he' || code === 'ar') continue;
      expect(isRtl(code), code).toBe(false);
    }
  });

  it('sets the document direction and language from the active choice', () => {
    const provider = () => createElement(I18nProvider, null, createElement('div'));
    localStorage.setItem('pb.lang', 'he');
    render(provider());
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    expect(document.documentElement.getAttribute('lang')).toBe('he');
    localStorage.clear();
    render(provider());
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');
    expect(document.documentElement.getAttribute('lang')).toBe('en');
  });

  it('migrates a stored zh-hant choice to the Taiwan dictionary, in place', () => {
    // The region-neutral generic Traditional row was withdrawn (2026-10-11) —
    // its dictionary was a byte-identical snapshot of zh-tw. A user who had
    // picked it must relaunch into Traditional Chinese with identical wording:
    // not a blank dictionary, not English, and not a silent 'system' that
    // starts following the OS language instead of the choice they made. The
    // stored value is rewritten so the migration runs once.
    localStorage.setItem('pb.lang', 'zh-hant');
    render(createElement(I18nProvider, null, createElement('div')));
    expect(document.documentElement.getAttribute('lang')).toBe('zh-tw');
    expect(localStorage.getItem('pb.lang')).toBe('zh-tw');
    localStorage.clear();
  });
});

describe('stored choice (savedChoice)', () => {
  afterEach(() => {
    localStorage.clear();
    // Drop the own-property mock so the Navigator prototype getter shows again.
    delete (navigator as { languages?: readonly string[] }).languages;
  });

  const renderWithChoice = () => render(createElement(I18nProvider, null, createElement('div')));
  const langAttr = () => document.documentElement.getAttribute('lang');
  const mockSystemLang = (tags: string[]) =>
    Object.defineProperty(navigator, 'languages', { configurable: true, get: () => tags });

  it('keeps a valid stored code, the region rows included', () => {
    // The region codes are ordinary Lang values in storage — a user who picked
    // 繁體中文（香港） or UK English must relaunch into exactly that row.
    for (const code of ['zh-hk', 'zh-mo', 'zh-tw', 'en-GB']) {
      localStorage.setItem('pb.lang', code);
      renderWithChoice();
      expect(langAttr(), code).toBe(code);
      localStorage.clear();
    }
  });

  it('follows the OS again when nothing is stored', () => {
    mockSystemLang(['fr']);
    renderWithChoice();
    expect(langAttr()).toBe('fr');
  });

  it('treats an unreadable stored value as no choice at all', () => {
    // Junk can only arrive from a hand-edited or version-skewed store; the
    // contract is a read-time fallback to 'system'. 'toString' and
    // 'constructor' are the sharp cases: inherited Object.prototype keys must
    // not masquerade as language codes (the `includes` comment on
    // savedChoice) — and the empty string is not a code either.
    mockSystemLang(['fr']);
    for (const junk of ['klingon', '', 'toString', 'constructor']) {
      localStorage.setItem('pb.lang', junk);
      renderWithChoice();
      // 'fr' can only come from systemLang() — a junk value kept as the
      // language would paint itself into the attribute instead.
      expect(langAttr(), JSON.stringify(junk)).toBe('fr');
      localStorage.clear();
    }
  });
});

describe('Hong Kong dictionary (override table)', () => {
  const overrideKeys = Object.keys(zhHkOverrides);

  it('inherits everything except its own rows', () => {
    // The whole point of shipping an override table instead of a second copy:
    // zh-tw and zh-hk may differ on exactly these keys and nothing else, so a
    // wording change in zh-tw reaches Hong Kong without a second edit.
    const differing = KEYS.filter((k) => zhHk[k as MessageKey] !== zhTw[k as keyof typeof zhTw]);
    expect(differing.sort()).toEqual([...overrideKeys].sort());
  });

  it('is small, and every row actually changes the Taiwan wording', () => {
    // A row that restates zh-tw is dead weight that reads like a difference.
    for (const key of overrideKeys) {
      expect(zhHkOverrides[key as keyof typeof zhHkOverrides]).not.toBe(
        zhTw[key as keyof typeof zhTw],
      );
    }
    // Growing past this needs a real HK-vs-TW term behind it, not a preference.
    // (40 rows today: 28 機械人 keys, the unit spellings, 網絡/網上/詳細資料.)
    expect(overrideKeys.length).toBeLessThan(50);
  });

  /**
   * "The two variants really are different" gate (report §7.2 v1.24 ②, from
   * GHPaths v1.33): a count that merely stays above zero lets someone quietly
   * delete rows and hand Hong Kong the Taiwan spellings back — the test above
   * stays green, because it only compares against the override list. So pin the
   * divergences by name (these three are what a Hong Kong reader notices first)
   * and keep a floor under the total. GHPaths sees 32 of its 412 keys differ
   * because that UI carries media vocabulary (影片/軟體); ours is a field tool,
   * so 40 today with the floor far below.
   */
  it('pins the named HK/TW divergences', () => {
    // The bumper title dropped its unit (2026-10-05), so the 米/公尺 split
    // now lives on the custom-field labels instead.
    expect(zhTw['customField.length' as MessageKey]).toContain('公尺');
    expect(zhHk['customField.length']).toContain('米');
    expect(zhHk['customField.length']).not.toContain('公尺');
    expect(zhTw['updates.failed' as MessageKey]).toContain('網路');
    expect(zhHk['updates.failed']).toContain('網絡');
    expect(zhTw['robots.selectPrompt' as MessageKey]).toContain('詳細資訊');
    expect(zhHk['robots.selectPrompt']).toContain('詳細資料');
    expect(overrideKeys.length).toBeGreaterThanOrEqual(5);
  });

  it('every zh-tw 機器人 string has a 機械人 override — inheritance cannot leak the TW term', () => {
    // HK government/competition/press standard is 機械人; TW writes 機器人.
    // zh-hk inherits zh-tw verbatim outside its override table, so a new
    // 機器人 string added to zh-tw.ts without a matching row below would
    // silently ship the Taiwan term to Hong Kong readers. Pin the pairing.
    for (const key of KEYS) {
      if (!zhTw[key as keyof typeof zhTw].includes('機器人')) continue;
      expect(zhHkOverrides[key as keyof typeof zhHkOverrides], `${key} (zh-tw has 機器人)`).toBeDefined();
      expect(zhHkOverrides[key as keyof typeof zhHkOverrides], key).toContain('機械人');
    }
  });
});

describe('English (United Kingdom) dictionary (override table)', () => {
  const overrideKeys = Object.keys(enGbOverrides);

  it('inherits everything except its own rows', () => {
    // Same contract as zh-hk over zh-tw: US and UK English differ on exactly
    // these keys, so a wording change in en reaches the UK without a second edit.
    const differing = KEYS.filter((k) => enGb[k as MessageKey] !== en[k as MessageKey]);
    expect(differing.sort()).toEqual([...overrideKeys].sort());
  });

  it('every override is a real message key that changes the US wording', () => {
    // A row that restates en — or names a key that does not exist — is dead
    // weight that reads like a difference (the key half is also pinned at
    // type level: enGbOverrides is Partial<Record<MessageKey, string>>).
    for (const key of overrideKeys) {
      expect(KEYS, key).toContain(key);
      expect(enGbOverrides[key as keyof typeof enGbOverrides]).not.toBe(en[key as MessageKey]);
    }
    // The whole point of the row is that it is nearly all US English — if the
    // table grows into a second dictionary, the residue gate comes back.
    expect(overrideKeys.length).toBeLessThan(20);
  });

  it('pins the named US/UK divergences', () => {
    expect(enGb['prefs.unit.m']).toContain('Metres');
    expect(en['prefs.unit.m']).toContain('Meters');
    expect(enGb['prefs.colorblind']).toContain('Colour');
    expect(en['prefs.colorblind']).toContain('Color');
    expect(enGb['menu.minimize']).toBe('Minimise');
    expect(en['menu.minimize']).toBe('Minimize');
  });
});

describe('picker language marks', () => {
  it('every registry row carries a non-empty mark', () => {
    // The mark is the short script/region cue the picker renders beside the
    // check icon (LanguagePicker.tsx); an empty one would paint a blank chip.
    for (const [code, meta] of Object.entries(LANG_META)) {
      expect(meta.mark.trim(), code).not.toBe('');
    }
  });

  it('pins the script/region cue for the multi-row families', () => {
    // All three Traditional rows share 繁 — the mark names the script, not the
    // region (the endonym already names the region); both English rows are EN.
    expect(LANG_META['zh-hk'].mark).toBe('繁');
    expect(LANG_META['zh-mo'].mark).toBe('繁');
    expect(LANG_META['zh-tw'].mark).toBe('繁');
    expect(LANG_META.zh.mark).toBe('简');
    expect(LANG_META.en.mark).toBe('EN');
    expect(LANG_META['en-GB'].mark).toBe('EN');
  });
});

describe('desktop native menu', () => {
  it('is rebuilt from the web spec (set_menu) — labels ship with the dictionaries', () => {
    // The menu went spec-driven (2026-10-06): the page pushes the whole tree
    // with its own localized labels, so every shipped dictionary covers the
    // native menu by construction and the old per-language Rust tables are
    // gone. This test pins both halves of that contract.
    const rust = readFileSync(
      resolve(__dirname, '../../../packages/desktop/src-tauri/src/lib.rs'),
      'utf8',
    );
    expect(rust).toContain('fn set_menu');
    expect(rust).not.toContain('struct MenuLang');
    expect(rust).not.toContain('fn build_menu(');
  });
});

describe('custom fields (core)', () => {
  it('round-trips through a session file', async () => {
    const { makeCustomField, serializeSession, deserializeSession } = await import('@pathblender/core');
    const field = makeCustomField({
      lengthM: 10, widthM: 5, ppm: 100, marginM: 0.25,
      pixelWidth: 1050, pixelHeight: 550,
    });
    const text = serializeSession([], 'custom', field);
    const restored = deserializeSession(text);
    expect(restored.fieldId).toBe('custom');
    expect(restored.field?.lengthM).toBeCloseTo(10, 9);
    expect(restored.field?.image?.ppm).toBe(100);
    expect(restored.field?.image?.marginM).toBeCloseTo(0.25, 9);
  });
});
