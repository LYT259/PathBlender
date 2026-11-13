# 修复 gen-homebrew-cask 输出：真实 brew style 两处违规（2026-11-09）

## 背景（实测证据，非推断）

Homebrew 真实分发验收（task:homebrew-tap-acceptance-20261109）在本机
`brew 7.0.12` 上对生成器产物 `Casks/pathblender.rb`（beta.17，SHA
`10a4bc78…a0f7879`，本地 tap 实挂）运行真实 `brew style --cask`，结果
2 offenses（均可自动修正，exit 1）：

1. `Casks/pathblender.rb:11:21: C: [Correctable] Homebrew/OSDependsOn:
   Use depends_on macos: :ventura.` —— 生成器输出
   `depends_on macos: ">= :ventura"`，新版 rubocop 要求单一下限用裸符号
   `depends_on macos: :ventura`（语义等价：ventura 及以上）。
2. `Casks/pathblender.rb:15:1: C: [Correctable] Layout/TrailingEmptyLines:
   1 trailing blank lines detected.` —— 模板以 `end\n` 结尾且 `console.log`
   再补一个 `\n`，产物以 `end\n\n` 结尾，多一个空行。

发布红线：不得发布带已知 brew 违规的 cask；生成器修复走本分支 + TDD，
PR/合并由控制器统一交付。

## 改动（最小）

- `scripts/gen-homebrew-cask.mjs`：
  - `depends_on macos: ">= :ventura"` → `depends_on macos: :ventura`；
  - 模板结尾由 `end\n`（+console.log 换行）改为 `end`，产物以单个 `end\n`
    结尾（无尾部空行）。
- `packages/web/test/gen-homebrew-cask.test.ts`：契约断言同步为期望输出
  （先改测试确认 RED，再改实现到 GREEN）：
  - contains `depends_on macos: :ventura`；
  - `out.endsWith('end\n')` 为真且不以 `\n\n` 结尾。

## 验证

1. RED：仅改测试后 `npx vitest run test/gen-homebrew-cask.test.ts`（web
   workspace）至少 2 项失败。
2. GREEN：改生成器后同命令 8/8 全绿。
3. 真实回归：用修复后生成器重新生成 beta.17 cask，`ruby -c` OK，
   重挂本地 tap 后 `brew style --cask` 0 offenses、`brew audit --cask
   --online` 通过（在验收任务侧执行并记录）。
4. 不改生成器其余行为：输入校验、stdout-only（零写入/零 git/零网络）契约
   测试保持不变且全绿。

## 不做

- 不动 beta/stable；不 push、不建 PR、不合并（控制器交付）。
- 不顺手改 cask 其余 stanza（audit 如再报新问题，回到本文件追加计划再改）。

## 第二轮追加（同日：真实 `brew audit --online` + livecheck 实测后）

audit 在线检查又报 3 项，其中 2 项需要生成器再改：

1. **`verified` URL 参数已被 Homebrew 7 弃用**（livecheck 运行时直接
   Warning："Calling the `verified` parameter in the `url` stanza is
   deprecated"）——生成器删除该参数（URL 主机与 homepage 同源，本就不需要）。
2. **livecheck 版本不一致是硬错误且无豁免**（`cask/audit.rb:942` 直接
   `add_error`）：默认策略只取 stable（0.1.9），且本仓存在历史异常 tag
   `v0.2.0-beta.1`（2026-09-16 发布后版本号回落 0.1.10 线），任何按版本
   比较的 livecheck 都会误报。修复：livecheck 用 `url :homepage` +
   `strategy :git` + regex 钉在版本入参的 `\d+\.\d+\.\d+` 线
   （`/^v0\.1\.10(?:-beta\.\d+)?$/i`，由版本入参推导、升版自动跟随；
   忽略 0.2.0 异常 tag，跟踪同线新 beta/stable）。
3. **pre-release 检查用 tap 级官方豁免**（非生成器问题）：
   `utils/shared_audits.rb:318` 支持 tap 的
   `audit_exceptions/github_prerelease_allowlist.json`，值 `any` =
   允许该 cask prerelease/stable 混发——beta 渠道 tap 的正规声明方式。

TDD：契约测试先改（新增 not.toContain('verified')、livecheck 三行、
钉线 regex 断言，2 failed RED）→ 生成器实现 → 9/9 GREEN（worktree 内
`npx vitest run test/gen-homebrew-cask.test.ts`）。真实验证在验收任务侧
对本地 tap 重跑 `ruby -c`/`brew style`/`brew livecheck`/`brew audit
--online`。

## 第三轮追加（同日：livecheck 实测捕获组要求）

带钉线 regex 的 cask 过了 `brew style`（0 违规），但 `brew livecheck`
报 "Unable to get versions"。Homebrew Git 策略源码注释明确要求 regex
「use a capture group around the version text」——`/^v0\.1\.10…$/` 无
捕获组取不到版本。修正为捕获组包住版本线：
`regex(/^v(0\.1\.10(?:-beta\.\d+)?)$/i)`（对 tag `v0.1.10-beta.17`
捕获 `0.1.10-beta.17`，与 cask version 同形）。TDD 同前：断言先改
（2 failed RED）→ 实现 → 9/9 GREEN。
