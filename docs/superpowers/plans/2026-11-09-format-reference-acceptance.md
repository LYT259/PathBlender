# 格式参考数值与真实样本可执行验收（2026-11-09）

Task: `task:format-reference-acceptance`（board e2344dfdc4d5）。Worktree:
`PathBlender-worktrees/format-reference-acceptance`，分支 `test/format-reference-acceptance`，
基于 beta@09c6d7d2。目标：收口 PR #411 遗留的「官方 `.auto` 数值未取得」与 PR #410 遗留的
「真实 `.hoot` 样本未验」两件事的可验部分；不改红皮书、工程日志、beta/stable；不推 PR。

## 背景与已核实事实（本会话独立复核，非转述）

- 官方参考门已存在：`packages/core/test/pathplanner-reference.test.ts`（自门控 manifest 驱动），
  `samples/pathplanner/reference/`（README + manifest + 官方 wheel 金样 Pickup/Score）。
- 官方 PyPI wheel `robotpy-pathplannerlib==2025.2.7`（本机 /tmp/pp-frac 重装复核）：
  - `auto.py:245` `getPathGroupFromAutoFile()` 能从真实 `.auto` 文件按官方语义解析出深度优先路径组；
  - `auto.py:155` `PathPlannerAuto` 是运行时 Command（构造命令树，不产出轨迹数值）；
  - `commands.py:111` `FollowPathCommand.initialize()` 用**当时实测车速/朝向**调
    `path.generateTrajectory(currentSpeeds, currentPose.rotation(), config)` ——
    整段 `.auto` 轨迹没有官方库函数可算，此前的「无法取得官方 golden」结论成立。
- 等价性突破口（上游示例在本钉版的真实数据）：`Example Auto.auto`（sequential：Pickup → wait 1.0 →
  named "print hello" → wait 1.0 → Score）。Pickup 末端锚点 (7.726886294559709, 0.8077125277685265)
  == Score 首锚点；Pickup goalEndState velocity=0/rotation=0°；Score idealStartingState
  velocity=0/rotation=0°。因此「各段按 ideal 起始态生成」与官方运行时语义（wait 后静止 →
  currentSpeeds=0，currentPose.rotation()=0°）在本夹具上**可证等价**。
- 本仓链式模型：`parsers/pathplanner-auto.ts` 按序时移、wait 以 10 Hz 保持末姿、named 零时长并警告；
  `pathplanner/generation.ts:68-73` 默认 ideal 起始（与 golden-runner.py 同公式）。
- harness 已支持 `kind:"auto"`（含 hold/join 检查、manifest 期望-金样交叉核对），缺的只是夹具。

## 判定

不编造「官方 golden」。新增一个**官方组合基线（composite）**夹具：输入＝钉版真实 `.auto` + 真实
`.path` + 真实 `settings.json`；期望值＝官方 wheel 在**声明式链式模型**（ideal 起始、声明 wait 保持、
named 零时长）下的实算输出。README/manifest 明确标注 composite 与等价性论证，整段官方数值仍记
unobtainable。

## 步骤（TDD）

1. **红**：先在 `samples/pathplanner/reference/manifest.json` 加 `example-auto-composite-v2025.2.7`
   案例（期望值先按官方 wheel 实算填入）并放占位金样 → 运行
   `npx vitest run pathplanner-reference` 应能加载案例（缺文件/哈希不匹配＝红）。
2. **官方实算**：新增 `samples/pathplanner/reference/auto-golden-runner.py`（与 golden-runner.py
   同规范：官方入口 `getPathGroupFromAutoFile` + `fromPathFile` + `generateTrajectory`(ideal)，
   遍历真实命令树 wait/named，输出 `golden-example-auto.json` 组合状态序列）。在 /tmp 用钉版
   wheel 实跑生成金样与 sha256，转录 manifest 期望值。
3. **绿或如实红**：跑 `pathplanner-reference`，数值差异如实报告；不放宽容差。若暴露本仓实现
   缺陷（如链式/等待语义错误），按 TDD 修复实现后复跑；若差异属容差设计问题，只记录不放宽。
4. **真实 `.hoot` / CTRE 转 WPILOG 样本核查**：
   - 搜索来源明确的公开样本（许可清晰）；找到→记录 URL、许可证、sha256；只读探测
     （`probeHootFile` 字节 70 合规版本；WPILOG 则走真实解析管线只读解析），样本入
     `samples/hoot/`（如许可允许）+ 新增 `hoot-samples.test.ts` 门控测试。
   - 找不到或许可不明→照实登记未验，不合成、不冒充；owlet 下载/转换需 EULA，一律不执行。
5. README（reference 目录）同步：composite 小节、等价性论证、unobtainable 口径更新。
6. 全量 `npm run typecheck` + `npm test`（core+web）；报告真实 HEAD、证据、未验项。

## 边界

- 不改红皮书/工程日志/AGENTS；不 bump 版本；不 push/PR/合并；不动 beta/stable。
- 真实验收不用桩、AI 或合成数据冒充；官方数值只能来自 wheel 实算或上游钉版文件。
- GitHub 访问：目的性少量请求，403/限流即停。
