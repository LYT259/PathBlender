/**
 * Generate zh-Hant strings from zh-Hans via OpenCC, then apply the FRC
 * terminology table (study §7.2: 「繁體起步策略 = OpenCC 從簡體自動轉換 +
 * FRC 術語表人工校對」). Dev-time tool — opencc-js never ships in the bundle.
 *
 * Usage: node scripts/gen-zh-hant.mjs   (run after editing packages/web/src/i18n/zh.ts)
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
const out = src.replace(/'([^']*)'/g, (m, inner) => {
  if (!/[\u4e00-\u9fff]/.test(inner)) return m;
  let s = converter(inner);
  for (const [from, to] of TERMS) s = s.split(from).join(to);
  return `'${s}'`;
});

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
