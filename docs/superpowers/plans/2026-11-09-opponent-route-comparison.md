# 对手路线对照：逐队红/蓝联盟选择与冲突明细区分（2026-11-09）

红皮书需求 #14 / §6.1：文件夹导入时逐队显式选择蓝方/红方，联盟归属在导入层指定，供赛前防反/遭遇分析；冲突明细区分「队友相撞」与「与对手交叠」。

Worktree：`PathBlender-worktrees/opponent-route-comparison`，分支 `feat/opponent-route-comparison`，基于 origin/beta 09c6d7d2（0.1.10-beta.17）。

## 现状链路（已核实）

- 所有解析器（traj/ghostauto/pathplanner-path/pathplanner-auto/wpilog）产出 `alliance: 'blue'` 的轨迹——样本一律按蓝方世界系解释；红队导出的文件目前没有入口声明"这是红方视角"（需求 #14 的缺口）。
- `Trajectory.alliance` = 样本所在坐标系标签（frame tag）。全局红/蓝切换是纯显示派生：`robotsForAlliance(source, view, field)` 逐机 `applyAllianceChange` 翻到视图系（派生副本），源机器人恒蓝系、恒 blue 标签（`restoreSessionAlliance` 恢复时也归一回蓝）。
- 逐队镜像 `mirrored` 是槽位旗标 + 视图派生（2026-10-05 成熟先例）；碰撞在派生视图上做，全量同翻不改相对几何。
- 会话文件按槽位序列化（`serializeSession` 写视图机器人的当前 tag 与样本；重开时逐机归一回蓝）。
- 冲突 `CollisionInterval` 只有 planned/tolerance 之别，无同/跨联盟归类；ConflictPanel 无队友/对手区分。
- 起步区闸门（`startsInAllianceZone`，蓝方矩形）+ 起点分组（`routeStartRegion`）都以蓝系判定；红队机器人物理在红半场，若不处理会被全量灰掉/闸死。
- 编辑/调解导出（editing.ts、exporters.ts）当前未接入 web UI；profile 重生成（`regeneratePathTimeline`，经 `applyProfileToRobot`）是真实可达的重生成路径，从 `regenFrom`/`editable` 的 authored 几何重建样本。

## 设计

### 1. 数据模型（core）

- `SessionTrajectory` 新增可选槽位字段 `teamAlliance?: Alliance`：该队原始联盟（undefined = 未指定 ≡ 蓝，旧会话零变化）。持久化进会话文件（可选键，v1 不变）；读取侧只接受 `'red' | 'blue'`，其他值自愈为 undefined（外部输入容错，同 timingSource/gaps 立场）。
- 源机器人存储不变量保持：**样本恒蓝系、tag 恒 blue**（现有架构不变量"红方文件在导入层翻进蓝系"）。选择红方 = 对该队槽位的**全部 authored 几何**做一次 180° 场地旋转（`x→L−x, y→W−y, heading→heading+π, (vx,vy)→−(vx,vy), ω 不变`——与 `applyAllianceChange`/`flipPoseToBlue` 同一数学），覆盖：
  - `samples`；
  - `editable`：choreo waypoints（x/y/heading）、pathplanner `ParsedPath` waypoints（anchor/prev/nextControl）与 rotationTargets/goalEndState/idealStartingState 的 rotation（+π wrap）、pointTowardsZones.fieldPosition；pathplanner-auto 按 ParsedAuto 实际携带的几何逐项同法；
  - `regenFrom.path`（同 ParsedPath 翻转——否则 profile 重生成会把路线拉回蓝半场）；
  - `original` 快照（editable + samples）。
  事件/间隙/模组位置/几何尺寸/时间均不受影响。翻转是 involution，且旗标永不驱动几何（分类、显示、zone 判定专用），从任何状态（新鲜导入/重开会话）出发都不会翻两次。
- 新 core 模块 `packages/core/src/team-alliance.ts`：
  - `setTeamAlliance(robot, teamAlliance, field): SessionTrajectory`——相对当前旗标（`?? 'blue'`）恰差一次翻转时执行上述全几何旋转（当前轨迹 + 全部 routeOptions），并写入新旗标；
  - `displayAlliance(robot): Alliance` = `teamAlliance ?? trajectory.alliance`（渲染色统一入口）；
  - `startsInTeamZone(trajectory, zone, field, teamAlliance)` 与 `routeStartRegionForTeam(...)`：起点位姿先归一到蓝系，`teamAlliance === 'red'` 再翻一次后与蓝方矩形比较（即判定该队自家墙的合法区）。
- `collision/detect.ts`：`CollisionInterval` 新增必填 `relation: 'teammates' | 'opponents'`，由对双方 `teamAlliance ?? 'blue'` 是否相同决定。

### 2. 导入（web）

- 文件夹导入（`fromFolder` 且解析出 ≥1 支队伍）在提交前弹出「逐队选择联盟」对话框：每队一行（队名/队号 + 蓝方/红方两个**可见文字原生 radio**，默认蓝方），Import 提交、Cancel 放弃本次导入。Enter=Import、Esc=Cancel，焦点管理走现有 Dialog 组件。默认全蓝提交结果与现状逐字节等价（旗标显式记录）。
- 提交时红队经 `setTeamAlliance` 处理（导入层指定）。松散多选文件导入、WPILOG/HOOT 导入维持现状直接落蓝（它们已有各自对话框），事后用卡片 radio 修正。
- 现有文件夹导入测试补一步对话框确认（行为测试同步更新为新的真实行为）。

### 3. 卡片修正（web）

- RobotList 每行新增原生 `<fieldset>`（legend 命名"队伍联盟"）+ 两个 `<input type="radio">`，可见持久文字标签（`robots.blue`/`robots.red` 复用），name 按机器人 id 作用域化；键盘原生可达（箭头切换/空格选择）。改选走 `setTeamAlliance`（一次历史步，undo/redo 自然生效）；槽位旗标对新加入路线持续生效。
- 复用现有 pill/分段样式配方与颜色令牌，只加新布局所需最小 CSS，不改既有视觉参数。

### 4. 显示与判定（web）

- 渲染色统一改经 `displayAlliance(robot)`：2D 保险杠/热图/段标签（canvas2d-render）、3D 底盘/热图（FieldCanvas3D）、ground-trail3d、robot-label-canvas（颜色由调用方传入）。未设旗标的机器人回退 `trajectory.alliance`——旧会话与单联盟用法显示逐字节不变。
- 起步区灰显/闸门/起点分组三处（`sessionStartsInZone`、composer 库闸、`previewDimsPath`/`dimmedPathRobotIds`）改为队伍感知判定，红队不再被误灰误闸；composer 增加 field 传参。
- 全局红/蓝切换、菜单、tour 语义零改动（旗标与视图正交）。

### 5. 冲突明细（web）

- ConflictPanel 在会话启用逐队联盟（任一机器人有旗标）时，为每条冲突显示「队友相撞 / 与对手交叠」徽标（`c.relation`），复用现有徽标视觉配方；未启用时面板与现状逐字节一致。

### 6. i18n（40 语）

新键：`robots.teamAlliance`、`conflicts.teammates`、`conflicts.opponents`、`import.allianceTitle`、`import.allianceBody`、`import.allianceApply`、`import.allianceCancel`（措辞以 en/zh 定稿后逐语补齐；zh-hk/zh-mo/en-gb 按现有继承结构处理）。由 i18n 完整性测试把门。

## 行为测试（TDD，先红后绿）

core：
1. `setTeamAlliance` 红→样本/waypoint/regenFrom/original 全部按官方对称翻转（对场地名义尺寸逐点数值校验，含 heading wrap、速度取反、ω 不变）；再设回蓝 = 逐位还原（involution）；routeOptions 同步翻转。
2. 会话序列化/反序列化：旗标往返；旧会话（无键）打开全部未设旗标；非法值自愈；红视图保存→重开，源归一蓝系且旗标保留、几何不翻两次（重开后位置与保存前物理一致）。
3. `detectCollisions`：同旗标=teammates、跨旗标=opponents、未设旗标默认 teammates；红视图下 relation 不变。
4. zone：红队起点在红半场合法区通过、蓝墙侧被闸；蓝队不受影响；两视图判定一致。
5. profile 重生成后红队仍停红半场（regenFrom 翻转生效）。

web：
6. 文件夹导入弹对话框：默认全蓝提交=现状；选红一支→该队样本落在红半场、其余不变；Cancel 不落任何机器人。
7. 卡片 radio 可见、可键盘操作；改红→物理镜像、undo 还原、redo 重做；新路线继承旗标。
8. 全局切换与旗标正交：红视图下红队显示红、蓝队显示蓝（displayAlliance），切换不改旗标与碰撞 relation；旧会话行为不变。
9. ConflictPanel 徽标：teammates/opponents 各自显示；未启用时不渲染徽标。
10. 40 语键完整性（现有 i18n 测试自动覆盖新键）。
11. 既有 alliance-workflow 等回归全绿（对话框步骤按新真实行为更新）。

## 边界与不做

- 不改全局切换语义、不改物理坐标约定、不动视觉参数（新 CSS 仅限新元素的布局接入，复用令牌）、不新增依赖、不另开格式通道。
- 冲突自动调解（autoResolveConflicts）只调 startDelay，旗标无关，不改。
- 对手路线的调解编辑（editing/exporters）仍为 core-only API，未接入 UI，不在本次范围；其几何翻转仍随槽位数据一致翻转，未来接入即正确。
- WPILOG/HOOT 文件夹导入不弹联盟对话框（已有各自选择对话框），卡片可修正——计划内明示。

## 验收

- `npm run typecheck` 0 错；`npm test` 全绿（core + web，含上述新测试）。
- 真实样本驱动（`samples/` 回归集真实文件），无桩/合成数据冒充。
- 分支干净可交付，不 push、不建 PR、不合 beta（控制器统一交付）。
