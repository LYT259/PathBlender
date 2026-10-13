import type { Lang } from './i18n';

/** English source + reviewed Chinese copy. Remaining locale translations are
 * an explicit pre-merge handoff item, not a claim of full language coverage. */
export const engagementEnglish = {
  star: 'Star on GitHub',
  support: 'Finding PathBlender useful?',
  supportBody: 'Star the project on GitHub to show your support and find it again later.',
  dismiss: 'Dismiss this invitation',
  firstCheck: 'Try your first path check',
  firstCheckHint: 'No files needed. Explore three synthetic routes, find a conflict, and compare a different start time.',
  lessonTitle: 'Your first path check',
  lessonNote: 'Synthetic teaching routes on a practice field; not real team or match data.',
  playTitle: '1. Replay the three routes together',
  playBody: 'Each robot follows its own route on the same clock. Watch A and B reach the crossing together.',
  play: 'Play the routes',
  findTitle: '2. Locate the conflict',
  findBody: 'Jump to the detected overlap. The checks panel and field show the same result.',
  find: 'Show the conflict',
  compareTitle: '3. Compare a later start',
  compareBody: 'Try starting B two seconds later. Only its session timing changes; the source route stays intact.',
  compare: 'Start B two seconds later',
  resultTitle: '4. Check the changed plan',
  resultBody: 'All three robots are visible, and the current check finds no collisions or out-of-bounds paths. Replay to see the different timing.',
  changedBody: 'The current plan still needs checking. Keep all three robots visible and inspect the checks panel, or restart the exercise.',
  replay: 'Replay the changed plan',
  restart: 'Restart this exercise',
  closeLesson: 'Hide the guide',
  exitLesson: 'End practice',
  showLesson: 'Show the guide',
} as const;

export type EngagementKey = keyof typeof engagementEnglish;
export type EngagementDictionary = Record<EngagementKey, string>;
const zh: EngagementDictionary = {
  star: '在 GitHub 上点 Star', support: 'PathBlender 对你有帮助吗？',
  supportBody: '在 GitHub 上点一颗 Star，支持项目，也方便以后找到它。', dismiss: '关闭此邀请',
  firstCheck: '试做第一次路径检查', firstCheckHint: '无需准备文件。用三条自制教学路线发现一次冲突，再比较不同的出发时间。',
  lessonTitle: '第一次路径检查', lessonNote: '练习场上的自制教学路线，不是真实队伍或比赛数据。',
  playTitle: '1. 同时回放三条路线', playBody: '每台机器人沿自己的路线、按同一时钟运动。观察 A 和 B 同时到达交叉处。', play: '播放路线',
  findTitle: '2. 定位冲突', findBody: '跳转到检测到的重叠时刻。检查面板和场地显示的是同一检查结果。', find: '查看冲突',
  compareTitle: '3. 比较稍晚出发的方案', compareBody: '让 B 晚两秒出发。只改变会话中的时间安排，原始路线保持不变。', compare: '让 B 晚两秒出发',
  resultTitle: '4. 检查调整后的方案', resultBody: '三台机器人都可见，当前检查未发现碰撞或越界。再次回放，观察时间安排的变化。',
  changedBody: '当前方案仍需核查。保持三台机器人可见并查看检查面板，或重新开始练习。',
  replay: '回放调整后的方案', restart: '重新开始练习', closeLesson: '收起引导', exitLesson: '结束练习', showLesson: '展开引导',
};
const zhTw: EngagementDictionary = {
  star: '在 GitHub 上點 Star', support: 'PathBlender 對你有幫助嗎？',
  supportBody: '在 GitHub 上點一顆 Star，支持專案，也方便以後找到它。', dismiss: '關閉此邀請',
  firstCheck: '試做第一次路徑檢查', firstCheckHint: '無需準備檔案。用三條自製教學路徑發現一次衝突，再比較不同的出發時間。',
  lessonTitle: '第一次路徑檢查', lessonNote: '練習場上的自製教學路徑，不是真實隊伍或比賽資料。',
  playTitle: '1. 同時播放三條路徑', playBody: '每台機器人沿自己的路徑、按同一時鐘運動。觀察 A 和 B 同時到達交叉處。', play: '播放路徑',
  findTitle: '2. 定位衝突', findBody: '跳轉到偵測到的重疊時刻。檢查面板和場地顯示的是同一檢查結果。', find: '查看衝突',
  compareTitle: '3. 比較稍晚出發的方案', compareBody: '讓 B 晚兩秒出發。只改變工作階段中的時間安排，原始路徑保持不變。', compare: '讓 B 晚兩秒出發',
  resultTitle: '4. 檢查調整後的方案', resultBody: '三台機器人都可見，目前檢查未發現碰撞或越界。再次播放，觀察時間安排的變化。',
  changedBody: '目前方案仍需核查。保持三台機器人可見並查看檢查面板，或重新開始練習。',
  replay: '播放調整後的方案', restart: '重新開始練習', closeLesson: '收起引導', exitLesson: '結束練習', showLesson: '展開引導',
};
const zhHk: EngagementDictionary = { ...zhTw,
  supportBody: '在 GitHub 上點一顆 Star，支持專案，也方便以後找到它。',
  findBody: '跳轉到檢測到的重疊時刻。檢查面板和場地顯示的是同一檢查結果。',
  compareBody: '讓 B 晚兩秒出發。只改變會話中的時間安排，原始路徑保持不變。',
};
export const engagementTranslations: Partial<Record<Lang, EngagementDictionary>> = {
  en: engagementEnglish, 'en-GB': engagementEnglish, zh, 'zh-tw': zhTw, 'zh-hk': zhHk, 'zh-mo': zhHk,
};
export const engagementText = (lang: Lang, key: EngagementKey): string =>
  (engagementTranslations[lang] ?? engagementEnglish)[key];
