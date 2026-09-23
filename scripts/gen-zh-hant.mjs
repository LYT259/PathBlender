/**
 * Generate zh-Hant strings from zh-Hans via OpenCC, then apply the FRC
 * terminology table (study §7.2: 「繁體起步策略 = OpenCC 從簡體自動轉換 +
 * FRC 術語表人工校對」). Dev-time tool — opencc-js never ships in the bundle.
 *
 * Usage: node scripts/gen-zh-hant.mjs   (run after editing packages/web/src/i18n/zh.ts)
 *
 * WARNING — read `git diff` before committing its output. packages/web/src/i18n/
 * zh-tw.ts has drifted from what this script produces: it carries Taiwan wording
 * that no rule here knows about (復原 for Undo, 同場回放, 資料夾 for folder,
 * 詳細資訊…), which regeneration turns into 撤銷 / 同場播放 / 檔案夾 / 詳情.
 * Adding those to TERMS is the way back to "regeneration is safe"; until then,
 * for a key addition or removal, edit zh-tw.ts by hand and keep this script for
 * bulk work only.
 *
 * Two silent failures fixed on 2026-09-23: the value pattern only matched
 * single-quoted strings while both dictionaries use double quotes (so nothing
 * converted, and the script happily overwrote 繁體 with 简体 while reporting
 * success), and there was no check that OpenCC had actually run.
 */
import { Converter } from 'opencc-js';
import { readFileSync, writeFileSync } from 'node:fs';

/** 两岸 FRC 术语校正（OpenCC 之后的字符串级替换）。 */
const TERMS = [
  ['保險杠', '保險桿'], // bumper：台惯用「桿」
  ['檢測', '偵測'],
  ['視頻', '影片'],
  ['軟件', '軟體'],
  ['默認', '預設'],
  ['鏈接', '連結'],
  ['網絡', '網路'],
  ['剪貼板', '剪貼簿'],
  ['導入', '匯入'],
  ['導出', '匯出'],
  ['保存', '儲存'],
  ['設置', '設定'],
  ['支持', '支援'],
  ['仿真', '模擬'],
  ['數據', '資料'],
  ['信息', '訊息'],
  ['當前', '目前'],
  ['回放', '播放'],
  ['幀', '影格'],
  ['人工智能', '人工智慧'],
  // 台灣慣用（本字典出現的其餘詞彙）
  ['文件', '檔案'],
  ['會話', '工作階段'],
  ['地址欄', '網址列'],
  ['粘貼', '貼上'],
  ['佈局', '布局'], // 台惯用「布局」；OpenCC 產「佈局」時回正
  [' (米)', ' (公尺)'],
  ['米)', '公尺)'],
];

// zh-Hant for HK+TW both: 'hk' avoids TW-only phrasing (網路/軟體) in favor
// of the shared vocabulary (網絡/軟件 is mainland; hk keeps 中性 IT 詞彙).
// Regional specifics are handled by the TERMS table below.
const converter = await Converter({ from: 'cn', to: 'hk' });

const src = readFileSync('packages/web/src/i18n/zh.ts', 'utf-8');

// Convert only value strings (containing CJK), leaving keys untouched.
// Both quote styles are matched: the dictionaries moved from '…' to "…" and a
// single-quote-only pattern silently converted NOTHING — the script kept
// reporting success while emitting simplified Chinese over the traditional
// file. The check below (any CJK left after conversion) makes that failure
// mode loud instead of silent.
const out = src.replace(/(['"])([^'"]*)\1/g, (m, quote, inner) => {
  if (!/[\u4e00-\u9fff]/.test(inner)) return m;
  let s = converter(inner);
  for (const [from, to] of TERMS) s = s.split(from).join(to);
  return `${quote}${s}${quote}`;
});

// Prove the converter actually runs before overwriting a traditional file with
// simplified text. Per-value "did it change" checks misfire (繁简同形 words like
// 接口地址), so test a sentinel that must differ.
if (converter('路径') !== '路徑') {
  console.error(
    'gen-zh-hant: OpenCC returned the input unchanged (converter broken or wrong ' +
    `locale): got ${JSON.stringify(converter('路径'))}. Refusing to write.`,
  );
  process.exit(1);
}

const header = `import type { MessageKey } from './en';

/**
 * 繁體中文 — 由 scripts/gen-zh-hant.mjs 生成（OpenCC 簡→繁 + FRC 術語表）。
 * 術語校正改 scripts/gen-zh-hant.mjs 的 TERMS 表後重新生成，勿直接手改本文件
 * （人工覆寫會在下一次生成時丟失）。
 */
`;

const body = out.slice(out.indexOf('export const'));
writeFileSync(
  'packages/web/src/i18n/zh-tw.ts',
  header + body.replace('export const zh:', 'export const zhTw:'),
);
console.log('generated packages/web/src/i18n/zh-tw.ts');
