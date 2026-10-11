import type { MessageKey } from './en';
import { zhTw } from './zh-tw';

/**
 * 繁體中文（香港）— an **override table on top of zh-tw**, not a second
 * copy of it (report §7.2 v1.23). Two full Traditional dictionaries would drift
 * apart on every wording change; the real HK/TW divergence in this UI is a
 * handful of terms, so only those are listed and everything else is inherited
 * verbatim. Macau has its own `zh-mo` row, which layers on top of *this*
 * dictionary (CLDR parentLocales zh-Hant-MO → zh-Hant-HK).
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
  // Same 米 rule for the standalone unit picker (was an oversight: the four
  // overrides above covered every other metre-bearing string).
  'prefs.unit.m': '米 (m)',
  // HK Education Bureau standard is 厘米; TW 公分.
  'prefs.unit.cm': '厘米 (cm)',
  // Imperial units: HK Customs weights-and-measures usage is 呎/吋; TW writes
  // 英尺/英吋.
  'prefs.unit.ft': '呎 (ft)',
  'prefs.unit.in': '吋 (in)',
  'prefs.unit.ftin': '呎+吋 (3′2″)',
  // "network": HK keeps 網絡; the TERMS table converts it to TW 網路.
  'updates.failed': '更新檢查失敗，請檢查網絡後重試',
  // "details": HK UI convention is 詳細資料; TW Microsoft uses 詳細資訊.
  // "robot": HK standard is 機械人 with classifier 部 (see the block below).
  'robots.selectPrompt': '選擇一部機械人查看詳細資料。',
  // "online": HK writes 網上 (GovHK 網上服務); TW 線上.
  'guide.fullOnline': '完整指南（網上）',
  // "robot": HK government/competition/press standard is 機械人, classifier
  // 部 (一台→一部, {n} 台→{n} 部); TW writes 機器人/台. Every zh-tw value
  // containing 機器人 is overridden here — adding a new 機器人 string to
  // zh-tw.ts requires a matching row below.
  'tour.task.play.hint': '按「播放」——兩部機械人在同一時鐘上一起跑；拖曳時間軸到任意時刻。',
  'tour.task.mirror.title': '左右鏡像一部機械人',
  'tour.task.mirror.hint': '點 8814 列內的「左右鏡像」——只有這部機械人連同路徑庫翻過中線。再看一眼檢查面板。',
  'welcome.description': '一起回放路徑，查看機械人之間是否有干涉。',
  'welcome.exampleNotice': '三部真實 FRC 機械人的 2026 賽季路線：11019、8814 與 11019 Champs。',
  'workspace.details': '機械人',
  'workspace.closeRobotDetails': '關閉機械人詳情',
  'checks.singleBody': '已檢查場地邊界。再匯入一部機械人，即可檢查路徑衝突。',
  'checks.hidden': '包含 {n} 部已隱藏的機械人',
  'robots.data': '機械人資料',
  'robots.title': '機械人 ({n})',
  'robots.applyProfile': '機械人參數',
  'robots.mirrorHint': '只翻轉這部機械人及其路徑庫——原始檔案不變',
  'robots.settingsNotProfile': '不是可用的機械人設定檔——找不到保險桿尺寸。',
  'robots.settingsApplied': '機械人參數已套用：{name}',
  'library.importFolderHint': '一次匯入整個資料夾的路線或機械人參數',
  'library.imported': '已匯入 {n} 條路線、{m} 份機械人參數',
  'library.add': '把 {name} 加入為機械人',
  'library.hint': '在機械人旁選擇路線即可切換自動；點 + 可把路線作為另一部機械人加入場地。',
  'timeline.empty': '匯入路徑，在同一時間軸比較機械人。',
  'canvas.heatmapHint': '機械人足跡隨時間疊加，顏色越深表示在此經過或停留越多',
  'canvas.trailHint': '在場上顯示每部機械人的完整路徑',
  'actions.saveHint': '儲存全部機械人和工作階段設定（.pb），用「匯入」重新開啟。單條路徑在右側機械人面板中匯出。',
  'actions.clearHint': '移除目前工作階段的全部機械人（不會改動已匯入的檔案）',
  'checks.estimated': '部分尺寸為估算值，請先核對機械人資料，再使用檢查結果。',
  'help.group.robot': '機械人',
  'help.switchRobot': '上一部 / 下一部機械人',
  'help.hideShow': '顯示 / 隱藏選取的機械人',
};

/** What `DICTS` consumes: the Taiwan dictionary with the HK rows applied. */
export const zhHk: Record<MessageKey, string> = { ...zhTw, ...zhHkOverrides };
