# i18n 术语契约（对照表 + keep-verbatim 白名单）

> 依据：《PathBlender_产品计划书》§7.2 v1.20（GHPaths 报告 v1.31 反向同步第 ④ 条）——六份字典已各自取舍，没有一张表就会各说各话。
> **规矩：新术语先补本表，再往字典里写。** 表里没定的词不要由某一份字典单独决定。

字典位置：`packages/web/src/i18n/{en,zh,zh-tw,es,fr,tr}.ts`（`en.ts` 是键源与源文案）。
完整性/占位符/漏翻三道门禁在 `packages/web/test/i18n.test.ts`。

## 1. 核心术语对照

| 概念 | en | zh | zh-tw | es | fr | tr | 备注 |
|---|---|---|---|---|---|---|---|
| path（本工具的通用词，含 .path 文件） | path | 路径 | 路徑 | ruta | parcours | yol | fr 不用 trajectoire 承担此义，见下一行 |
| trajectory（Choreo 生成的那层数据） | trajectory | 轨迹 | 軌跡 | trayectoria | trajectoire | yörünge | 只在讲 Choreo/生成结果时用 |
| route（路线库条目） | route | 路线 | 路線 | ruta | parcours | yol | `library.*` 与 path 同族，不另造词 |
| autonomous（auto） | auto | 自动 | 自動 | autónomo | autonome | otonom | `library.hint` 里指一套自动路线 |
| alliance | alliance | 联盟 | 聯盟 | alianza | alliance | ittifak | |
| bumper | bumper | 保险杠 | 保險槓／保險桿 | parachoques | pare-chocs | tampon | zh-tw 两写法并存，新文案统一 **保險槓** |
| waypoint | waypoint | 路点 | 路點 | punto de paso | point de passage | yol noktası | |
| heading | heading | 朝向 | 朝向 | rumbo | cap | yön | 机器人机头朝向，不是"标题" |
| start delay | delay | 起步延迟 | 起步延遲 | retardo | délai | gecikme | 单位一律 (s) |
| field（比赛场地） | field | 场地 | 場地 | campo | terrain | saha | |
| out of bounds | out of bounds | 越界 | 越界 | fuera de límites | hors limites | saha dışı | |
| collision | collision | 碰撞 | 碰撞 | colisión | collision | çarpışma | |
| conflict（联盟协调语义） | conflict | 冲突 | 衝突 | conflicto | conflit | çakışma | 与 collision 区分：conflict=需要调解的时间冲突 |
| checks | checks | 检查 | 檢查 | comprobaciones | vérifications | denetimler | 面板名 |
| playback | playback | 回放 | 回放 | reproducción | lecture | oynatma | fr 按钮"播放"= Lecture，面板名同为 Lecture |
| timeline | timeline | 时间轴 | 時間軸 | línea de tiempo | frise | zaman çizelgesi | |
| session | session | 会话 | 會話 | sesión | session | oturum | |
| folder | folder | 文件夹 | 資料夾 | carpeta | dossier | klasör | zh-tw 用 資料夾（不用 文件夾） |
| profile（机器人参数文件） | profile | 参数 | 參數 | perfil | profil | profil | 完整说法：zh「参数文件」/ zh-tw「參數檔」/ es「archivo de ajustes」/ fr「fichier de réglages」/ tr「ayar dosyası」 |
| robot settings | robot settings | 机器人参数 | 機器人參數 | ajustes de robot | réglages de robots | robot ayarları | |
| season | game season | 比赛赛季 | 比賽賽季 | temporada | saison de jeu | oyun sezonu | |
| undo / redo | undo / redo | 撤销 / 重做 | 復原 / 重做 | deshacer / rehacer | annuler / rétablir | geri al / yinele | fr 的 Annuler 同时承担"撤销"和对话框"取消"，靠上下文区分；zh-tw 用 復原（不用 撤銷） |
| preferences | preferences | 偏好设置 | 偏好設定 | preferencias | préférences | tercihler | 桌面原生菜单与网页弹窗同源 |
| prefs（工具栏短标签） | prefs | 设置 | 設定 | ajustes | réglages | ayarlar | 与上一行区分：竖排按钮位只放两字/单词 |
| share link | share link | 分享链接 | 分享連結 | enlace para compartir | lien de partage | paylaşım bağlantısı | |

## 2. 不翻的东西（keep-verbatim）

`i18n.test.ts` 的 `KEEP_VERBATIM` 是唯一白名单，测试会双向检查：既拦"该翻没翻"，也拦"白名单里已经没人用了"。分四类：

1. **品牌与格式名**：`PathBlender`、`AprilTag`、`Choreo`、`PathPlanner`、`OpenAI`、`Anthropic`、`DeepSeek`、扩展名 `.traj / .path / .auto / .ghostauto / .chor`。
2. **符号与单位**：`m`、`s`、`px / m`、`{n}×`、`t = {t} s`、`{a} × {b}`。
3. **视图立方体字母 `vc.*`**：拉丁语的单字母缩写会撞车（es Inferior 与 Izquierda 同为 I，fr Bas 与 Droit 同为 D，tr Alt 与 Arka 同为 A），所以**拉丁语系一律沿用英文源字母** T/B/F/K/L/R，只有 zh / zh-tw 用单字（上/下/前/后/左/右）。
4. **发给服务端的字面量**：`reasoning_effort` 的 `off,low,high,max`、`thinking:{type:disabled}`、协议路径 `/chat/completions`、`/messages`，以及 Beta / Stable 频道名。

## 3. 数据与文案的分界

- **文案翻**：界面标签、提示、错误说明。
- **数据不翻、不改写**：用户导入的文件名、路线名、机器人名、队号，以及写进导出文件（`.ghpb.json`、分享链接、PNG 文件名）的内容——任何语言下都保持原文。
- 内置场地/赛季名属**文案**，需要本地化时按本节补表（当前实现仍显示官方英文名，未本地化——见计划书 §7.2 v1.20 第 ⑤ 条，待办）。

## 4. 数字与排版

- **小数点一律 `.`**，不按语言改成 `,`（`timeline.stepBack` 等文案里的 `0.5` 与代码 `toFixed` 产出的数值必须同形，混排会让用户以为是两个不同的数）。
- 千分位、百分号目前不出现；将来出现时同样以代码产出形态为准。
- fr 按法语习惯在 `:` `;` 前留空格；es/tr 不加。
- 省略号统一用 `…`（U+2026），不用三个句点。
- 插值保持朴素 `{name}` 替换，不做复数形态（计划书 §7.2 v1.19 已判定西/法/土复数简单可接受）。

## 5. 语言列表

注册表在 `packages/web/src/i18n/index.tsx` 的 `LANG_META`：每语言一行 `{ englishName（排序键，纯 ASCII）, endonym（显示名） }`。
显示用自称，**排序用英文键**，「跟随系统」钉顶不参与排序；不用 `Intl.Collator`（V8 与 WebKit 对 CJK 的排序表版本不一致，会让开发服务器与桌面壳排出不同顺序）。
新增语言 = 加一行 `LANG_META` + 一份 `Record<MessageKey, string>` 字典 + `langFromTags()` 一条分支 + 桌面 `lib.rs` 一张菜单表（`i18n.test.ts` 会逐个断言）。
