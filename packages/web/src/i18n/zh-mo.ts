import type { MessageKey } from './en';
import { zhHk } from './zh-hk';

/**
 * 繁體中文（澳門）— an override table on top of **zh-hk**, matching the CLDR
 * parentLocales inheritance (zh-Hant-MO → zh-Hant-HK). Macau official/press
 * usage matches Hong Kong for this dictionary's vocabulary: 網絡 (Law
 * 13/2019), 機械人 (TDM), 米/厘米 (Macau school materials). No Macau-specific
 * override is added without a source — the empty table is deliberate, not an
 * omission; a key only appears here once a Macau attestation exists for it.
 */
export const zhMoOverrides: Partial<Record<MessageKey, string>> = {};

/** What `DICTS` consumes: the Hong Kong dictionary with the Macau rows applied. */
export const zhMo: Record<MessageKey, string> = { ...zhHk, ...zhMoOverrides };
