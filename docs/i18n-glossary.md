# i18n 术语契约（对照表 + keep-verbatim 白名单）

> Source: PathBlender Red Book (formerly Product Plan), §7.2 v1.20; GHPaths report v1.31, reverse-sync item ④. This table keeps terminology consistent across the twenty-four dictionaries.
> 依据：《PathBlender_红皮书》（原《PathBlender_产品计划书》）§7.2 v1.20（GHPaths 报告 v1.31 反向同步第 ④ 条）——二十四份字典已各自取舍，没有一张表就会各说各话。
> **规矩：新术语先补本表，再往字典里写。** 表里没定的词不要由某一份字典单独决定。

字典位置：`packages/web/src/i18n/{en,ar,cs,de,es,fil,fr,he,hi,id,it,ja,ko,mr,ms,nl,pl,pt-br,ta,tr,vi,zh,zh-hk,zh-tw}.ts`（`en.ts` 是键源与源文案；`zh-hk.ts` 是覆盖表不是完整字典——见第 6 节）。第三批（de/it/ar/hi/mr/ms/ta/fil/vi/id，10 种）2026-10-04 落地；第四批待评估。
完整性/占位符/漏翻三道门禁在 `packages/web/test/i18n.test.ts`。

## 1. 核心术语对照

| 概念 | en | zh | zh-tw | es | fr | tr | pt-BR | he | nl | pl | ja | ko | cs | 备注 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| path（本工具的通用词，含 .path 文件） | path | 路径 | 路徑 | ruta | parcours | yol | trajetória | מסלול | route | trasa | パス | 경로 | trasa | fr 不用 trajectoire 承担此义，见下一行；pt-BR 第一批定 trajetória 同担 path/trajectory；nl/pl/cs 与 route 同词 |
| trajectory（Choreo 生成的那层数据） | trajectory | 轨迹 | 軌跡 | trayectoria | trajectoire | yörünge | trajetória | מסלול מחושב | trajectorie | trajektoria | 軌跡 | 궤적 | trajektorie | 只在讲 Choreo/生成结果时用 |
| route（路线库条目） | route | 路线 | 路線 | ruta | parcours | yol | rota | מסלול | route | trasa | ルート | 경로 | trasa | `library.*` 与 path 同族，不另造词 |
| autonomous（auto） | auto | 自动 | 自動 | autónomo | autonome | otonom | auto | אוטונומי | autonome route | auto | オート | 오토 | autonomní program | `library.hint` 里指一套自动路线；nl 避用 auto（=汽车） |
| alliance | alliance | 联盟 | 聯盟 | alianza | alliance | ittifak | aliança | ברית | alliantie | sojusz | アライアンス | 얼라이언스 | aliance | |
| bumper | bumper | 保险杠 | 保險槓／保險桿 | parachoques | pare-chocs | tampon | para-choque | פגוש | bumper | zderzak | バンパー | 범퍼 | nárazník | zh-tw 两写法并存，新文案统一 **保險槓**；nl 借词同英文 |
| waypoint | waypoint | 路点 | 路點 | punto de paso | point de passage | yol noktası | ponto de passagem | נקודת ציון | routepunt | punkt pośredni | ウェイポイント | 웨이포인트 | trasový bod | |
| heading | heading | 朝向 | 朝向 | rumbo | cap | yön | orientação | כיוון | richting | kierunek | 方位 | 헤딩 | orientace | 机器人机头朝向，不是“标题” |
| start delay | delay | 起步延迟 | 起步延遲 | retardo | délai | gecikme | atraso | השהיה | vertraging | opóźnienie | 遅延 | 지연 | zpoždění | 单位一律 (s) |
| field（比赛场地） | field | 场地 | 場地 | campo | terrain | saha | campo | מגרש | veld | boisko | フィールド | 필드 | hřiště | |
| out of bounds | out of bounds | 越界 | 越界 | fuera de límites | hors limites | saha dışı | fora dos limites | מחוץ לגבולות | buiten de veldgrenzen | poza boiskiem | フィールド外 | 필드 이탈 | mimo hřiště | |
| collision | collision | 碰撞 | 碰撞 | colisión | collision | çarpışma | colisão | התנגשות | botsing | kolizja | 衝突 | 충돌 | kolize | |
| conflict（联盟协调语义） | conflict | 冲突 | 衝突 | conflicto | conflit | çakışma | conflito | התנגשויות | conflict | konflikt | 競合 | 간섭 | konflikt | 与 collision 区分：conflict=需要调解的时间冲突；he 两词同根（第一批已定）；ko 用 간섭（干涉）保住区分 |
| checks | checks | 检查 | 檢查 | comprobaciones | vérifications | denetimler | verificações | בדיקות | controles | sprawdzenia | チェック | 검사 | kontroly | 面板名 |
| playback | playback | 回放 | 回放 | reproducción | lecture | oynatma | reprodução | ניגון | afspelen | odtwarzanie | 再生 | 재생 | přehrávání | fr 按钮“播放”= Lecture，面板名同为 Lecture |
| timeline | timeline | 时间轴 | 時間軸 | línea de tiempo | frise | zaman çizelgesi | linha do tempo | ציר הזמן | tijdlijn | oś czasu | タイムライン | 타임라인 | časová osa | |
| session | session | 会话 | 會話 | sesión | session | oturum | sessão | הפעלה | sessie | sesja | セッション | 세션 | relace | |
| folder | folder | 文件夹 | 資料夾 | carpeta | dossier | klasör | pasta | תיקייה | map | folder | フォルダ | 폴더 | složka | zh-tw 用 資料夾（不用 文件夾） || profile（机器人参数文件） | profile | 参数 | 參數 | perfil | profil | profil | perfil | פרופיל | profiel | profil | プロファイル | 프로필 | profil | 完整说法：zh「参数文件」/ zh-tw「參數檔」/ es「archivo de ajustes」/ fr「fichier de réglages」/ tr「ayar dosyası」 |
| robot settings | robot settings | 机器人参数 | 機器人參數 | ajustes de robot | réglages de robots | robot ayarları | configurações do robô | הגדרות רובוט | robotinstellingen | ustawienia robota | 設定ファイル | 로봇 설정 파일 | nastavení robota | |
| season | game season | 比赛赛季 | 比賽賽季 | temporada | saison de jeu | oyun sezonu | temporada | עונת המשחק | wedstrijdseizoen | sezon rozgrywek | 競技シーズン | 게임 시즌 | sezóna | |
| undo / redo | undo / redo | 撤销 / 重做 | 復原 / 重做 | deshacer / rehacer | annuler / rétablir | geri al / yinele | desfazer / refazer | ביטול / ביצוע מחדש | ongedaan maken / opnieuw | cofnij / ponów | 取り消し / やり直し | 실행 취소 / 다시 실행 | zpět / znovu | fr 的 Annuler 同时承担“撤销”和对话框“取消”，靠上下文区分；zh-tw 用 復原（不用 撤銷）。（功能已删，行保留备复用） |
| preferences | preferences | 偏好设置 | 偏好設定 | preferencias | préférences | tercihler | preferências | העדפות | voorkeuren | preferencje | 環境設定 | 환경설정 | předvolby | 桌面原生菜单与网页弹窗同源 |
| prefs（工具栏短标签） | prefs | 设置 | 設定 | ajustes | réglages | ayarlar | preferências | העדפות | voorkeuren | opcje | 設定 | 설정 | předvolby | 与上一行区分：竖排按钮位只放两字/单词 |

## 2. 不翻的东西（keep-verbatim）

`i18n.test.ts` 的 `KEEP_VERBATIM` 是唯一白名单，测试会双向检查：既拦"该翻没翻"，也拦"白名单里已经没人用了"。分四类：

1. **品牌与格式名**：`PathBlender`、`AprilTag`、`Choreo`、`PathPlanner`、`OpenAI`、`Anthropic`、`DeepSeek`、扩展名 `.traj / .path / .auto / .ghostauto / .chor`。
2. **符号与单位**：`m`、`s`、`px / m`、`{n}×`、`t = {t} s`、`{a} × {b}`。
3. **视图立方体字母 `vc.*`**：拉丁语的单字母缩写会撞车（es Inferior 与 Izquierda 同为 I，fr Bas 与 Droit 同为 D，tr Alt 与 Arka 同为 A），所以**拉丁文字语言一律沿用英文源字母** T/B/F/K/L/R（含第二批 nl/pl/cs）；**CJK 语言用单字表意**：zh / zh-tw 用 上/下/前/后（後）/左/右，第二批 **ja 用 上/下/前/後/左/右、ko 用 상/하/전/후/좌/우**——表意文字无缩写撞车问题。
4. **发给服务端的字面量**：`reasoning_effort` 的 `off,low,high,max`、`thinking:{type:disabled}`、协议路径 `/chat/completions`、`/messages`，以及 Beta / Stable 频道名。

## 3. 数据与文案的分界

- **文案翻**：界面标签、提示、错误说明。
- **数据不翻、不改写**：用户导入的文件名、路线名、机器人名、队号，以及写进导出文件（`.pb` 会话、GIF 与方案包文件名）的内容——任何语言下都保持原文。
- 内置场地/赛季名属**文案**，需要本地化时按本节补表（当前实现仍显示官方英文名，未本地化——见计划书 §7.2 v1.20 第 ⑤ 条，待办）。

## 4. 数字与排版

- **小数点一律 `.`**，不按语言改成 `,`（`timeline.stepBack` 等文案里的 `0.5` 与代码 `toFixed` 产出的数值必须同形，混排会让用户以为是两个不同的数）。
- 千分位、百分号目前不出现；将来出现时同样以代码产出形态为准。
- fr 按法语习惯在 `:` `;` 前留空格；es/tr 不加。
- 省略号统一用 `…`（U+2026），不用三个句点。
- 插值保持朴素 `{name}` 替换，不做复数形态（计划书 §7.2 v1.19 已判定西/法/土复数简单可接受）。

## 6. 港台分工（`zh-hk` 是覆盖表，不是第二份字典）

`packages/web/src/i18n/zh-hk.ts` 只导出 `zhHkOverrides`，运行时 `{ ...zhTw, ...zhHkOverrides }` 合成。**规矩**：两岸共读同一写法的键一律不开覆盖——两份完整繁體必然随文案迭代互相漂移，而本工具的文案面差异本来就小。`i18n.test.ts` 的 `inherits everything except its own rows` 把"两边只允许在这些键上不同"钉成测试，加一个没有理由的覆盖键会直接红。

当前覆盖（7 键）与理由：

| 键 | zh-tw | zh-hk | 为什么 |
|---|---|---|---|
| `robots.bumper`、`robots.profileEntry`、`customField.margin`、`customField.length`、`customField.width` | 公尺 | **米** | 米是国际单位名，港澳教科书与政府文件都用；`公尺` 是台湾说法（生成器 `scripts/gen-zh-hant.mjs` 的 TERMS 专门把 米→公尺） |
| `updates.failed` | 網路 | **網絡** | TERMS 里 `網絡→網路` 就是台式改写，HK 保留 網絡 |
| `robots.selectPrompt` | 詳細資訊 | **詳細資料** | HK 界面（Microsoft zh-HK）用 詳細資料，TW 用 詳細資訊 |

**澳门读 `zh-hk`**，不单开 locale（计划书 §7.2 v1.22「区域就近回退」/ v1.23 判定）：`langFromTags()` 把 `zh-HK`/`zh-MO`/`zh-Hant-HK`/`zh-Hant-MO` 都指到这里；`zh-Hans-HK`/`zh-Hans-MO` 仍走简体（Hans 压过地区——HK、澳门的 Chrome 常报 `zh-Hans-HK`，不写这条会把简体用户丢進繁體）。裸 `zh-Hant`（无地区）给台湾那份。

**门禁**（计划书 §7.2 v1.24 第 ② 条）：只比"差异条数 > 0"不够——有人删掉几条覆盖，那条断言还是绿的。所以 `i18n.test.ts` 另钉三条**具名分歧**（公尺↔米、網路↔網絡、詳細資訊↔詳細資料）+ 覆盖条数下限 5，并保留"两边只允许在覆盖表那几条上不同"。**加覆盖键时同步补一条具名断言。**

**为什么不做成"共享层 + 两个分区层"**（GHPaths 的三层结构）：本项目 `zh-tw.ts` 是手写包、不是 OpenCC 输出，台港一致的书面词本来就直接写在这份底里，分区差异只剩 7 条，再拆一层共享包只多一次跳转；等覆盖表长到几十条（接近 GHPaths 的 32/412）再考虑改结构。附带印证：GHPaths 实测 `cn→hk` 字形转换**只给字形不给词**（照样输出 默認/導出/文件/在線），这正说明本项目 `scripts/gen-zh-hant.mjs` 为什么必须带一张 TERMS 表（默認→預設、導入→匯入、文件→檔案……）——同一形态，我们早已如此。

**已核过但故意不动的候选差异**（缺可靠依据，等港方使用者点名再补）：

- `保險桿` / `保險槓`：两份现都用 `保險桿`。原 `zh-tw.ts` 里 `robots.bumper` 是 `保險槓`、其余是 `保險桿`——那是 OpenCC 把 `杠` 转成 `槓` 绕过 TERMS 规则留下的残迹，2026-09-24 已统一为 `保險桿` 并给 TERMS 补了 `保險槓→保險桿`；HK 汽车用语是否更偏 `保險槓` 未核，先不开覆盖。
- `資料夾` / `檔案夾`：Microsoft zh-HK 用 資料夾、Apple zh-HK 用 檔案夾，两家不一致，跟随现值。
- `布局` / `佈局`：TERMS 明确选了 `布局`（注释记为台惯用），这条对港台是否一致存疑，但它是既有决定，本轮不擅自翻案。

## 7. 语言列表

注册表在 `packages/web/src/i18n/index.tsx` 的 `LANG_META`：每语言一行 `{ englishName（排序键，纯 ASCII）, endonym（显示名） }`。
显示用自称，**排序用英文键**，「跟随系统」钉顶不参与排序；不用 `Intl.Collator`（V8 与 WebKit 对 CJK 的排序表版本不一致，会让开发服务器与桌面壳排出不同顺序）。
新增语言 = 加一行 `LANG_META` + 一份 `Record<MessageKey, string>` 字典（同区域变体走第 6 节的覆盖表，不复制整份）+ `langFromTags()` 一条分支 + 桌面 `lib.rs` 一张菜单表（`i18n.test.ts` 会逐个断言，漏菜单表就红）。
当前顺序（十五个界面选项下恒定）：跟随系统 · 简体中文 · 繁體中文（中國香港） · 繁體中文（中國台灣） · Čeština · Nederlands · English · Français · עברית · 日本語 · 한국어 · Polski · Português (Brasil) · Español · Türkçe。
