# 可用环境验收：Mac 真实安装/更新/Gatekeeper + Windows 更新接管 workflow（2026-11-09）

任务键 `task:available-environment-acceptance`（board 234f8ee55153）。目标：在当前真实可用的环境里收口红皮书 §7.1（L330「真实更新接管/真实 feed/更新重启未验证」、L332「无浏览器裸机冒烟未执行」、L347 发行版与 Intel Mac 未验）与 docs/releasing.md 未验清单中**现在能做**的部分；做不了的如实标未验，不用模拟冒充。

## 代码改动（本分支，TDD，不推不 PR）

1. **新增 `.github/workflows/update-verify.yml`**（手动 dispatch，仅此触发）：
   - 输入：`from_tag`（默认 `v0.1.10-beta.16`）。目标版本由 feed 实际返回值决定，不硬编码。
   - windows job（`repository.private == false` 门控、`permissions: contents: read`、只读 `github.token` 做元数据、资产匿名下载 + 服务端 sha256 digest 校验——同 release-verify 契约）：
     a. 旧版匿名下载（digest 校验）→ `/S` 静默安装 → 启动并断言版本=旧版、窗口标题；
     b. UIA（System.Windows.Automation）真实驱动 UI：Ctrl+, 开偏好窗口 → Update channel 切 Beta → Save → Check for updates → 等「Install and relaunch」出现 → 点击；
     c. 轮询 NSIS 接管：旧进程退出、安装目录 exe 版本变 beta.17、进程重新存活且带窗口（区分「安装器自动重启」与「未重启」，均如实记录）；
     d. 全程截图 + 日志上传 artifacts。
   - 不使用任何生产签名密钥；不 checkout、不构建；不绕过任何 CI 门（独立只读验证，dispatch-only）。
2. **TDD**：先在 `packages/web/test/release-pipeline.test.ts` 加失败断言（workflow 存在、dispatch-only、private 门控、token 只读、digest 校验、UIA 关键步骤、无 secrets 上下文泄漏），再实现 workflow 转绿。

## 真实验收（不改产品代码）

3. **Mac 本机（Apple Silicon arm64, macOS 27.3）**：
   - Safari 真实浏览器下载 beta.16 DMG（带 quarantine）→ 临时目录安装（不动 /Applications）→ 首启抓 Gatekeeper 拦截弹窗真实截图 → 右键打开（仍要打开）流程放行；
   - 运行 beta.16 → 真实 UI 切 Beta 通道 → 检查更新 → 从真实 feed（releases/latest/download/latest-beta.json）下载 → 安装重启 → 断言运行版本 0.1.10-beta.17（About/进程）+ 截图；
   - 证据存 worktree 私有目录（gitignore）。
4. **复用现有 workflow**：dispatch `release-verify.yml` tag=`v0.1.10-beta.16`，取三端（含原生 Intel mac runner、ubuntu DEB/AppImage/RPM）真实发布资产安装证据；回读 run 全绿 + artifacts。
5. **双站可达性**：本机分别回读 `lyt259.github.io/PathBlender/sw.js` 与 `pathblender.pages.dev/sw.js`（cache-buster），核对缓存名版本=0.1.10-beta.17；只代表本机网络。
6. **Windows 更新 workflow 执行**：需分支在远端才能 dispatch——本会话不 push，交控制器合并后 dispatch（如实登记为已写+本地验证、未跑）。

## 明确未验（无条件）

- 内网 Linux 验证主机真机（主机 IP 属私有信息，略；上次核查离线：ping 全丢、SSH 超时）；Fedora/openSUSE 等其他发行版。
- Intel Mac 真机（本机 arm64；CI macos-15-intel runner 可部分覆盖安装/启动，但不等于真机）。
- SmartScreen 弹窗截图（无实体 Windows 机；runner 不弹窗）。
- 无浏览器裸机冒烟（三平台）；真人/触屏硬件；最低 macOS 版本。
