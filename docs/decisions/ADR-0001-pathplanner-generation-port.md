# ADR-0001: Port PathPlanner trajectory generation to TypeScript in core

- 状态：Accepted（2026-08-25）
- 关联：可行性研究报告 §5.2（唯一硬骨头）、§七（架构分层）；NOTICE.md（MIT 归属）

## 背景

PathPlanner 原生 `.path`/`.auto` 只存路点与约束，时间轨迹由 PathPlannerLib
（官方 Java/C++/Python）在机器人上生成。本项目要在浏览器里给策略组回放这些
文件，必须自己复现生成。截至 2026-08-25 社区没有可用的 JS/TS 移植。

## 决策

以 **PathPlannerLib Java**（MIT，`PathPlannerTrajectory.java`）为主参考、
**PathPlanner GUI Dart**（`pathplanner_path.dart` / `trajectory.dart`）为交叉
参考，1:1 移植到 `packages/core/src/pathplanner/`：

- `dc-motor.ts`（电机模型与电机表）、`robot-config.ts`（GUI 默认配置）
- `path-model.ts`（.path 2025.0 JSON → 模型，度→弧度）
- `path-points.ts`（贝塞尔离散：0.05 探测步 → 0.2 m 间距、旋转目标插入、
  曲率加密、约束区间映射）
- `kinematics.ts`（底盘↔模块速度、desaturate）
- `generation.ts`（generateStates + 前向/后向加速度 pass + dt=2Δd/(v0+v1)）

## 关键取舍

1. **完整电机级物理而非简化恒力模型**——时间轴精度直接影响碰撞结论
   （本项目核心价值），电机数学本身很小，值得忠实移植。
2. **.path 不含机器人配置** → 按 GUI 默认（Kraken X60 swerve、74 kg 等）
   生成，导入时警告「时间为估计值」；后续 UI 可开放配置编辑。
3. **降级近似策略**（报告 §5.2）：parallel/race/group 命令组按 sequential
   展开 + 警告；named 命令时长不可知 → 记事件、计 0 秒 + 警告；罕用
   约束类型遇不支持时按无约束近似并警告。
4. **.auto 引用解析交给调用方**：core 接收 `resolvePath` 回调，web 端用
   「同批导入 + 会话内 path 缓存」策略，core 不持有 IO 状态。

## 验证

- 8+ 生成测试：物理合理性（起点/终点静止、速度顶约束上限不超调、样本贴
  合路径 <5 cm、时间单调）、约束敏感性（放宽约束时长变短）；
- Pickup.path：3.14 s、峰值 3.00 m/s 精确顶到 3.0 约束（梯形特征）；
- .auto 串接：9.22 s ≈ Pickup 3.14 + 2×1s wait + Score 4.08。

## 后果

- 本项目成为社区第一个浏览器端 PathPlanner 轨径生成实现（报告 §5.2 预期
  的社区贡献点），发布时在 CD 帖中注明移植关系（MIT 允许，需署名）。
- 上游算法演进（PPLib 改动）需要人工跟进；样本回归集 + 此 ADR 固化对照
  来源与版本。
