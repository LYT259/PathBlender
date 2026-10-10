/**
 * In-app quick guide (2026-10-07 onboarding plan §5): topic copy shipped with
 * the app so the core explanations read offline — the web build makes no
 * network requests and the venue Wi-Fi cannot be counted on.
 *
 * Framework strings (dialog title, link labels) live in the i18n dictionaries;
 * this body is maintained in English + Simplified + Traditional Chinese only,
 * per the plan's language scope ("maintain English and Chinese first; decide
 * other coverage separately"). Other UI languages read the English body —
 * the dictionaries' fallback order does the same for missing keys.
 *
 * UI-control names quoted in the copy are the real labels of the matching
 * language family (e.g. zh-Hans text names 「左右镜像」, zh-Hant 「左右鏡像」),
 * so the guide keeps pointing at the button the reader sees.
 */

import type { Lang } from './i18n';

/** A string maintained per script family; `hans`/`hant` fall back to `en`. */
export interface LocalizedText {
  en: string;
  hans?: string;
  hant?: string;
}

export interface GuideTopic {
  id: string;
  title: LocalizedText;
  intro: LocalizedText;
  points: LocalizedText[];
}

/** The online full guide follows the reader's script family, else English. */
export function guideUrlForLang(lang: Lang): string {
  const file = lang === 'zh' || lang === 'zh-hk' || lang === 'zh-hant'
    ? 'user-guide.zh.md'
    : 'user-guide.en.md';
  return `https://github.com/LYT259/pathblender/blob/stable/docs/${file}`;
}

export function pickLocalized(text: LocalizedText, lang: Lang): string {
  if (lang === 'zh') return text.hans ?? text.en;
  // zh-hant (generic, 2026-10-10) and zh-hk are the selectable Traditional
  // UIs since the Taiwan row withdrew from the picker (2026-10-07, fifth
  // batch pending).
  if (lang === 'zh-hk' || lang === 'zh-hant') return text.hant ?? text.hans ?? text.en;
  return text.en;
}

export const GUIDE_TOPICS: GuideTopic[] = [
  {
    id: 'purpose',
    title: {
      en: 'What PathBlender is for',
      hans: 'PathBlender 是做什么的',
      hant: 'PathBlender 是做什麼的',
    },
    intro: {
      en: 'Before a match: put every alliance partner’s autonomous run on one field, replay them together on a shared clock, and catch robot-to-robot conflicts while there is still time to change the plan.',
      hans: '比赛前：把联盟各队的自动路线放到同一块场地上，用统一时钟同时回放，趁还来得及改方案的时候发现机器人之间的冲突。',
      hant: '比賽前：把聯盟各隊的自動路徑放到同一塊場地上，用統一時鐘同時播放，趁還來得及改方案的時候發現機器人之間的衝突。',
    },
    points: [
      {
        en: 'Built for alliance strategy and programming groups — you only need to know what the autonomous period is.',
        hans: '面向联盟策略组与编程组——只需要了解「自动阶段」是什么。',
        hant: '面向聯盟策略組與程式組——只需要了解「自動階段」是什麼。',
      },
      {
        en: 'Every file is parsed on your own machine: nothing is uploaded, no account, no telemetry.',
        hans: '所有文件都在你自己的设备上解析：不上传、无账号、无遥测。',
        hant: '所有檔案都在你自己的裝置上解析：不上傳、無帳號、無遙測。',
      },
      {
        en: 'PathBlender is a viewer: it shows the problem. Edits happen in Choreo or PathPlanner — re-export, drop the new file in, check again.',
        hans: 'PathBlender 是查看器：负责把问题显示出来。修改在 Choreo / PathPlanner 里完成——重新导出、拖入新文件、再查一遍。',
        hant: 'PathBlender 是檢視器：負責把問題顯示出來。修改在 Choreo / PathPlanner 裡完成——重新匯出、拖入新檔案、再檢查一遍。',
      },
    ],
  },
  {
    id: 'import',
    title: {
      en: 'Prepare and import files',
      hans: '准备与导入文件',
      hant: '準備與匯入檔案',
    },
    intro: {
      en: 'Ask each partner for an export from their tool. One import can mix formats and select several files — or load a whole folder.',
      hans: '向每个队友要一份他们工具的导出文件。一次导入可以混格式、多选文件——也可以整包导入文件夹。',
      hant: '向每個隊友要一份他們工具的匯出檔案。一次匯入可以混合格式、多選檔案——也可以整包匯入資料夾。',
    },
    points: [
      {
        en: 'Choreo: .traj.',
        hans: 'Choreo：.traj。',
        hant: 'Choreo：.traj。',
      },
      {
        en: 'PathPlanner: the .auto plus every .path it references — import them in the same batch.',
        hans: 'PathPlanner：.auto 与它引用的每个 .path——必须同批导入。',
        hant: 'PathPlanner：.auto 與它引用的每個 .path——必須同批匯入。',
      },
      {
        en: 'Team 103 Collaborative fork: .ghostauto (carries the team name and bumper size).',
        hans: '103 队 Collaborative fork：.ghostauto（自带队名与保险杠尺寸）。',
        hant: '103 隊 Collaborative fork：.ghostauto（自帶隊名與保險桿尺寸）。',
      },
      {
        en: 'PathPlanner settings.json: gives every robot that project’s real bumper dimensions.',
        hans: 'PathPlanner settings.json：让所有机器人获得该项目的真实保险杠尺寸。',
        hant: 'PathPlanner settings.json：讓所有機器人取得該專案的真實保險桿尺寸。',
      },
      {
        en: 'A broken file is reported on its own without stopping the rest.',
        hans: '坏文件会单独报错，不影响其他文件导入。',
        hant: '壞檔案會個別回報錯誤，不影響其他檔案匯入。',
      },
      {
        en: 'Right after importing, check the basics: season and field, bumper size, red/blue alliance.',
        hans: '导入完成后先核对基础设置：赛季与场地、保险杠尺寸、红/蓝联盟。',
        hant: '匯入完成後先核對基本設定：賽季與場地、保險桿尺寸、紅/藍聯盟。',
      },
    ],
  },
  {
    id: 'playback',
    title: {
      en: 'Replay and compare plans',
      hans: '回放与比较方案',
      hant: '播放與比較方案',
    },
    intro: {
      en: 'Press Play and watch every robot at once; scrub the timeline to any moment. Speeds run 0.25×–1×.',
      hans: '按下「播放」，同时观察所有机器人；拖动时间轴到任意时刻。速度可选 0.25×–1×。',
      hant: '按下「播放」，同時觀察所有機器人；拖曳時間軸到任意時刻。速度可選 0.25×–1×。',
    },
    points: [
      {
        en: 'Switch a robot’s route live from the picker beside it — import a folder to fill its route library first.',
        hans: '在机器人旁的选择器里实时切换当前路线——先导入文件夹即可填满它的路线库。',
        hant: '在機器人旁的選擇器裡即時切換目前路徑——先匯入資料夾即可填滿它的路徑庫。',
      },
      {
        en: 'Open a robot’s arrangement to shift its start time and compare “their plan A vs plan B” against the rest of the alliance.',
        hans: '打开机器人的编排可调整起步时间，把「他们的 A 方案 vs B 方案」与其余联盟路径对比。',
        hant: '開啟機器人的編排可調整起步時間，把「他們的 A 方案 vs B 方案」與其餘聯盟路徑對比。',
      },
      {
        en: 'Every adjustment here is an analysis view: your imported files are never rewritten.',
        hans: '这里的每次调整都只是分析视图：导入的原始文件不会被改写。',
        hant: '這裡的每次調整都只是分析視圖：匯入的原始檔案不會被改寫。',
      },
    ],
  },
  {
    id: 'transforms',
    title: {
      en: 'Alliance switch vs. left/right mirror',
      hans: '联盟切换与左右镜像',
      hant: '聯盟切換與左右鏡像',
    },
    intro: {
      en: 'Two different spatial tools — they look similar but act on different things. Pick the one that matches what you want.',
      hans: '两个不同的空间变换——看起来相似，作用对象不同。按你的目的选择。',
      hant: '兩個不同的空間變換——看起來相似，作用對象不同。依你的目的選擇。',
    },
    points: [
      {
        en: 'Red/blue alliance (whole session): moves the entire fused session to the chosen half-field — the side those robots actually start on in the match.',
        hans: '红/蓝联盟（整套会话）：把整套融合结果变换到所选半场——即这些机器人在比赛中真正起步的那一侧。',
        hant: '紅/藍聯盟（整套工作階段）：把整套融合結果變換到所選半場——即這些機器人在比賽中真正起步的那一側。',
      },
      {
        en: 'Mirror left/right (one robot): flips that robot and its route library about the field centerline — for a partner who exported from the other side.',
        hans: '左右镜像（单台机器人）：把该机器人及其路线库沿场地中线左右翻转——适用于从另一侧导出的队友。',
        hant: '左右鏡像（單台機器人）：把該機器人及其路徑庫沿場地中線左右翻轉——適用於從另一側匯出的隊友。',
      },
      {
        en: 'Both are derived views: the original files stay untouched, and collision checking always uses the coordinates you see.',
        hans: '两者都是派生视图：原始文件不被改动，碰撞判定用的就是你看到的坐标。',
        hant: '兩者都是衍生視圖：原始檔案不被改動，碰撞判定用的就是你看到的座標。',
      },
      {
        en: 'Neither reverses time: playback still runs forward on the shared clock — this is a spatial flip, not playing a run backwards.',
        hans: '两者都不会让时间倒流：回放仍在统一时钟上向前进行——这是空间翻转，不是倒放。',
        hant: '兩者都不會讓時間倒流：播放仍在統一時鐘上向前進行——這是空間翻轉，不是倒放。',
      },
    ],
  },
  {
    id: 'checks',
    title: {
      en: 'Reading the check results',
      hans: '读懂检查结果',
      hant: '讀懂檢查結果',
    },
    intro: {
      en: 'A conflict shows up in three places: a red ring on the field, a red segment on the timeline, and an entry in the checks panel (who, when, where). Click an entry to jump the clock to that moment.',
      hans: '冲突在三处同时出现：场地上的红色圆环、时间轴上的红色区段、检查面板里的条目（谁和谁、什么时刻、在哪里）。点一条直达那个瞬间。',
      hant: '衝突在三處同時出現：場地上的紅色圓環、時間軸上的紅色區段、檢查面板裡的條目（誰和誰、什麼時刻、在哪裡）。點一條直達那個瞬間。',
    },
    points: [
      {
        en: 'Robots leaving the field are marked out of bounds at the exact times it happens.',
        hans: '机器人驶出场地边界的时刻会标记为越界。',
        hant: '機器人駛出場地邊界的時刻會標記為越界。',
      },
      {
        en: 'Times from .traj / .ghostauto come from the export; a .path without its settings.json is regenerated locally and marked as an estimate — treat borderline results as a prompt to verify with both teams, not a verdict.',
        hans: '.traj / .ghostauto 的时间来自导出采样；没有 settings.json 的 .path 是本地重算的估算值——临界结果当作「去找两队核对」的提示，不要当作定论。',
        hant: '.traj / .ghostauto 的時間來自匯出取樣；沒有 settings.json 的 .path 是本機重算的估算值——臨界結果當作「去找兩隊核對」的提示，不要當作定論。',
      },
      {
        en: 'Analysis is not a simulation of the real robots: it replays the exported plans, not the physical cars.',
        hans: '分析不等于实车仿真：它回放的是导出的方案，不是真实机器人的物理表现。',
        hant: '分析不等於實車模擬：它播放的是匯出的方案，不是真實機器人的物理表現。',
      },
    ],
  },
  {
    id: 'save',
    title: {
      en: 'Save and share',
      hans: '保存与分享',
      hant: '儲存與分享',
    },
    intro: {
      en: 'What you can hand to the next strategy meeting depends on the host: the desktop app saves, the web viewer opens.',
      hans: '能把什么交给下一场策略会取决于平台：桌面版能保存，网页版只读打开。',
      hant: '能把什麼交給下一場策略會取決於平台：桌面版能儲存，網頁版唯讀開啟。',
    },
    points: [
      {
        en: 'Desktop: save / open the whole session as a .pb file, export a GIF of the 2D replay, or pack a solution package (routes, session, replay, README) for the alliance chat.',
        hans: '桌面版：把整个会话保存/打开为 .pb 文件；导出 2D 视图的 GIF 回放；或打包方案包（路线、会话、回放、说明）发联盟群。',
        hant: '桌面版：把整個工作階段儲存/開啟為 .pb 檔案；匯出 2D 檢視的 GIF 播放；或打包方案包（路徑、工作階段、播放、說明）傳聯盟群。',
      },
      {
        en: 'Web: opens saved sessions and does every import, playback and check — saving and export live in the desktop app.',
        hans: '网页版：能打开已保存的会话，导入、回放、检查全部可用——保存与导出在桌面版里。',
        hant: '網頁版：能開啟已儲存的工作階段，匯入、播放、檢查全部可用——儲存與匯出在桌面版裡。',
      },
    ],
  },
  {
    id: 'more',
    title: {
      en: 'Where to find more',
      hans: '更多帮助',
      hant: '更多說明',
    },
    intro: {
      en: 'The full walkthrough with screenshots is one click away (link at the bottom of this guide).',
      hans: '带截图的完整教程就在一键之遥（见本指南底部链接）。',
      hant: '帶截圖的完整教學就在一鍵之遙（見本指南底部連結）。',
    },
    points: [
      {
        en: 'Keyboard shortcuts: press ? anywhere, or open them from the Help menu.',
        hans: '键盘快捷键：任意位置按 ?，或从帮助菜单打开。',
        hant: '鍵盤快速鍵：任意位置按 ?，或從說明選單開啟。',
      },
      {
        en: 'No files at hand? “Try the example” on the welcome screen loads a real multi-robot session.',
        hans: '手头没有文件？欢迎页的「试试示例」会加载一个真实的多机器人会话。',
        hant: '手邊沒有檔案？歡迎頁的「試試示例」會載入一個真實的多機器人工作階段。',
      },
      {
        en: 'Bugs and format-drift reports go to the project’s GitHub issues.',
        hans: '程序错误与格式漂移报告请发到项目的 GitHub issues。',
        hant: '程式錯誤與格式漂移報告請發到專案的 GitHub issues。',
      },
    ],
  },
];
