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
