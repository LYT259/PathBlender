# 发布 Checklist（每次公开发版前过一遍）

> 依据：可行性研究报告 §七（许可证）、AGENTS.md 红线 §2/§4。

## 构建与质量

- [ ] **推送前门禁**：`scripts/pre-push-check.mjs`（git pre-push 钩子自动执行；新克隆后先跑 `scripts/install-hooks.sh`）——待推提交命中敏感词（账号/工单/内网 IP/真实姓名/密钥材料）一律中止。2026-09-02 教训：一次性扫描会随日志追加失效，门禁是唯一可靠形态。

- [ ] `npm run typecheck` 零错误
- [ ] `npm run version:check`（六处版本号同源：root / core / web / desktop 的 package.json + tauri.conf.json + Cargo.toml；SW 缓存名取 root 值）
- [ ] `npm test` 全绿（core + web e2e）
- [ ] `npm run build` 成功；`packages/web/dist` 体积合理（gzip JS < 300 KB 量级）
- [ ] 本地 `npm run preview` 过一遍完整流程：四格式导入 → 回放 → 碰撞 → 延迟 what-if → 会话存/取 → Share link → PNG
- [ ] 桌面版：`npm run tauri build -w packages/desktop` 出 .app/.dmg；ad-hoc 签名保留（`codesign -dv` 核对）；启动冒烟（进程存活）
- [ ] **深浅色应用图标**：`packages/desktop/src-tauri/icons/AppIcon.icon`（日间红底 / 夜间黑底，第 14 轮定稿）经 `scripts/apply-dark-icon.sh` 注入 Assets.car + `CFBundleIconName`——本地 install-desktop.sh 与 release.yml 均已内置该步；抽查安装包 `Contents/Resources/Assets.car` 存在且 `assetutil --info` 含 `NSAppearanceNameDarkAqua`

## 许可证与素材

- [ ] NOTICE.md 归属清单与当前代码一致（PathPlanner / Choreo / 103 fork / WPILib）
- [ ] PathPlanner 轨迹生成移植说明保留在发布说明中（MIT 要求注明）
- [ ] **FIRST 场地素材条款复查**：核对当赛季（当前：2026 REBUILT）Game Manual / Official Field Drawings 的素材使用条款是否仍允许工具内置场地图片（AdvantageScope / PathPlanner 先例）；若收紧 → 启用用户自导入场地（报告 §八 降级方案）
  - **2026-08-26 复查记录**（依据：FIRST《Policy on the Use of FIRST® Trademarks and Copyrighted Materials》rev. 04/19/25，官方 PDF）：①注册 FIRST 队伍可非商业使用 FIRST 版权材料（**明文含 field designs**）开展 FIRST 项目相关活动，条件是展示 §IV 标准 disclaimer（已落入 NOTICE.md 与 README）；②**「copyrighted materials may never be used in any modified form」**——本项目场地图为裁剪/缩放标定版，处于该条款灰区；社区先例（AdvantageScope / PathPlanner 内置场地多年）支持继续内置，但若 FIRST 收紧执法：立即停发内置场地、启用用户自导入场地路径（已就位）；③FIRST 保留随时终止许可的权利——每次发版重新核对本条；④Logos（图形商标）不可用，仅 word marks 可提及。
- [ ] 场地图来源与标定记录与 `docs/formats/format-facts.md` 一致

## 隐私红线

- [ ] 无任何网络上传/遥测/统计脚本（`grep -rn "fetch\|XMLHttpRequest\|sendBeacon" packages/web/src` 人工复核）。**豁免清单（当前全部出站请求，逐处核对，2026-09-18）**：
  1. `packages/web/src/ai/client.ts` — 助手对话，仅向用户自填 base URL；`chatCompletion` 内硬拦 `enabled`（默认关闭，报告 v1.4 §6.4 / AGENTS.md 红线增补口径）；
  2. 同文件的 `fetchAvailableModels` — 模型列表 GET，设置面板里用户点击才发；
  3. `packages/web/src/components/AiSettingsSection.tsx` — 「测试连接」按钮，用户点一下才发一条不含会话数据的探测消息；
  4. `packages/web/src/ai/actions.ts` 的 `web_fetch` 动作 — 默认关闭、需设置里显式开启，仅 http(s) 公网、拒环回/私网。
  四者均为「用户自带 Key、主动发起」的调用，不带遥测、不落日志；除此之外出现任何新的 fetch 都要在本清单登记或删掉。AI 测试全部 mock 网络（见 `packages/web/test/ai-gate.test.tsx`）。
- [ ] README 隐私声明与实际行为一致（文件本地解析、Share link 仅含会话数据本身）

## GitHub（发布操作纪律）

- [ ] 推送 / PR / Pages 配置一律手动单发，不写自动重试循环；失败间隔 ≥60 秒再评估
- [ ] 网站上线（2026-09-09 起实际走 Cloudflare Pages 直传，报告 §7.1 的国内可达性方案即此渠道）：
      `npx wrangler pages deploy packages/web/dist --project-name=pathblender --branch=stable`；
      β 预览站另建 `pathblender-preview`（`--branch=beta` + `VITE_SITE_PREVIEW=1`）。
      构建期 `VITE_VIEWER_ONLY=1` 出只读查看器版（网站不放编辑/导出/AI，见 `packages/web/src/viewer.ts`）。
- [ ] GitHub Pages 工作流（`.github/workflows/deploy.yml`，push 到 stable 自动构建发布）仍在看管范围内，
      但与上面的 Cloudflare 直传是**两条独立渠道**——发版时确认两边同版本，避免用户从两个域名拿到不同构建
- [ ] 发布帖（Chief Delphi）中注明：PathPlanner 移植关系与 MIT 来源、Choreo 互操作定位、零上传承诺

## 更新签名密钥（tauri-plugin-updater，2026-08-30 集成）

- **密钥**：ed25519，`npx tauri signer generate` 生成，**无口令**。
  - 主副本：`~/.tauri/pathblender-updater.key`（权限 600，**空口令**——构建时需 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""`，install-desktop.sh 已带）；公钥 `.key.pub` 已写入 `tauri.conf.json`（可公开）。
  - 备份：离线/次要位置一份（本机 README 有恢复流程；保住 ~/.tauri 主副本即可）。
- **红线**：私钥绝不进 git 仓库/截图/日志/会话文件（同 AI 密钥纪律）。
- **本地构建**：`scripts/install-desktop.sh` 检测到 `~/.tauri` 密钥会自动导出 `TAURI_SIGNING_PRIVATE_KEY_PATH`，`createUpdaterArtifacts: true` 产出带签名的 `.app.tar.gz` + `.sig`。
- **发版时**：CI/手工用同一密钥签名上传 `.app.tar.gz` 与 `.sig` 到 GitHub Release，并生成 `latest.json`（版本号、平台产物 URL、签名）。endpoint 与 `tauri.conf.json` 保持一致（仓库名小写）：
  `https://github.com/LYT259/pathblender/releases/latest/download/latest.json`。
- **β 渠道**：同目录下的 `latest-beta.json` 由 `scripts/gen-latest-json.mjs` 随每次发版生成，stable 标签才另存一份为 `latest.json`（stable 抬高 beta）。应用内切换渠道走 `check_update`（Rust 侧决定读哪个 feed——插件 JS 的 `check()` 不接受 endpoint 覆盖）。
- **丢钥后果**：已分发用户永远收不到自动更新，只能手动重装——发版前确认两处副本齐全。
- **应用内入口**：菜单「检查更新…」→ 有更新则下载安装并重启；404/离线显示「尚未上线」toast——发布渠道上线后自动变为真实行为。

## 姊妹项目协调（发布时）

- GHPaths 侧 ADR-0013/0017/0018 以旧名「GHPathBlender core（MIT）」提及本项目——**不改其冻结的 ADR 正文**（两项目共守的 ADR 纪律）；名称（PathBlender）与许可证（Apache-2.0）的变迁在 GHPaths 实际集成 core 时由其自建新 ADR 记录，届时包名 `@pathblender/core`。
- `@pathblender/core` 首次 npm 发布后通知 GHPaths 侧锁定版本（其 ADR-0013 已把 semver 列为一等约束）。
