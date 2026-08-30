# 文件格式事实（Phase 0 实物样本定案）

> 定案日期：2026-08-25。所有结论来自实物样本与上游源码核对，样本存于 `samples/`。
> 上游快照：Choreo main（2026-08-25）、pathplanner main（2026-08-25）、
> Collaborative_Pathplanner_103_Fork main（2026-08-25，LICENSE 核实为 MIT，
> 版权沿用 Michael Jansen 2022，即 PathPlanner 原许可证）。
> 坐标系：除非注明，一律为 WPILib 蓝方原点约定（米、弧度，+x 朝红方墙，+y 面向红方时的左手边）。

## 1. Choreo `.traj`

来源：Choreo 仓库 `test-jsons/trajectory/`（版本 0/1/2/3、v2025.0.0 各一对 swerve/differential）。

- 顶层字段：`name`、`version`（数字 0/1/2/3，或字符串 `"v2025.0.0"`）、`snapshot`、`params`、`trajectory`、`events`（个别带 `pplib_commands`）。
- **回放所需的全部状态在 `trajectory.samples[]`**：

  ```json
  {"t": 0.0, "x": 1.0, "y": 1.0, "heading": 0.0,
   "vx": 0.0, "vy": 0.0, "omega": 0.0,
   "ax": 5.54, "ay": 5.69, "alpha": 13.1,
   "fx": [..4], "fy": [..4]}          // swerve
  {"t": 0.0, "x": 1.0, "y": 1.0, "heading": 0.0,
   "vl": 0.0, "vr": 0.0, "omega": 0.0,
   "al": 4.5, "ar": 4.5, "alpha": 153.4,
   "fl": 153.4, "fr": 0.0}            // differential
  ```

  纯解析即可回放，证实报告 §5.1「低难度」判断。
- `trajectory.sampleType`：`"Swerve"` | `"Differential"`（v2025.0.0 的 trajectory 顶层不再带 sampleType/config，见下）。
- `trajectory.splits[]`：分段点 waypoint 索引（Choreo 的 split waypoint；事件以 waypoint 为锚）。
- 机器人几何：**v3 在 `trajectory.config` 自带** `frontLeft/backLeft`（模块位置，可推全四轮）、`bumper: {front, side, back}`、质量/惯量/传动等；**v2025.0.0 的 trajectory 只剩 `waypoints/samples/splits`，config 不在 params（params 仅 waypoints/constraints/targetDt）也不在 snapshot**——新版本文件不带机器人几何，证实报告 §5.4「.traj 需默认+用户可调几何」对当前版本成立；解析器对 config 两者都支持（有则白捡）。
- 联盟信息：文件不带（Choreo 内部以蓝方为基准导出）；红方文件按报告 §5.3 由用户设置后归一化。
- 版本策略：解析器读取 `version` 并接受上述全部已知版本；缺 `trajectory` 或 `samples` 空 → 明确报错「未生成轨迹（请在 Choreo 中先生成再导出）」。

## 2. 103 fork `.ghostauto`

来源：fork 仓库无实物样本；**格式以下游源码 `lib/auto/ghost_auto.dart`（toJson/fromJson）为权威**，本仓库据此生成回归样本（`scripts/gen_ghostauto_samples.py`）。

```json
{
  "version": "1.0",
  "name": "…", "teamName": "…",
  "bumperSize": {"width": m, "height": m},      // 保险杠矩形，米
  "bumperOffset": {"x": m, "y": m},             // 机器人坐标系内偏移
  "holonomic": true,
  "moduleLocations": [{"x": m, "y": m}, …],     // swerve 轮组位置
  "states": [
    {"t": s, "x": m, "y": m, "rotation": rad,
     "vx": m/s, "vy": m/s, "omega": rad/s,
     "moduleStates": [ {"fieldAngle": rad, "fieldPosX": m, "fieldPosY": m,
                        "speed": m/s, "angle": rad}, … ]}
  ]
}
```

- 采样约 10 Hz；线性插值采样即回放（fork 官方 sampleLinear 也是线性插值）。
- **自带保险杠几何与轮组位置** → 碰撞检测白捡（证实报告 §5.1/§5.4）。
- 全部字段在 fork 的 fromJson 中均有默认值（bumperSize 0.9×0.9、holonomic true 等）——解析器同样容错缺字段。
- 联盟信息：文件不带，同上由用户设置。

## 3. PathPlanner `.path` / `.auto`（**已支持**——Phase 2 移植完成）

来源：pathplanner 仓库 `examples/*/deploy/pathplanner/`，格式版本 `2025.0`。

- `.path`：`waypoints[]`（`anchor` + `prevControl`/`nextControl` 贝塞尔控制点，`isLocked`、`linkedName`）、`rotationTargets[]`、`constraintZones[]`、`pointTowardsZones[]`、`eventMarkers[]`（command 树）、`globalConstraints`（maxVelocity/maxAcceleration/maxAngularVelocity/maxAngularAcceleration）、`goalEndState`、`reversed`、`folder`、`useDefaultConstraints`。**无时间采样——轨迹生成已于 2026-08-25 移植（ADR-0001）**：Pickup.path 生成 3.14 s、峰值速度精确顶 3.0 m/s 约束。
- `.auto`：`command` 树（`sequential`/`path`（引用 pathName）/`wait`/`named`/…）、`resetOdom`、`folder`、`choreoAuto`。串接语义：path 段按 ideal 起始状态生成后时间平移；wait 静止保持；named 计 0 秒记事件；parallel/race/group 降级为顺序展开 + 警告。引用的 `.path` 从同批导入或会话缓存解析（core 不做 IO）。
- GUI 每赛季场地定义（`lib/widgets/field_image.dart`）：**2026 REBUILT = `field26.png`，3508×1814 px @200 px/m，图内含 0.5 m 边距** → 场地 16.54 m × 8.07 m。本仓库场地图取自该仓库（MIT），见 NOTICE。

## 4. 回归样本清单

| 文件 | 用途 |
|---|---|
| `samples/traj/v0..v3_swerve.traj` | 各 schema 版本解析回归 |
| `samples/traj/v3_differential.traj` | 差速状态字段（vl/vr/al/ar）解析回归 |
| `samples/traj/v2025.0.0_swerve.traj` | 当前版本（无 config）解析回归 |
| `samples/traj/swerve_test.traj` | choreolib 导出变体（带 pplib_commands） |
| `samples/ghostauto/straight_run.ghostauto` | 与 stop_and_score 在 t≈4.2~5.0 s、(7.5,2) 附近相撞（碰撞正例） |
| `samples/ghostauto/stop_and_score.ghostauto` | 中途停车例程（碰撞正例） |
| `samples/ghostauto/side_lane.ghostauto` | 平行错开不撞（碰撞负例） |
| `samples/pathplanner/*.path`、`*.auto` | Phase 2 存档 |

损坏样本（`samples/invalid/`）随解析器实现补充：截断 JSON、缺 states、非 JSON 文本、错误 version 等。
