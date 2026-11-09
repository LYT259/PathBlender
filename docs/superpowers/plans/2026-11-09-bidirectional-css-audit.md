# RTL/LTR CSS 逻辑属性双向审计实施计划

> **工作包**:红皮书 L407 第②条后半「CSS 逻辑属性审计」。RTL 基建（`html[dir='rtl']`、
> timeline/conflict-list/number-input 钉 LTR）已随希伯来语落地（PR #115 系）；本包只做审计与必要修复。
> Branch `fix/bidirectional-css-audit`，基于 `origin/beta@09c6d7d2`。不 push、不建 PR、不碰 beta/stable。

**Goal**: 完整枚举产品 CSS 的物理方向属性，逐项判定「随阅读方向翻转」或「物理语义不翻转」；
修正确实导致 LTR/RTL 错误的规则；用静态契约测试把物理例外固化为有限、可审查的清单；
用真实浏览器对 en(ltr)/he(rtl) 双方向做 computed-style/布局断言与截图。LTR 渲染逐像素不变
（所有转换在 LTR 下恒等），不调整任何未经批准的视觉数值。

**Tech stack**: 既有工具链——Vitest（契约测试，读 CSS 源）、playwright-core + `vite preview`
（真浏览器验收脚本，仿 `scripts/lang-acceptance.mjs`）。不新增依赖
（`@csstools/css-tokenizer` 已在 devDeps 但当前无人用；本计划用行级解析即可，不动它）。

## 基线审计结论（2026-11-09 枚举）

19 个产品 CSS 文件（2434 行）：152 条物理方向声明 + 9 条左右不对称四值简写；已有 24 条逻辑属性。
三类处置：

### A. 判定为「阅读方向应翻转」→ 改逻辑属性（LTR 下恒等，~40 处）

| 文件 | 规则 | 改法 |
|---|---|---|
| app.css | `.import-banner ul` padding-left:18 | padding-inline-start |
| app.css | `.robot-list` border-right | border-inline-end（RTL 下 grid 把库放右侧，分隔线须面向内容） |
| app.css | `.conflict-panel` border-left | border-inline-start |
| app.css | `.tolerance-badge` margin-left:6 | margin-inline-start |
| app.css | `.cf-panel` left:280 | inset-inline-start:280（固定面板避让左侧库，RTL 库在右） |
| workspace.css | `.workspace-inspector` border-left | border-inline-start |
| workspace.css | `.workspace-inspector .conflict-panel` border-left:0 | border-inline-start:0（保持重置配对） |
| workspace.css | ≤900px `.workspace-inspector` inset:0 0 0 auto | inset:0 + inset-inline-start:auto；阴影 `:dir(rtl)` 镜像为 +8px |
| workspace.css | ≤640px `.workspace-body>.robot-library` inset:0 auto 0 0 | inset:0 + inset-inline-end:auto；阴影 `:dir(rtl)` 镜像为 -8px |
| MenuBar.css | `.menu-panel` left:0 | inset-inline-start:0（RTL 右缘对齐，修复右溢出） |
| MenuBar.css | `.menu-sub-panel` left:calc(100%-2px) | inset-inline-start:calc(100%-2px)（RTL 向左弹出） |
| MenuBar.css | `.menu-item` text-align:left | start |
| MenuBar.css | `.menu-sub-arrow`（`›`） | 新增 `:dir(rtl){transform:scaleX(-1)}`（RTL 指左） |
| PreferencesPanel.css | `.preferences-panel` text-align:left | start |
| PreferencesPanel.css | `.preferences-sidebar` border-right | border-inline-end（RTL 侧栏在右，分隔线在其左） |
| PreferencesPanel.css | `.preferences-nav button` text-align:left | start |
| PreferencesPanel.css | `.preferences-save-hint` margin-left:auto | margin-inline-start:auto |
| PreferencesPanel.css | `.preferences-checkbox input::after` left:2 / checked left:13 | inset-inline-start（开关旋钮随方向镜像，平台惯例） |
| RobotList.css | `.robot-library-select` text-align:left; padding 简写 | start；padding-block/padding-inline 拆分（值不变） |
| RobotList.css | `.robot-inspector-warnings` padding-left:15 | padding-inline-start |
| RobotList.css | `.robot-team-editor` padding 简写 | 拆分逻辑（值不变） |
| RobotList.css | `.robot-identity-cell>.robot-library-meta` margin 简写 | margin-block + margin-inline-start:26 |
| RobotList.css | `.robot-settings-upload` 两条 margin 简写 | 拆分逻辑（值不变） |
| RobotList.css | `.robot-arrange-button` margin 简写（已被后规则覆盖） | 拆分逻辑（防回退陷阱） |
| RobotList.css | `.robot-library .robot-library-row` padding 简写与 padding-inline 并存 | 合并为 padding-block + padding-inline |
| OnboardingTasks.css | `.tour-progress` margin-left:auto | margin-inline-start:auto |
| UsageTip.css | `.example-notice .btn` margin-left:auto | margin-inline-start:auto |
| GuideDialog.css | `.guide-topics` padding-right:4 | padding-inline-end（滚动条槽随方向换边） |
| GuideDialog.css | `.guide-topic ul` padding-left:18 | padding-inline-start |
| WpilogImportDialog.css | `.wpilog-queue` padding-right:4 | padding-inline-end（同滚动条槽） |
| WpilogImportDialog.css | `.wpilog-file` text-align:left | start |
| WpilogImportDialog.css | `.wpilog-logwarnings ul` padding-left:18 | padding-inline-start |

### B. 判定为「物理语义，不应翻转」→ 保留 + 入例外清单（契约测试固化）

1. **时间轴全家**（Timeline.css；SequenceTimelineComposer 的 axis/track/lane/clip/gap/auto-end/wait；
   app.css timeline-track/tick/band 段）：容器钉 `direction:ltr`（`.timeline-workspace` / `dir="ltr"`），
   时间是物理轴。
2. **钉 LTR 数据容器内的行**：`.conflict-jump`（含 `.is-tolerance` 边色、workspace.css:118 border-left-width）
   在 `.conflict-list` 内，钉 LTR。
3. **窗口物理件**：`body.desktop.desktop-macos .toolbar/.workspace-toolbar` padding-left——macOS
   红绿灯永远物理左上。
4. **画布覆盖物**：`.viewcube{right:10px}`、`.robot-label-3d{left:0}`、`.team-order-ghost{left:0}`、
   TSX 内联 `left:` 跟随指针的 clip-menu/drag-badge——画布/指针物理坐标。
5. **硬件/示意图**：PreferencesPanel `.mouse-callout-*`（鼠标左中右键是物理键位）、
   `.preferences-theme-preview i/b`（主题缩略图是产品示意图）。
6. **已记录的设计决定**：`.language-picker-mark` text-align:right + `:dir(rtl)` 网格重排——
   「文字标识保持物理右侧」是 LanguagePicker.css 内注释明示的决定。
7. **ltr 钉死输入内**：`.robot-inspector input` text-align:right——`input[type=number]` 全局钉 LTR，
   end==right 恒成立。
8. **方向中性变换**：`.tour-toggle svg` rotate(±90deg)（左箭头转成上/下，纵向箭头无方向）、
   translateY 居中、`left:50%`+translate(-50%) 对称居中、`left:0;right:0` 对称铺满（toast 等）。
9. **`direction`/`unicode-bidi` 三处钉 LTR 与 isolate**：既有 RTL 基建本身。

### C. 死样式（无任何 TSX 引用，已逐一 rg 验证）——不修，只记录

`.ai-*` 全段、`.switch/.sw-track`（app.css 与 workspace.css 两份）、`.chev`、`.editor-bar/.editor-title`、
`.waypoint-panel`、`.wp-*`（head/toggle/idx/coords/body/ctl/heading）、`.band-*/.per-robot-bands`、
`.canvas-tools`、`.geom-inputs/.geom-note`、`.bounds-title`、`.auto-resolve`。
删除属独立清理，不在本包（避免与方向审计混在一个 diff）；例外清单按选择器前缀收纳它们。

## 测试（先红后绿）

1. **契约测试** `packages/web/test/bidirectional-css.test.ts`（Vitest，读 CSS 源）：
   - 枚举全部物理方向声明（含不对称四值简写）；
   - 断言每一条都命中 A（已转换，不再物理）或 B/C 例外清单（`file|选择器前缀|属性` + 理由）；
   - 正向断言：A 表代表性规则已用逻辑属性（inspector/menu-panel/sidebar/switch 旋钮等）；
   - 例外清单卫生：每条例外必须实际命中至少一条声明（防陈旧条目，仿 i18n KEEP_VERBATIM 纪律）。
2. **真浏览器验收** `scripts/bidi-acceptance.mjs`（node + playwright-core，`vite preview` :4173），
   en/he 双轮：
   - `html[dir]` 正确；欢迎屏与示例工作区均无横向溢出（scrollWidth-clientWidth ≤1）；
   - 菜单：首/末菜单、View 子菜单弹出后 bbox 都在视口内；RTL 下菜单项文本 start 对齐；
   - 面板几何：RTL 下库在右、inspector 在左（bbox 比较）；inspector 分隔线 computed
     border-right-width=1 / border-left-width=0（LTR 相反）；
   - 开关旋钮（偏好设置）inset-inline-start 2→13 随 checked；RTL 镜像；
   - 时间轴在 RTL 下 computed direction 仍 ltr；语言选择器 mark 仍物理右（钉死设计决定）；
   - Tab 首焦点落在菜单栏第一项且 focus ring 存在（两方向一致）；
   - 截图存 `<worktree>/.bidi-acceptance/shots/`（不入库）。
3. **基线先行**：先在未修复树上跑验收脚本记录 FAIL 清单（菜单右溢出等），修复后全绿。

## 收尾

- `npm run typecheck` + `npm test -w packages/web`（全量）全绿；构建产物 `sw.js` 噪音还原。
- 提交（英文 conventional commit）：计划 → 契约测试+CSS 修复 → 验收脚本。不 push。
- 报告：真实 HEAD、测试证据、截图路径、未验项（桌面壳内 RTL、真 Hebrew 母语者走查、43 语言全量只跑
  en/he 深检 + lang-acceptance 既有全量）。
