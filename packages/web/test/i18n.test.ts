import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { createElement } from 'react';
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
import { zhTw } from '../src/i18n/zh-tw';
import { I18nProvider, isRtl, LANGUAGES, LANG_META, langLabel, langFromTags, type Lang } from '../src/i18n';

/**
 * Every shipped dictionary — including zh-tw, which ships as the base under the
 * zh-hk override table but has had no picker row since the 2026-10-07
 * withdrawal (fifth batch pending). Adding a *selectable* language means
 * adding one row here (plus `DICTS`, a `LANG_META` row and a `langFromTags`
 * branch in `src/i18n/index.tsx`, and a menu table in `packages/desktop`);
 * these tests then hold it to the same bar as English. Each full dictionary is
 * typed `Record<MessageKey, string>`, so a missing key is a compile error too —
 * the runtime checks below cover the blanks and the placeholders a type cannot.
 */
const DICTS: Record<string, Record<string, string>> = {
  en, ar, az, bg, bs, cs, da, de, el, es, fil, fr, he, hi, hr, hu, hy, id, it: itDict,
  ja, ko, mk, mr, ms, nb, nl, nn, pl, 'pt-BR': ptBR, ro, rw, sq, sr, sv, ta,
  tr, uk, vi, zh, 'zh-hk': zhHk, 'zh-tw': zhTw,
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
    'prefs.mouse.solidworks.right', 'sequence.seconds',
  ]);

  // Pin exemptions to the language in which the previous audit accepted a
  // loanword or the existing view-cube convention. Do not derive this table
  // from dictionaries at runtime: that would bless every new English leak.
  const KEEP_VERBATIM = {
    'ar': [],
    'az': ["vc.top","vc.bottom","vc.front","vc.back","vc.left","vc.right","workspace.details","prefs.channel.beta"],
    'bg': [],
    'bs': ["vc.top","vc.bottom","vc.front","vc.back","vc.left","vc.right","workspace.details","prefs.channel.beta"],
    'cs': ["vc.top","vc.bottom","vc.front","vc.back","vc.left","vc.right","workspace.details","prefs.channel.stable","prefs.channel.beta","sequence.start"],
    'da': ["prefs.mouse.onshape.wheel","prefs.mouse.solidworks.wheel","prefs.mouse.zoom","vc.top","vc.bottom","vc.front","vc.back","vc.left","vc.right","menu.zoom","workspace.details","robots.alliance","timeline.pause","about.version","robots.driveDifferential","robots.timing","prefs.channel.beta","sequence.start"],
    'de': ["vc.top","vc.bottom","vc.front","vc.back","vc.left","vc.right","menu.zoom","about.version","actions.heatmapOn","canvas.heatmap","prefs.section.updates","prefs.channel.beta","sequence.start"],
    'el': ["prefs.channel.beta"],
    'es': ["prefs.mouse.onshape.wheel","prefs.mouse.solidworks.wheel","prefs.mouse.zoom","vc.top","vc.bottom","vc.front","vc.back","vc.left","vc.right","menu.zoom","prefs.section.general","workspace.details","robots.title","prefs.channel.beta"],
    'fil': ["prefs.mouse.onshape.wheel","prefs.mouse.solidworks.wheel","prefs.mouse.zoom","vc.top","vc.bottom","vc.front","vc.back","vc.left","vc.right","menu.file","workspace.details","robots.collision","actions.heatmapOn","canvas.heatmap","robots.timing","prefs.channel.stable","prefs.channel.beta"],
    'fr': ["prefs.mouse.onshape.wheel","prefs.mouse.solidworks.wheel","prefs.mouse.zoom","vc.top","vc.bottom","vc.front","vc.back","vc.left","vc.right","menu.zoom","workspace.details","robots.title","robots.collision","robots.alliance","timeline.pause","about.version","prefs.unit.yd","prefs.channel.stable","sequence.count"],
    'he': ["vc.top","vc.bottom","vc.front","vc.back","vc.left","vc.right","prefs.channel.stable","prefs.channel.beta"],
    'hi': [],
    'hr': ["vc.top","vc.bottom","vc.front","vc.back","vc.left","vc.right","workspace.details","prefs.channel.beta"],
    'hu': ["vc.top","vc.bottom","vc.front","vc.back","vc.left","vc.right","workspace.details"],
    'hy': [],
    'id': ["vc.top","vc.bottom","vc.front","vc.back","vc.left","vc.right","workspace.details","prefs.channel.beta"],
    'it': ["prefs.mouse.onshape.wheel","prefs.mouse.solidworks.wheel","prefs.mouse.zoom","vc.top","vc.bottom","vc.front","vc.back","vc.left","vc.right","menu.zoom","menu.file","workspace.details","prefs.channel.beta"],
    'ja': ["prefs.channel.stable","prefs.channel.beta"],
    'ko': ["prefs.channel.stable","prefs.channel.beta"],
    'mk': [],
    'mr': [],
    'ms': ["vc.top","vc.bottom","vc.front","vc.back","vc.left","vc.right","workspace.details","robots.uploadSettings","prefs.channel.beta"],
    'nb': ["prefs.mouse.onshape.wheel","prefs.mouse.solidworks.wheel","prefs.mouse.zoom","vc.top","vc.bottom","vc.front","vc.back","vc.left","vc.right","menu.zoom","workspace.details","timeline.pause","robots.timing","prefs.channel.beta","sequence.start"],
    'nl': ["vc.top","vc.bottom","vc.front","vc.back","vc.left","vc.right","menu.zoom","menu.help","workspace.details","robots.title","robots.timing","prefs.section.updates","robots.profileEntry","prefs.channel.stable","prefs.channel.beta","sequence.start"],
    'nn': ["prefs.mouse.onshape.wheel","prefs.mouse.solidworks.wheel","prefs.mouse.zoom","vc.top","vc.bottom","vc.front","vc.back","vc.left","vc.right","menu.zoom","workspace.details","timeline.pause","prefs.channel.beta","sequence.start"],
    'pl': ["vc.top","vc.bottom","vc.front","vc.back","vc.left","vc.right","workspace.details","prefs.channel.stable","prefs.channel.beta","sequence.start"],
    'pt-BR': ["prefs.mouse.onshape.wheel","prefs.mouse.solidworks.wheel","prefs.mouse.zoom","vc.top","vc.bottom","vc.front","vc.back","vc.left","vc.right","menu.zoom","prefs.channel.stable","prefs.channel.beta"],
    'ro': ["vc.top","vc.bottom","vc.front","vc.back","vc.left","vc.right","menu.zoom","prefs.section.general","workspace.details","prefs.channel.beta","sequence.start"],
    'rw': ["vc.top","vc.bottom","vc.front","vc.back","vc.left","vc.right","canvas.heatmap","canvas.trail","canvas.overlays","prefs.channel.beta"],
    'sq': ["vc.top","vc.bottom","vc.front","vc.back","vc.left","vc.right","workspace.details","prefs.channel.beta"],
    'sr': ["vc.top","vc.bottom","vc.front","vc.back","vc.left","vc.right","workspace.details","prefs.channel.beta"],
    'sv': ["vc.top","vc.bottom","vc.front","vc.back","vc.left","vc.right","menu.zoom","workspace.details","about.version","robots.driveDifferential","robots.timing","prefs.channel.beta","sequence.start"],
    'ta': [],
    'tr': ["vc.top","vc.bottom","vc.front","vc.back","vc.left","vc.right","workspace.details","prefs.channel.beta"],
    'uk': [],
    'vi': ["vc.top","vc.bottom","vc.front","vc.back","vc.left","vc.right","workspace.details","prefs.channel.beta"],
    'zh': [],
    'zh-hk': [],
    // Ships as the zh-hk base, not as a picker row — see the DICTS comment.
    'zh-tw': [],
  } satisfies Record<Exclude<Lang, 'en'> | 'zh-tw', readonly MessageKey[]>;

  function englishResidue(code: Exclude<Lang, 'en'> | 'zh-tw', dictionary: Record<string, string>): string[] {
    const allowed: readonly string[] = KEEP_VERBATIM[code];
    return Object.entries(en)
      .filter(([key, source]) => !UNIVERSAL_VERBATIM.has(key as MessageKey) && !allowed.includes(key) && dictionary[key] === source)
      .map(([key]) => key);
  }

  it('nothing is left sitting on the English text', () => {
    for (const code of CODES) {
      if (code === 'en') continue;
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
   * mode and stays pinned first; Chinese sorts first, so the two Chinese
   * names head the list and the rest keep their own alphabetical order.
   */
  it('offers the languages in a fixed alphabetical order after “system”', () => {
    expect([...LANGUAGES]).toEqual([
      'system',
      // English-name sort of the shipped registry — the stable, engine-
      // independent order the picker promises (2026-10-04, batch 3+4;
      // 2026-10-07 dropped the zh-tw row).
      'sq', 'ar', 'hy', 'az', 'bs', 'bg', 'zh', 'zh-hk', 'hr', 'cs',
      'da', 'nl', 'en', 'fil', 'fr', 'de', 'el', 'he', 'hi', 'hu', 'id', 'it',
      'ja', 'rw', 'ko', 'mk', 'ms', 'mr', 'nb', 'nn', 'pl', 'pt-BR', 'ro', 'sr',
      'es', 'sv', 'ta', 'tr', 'uk', 'vi',
    ]);
  });

  it('lists every selectable dictionary, and nothing the picker cannot honour', () => {
    for (const code of CODES) {
      if (code === 'zh-tw') continue;
      expect(LANGUAGES).toContain(code);
    }
    // zh-tw still ships as the zh-hk base but must not be selectable
    // (withdrawn 2026-10-07, fifth batch pending).
    expect(LANGUAGES).not.toContain('zh-tw');
    expect(LANGUAGES).toHaveLength(CODES.length); // 40 selectable + the 'system' mode
  });

it('labels each language in its own language', () => {
    // Self-maintaining: every selectable code must render its own endonym
    // (no English fallthrough in the picker) — the shipped set order is
    // pinned by the dedicated ordering test above. zh-tw has no registry row.
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
    expect(langFromTags(['en-GB'])).toBe('en');
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

  it('routes every Traditional Chinese reader to Hong Kong, Macau included', () => {
    // Report §7.2 v1.23 routed TW and a bare `zh-Hant` to zh-tw; the Taiwan
    // picker row was withdrawn on 2026-10-07 (public-round decision, fifth
    // batch pending), so every Traditional reader — HK, MO, TW and region-less
    // Hant — now reads the Hong Kong dictionary. The zh-tw dictionary still
    // ships underneath it (zh-hk is an override table), it just is not
    // selectable.
    expect(langFromTags(['zh-HK'])).toBe('zh-hk');
    expect(langFromTags(['zh-Hant-HK'])).toBe('zh-hk');
    expect(langFromTags(['zh-MO'])).toBe('zh-hk');
    expect(langFromTags(['zh-Hant-MO'])).toBe('zh-hk');
    expect(langFromTags(['zh-TW'])).toBe('zh-hk');
    expect(langFromTags(['zh-Hant-TW'])).toBe('zh-hk');
    expect(langFromTags(['zh-Hant'])).toBe('zh-hk');
    // Hans always wins over the region: a Simplified-Chrome install in Hong
    // Kong (`zh-Hans-HK`) must not open in Traditional.
    expect(langFromTags(['zh-Hans-HK'])).toBe('zh');
    expect(langFromTags(['zh-Hans-MO'])).toBe('zh');
    expect(langFromTags(['en-GB', 'zh-HK'])).toBe('en');
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
      if (code === 'he' || code === 'ar' || code === 'zh-tw') continue;
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

  it('migrates a stored zh-tw choice to the Hong Kong dictionary, in place', () => {
    // The Taiwan row was withdrawn (2026-10-07, fifth batch pending). A user
    // who had picked it must relaunch into Traditional Chinese — not a blank
    // dictionary, not English, and not a silent 'system' that starts
    // following the OS language instead of the choice they made.
    localStorage.setItem('pb.lang', 'zh-tw');
    render(createElement(I18nProvider, null, createElement('div')));
    expect(document.documentElement.getAttribute('lang')).toBe('zh-hk');
    expect(localStorage.getItem('pb.lang')).toBe('zh-hk');
    localStorage.clear();
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
    expect(overrideKeys.length).toBeLessThan(40);
  });

  /**
   * "The two variants really are different" gate (report §7.2 v1.24 ②, from
   * GHPaths v1.33): a count that merely stays above zero lets someone quietly
   * delete rows and hand Hong Kong the Taiwan spellings back — the test above
   * stays green, because it only compares against the override list. So pin the
   * divergences by name (these three are what a Hong Kong reader notices first)
   * and keep a floor under the total. GHPaths sees 32 of its 412 keys differ
   * because that UI carries media vocabulary (影片/軟體); ours is a field tool,
   * so 7 today with the floor at 5.
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
