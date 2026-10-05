import type { MessageKey } from './en';
import { zhTw } from './zh-tw';

/**
 * 繁體中文（中國香港）— an **override table on top of zh-tw**, not a second
 * copy of it (report §7.2 v1.23). Two full Traditional dictionaries would drift
 * apart on every wording change; the real HK/TW divergence in this UI is a
 * handful of terms, so only those are listed and everything else is inherited
 * verbatim. Macau reads this dictionary too: `langFromTags()` routes
 * `zh-MO`/`zh-Hant-MO` here rather than opening a third locale for a community
 * with no registered teams (v1.22's 区域就近回退, same rule as `es-AR`→`es-MX`).
 *
 * Every key added here needs a reason in the comment above it — "TW happens to
 * phrase it differently" is not one; a shared HK/TW reading is.
 */
export const zhHkOverrides: Partial<Record<MessageKey, string>> = {
  // Units: HK uses the international name 米 (as mainland does); 公尺 is the
  // Taiwan term — `scripts/gen-zh-hant.mjs` rewrites 米→公尺 on purpose.
  'robots.profileEntry': '保險桿 {l} × {w} 米',
  'customField.margin': '邊距 (米)',
  'customField.length': '長 (米)',
  'customField.width': '寬 (米)',
  // "network": HK keeps 網絡; the TERMS table converts it to TW 網路.
  'updates.failed': '更新檢查失敗，請檢查網絡後重試',
  // "details": HK UI convention is 詳細資料; TW Microsoft uses 詳細資訊.
  'robots.selectPrompt': '選擇一台機器人查看詳細資料。',
};

/** What `DICTS` consumes: the Taiwan dictionary with the HK rows applied. */
export const zhHk: Record<MessageKey, string> = { ...zhTw, ...zhHkOverrides };
