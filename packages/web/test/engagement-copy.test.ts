import { describe, expect, it } from 'vitest';
import { LANG_META } from '../src/i18n';
import { engagementEnglish, engagementTranslations } from '../src/engagement-copy';

const KEYS = Object.keys(engagementEnglish);

/** Full-coverage contract for the engagement copy: every UI language must
 * carry the complete set of keys (no silent English fallback), the two
 * deliberate share-alikes (en-GB ← en, zh-mo ← zh-hk) are the only whole-dict
 * duplicates, Serbian stays Latin-script, and ar/he stay in their scripts. */
describe('engagement copy coverage', () => {
  it('has a dictionary for every UI language with exactly the source keys', () => {
    expect(Object.keys(engagementTranslations).sort()).toEqual(Object.keys(LANG_META).sort());
    for (const [lang, dict] of Object.entries(engagementTranslations)) {
      expect(Object.keys(dict).sort(), lang).toEqual([...KEYS].sort());
      for (const [key, value] of Object.entries(dict)) {
        expect(value.length > 0, `${lang}.${key}`).toBe(true);
      }
    }
  });

  it('localises rather than echoing English (except the documented share-alikes)', () => {
    for (const lang of Object.keys(engagementTranslations)) {
      const dict = engagementTranslations[lang as keyof typeof engagementTranslations];
      const sameAsEnglish = KEYS.filter((k) => dict[k as keyof typeof dict] === engagementEnglish[k as keyof typeof engagementEnglish]);
      if (lang === 'en' || lang === 'en-GB') {
        expect(sameAsEnglish, lang).toHaveLength(KEYS.length);
      } else {
        expect(sameAsEnglish.length < KEYS.length / 2, `${lang} echoes English`).toBe(true);
      }
    }
  });

  it('keeps zh-mo aligned with zh-hk and zh-hk distinct from zh-tw', () => {
    expect(engagementTranslations['zh-mo']).toEqual(engagementTranslations['zh-hk']);
    const differing = KEYS.filter(
      (k) => engagementTranslations['zh-hk'][k as keyof typeof engagementTranslations['zh-hk']] !== engagementTranslations['zh-tw'][k as keyof typeof engagementTranslations['zh-tw']],
    );
    expect(differing.length).toBeGreaterThan(0);
  });

  it('uses the script each locale is registered with', () => {
    expect(/\p{Script=Cyrillic}/u.test(engagementTranslations.sr.findBody!)).toBe(false);
    expect(/\p{Script=Arabic}/u.test(engagementTranslations.ar.findBody!)).toBe(true);
    expect(/\p{Script=Hebrew}/u.test(engagementTranslations.he.findBody!)).toBe(true);
    expect(/\p{Script=Han}/u.test(engagementTranslations.zh.lessonTitle!)).toBe(true);
  });

  it('registers a metadata row for every dictionary language', () => {
    for (const lang of Object.keys(engagementTranslations)) {
      expect(LANG_META[lang as keyof typeof LANG_META], lang).toBeDefined();
    }
  });
});
