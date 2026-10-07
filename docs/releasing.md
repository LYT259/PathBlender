# 发布 Checklist（每次公开发版前过一遍）

> 依据：许可证（Apache-2.0 + 第三方 MIT/BSD 归属）与 GitHub 操作纪律。

## 构建与质量

- [ ] **推送前门禁**：`scripts/pre-push-check.mjs`（git pre-push 钩子自动执行；新克隆后先跑 `scripts/install-hooks.sh`）——待推提交命中敏感词（账号/工单/内网 IP/真实姓名/密钥材料）一律中止。2026-09-02 教训：一次性扫描会随日志追加失效，门禁是唯一可靠形态。

- [ ] `npm run typecheck` 零错误
- [ ] `npm run version:check`（七处版本号同源：root / core / web / desktop 的 package.json + tauri.conf.json + Cargo.toml + web `version-info.ts`；SW 缓存名取 root 值）
- [ ] 版本号生命周期（2026-10-01 定稿）：每次合 beta 经 `scripts/bump-version.mjs beta "说明"` 抬 `-beta.N`（附用户可懂说明，偏好设置「关于」展示/一键复制）；发版时 `bump-version.mjs release` 去后缀得正式号，再打 `v*` tag；**同一版本号永不对应两种内容**——有问题需重发时用新号，旧版安装包留在 Release 里可回退
- [ ] `npm test` 全绿（core + web e2e）
- [ ] `npm run build` 成功；`packages/web/dist` 体积合理（gzip JS < 300 KB 量级）
- [ ] 本地 `npm run build -w @pathblender/web && npm run preview -w @pathblender/web` 后跑两个真实浏览器走查脚本并全绿：`node scripts/browser-walkthrough.mjs`（鼠标 + 真实文件：四格式导入 → 回放 → 碰撞 → 路线库编排 → 40 语言与 RTL → 会话存/取 → GIF 与方案包导出 → 服务工作者 → 3D）、`node scripts/keyboard-walkthrough.mjs`（纯键盘走通同一成品）。界面一改，脚本同步改在同一个 PR 里，别留下指向已删控件的断言
- [ ] 网站门控自查 `scripts/viewer-check.mjs` 全绿（26 项）：`VITE_VIEWER_ONLY=1 npm run build -w @pathblender/web` + `node scripts/serve-dist.mjs <端口>`，再 `VIEWER_BASE=http://localhost:<端口>/ node scripts/viewer-check.mjs`；查的是发布出去的查看器构建留住导入/回放/检查/编排、首屏零跨域请求、首访跟随系统语言，且任何入口（含没有按钮的 Ctrl/Cmd+S 快捷键）都写不出文件。改动保存/导出类入口时必须重跑
- [ ] 桌面版：`npm run tauri build -w packages/desktop` 出 .app/.dmg；ad-hoc 签名保留（`codesign -dv` 核对）；启动冒烟（进程存活）
- [ ] **深浅色应用图标**：`packages/desktop/src-tauri/icons/AppIcon.icon`（日间红底 / 夜间黑底，第 14 轮定稿）经 `scripts/apply-dark-icon.sh` 注入 Assets.car + `CFBundleIconName`——本地 install-desktop.sh 与 release.yml 均已内置该步；抽查安装包 `Contents/Resources/Assets.car` 存在且 `assetutil --info` 含 `NSAppearanceNameDarkAqua`

## 许可证与素材

- [ ] NOTICE.md 归属清单与当前代码一致（PathPlanner / Choreo / 103 fork / WPILib）
- [ ] PathPlanner 轨迹生成移植说明保留在发布说明中（MIT 要求注明）
- [ ] **FIRST 场地素材条款复查**：核对当赛季（当前：2026 REBUILT）Game Manual / Official Field Drawings 的素材使用条款是否仍允许工具内置场地图片（AdvantageScope / PathPlanner 先例）；若收紧 → 停发内置场地、改走已就位的用户自导入场地路径
  - **2026-08-26 复查记录**（依据：FIRST《Policy on the Use of FIRST® Trademarks and Copyrighted Materials》rev. 04/19/25，官方 PDF）：①注册 FIRST 队伍可非商业使用 FIRST 版权材料（**明文含 field designs**）开展 FIRST 项目相关活动，条件是展示 §IV 标准 disclaimer（已落入 NOTICE.md 与 README）；②**「copyrighted materials may never be used in any modified form」**——本项目场地图为裁剪/缩放标定版，处于该条款灰区；社区先例（AdvantageScope / PathPlanner 内置场地多年）支持继续内置，但若 FIRST 收紧执法：立即停发内置场地、启用用户自导入场地路径（已就位）；③FIRST 保留随时终止许可的权利——每次发版重新核对本条；④Logos（图形商标）不可用，仅 word marks 可提及。
- [ ] 场地图来源与标定记录与 `docs/formats/format-facts.md` 一致

## 隐私红线

- [ ] 无任何网络上传/遥测/统计脚本（`grep -rn "fetch\|XMLHttpRequest\|sendBeacon" packages/web/src` 人工复核）。
      **豁免清单（当前全部出站请求，逐处核对）**：web 版零出站请求（2026-09-30 AI 模块整体删除后已无任何 fetch）；
      桌面版仅「检查更新」按用户点击访问 GitHub Releases（feed JSON + 更新包，见 src-tauri/src/lib.rs 的
      FEED_STABLE/FEED_BETA 白名单）——除此之外出现任何新的网络调用都要在本清单登记或删掉。
      **机制保证（2026-10-03 收紧）**：桌面版页面侧 CSP 为 `connect-src 'self'`——页面脚本发起的任何外发连接
      （fetch/XHR/WebSocket，http/https/ws 一律）都会被 WebView 直接拦截；「路径不出机」由机制兜底而非仅靠代码
      纪律。唯一出站通道 = Rust 原生 updater（tauri-plugin-updater 原生网络栈，不受页面 CSP 约束）。

- [ ] README 隐私声明与实际行为一致（文件本地解析）

## GitHub（发布操作纪律）

- [ ] 推送 / PR / Pages 配置一律手动单发，不写自动重试循环；失败间隔 ≥60 秒再评估
- [ ] 网站上线（2026-09-09 起实际走 Cloudflare Pages 直传；**2026-10-04 已定弃用、转公开后退役**；**2026-10-06 用户定稿：转公开前为试用演示恢复本渠道为常设——每次分支合并到 beta 后重部署 `pathblender.pages.dev`，直至转公开**）：
      `VITE_VIEWER_ONLY=1 npm run build -w packages/web` 然后
      `npx wrangler pages deploy packages/web/dist --project-name=pathblender --branch=stable`（本机直传，零 Actions 额度）；
      β 预览站 `pathblender-preview` 仍弃用不动（`--branch=beta` + `VITE_SITE_PREVIEW=1` 的旧条款仅存档；**2026-10-07 起 UI 侧的预览站交叉入口与横幅已随 `VITE_SITE_PREVIEW` 构建开关一并删除——网站本身即 beta 通道，构建不再区分站点 flavor**）。
      **部署后核对线上版本与树内一致**（回读 `https://pathblender.pages.dev/sw.js` 的缓存名 `pb-<版本>-<时间戳>`；2026-10-02 审计曾发现线上挂着转型前旧构建，此条为常规核对项）。
- [ ] GitHub Pages 工作流已于 2026-10-02 移除：私有 Free 仓库无法启用 Pages，deploy.yml 在每次 stable 推送上稳定失败（5/5）。**2026-10-04 用户定稿：弃 Cloudflare，转公开后全用 GitHub Pages——重建 deploy.yml 自动部署（viewer 构建），wrangler 直传条款届时退役**。**2026-10-06 用户定稿（取代「push stable 触发」）：转公开后每次分支合并到 beta 就重新部署 Pages——deploy.yml 届时按 push beta 触发重建**。
- [ ] **转公开日清单（用户决定 2026-10-02：仓库暂不转公开；转公开之后才有 Demo 网站；2026-10-05 增补 Windows 项）**——按序执行，防止 README 的站点链接先于 Demo 上线：
      ① 给 stable 打分支保护（禁强推 + 禁删除 + 含管理员；不开 status checks/PR 门，避免打断自动发版的直推）；
      ② **Windows 验证（2026-10-05 PR #198 落地，此前无法真机验证）**：手动 dispatch `.github/workflows/windows-smoke.yml`（公开仓标准 runner 免费），下载 artifact 截图人工核对——原生标题栏无红绿灯让位空隙、暗色渲染正常；然后打当期 `v*` tag，release.yml 的 build-windows 自动产出 NSIS 安装包，Release 资产含 `*-setup.exe`(+`.sig`)、更新器 feed 含 `windows-x86_64` 条目；
      ③ Demo 站（2026-10-04 起走 Pages）：重建 deploy.yml（**push beta 即自动部署——2026-10-06 用户定稿：每次分支合并到 beta 就重新部署**）+ `VITE_VIEWER_ONLY=1` viewer 构建，部署后核对线上版本串与树内一致（Cloudflare 渠道届时退役）；
      ④ 核对 README 三语的「获取方式」链接与真实可达状态一致（补充 Windows 下载说明）；更新 feed / Release 资产对未认证用户转可达（无需改动——端点本就是 GitHub 公网 URL）；
      ⑤ 反馈渠道=GitHub Issues（转公开即活；README/指南/模板已指向 issues 链接）；Chief Delphi 发布帖由用户本人发（用户决定 2026-10-03）。

- [ ] 发布帖（Chief Delphi）中注明：PathPlanner 移植关系与 MIT 来源、Choreo 互操作定位、零上传承诺

## 更新签名密钥（tauri-plugin-updater，2026-08-30 集成）

- **密钥**：ed25519，`npx tauri signer generate` 生成，**无口令**。
  - 主副本：`~/.tauri/pathblender-updater.key`（权限 600，**空口令**——构建时需 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""`，install-desktop.sh 已带）；公钥 `.key.pub` 已写入 `tauri.conf.json`（可公开）。
  - 备份：离线/次要位置一份（本机 README 有恢复流程；保住 ~/.tauri 主副本即可）。
- **红线**：私钥绝不进 git 仓库/截图/日志/会话文件（同 AI 密钥纪律）。
- **本地构建**：`scripts/install-desktop.sh` 检测到 `~/.tauri` 密钥会自动导出 `TAURI_SIGNING_PRIVATE_KEY_PATH`，`createUpdaterArtifacts: true` 产出带签名的 `.app.tar.gz` + `.sig`。
- **发版时**：CI/手工用同一密钥签名上传 `.app.tar.gz` 与 `.sig` 到 GitHub Release，并生成 `latest.json`（版本号、平台产物 URL、签名）。endpoint 与 `tauri.conf.json` 保持一致（仓库名小写）：
  `https://github.com/LYT259/pathblender/releases/latest/download/latest.json`。
- **β 渠道**：`latest-beta.json` 由 `scripts/gen-latest-json.mjs` 随每次发版生成，stable 标签才另存一份为 `latest.json`（stable 抬高 beta）。应用内切换渠道走 `check_update`（Rust 侧决定读哪个 feed——插件 JS 的 `check()` 不接受 endpoint 覆盖）。
- **β feed 落点（2026-10-02 修复）**：GitHub 的 `releases/latest` 永不解析到 prerelease，而客户端 β 地址是 `releases/latest/download/latest-beta.json`——因此 release.yml 在每次 beta tag 发布后会把 `latest-beta.json` 以 `--clobber` 重新上传到**当前 stable release** 上（活指针，不是历史文物；安装包等资产永不改动）。验证口径：发完新 beta 后 `curl -s https://github.com/LYT259/pathblender/releases/latest/download/latest-beta.json | jq .version` 应等于最新 beta 号。
- **打包单一管线（2026-10-02 统一）**：本机 install-desktop.sh 与 CI release.yml 共用 `scripts/package-desktop-artifacts.sh`（图标注入 → ad-hoc 密封 → 严格校验硬门 → 重打 updater tar+sig → 重出 dmg）。此前 CI 注入图标后从不密封，下载版过不了本机装机必过的 strict codesign 校验。
- **统一说明来源（2026-10-02）**：`scripts/release-notes-for.mjs <版本>` 从关于页 VERSION_NOTES（bump-version.mjs 维护）+ `docs/release-notes/known-issues.md` 组装用户可读 Release 正文与更新 feed notes；GitHub Release 用 `-F` + `--generate-notes`（提交列表仅作附录）。修复了问题必须在同版把 known-issues 条目删掉。
- **丢钥后果**：已分发用户永远收不到自动更新，只能手动重装——发版前确认两处副本齐全。
- **应用内入口**：菜单「检查更新…」→ 有更新则下载安装并重启；feed 不可达（离线/私有仓 404）显示「检查失败」toast——按设计绝不误报「已是最新版」。注意：仓库保持私有期间，未认证客户端拿不到 release 资产（更新与下载同限）；转公开后该限制自动解除（GitHub 公网 URL）。

## 姊妹项目协调（发布时）

- GHPaths 侧 ADR-0013/0017/0018 以旧名「GHPathBlender core（MIT）」提及本项目——**不改其冻结的 ADR 正文**（两项目共守的 ADR 纪律）；名称（PathBlender）与许可证（Apache-2.0）的变迁在 GHPaths 实际集成 core 时由其自建新 ADR 记录，届时包名 `@pathblender/core`。
- `@pathblender/core` 首次 npm 发布后通知 GHPaths 侧锁定版本（其 ADR-0013 已把 semver 列为一等约束）。
