# 验收/分发分支集成说明（2026-11-09）

Task: `task:acceptance-followup-integration`（board 71397909c949）。Worktree:
`PathBlender-worktrees/acceptance-followup-integration`，分支
`test/acceptance-followup-integration`，基于 `origin/beta@90b45229`
（0.1.10-beta.20）。目标：把三条已完成、已独立复核的验收/分发分支按原提交
cherry-pick 到一个可发布集成分支；不重新设计功能、不抬号、不推送、不建 PR、
不 dispatch；不碰 stable/工程日志/红皮书。

## 提交清单（按序，作者身份全保留）

| # | 新 SHA | 原 SHA | 来源分支 | 主题 |
|---|--------|--------|----------|------|
| 1 | 2c2d37c6 | f31fb110 | test/format-reference-acceptance | 官方 wheel 组合基线 + 真实 CTRE 转 WPILOG 样本门控 |
| 2 | c9e03b55 | ca4524e2 | fix/homebrew-cask-brew-style | brew style 清洁 cask（符号 macos 依赖、无尾空行） |
| 3 | 4be37863 | 46f43176 | 〃 | 删弃用 verified 参数；钉线 livecheck |
| 4 | db810445 | fffe9c5d | 〃 | livecheck regex 捕获组 |
| 5 | 1de0b4c0 | b0c13a55 | 〃 | 记录已发布 tap 状态 + 用户指南三步安装 |
| 6 | 4ec24efa | e719b980 | test/available-environment-acceptance-v3 | dispatch-only update-verify workflow + 契约测试 |
| 7 | 49278040 | 19f0c79a | 〃 | 跨 step pwsh 变量修复 + combobox UIA 加固 |
| 8 | a69bfcba | f1206a4a | 〃 | semver 预发布段排序 + 失败证据 always 上传 |

审查结论：三条源分支相对 09c6d7d2 的全部提交恰好为上述 8 个（1+4+3），
无一遗漏、无一重复、无一已在 beta；逐提交 `--stat` 与原提交完全一致。

## 冲突与语义核验（对 #417 CSS / #418 对手路线 / PR#409）

- **文本冲突：零**。与 PR#409（55ad213a）共享的两处文件由 git 自动合并，
  逐项核验双方行为都在：
  - `packages/web/test/release-pipeline.test.ts`：#409 的 retry 状态机 4 测试
    与 CRLF 归一化保留；update-verify 契约（dispatch-only/只读 token/digest/
    UIA/无 secrets 泄漏）与 tap 分发契约（brew style/livecheck/双指南安装步）
    全部在场，合计 56/56 绿。
  - `docs/releasing.md`：#409 的「verify 绑定完整构建标识」与「Star 邀请自动
    附加恰一条」措辞保留；b0c13a55 的 tap 已发布状态与发布 checklist 改写
    并存（第 65/88 行区段）。
- #417 CSS、#418 对手路线、i18n、版本九文件与本次 8 提交零文件交集
  （累计 17 文件 +2306/−25，全部在 samples/、docs/、core 测试、web 测试、
  scripts/gen-homebrew-cask.mjs、update-verify.yml 范围内）。
- 终态字节核验：update-verify.yml == f1206a4a 原版；gen-homebrew-cask.mjs
  与其测试 == fffe9c5d 原版。

## 门禁结果（全部在集成分支 HEAD=a69bfcba 实跑）

- `npm run typecheck`（全仓）：0 错误。
- `npm test`（core+web 全量）：144 文件 / 1551 测试全绿。
- 格式参考：`pathplanner-reference` 29/29 绿（含新夹具
  `example-auto-composite-v2025.2.7` 5 断言组）。
- Homebrew：生成器按 beta.17 + 已发布 sha 重产 cask，与已发布 tap
  （LYT259/homebrew-tap@e1455129 本地验收副本）**逐字节一致**；`ruby -c`
  Syntax OK（beta.17 真实 sha 与 beta.20 占位 sha 各一次）。
- workflow YAML：update-verify.yml 经独立 PyYAML 解析 OK（仅
  workflow_dispatch 触发、单 windows-update job、permissions 只读）。
- 真实 CTRE 门控样本：CD 附件实下，zip sha256 `17d1319e…` 与内层
  `b830e32b…` 双双与登记一致；`hoot-samples` 3/3 绿——生产管线解析
  102,933,199 字节、1835 entries、0 corrupt-timestamp 警告、655 ms，
  与原验收会话数字一致。样本按设计不入库（本地 /tmp，未提交）。

## 发现（未改，保持 cherry-pick 补丁保真）

- `samples/hoot/README.md` 的示例命令 `npx vitest run test/hoot-samples.test.ts
  -w packages/core` 中 `-w` 落在 vitest 侧等于 watch——套件会跑完并打印结果
  但进程不退出（实测 DEV 模式驻留）。正确等价写法：在 `packages/core` 目录
  直接 `HOOT_SAMPLE_DIR=… npx vitest run test/hoot-samples.test.ts`。留待
  源分支 owner 或控制器定夺，本分支不改原提交内容。

## 未验项（如实登记）

- update-verify workflow 的真实 Windows dispatch（分支未推送，dispatch 需要
  远端分支；交控制器合并后执行）。
- raw `.hoot` 容器、owlet 下载/转换（EULA）——门控样本边界，与源任务一致。
- brew style/audit/livecheck 本次未对真实 tap 重跑（源验收已于 2026-11-09
  对线上 tap 全绿；本分支以字节一致 + 契约测试 + ruby -c 覆盖回归面）。
