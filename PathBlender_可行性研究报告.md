# GHPathBlender 可行性研究报告
## 面向 FRC 联盟策略协作的多源自动路径融合查看器

> 研究日期：2026-08-25（**v1.7（2026-08-27）：新增 §7.4 主题与视觉规范——深浅双主题默认跟随系统、Preferences 可改并记忆；深色弃「深蓝 AI 感」改中性灰（对标 Xcode/Safari/Codex/Typeless）（来源：用户指令 2026-08-27）**；**v1.6（2026-08-27）：依用户指令将桌面版从触发式轨道提前为正式范围——双形态定稿：网页为主（对外队零安装）+ Tauri 桌面版（「像 GHPaths 一样是软件」）；修订 §6.1、§7.1、§7.3-3、§九、§十。同轮落地 §6.4 harness 五条纪律的补齐项（Action 注册制重构 + Action API 随 core 发包）**；**v1.5（2026-08-27）：§6.4 增补 AI harness 参考实现研究——DeepSeek Harness（DSH）与 OpenAI Codex harness，提炼 Action API 五条落地纪律（用户指令）**；**v1.4（2026-08-27）：新增三大功能入册——机器人队号标注（§6.1）、路径调解编辑与多格式导出（§6.3）、用户自配 AI 直接操作软件（§6.4）；相应修订 §7.3 不做清单、纯前端红线适配与风险/路线图（来源：用户指令 2026-08-27）**；**v1.3（2026-08-26）：自有代码许可证定稿为 Apache-2.0（§4.2、§七）**；**v1.2（2026-08-26）：全量对齐姊妹报告 GHPaths v1.14——§4.3 更新为「既定集成计划」（GHPaths v1.11/ADR-0013 已入册引用本项目 core 包）；新增 §7.3 工程纪律与方法论（功能准入规矩、明确不做清单、触发式轨道、发版就绪非功能清单、数据来源分层、SW 缓存更新策略，均自 GHPaths 报告移植适配）；风险清单与路线图相应增补（来源：用户指令 2026-08-26）**；**v1.1（2026-08-26）：新增 §7.1 分发与安装（免费定稿：网页零安装 + PWA；远期桌面版沿用 GHPaths 免费双渠道方案）与 §7.2 三语方案（简/繁/英）**；v1.0 首版）
> 研究范围：市场调研与竞品分析、项目定位决策、文件格式可行性、功能规划、技术选型、风险与路线图
> 姊妹报告：GHPaths《可行性研究报告》（演出多机演控系统，v1.6）——本项目与其共享工程纪律，架构互不依赖（见 §四）

---

## 一、执行摘要

**结论：可行，且生态位确认为空白。** 本项目的三项核心能力——①同时导入 Choreo 与 PathPlanner 两大体系的路径文件、②多机器人同场地时间轴同步回放、③自动程序碰撞/干涉检测——目前没有任何一个现成工具同时具备。2026 年 3-4 月调研确认：最近的竞品（FRC 103 队的 Collaborative PathPlanner fork）只覆盖 PathPlanner 体系且定位为「编辑器内的叠加参考」，Choreo 官方无多机器人概念，AdvantageScope 只能叠加实测 log 而非规划文件（官方文档已核实）。「把各队导出文件融合到一张图上给策略组看」这个定位无人占据，而社区需求真实存在（Chief Delphi 常年讨论串佐证）。

关键结论分条：

1. **做成独立新项目，不并入 GHPaths**（2026-08-25 定稿）：用户群（外队策略组 vs 本社团演控）、运行形态（零安装网页 vs Tauri 桌面+sidecar）、系统本质（静态文件分析 vs 实时安全控制）全部不同；GHPaths 处于 Phase 0 高速变动期且有许可证红线，公开工具不应绑定其上。论证见 §四。
2. **格式难度不对称，MVP 路径清晰**：Choreo `.traj` 与 103 fork 的 `.ghostauto` 都自带时间采样状态，**纯解析即可回放**（低难度）；PathPlanner 原生 `.path`/`.auto` 只存路点与约束，需要**移植轨迹生成算法**（高难度，全项目唯一硬骨头）。因此 MVP 先吃前两者，原生 PP 导入放 Phase 2。见 §五。
3. **PathPlannerLib 没有现成 TS 移植**（2026-08-25 核查：官方仅 Java/C++/Python，社区无可用的 JS/TS 实现）；但移植有双参考——Java 库（MIT）与 Flutter/Dart 版 GUI 的预览生成逻辑（以源码核实为准），且 MIT 许可明确允许移植。见 §5.2。
4. **形态定稿：纯前端 Web 应用**（Vite + TypeScript + React），文件本地解析零上传，部署 GitHub Pages——零安装、零隐私顾虑是社区采用的两个先决条件。见 §七。
5. **碰撞检测可以后来居上**：103 fork 用 0.1s 采样 + 包围圆（自述「不完美」）；本项目按 0.02~0.05s 采样 + 保险杠矩形 OBB-SAT 相交检测设计，精度对标超过。见 §6.2。
6. **发布节奏锚定赛季**：2026 offseason 用 2026 场地先行发布积累用户；2027 kickoff（预计 2027-01）前完成多赛季场地机制，赶上「各队开始画新 auto」的需求高峰。见 §十。
7. **分发与安装（v1.1，免费定稿）**：主形态即网页——GitHub Pages 零安装零费用，无 Gatekeeper/开发者账号问题；PWA「添加到 Dock」为第二条免费安装路径；若未来社区需要桌面离线版，Mac 两种安装方式沿用 GHPaths ADR-0007 v2 定稿（浏览器下载 + 终端/Homebrew），**不购 Apple Developer 账号（$99/年，GHPaths 已决策放弃，同样适用于本项目）**。语言：简体中文 / 繁體中文 / English 三语（沿用 GHPaths §8.7 方案）。见 §7.1、§7.2。
8. **功能扩展三件套（v1.4 入册）**：①场地机器人方形上标注**队号**，路径-机器对应一目了然；②路径**调解式编辑**（拖路点避冲突）+ **导出 .traj / .path / .ghostauto**——关键洞察：导出比导入容易（.path 本就只存路点，无需生成算法），编辑严格限定「改既有路径」、不做从零创作；③**用户自配 AI**（OpenAI 兼容协议 + 自带 API Key，默认关闭）经 Action API 直接操作软件（改路径、导出等）——密钥仅存本地，严禁进入分享/导出物。见 §6.1、§6.3、§6.4。

---

## 二、需求回顾

| # | 需求 | 确认信息 |
|---|------|---------|
| 1 | 导入各队导出的自动路径文件，**PathPlanner 与 Choreo 体系混合融合** | 本项目的核心差异化；现状无工具做到 |
| 2 | 多机器人同场地叠加显示，统一时间轴同步回放 | 自动阶段 15 秒；播放/暂停/倍速/拖动 |
| 3 | 检查自动程序互相干涉/碰撞 | 策略组的实际使用场景：赛前联盟协调 |
| 4 | 面向**策略组**而非编程组 | 零安装（网页）、操作简单、结果易分享（截图/文件） |
| 5 | （研究新增，隐含需求）红蓝联盟归一化 | 不同队伍的文件可能以不同联盟视角导出，须统一变换后再融合（§5.3） |
| 6 | 安装与分发：**不打算付费**（不购开发者账号等）；Mac 端提供两种安装方式（2026-08-26 补充） | 网页零安装为主形态，天然免费；PWA 安装为第二条路；远期桌面版沿用 GHPaths 免费双渠道定稿。见 §7.1 |
| 7 | 语言：简体中文 / 繁体中文 / English 三语（2026-08-26 补充） | 沿用 GHPaths §8.7 方案骨架；默认随系统语言。见 §7.2 |
| 8 | 机器人方形上显示**队号**，看路径时能分清哪条路径对应哪台机器（2026-08-27 补充） | 颜色=路径=图例三方一致；.ghostauto 自带队名，.traj/.path 由 robot 卡片填写（默认从文件名推断）。见 §6.1 |
| 9 | 可修改路径以避免冲突，并**导出为 Choreo / PathPlanner 路径文件**（2026-08-27 补充） | 调解式编辑（只改既有路径，不做从零创作）；导出 .traj/.path/.ghostauto。见 §6.3 |
| 10 | 用户可在特定位置输入**自己的 API 密钥**配置 AI，使其直接操作软件（修改路径、导出路径等）（2026-08-27 补充） | OpenAI 兼容协议（GLM/OpenAI/DeepSeek/本地 Ollama 均可）；默认关闭、密钥仅存本地、动作全程可撤销。见 §6.4 |

附加约束：开发维护主要依靠 AI 工具，技术选型需考虑 AI 友好性（沿用 GHPaths 报告 §二之附加约束）。

---

## 三、市场调研：现有工具盘点与空白确认（2026-08-25 核查）

### 3.1 竞品总表

| 工具 | 多队伍路径叠加 | 吃 Choreo 文件 | 吃 PathPlanner 文件 | 碰撞检测 | 形态 |
|---|:---:|:---:|:---:|:---:|---|
| **103 队 Collaborative fork**（2026-03/04 发布） | ✅（最多 10 个「幽灵」） | ❌ | ✅（.ghostauto / deploy 目录） | ✅（0.1s 包围圆） | PathPlanner 桌面 fork |
| Choreo 官方 | ❌（单机器人设计） | — | ❌ | ❌ | 桌面规划器 |
| PathPlanner 官方 | ❌（单机器人设计） | 互操作仅限机器人端 lib 跟随 | — | ❌ | 桌面规划器 |
| AdvantageScope | ✅（多 log 文件时间对齐） | ❌（只开 log 类格式，官方文档核实） | ❌ | ❌（靠人眼） | 日志分析器 |
| 各队小工具（AutoBOARd、PathVisualizer 等） | ❌ | 部分 | 部分 | ❌ | 单机可视化 |

### 3.2 最近邻详析：103 队 Collaborative PathPlanner Fork（"PathPlanner Ghost"）

[发布公告](https://www.chiefdelphi.com/t/frc-team103-presents-collaborative-pathplanner-fork/517640) · [GitHub](https://github.com/Cybersonics/Collaborative_Pathplanner_103_Fork)。PathPlanner 的 fork，新增上游没有的 Ghost Auto Overlay System：

- **能力**：联盟伙伴 auto 以半透明幽灵叠加（颜色区分、随预览同步回放动画）；`.ghostauto` 文件导入或从对方 `deploy/pathplanner` 目录批量导入；幽灵文件自带机器人配置（保险杠尺寸、轮组位置、全向标志、队名）；时间采样包围圆碰撞检测（红色警告圈）；pit 内局域网实时同步（UDP 广播发现 5810 + WebSocket 5811-5821）。
- **它验证了需求**：发布于 2026 年 3-4 月，社区反响热烈（"This is sick!"），且帖内即被追问「伙伴用 Choreo 怎么办」——正是本项目要填的坑。
- **四项局限（= 本项目的差异化依据）**：
  1. **不支持 Choreo**——`.ghostauto` 与 PP 项目目录之外无导入路径，Choreo 队只能手动重画；
  2. **fork 维护性差**——上游拒绝了合并 PR，此后每版上游都要追着合并（帖内 Fletch1373 已指出此风险）；
  3. **定位是编辑器附属功能**——给「正在编辑自己路径的编程组」看参考，不是给策略组的独立融合查看器；
  4. **分发绑 LAN/桌面**——pit 内同网段才有实时同步，赛前远程协调只能手工传文件。

### 3.3 需求真实性

「怎么和联盟伙伴对 auto、避免撞车」是 Chief Delphi 常年痛点：[How do teams develop autos between matches?](https://www.chiefdelphi.com/t/how-do-teams-develop-autos-between-matches/520053)、[How do you talk to alliance partners about auto compatibility?](https://www.chiefdelphi.com/t/how-do-you-talk-to-alliance-partners-about-auto-compatibility-in-reefscape/484448)。现状靠嘴对嘴 + 时间估计；353 队甚至用电子表格查 auto 冲突。103 fork 的热烈反响是需求被验证的最新证据。

### 3.4 结论

「同时吃 Choreo + PathPlanner 规划文件、融合给策略组看」的工具**不存在**。最近的竞品 5 个月前才出现且只覆盖半边。空白确认，值得做。

---

## 四、定位决策：独立项目，不并入 GHPaths（2026-08-25 定稿）

### 4.1 两项目对照

| | GHPaths | GHPathBlender |
|---|---|---|
| 用户 | 本社团演控操作员 | **外队**策略组 |
| 本质 | 实时控制系统（DS 使能/急停/看门狗/时钟广播） | 纯被动的文件可视化与分析 |
| 形态 | Tauri 桌面 App + sidecar 进程 + Mac 系统脚本 | 纯前端网页（GitHub Pages） |
| 场地 | 自定义舞台 | 各赛季官方 FRC 场地 |
| 阶段 | Phase 0 高速变动期 | 全新启动 |

### 4.2 独立的四条理由

1. **分发决定成败**：目标用户是外队策略组，最好形态是零安装网页——藏在带 DS 协议、sidecar、系统脚本的 monorepo 里，外人 clone/信任成本完全不同；
2. **GHPaths 是安全敏感的实时系统**：公开工具绑上去会继承其不稳定，GHPaths 也会被公众用户诉求拖慢；
3. **许可证**：GHPaths 有 OpenDS 只读红线；本项目要开源给社区，独立仓库一个干净的 **Apache-2.0**（2026-08-26 用户定稿）即可，不必在约束中做切割；
4. **用户自己的判断即决策依据**：「有些人用不上 GHPaths，只需要这一个功能」——正是解耦信号。

### 4.3 与 GHPaths 的复用关系（v1.2 更新：集成已从「预留」升格为「既定计划」）

- **复制改造起步**（当前阶段）：`packages/field-model`（纯类型+纯函数）、console 的 2D 画布/时间轴交互范式、i18n 机制（ADR-0008 先例）直接搬概念与代码，**不建跨仓库共享包**——两项目都稳定且确有共同需求后再评估抽包，避免过早抽象；
- **依赖方向固定，且已被对方入册**：GHPaths 报告 v1.11（2026-08-26，ADR-0013）已把「引用本项目 core 包」写入其正式计划——演出用例为①联合演出/展示时导入客队 Choreo/PathPlanner 系路径为参考图层并做跨队干涉检查、②编舞师用 PP/Choreo 画的草稿导入转演出路径；并采纳本报告 §6.2 的 OBB-SAT 碰撞规格（0.02~0.05s 采样，优于包围圆）与 §5.3 红蓝归一化语义。**含义**：core 的「可独立发布 npm 包」不再是「为未来留接口」，而是 GHPaths Phase 3 的实际依赖——core 的 API 稳定性与发包纪律从 v1.2 起升为一等约束（见 §7.3 与 §九 风险增补）；本项目仍不得反向依赖 GHPaths 任何代码；
- **格式事实共纪律**：两项目共用「实物样本为准 + 解析容错」的格式事实纪律（GHPaths §10.9 同款表述），样本回归集是共同防线。

---

## 五、文件格式可行性（核心技术论证）

### 5.1 格式难度总表

| 格式 | 文件里存了什么 | 难度 | 说明 |
|---|---|:---:|---|
| Choreo `.traj` | 完整时间参数化轨迹（各时刻位姿+速度采样） | **低** | 纯解析即可回放；一个文件一条路径。精确 JSON 字段官方文档未抄录，**以实物样本为准**（Phase 0 收集） |
| 103 fork `.ghostauto` | 约 10Hz 采样点+轮组状态+机器人配置（保险杠尺寸、轮组位置、全向标志、队名） | **低** | 格式为公开简单 JSON（帖内人称「其他路径应用可复刻兼容」）；**自带保险杠几何**，碰撞检测白捡 |
| PathPlanner `.path` / `.auto` | 路点+控制点+约束 / 例程结构（引用路径名、等待、命令序列） | **高** | 无采样状态，时间轨迹由 PathPlannerLib 在机器人上生成——须自行复现生成算法（§5.2）；`.auto` 的等待/命令语义还需单独建模 |
| （远期）WPILOG | 实测位姿 log | 中 | AdvantageScope 生态；读有现成 TS 库（npm `wpilog-parser`）；价值在「规划 vs 实测」对比，非 MVP |

### 5.2 唯一硬骨头：PathPlanner 轨迹生成移植

- **没有现成轮子**（2026-08-25 核查）：PathPlannerLib 官方只有 Java/C++/Python；社区搜不到可用的 JS/TS 移植。PathPlanner 2.0 发布帖中作者明言欢迎各语言移植并愿意在 wiki 挂链接——至今没有 JS/TS 版，说明这块没人啃过，做出来本身就是社区贡献。
- **移植有双参考、且合法**：
  1. PathPlannerLib Java 源码（**MIT**，允许移植，注明来源即可）：贝塞尔路径生成 + 全向/差速速度规划 + 约束求解；
  2. PathPlanner GUI 本体是 Flutter/**Dart**，其预览仿真必然内含一套 Dart 版生成逻辑，可作交叉对照（**待源码核实**——Phase 2 开工前先确认其生成代码位置与完整度）。
- **风险边界**：`.path` 的各种约束类型（速度/加速度区间、自定义约束）不必一次全实现——MVP 移植先覆盖多数队伍实际使用的主流约束，罕用约束给「按无约束近似生成 + 明确警告」的降级路径。
- **兜底**：PP 队在此期间可用 103 fork 导出 `.ghostauto`（本项目兼容读取），或 PP 队友用 Choreo 互操作（PPLib 本就能跟随 `.traj`）——PP 原生导入晚到不阻塞任何人。

### 5.3 红蓝联盟归一化（易漏的关键正确性问题）

- FRC 场地红蓝对称，各队导出的路径通常以**蓝方原点**为基准（Choreo 导出即含 blue-alliance 起终点；PP 路径惯例同），但队伍也可能以红方视角作图；
- 本项目导入层提供每台机器人的联盟归属设置，红方文件按场地对称变换归一化到蓝方坐标系后再融合（变换规则沿用 WPILib 官方红蓝 transform 语义）；
- 下游（渲染、碰撞）对联盟无感知——这是「单一归一化路径」架构不变量的具体体现。

### 5.4 机器人几何

- `.ghostauto` 自带保险杠尺寸与轮组位置；
- `.traj` / `.path` 不含机器人几何 → 每台机器人给默认尺寸（覆盖常见 FRC 底盘范围）+ 用户可调；几何只影响碰撞检测的包围盒，不影响轨迹回放。

---

## 六、功能规划（下一步该做什么的答案）

### 6.1 功能清单与优先级

| 优先级 | 功能 | 说明 |
|---|---|---|
| **P0（MVP）** | Choreo `.traj` 导入 | 拖拽/多选；格式探测与容错 |
| P0 | `.ghostauto` 导入 | 顺手兼容 103 fork 生态（对 PP 队是现成导出路径） |
| P0 | 2026 赛季场地 + 多机叠加 | 官方场地 2D；每机一色一图层，机器人矩形按几何渲染 |
| P0 | 统一时间轴回放 | 15s auto 时钟：播放/暂停/倍速/拖动；轨迹尾巴 |
| P0 | 碰撞/干涉检测 | 见 §6.2；冲突时刻列表（谁和谁、何时、何地） |
| P0 | 红蓝联盟归属设置 | §5.3 |
| P0 | 会话保存/恢复 + 截图导出 | 融合结果存成一个项目文件（含所有轨迹+设置）；PNG 截图发群 |
| **P1** | 起步延迟 what-if | 给任意机器人加起步延迟看能否错开——策略协调的实际动作；不修改原文件 |
| P1 | 最小间距报告 | 任意两机全时段最小距离，比二元碰撞更早预警 |
| P1 | 机器人几何编辑 | 默认尺寸+可调（§5.4） |
| P1 | 机器人队号标注（v1.4 新增） | 场地上每个机器人方形渲染队号；颜色=路径=图例一致；数据来源分层见 §7.3-5 |
| **P2** | PP 原生 `.path`/`.auto` 导入 | 轨迹生成移植（§5.2）；`.auto` 等待/命令序列建模 |
| P2 | 多赛季场地 + 用户导入场地 | 对齐 GHPaths ADR-0008 的 FieldMap 设计：场地图片 + 像素角点标定（图→米制映射）+ 尺寸 + 可选 AprilTag 布局 JSON（直接兼容 WPILib / PhotonVision 官方格式） |
| P2 | URL 会话分享 | 会话压缩编码进 URL hash——纯前端隐私友好的分享方式 |
| P2 | PWA（添加到 Dock / 安装） | §7.1；service worker 静态资源缓存，赛场无网环境也可靠 |
| P2 | 桌面版（Tauri 打包，v1.6 新增） | 双形态：网页对外、桌面版对内/离线；纯静态壳（无 sidecar/后端），加载与网页同源的构建产物；分发沿用 GHPaths ADR-0007 v2 免费定稿。见 §7.1 |
| P2 | 路径调解编辑（v1.4 新增） | 拖拽/增删路点与控制点消解冲突；派生副本不改原文件；时间重参数化复用 Phase 2 生成器。见 §6.3 |
| P2 | 路径导出 .traj / .path / .ghostauto（v1.4 新增） | 导出比导入容易（.path 本就只存路点）；导出→原工具回开测试入回归。见 §6.3 |
| P2 | 用户自配 AI 直接操作（v1.4 新增） | OpenAI 兼容 + 自带 Key + 默认关；Action API 与 UI 同源、全程可撤销。见 §6.4 |
| P1 | 三语 i18n（简/繁/英） | §7.2；机制骨架随 MVP 就位（简中+英文先行），繁体与全量覆盖放 Phase 3 |
| P3（触发式轨道，见 §7.3-3） | WPILOG 导入 | 实测 vs 规划对比；面向复盘而非赛前协调 |
| P3（触发式轨道，见 §7.3-3） | 103 式 LAN 实时同步 | 文件模式已满足需求；除非社区强烈要求 |

### 6.2 碰撞检测设计

- **算法**：全时段按固定步长采样（0.02~0.05s，优于 103 fork 的 0.1s），每时刻对全部机器人两两做**有向包围盒（OBB）相交检测**（保险杠矩形，SAT 分离轴定理）——比包围圆精确（FRC 底盘多近方形，圆会虚报），实现量也不大；
- **产出**：①时间轴与场地上标红冲突点；②冲突明细列表（机器人对、时刻区间、位置、最小间距）；③时间轴上每台机器人的「安全/冲突」色带；
- **远期**：机器人 OBB vs 场地元素（墙、障碍物）——场地元素几何随赛季场地包走。

### 6.3 路径调解编辑与导出（v1.4 新增）

**定位：调解器，不是编辑器。** 编辑的目的是「消解已发现的冲突」，不是「创作新路径」——从零画路径仍引导用户回 Choreo/PathPlanner（§7.3-2 修订后的边界）。

- **编辑能力（P2）**：拖拽路点/控制点、增删路点；编辑后即时重跑碰撞检测——所见即所得的调解闭环；与起步延迟 what-if 可组合使用；
- **不破坏原文件原则**：编辑产生**派生副本**（会话内标记「已修改」），导入的原始文件保持只读；导出为用户主动动作，文件名默认带 `-adjusted` 后缀防混淆；
- **时间重参数化**：几何改动后轨迹时间轴需重算——直接复用 Phase 2 移植的轨迹生成器（同一份代码支撑「PP 导入」与「编辑重算」，双重回报）；Choreo 路径编辑在此期间可降级为「保留原时间分布、仅重映射几何」+ 警告标注；
- **导出格式与难度（关键洞察：导出比导入容易一个量级）**：
  - `.path`：文件本就只存路点+控制点+约束（无采样状态）——从统一模型回写即可，机器人端 PathPlannerLib 自会生成轨迹，**无需生成算法**；
  - `.ghostauto`：自家兼容格式，直接写；
  - `.traj`：需写路点+采样状态，采样由重参数化产出（同上复用生成器）；
  - `.auto` 例程级编辑（等待/命令序列）后置到触发式轨道（§7.3-3）；
- **互操作回归**：导出文件必须在原工具中可打开——「导出 .traj → Choreo GUI 打开」「导出 .path → PathPlanner 打开」加入发版回归（样本回归集的**反向**用例）。

### 6.4 用户自配 AI 直接操作（v1.4 新增）

让策略组用自然语言完成调解：「把 2 号机延迟 0.5 秒避开碰撞，然后导出全部路径」。

- **协议与配置**：OpenAI 兼容协议（chat/completions + tools/function calling）已是事实标准——GLM（方舟 endpoint）、OpenAI、DeepSeek、本地 Ollama 均可接入；设置面板提供预设 + 自定义 base URL / model / API Key 三项；
- **密钥纪律（红线级）**：API Key 仅存 localStorage，**严禁进入会话文件、URL 分享、导出物、日志、截图**；URL 会话分享必须剥离 AI 配置（分享出去的链接不含 Key）；
- **操作机制：Action API**。core/ui 分层下天然存在一个与 UI 同源的纯函数命令集（modifyWaypoint / setStartDelay / setAlliance / regenerateTrajectory / exportFile / queryCollisions…）——UI、测试、AI 是同一命令集的三个消费者，AI 没有任何特权通道；LLM 侧用 function calling 描述命令 schema；
- **安全与可控**：动作白名单校验——**不 eval、不执行模型返回的代码**，只把模型输出映射到命令枚举与参数 schema（外部内容不可信红线的延伸）；每条 AI 动作入 undo 栈并在界面显示动作摘要；导出/删除类动作需用户确认；会话内可随时一键断开 AI；
- **隐私定位**：默认关闭；开启时显式提示「路径数据将发送至你配置的 AI 服务商」；配 Ollama 本地模型可做到数据不出本机——纯前端红线按 AGENTS.md v1.4 增补口径执行（用户自配、自带 Key、主动开启的调用不属「上传」；我们仍无后端、无遥测）；
- **免责边界**：AI 修改只是加速调解，碰撞结论始终来自确定性检测器，不依赖 AI 判断。
- **harness 参考实现（v1.5 增补，2026-08-27 核查）**：两套开源 harness 指定为设计参考——**DeepSeek Harness（DSH）**（[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)，MIT，「一切皆插件」/Cordis 框架，TS 优先 monorepo，自带 `dsh web` 浏览器形态）与 **OpenAI Codex harness**（[openai/codex](https://github.com/openai/codex)，Apache-2.0，Rust 实现：agent loop + 沙箱化工具执行 + 审批分级）。许可证均与本项目兼容（参考设计不受限）。由此提炼五条落地纪律：
  1. **Action 自描述注册制**（DSH 插件思想的收窄版）：每个 Action = { 名称、描述、参数 JSON Schema、handler、后果分级 }，注册进统一注册表——function calling 的工具 schema 从注册表自动生成，UI 按钮 / AI / 测试三方消费同一注册表，改一处全生效；
  2. **审批两档**（Codex approval policy 的领域化）：低危动作（调延迟、改参数、查询冲突）自动执行 + 界面显示动作摘要；高后果动作（导出、删除、批量修改）必须用户逐次确认；
  3. **沙箱 = 会话**（Codex 沙箱思想的领域化）：AI 只能经 Action 操作会话内状态，接触不到文件系统与网络——导出是唯一出口且属高后果档；
  4. **工具结果紧凑回喂**（Codex 上下文纪律）：queryCollisions 之类查询返回结构化 JSON（机器人对/时刻区间/最小间距），不 dump 全会话；对话设轮数上限，防失控循环与 token 浪费；
  5. **Action API 随 core 走 semver**（DSH 预览期「必有破坏性变更」警示的反面教训）：命令集 schema 是 AI 提示词的依赖面，破坏性变更照 §九 的 core 纪律走 ADR + 通知。
  可行性佐证：DSH 与本项目同为 TS 栈且本身提供浏览器形态，证明「浏览器内跑 agent runtime」是成熟做法；Codex 的 AGENTS.md 约定（本项目正在使用）也源自该生态——给 AI 一份应用内「操作 runbook」作为系统提示上下文，是其验证过的模式。

---

## 七、技术选型与架构方向

- **纯前端 SPA**：Vite + TypeScript + React，部署 GitHub Pages（零后端、零数据库、零成本；用户文件不出浏览器——隐私即信任）；
- **分层**：
  - `core`（可独立发包）：parsers（.traj/.ghostauto/.path/.auto → 统一轨迹模型）+ merge（时间轴融合、联盟归一化、延迟 what-if）+ collision（OBB-SAT）——纯函数、零 DOM；
  - `ui`：画布渲染（canvas 2D 足够——轨迹是低密度矢量，无需 WebGL）、时间轴、导入管理、设置；
- **AI 友好**：TS/React 训练语料最丰富（沿用 GHPaths 报告 §六之选型理由）；core 层纯函数天然好测；
- **从 GHPaths 搬运清单**：`field-model` 类型设计与坐标系约定、2D 画布（多图层/坐标变换/拖拽缩放）交互范式、时间轴组件思路、i18n 机制、工程纪律（AGENTS.md 已落地）；
- **许可证**：自有代码 **Apache-2.0**（2026-08-26 用户定稿；与所参考移植的 PathPlanner MIT / Choreo BSD-3 兼容——宽松许可并入只需保留来源声明，且 Apache-2.0 自带专利授权条款，对社区分发更稳妥）；参考来源许可见 AGENTS.md 红线 §2；FIRST 场地素材条款每次发版复查；
- **测试策略**：实物样本文件回归集（Phase 0 起每个格式收集正例+损坏例，防止格式版本漂移悄悄弄坏解析）。

### 7.1 分发与安装体验（v1.1 定稿：免费为纲）

- **主形态 = 网页，天然免分发**：GitHub Pages 静态托管（免费、无后端），用户打开链接即用——不存在安装、Gatekeeper、签名公证、更新批准等任何环节；「不付费」目标在本形态下自动达成。GHPaths 报告 §7.5 论证的那套桌面分发难题，本项目的主形态直接绕开。
- **Mac 端两种使用/安装方式（当前形态）**：
  1. **网页直用**（零安装）：浏览器打开即用，链接发群即分享；
  2. **PWA 安装**（免费、一次点击）：Safari「添加到 Dock」/ Chrome「安装」——独立窗口、Dock 图标、离线能力（service worker 只缓存静态资源；路径文件本就在用户本地，离线可用性天然完整）。
- **国内可达性（待发版实测）**：GitHub Pages 在国内部分网络环境慢或不可达，而本项目受众含中国赛区各队；可选 Cloudflare Pages（或同类免费静态托管）做镜像，发布页主备双链接——均为纯静态托管，不违反纯前端红线。
- **桌面版（v1.6 由触发式轨道提前为正式范围，用户指令「像 GHPaths 一样做成一个软件」）**——Tauri 包装的静态壳：无 sidecar、无后端进程，加载与网页完全同源的构建产物，功能零分叉；网页仍是主形态（对外队的零安装卖点不变），桌面版服务本机/离线/习惯桌面软件的用户。分发**沿用 GHPaths ADR-0007 v2 免费分发定稿，不重开决策**：Mac 两种安装方式 = ① GitHub Releases 浏览器下载 dmg（每台 Mac 首装一次性「仍要打开」+ 密码，约 30 秒，PathPlanner/Choreo 同款免费上限）+ ② 终端一行安装 / Homebrew cask（零弹窗）；升级走应用内更新；**不购 Apple Developer Program（$99/年）**——AdvantageScope 档的零警告安装需要付费签名公证，已随 GHPaths 决策放弃。
- **发版 checklist 项**：发布页固定含——网页主链接 + 镜像链接、（桌面版时期）安装包与浏览器/终端/Homebrew 三渠道图文教程、当赛季 FIRST 场地素材条款复查记录（AGENTS.md 红线 §2）。

### 7.2 语言设置：简体中文 / 繁體中文 / English（v1.1 新增）

沿用 GHPaths §8.7 / ADR-0008 方案骨架，按本项目（网页、国际社区受众）适配：

- **入口与行为**：网页顶栏设置菜单提供三语切换；默认跟随系统语言，手动选择后覆盖（localStorage 持久化）；切换即时生效无需刷新；
- **实现**：react-i18next + 三份语言包（`zh-Hans` / `zh-Hant` / `en`）；**繁体起步策略 = OpenCC 从简体自动转换 + FRC 术语表人工校对**（控制「保险杠」「轮组」「联盟」等术语的两岸差异），后续按维护成本决定是否双份维护；
- **覆盖范围**：全部 UI 文案（导入、错误提示、碰撞报告、设置）；**数据不翻译**（文件名、路径名、队号、字段名）；
- **节奏**：i18n 机制骨架随 Phase 1 MVP 就位，**简中 + 英文双语先行**——受众是国际 FRC 社区，英文是 Chief Delphi 发布帖的硬门槛；繁体 OpenCC 转换与三语全量覆盖放 Phase 3 UI 文案冻结时（太早做会随界面迭代反复重翻）。

### 7.3 工程纪律与方法论（v1.2 新增：自 GHPaths 报告 v1.14 移植适配）

姊妹报告在长期迭代中沉淀了一套防膨胀、防漂移的工程规矩，逐项评估后移植到本项目（不适用的——演出安全门、Preflight 闸门、多设备接管、DS/NT 协议——均已剔除）：

**(1) 功能甄别的「单一事实来源」+ 准入规矩**（源自 GHPaths §9.1 / §10.6）：

- §6.1 功能清单即「要不要做某个功能」的单一事实来源，后续需求变化在原表更新而非另起炉灶；
- **准入检验**：每个新功能入册前须能回答「**哪次联盟协调会用到它**」——答不上来就不进计划书。功能清单的增长由真实使用痛点与用户指令驱动，不接受头脑风暴式续期；
- 本项目功能面收窄为「**查看器 + 分析器 + 调解器**」（v1.4 修订：原为查看器+分析器）：调解器 = 改既有路径消解冲突 + 导出（§6.3）；**从零创作路径的完整编辑器仍是定位漂移**，准入规矩继续防守这条线。

**(2) 明确不做清单（附理由）**（源自 GHPaths §10.5 的形式）：

| 不做的事 | 理由 |
|---|---|
| 从零创作路径的完整编辑器（新建空白路径、从零绘制） | v1.4 修订：**调解式编辑**（改既有路径消冲突 + 导出，§6.3）已入册，但「从零画路径」仍不做——Choreo/PathPlanner 是成熟创作工具，重复造轮子零增量；创作需求引导用户回原工具，本项目只管「合在一起看 + 微调消冲突」 |
| 账号体系 / 云端会话同步 | 纯前端红线（报告 §七）；分享已由 URL hash + 会话文件双路径覆盖 |
| 实时遥测 / 实时位置监控 | 那是 GHPaths（NT4/演出）与 AdvantageScope（log 回放）的地盘；本项目是赛前静态分析，混入实时会稀释定位 |
| 机器人端代码 / vendordep | 越界：本项目不接触机器人；`.traj` 互操作已由 PPLib 官方承担 |
| 通用数据绘图/数值表（log 分析器形态） | 同 AdvantageScope 重复；WPILOG 对比（P3）限定为「规划 vs 实测轨迹叠加」，不做通用 log 分析 |

**(3) 触发式轨道**（源自 GHPaths §10.14 的「目标入册、架构就位、执行等触发」方法）：原 P3「观望」项升格为可操作的触发式轨道——不做空头排期，各写明触发条件：

| 轨道 | 触发条件（满足其一即立项） | 架构准备（现在已做） |
|---|---|---|
| WPILOG 导入（规划 vs 实测） | CD 发布后社区反馈「想做复盘对比」信号集中；或本社团自身 offseason 复盘需求 | 统一轨迹模型可直接吃实测位姿序列；TS 读库已有现成（npm `wpilog-parser`） |
| 103 式 LAN 实时同步 | 社区强烈要求（多帖/多队）；文件模式被证明不够用 | 无（纯增量，不污染 core） |
| Cloudflare Pages 国内镜像 | 部署后国内可达性实测不达标 | 纯静态托管，零代码改动 |

**(4) 发版就绪非功能清单**（源自 GHPaths §10.8「比新功能更值钱、不写代码也能推进」的思路）：

1. **《策略组使用指南》**（Runbook）：三步上手图文（开链接 → 拖文件 → 读碰撞报告）+ what-if 延迟调解实例 + 常见格式问题 FAQ——写指南时暴露的工具缺口即下一批真功能的正确来源。随 v0.1 发布成稿，按社区反馈迭代；
2. **发版回归 = 既有 16 项真实浏览器走查**（导入/碰撞/回放/倍速/三语/分享/越界/赛季/自定义场地/PP 批量/会话下载/SW 注册/零控制台错误）——每次公开发版前全量过一遍（对应 GHPaths「整场演出自动回归测试」的等价物）；
3. **首版范围定死**：v0.1 = 当前 P0/P1/P2 全集 + 已就位的 Phase 3 项（三语/PWA/AprilTag/URL 分享），不再临发版加功能；
4. FIRST 素材条款复查——已入 docs/releasing.md（2026-08-26 已完成一轮）。

**(5) 机器人参数的数据来源分层**（源自 GHPaths §10.15 硬件画像的三层数据源设计，本项目已实现、v1.2 入册为原则）：每台机器人的几何/配置按可靠性分层取值——①**文件自带**（`.ghostauto` 的保险杠尺寸/轮组位，可靠主源）＞②**默认值 + 明确警告**（`.path`/`.traj` 用 PathPlanner GUI 默认机器人配置生成，UI 常驻「timing is an estimate」警告）＞③**用户手调**（robot 卡片几何编辑，会话内覆盖、不改原文件）。任何新增参数都先回答「它在哪一层」。

**(6) PWA service worker 的版本更新策略**（源自 GHPaths §10.13「ChatGPT 式自动更新」精神的 Web 形态适配）：网页没有「更新仪式」，但有**缓存陈旧**问题——SW 缓存的静态资源在新版本发布后仍会服役。纪律：SW 缓存以构建产物 hash 文件名为键（内容寻址，天然免陈旧），`index.html` 本身走 network-first；发版后用户刷新页面即拿到新版，无需特殊迁移。此项列入发版回归的 SW 检查。

### 7.4 主题与视觉规范（v1.7 新增）

- **双主题**：深色 / 浅色各一套完整调色板；**默认跟随系统**（`prefers-color-scheme` 实时联动，系统切换即时生效）；Preferences 提供三态选择（跟随系统 / 深色 / 浅色），**用户手动选择后记忆**（localStorage，跨启动保留）；
- **深色规范**：弃用早期的深蓝底 + 高饱和青强调（「AI 生成感」的来源）——改为**中性灰阶**，对标 Xcode / Safari 深色模式与 Codex、Typeless 的克制风格：近黑灰底（#1e1e20 系）、面板灰（#252528 系）、文字近白（#e6e6e8 系）、强调色用系统蓝（#0a84ff）；
- **浅色规范**：Safari/Xcode 浅色同构——浅灰底（#f5f5f7）、白面板、近黑文字（#1d1d1f）、系统蓝强调（#0071e3）；
- **实现纪律**：全部界面颜色走 CSS 变量令牌（`:root`/`[data-theme]` 双套），组件禁止硬编码色值；画布（2D/3D）绘制色从同一组令牌读取，保证深浅一致；两主题均为发版回归走查项。

---

## 八、替代与降级方案

| 场景 | 替代方案 | 代价 |
|------|---------|------|
| PP 轨迹生成移植受阻/延期 | 维持 `.ghostauto` 路径：教程引导 PP 队用 103 fork 导出 | PP 队多装一个工具；功能等 PP 移植完成 |
| 罕用路径约束无法精确复现 | 按无约束近似生成 + 明确警告标注 | 个别路径时间轴有偏差，碰撞结论需人工复核 |
| FIRST 场地素材条款收紧 | 用户自导入场地（P2 的场地导入提前） | 首次使用多一步配置 |
| 社区采用率不及预期 | 作为本社团内部工具继续服役（联盟协调自用）；GHPaths 仍可引用其 core | 项目价值收窄，损失有限（纯前端维护成本低） |
| 103 fork 上游合并 ghost 功能 | 它仍不支持 Choreo、仍绑桌面编辑器——差异化仍在 | 需强化「融合查看器」定位（多格式、网页、策略组导向） |

---

## 九、风险清单

| 风险 | 等级 | 缓解 |
|------|------|------|
| PP 轨迹生成移植工作量超预期 | 中 | 双语言参考（Java lib + Dart GUI）；分阶段（P2 才做）；罕用约束降级近似；`.ghostauto` 兜底路径全程可用 |
| `.traj`/`.ghostauto` 格式随版本漂移 | 低中 | 实物样本回归测试集；格式版本探测；解析容错（明确报错不崩溃） |
| Choreo/PathPlanner 新赛季格式变更 | 低 | 样本回归集 + 社区反馈渠道（CD 发布帖）；kickoff 后例行验证 |
| 红蓝归一化做错导致碰撞结论失真 | 中（正确性） | 变换规则对齐 WPILib 官方语义；用红蓝对称样本文件专项测试；UI 明示每台机器人的联盟归属 |
| 场地素材版权 | 低 | AS/PP 内置先例充分；发版 checklist 复查当赛季条款 |
| 社区采用率不足 | 中 | 零安装+零上传+Choreo 通吃三卖点；CD 发布时机锚定 kickoff； offseason 先积累种子用户 |
| 国内访问 GitHub Pages 慢/不可达 | 中 | Cloudflare Pages 免费静态镜像，发布页主备双链接；发版前实测（§7.1） |
| （远期桌面版）免费分发首装需「仍要打开」仪式 | 低 | 沿用 GHPaths ADR-0007 v2：Releases 页三步图文引导 + 终端/Homebrew 零弹窗渠道 + 应用内更新；当前主形态为网页，此项仅桌面版成立 |
| 与 GHPaths 抢开发资源 | 中 | 两项目排期显式分界；本项目 MVP 刻意收窄（不含 PP 移植） |
| 依赖单人维护 | 低（纯前端） | core 纯函数 + 样本回归集降低维护门槛；Apache-2.0 开源接受社区 PR |
| core 包 API 破坏性变更波及 GHPaths（v1.2 新增——其 Phase 3 依赖本 core，见 §4.3） | 中 | core 按 semver 发包；破坏性变更（解析器签名/统一模型字段/碰撞接口）一律走 ADR 并在其合入前通知 GHPaths 侧；79 个 core 测试即 API 契约的回归防线 |
| 桌面版 Gatekeeper「仍要打开」仪式（v1.6 新增） | 低 | ad-hoc 签名保留（同 GHPaths）；发版页三步图文引导；终端解压渠道零弹窗 |
| SW 缓存导致用户停留在旧版本（v1.2 新增） | 低 | 已实现内容寻址策略（§7.3-6）：hash 资产 cache-first、文档 network-first——刷新即得新版；SW 检查列入发版回归 |
| 调解编辑的重参数化与原轨迹时间偏差（v1.4 新增） | 中 | 复用 Phase 2 生成器保证同源；Choreo 路径降级「保留时间分布仅重映射几何」+ 警告；编辑副本与原文件隔离，可随时丢弃重来 |
| 导出文件被原工具拒开 / 格式保真（v1.4 新增） | 中 | 「导出 → Choreo/PathPlanner 回开」互操作测试入发版回归；格式字段按实物样本反写 |
| AI 功能稀释隐私承诺 / API Key 泄露（v1.4 新增） | 中 | 默认关闭 + 显式数据流向告知；Key 仅存 localStorage 且严禁进分享/导出/日志（红线级纪律，AGENTS.md 已增补）；URL 分享剥离 AI 配置 |
| AI 误操作损坏会话 / 注入风险（v1.4 新增） | 低 | Action API 白名单（不执行模型返回的代码）+ undo 栈全程可撤销 + 导出类动作需确认；碰撞结论不依赖 AI |

---

## 十、分阶段路线图

**Phase 0 —— 样本驱动验证（约 1~2 周）**
1. 收集实物样本：自装 Choreo 画 2~3 条路径导出 `.traj`；自装 PathPlanner 导出 `.path`/`.auto`；从 103 fork 仓库/社区获取 `.ghostauto` 样例或格式文档——**样本先于代码**；
2. 起仓库骨架（Vite+TS+React+workspaces，core/ui 分层），2026 官方场地一张；
3. 里程碑：拖入一个 `.traj`，在场地画布上按时序回放单条轨迹。

**Phase 1 —— 融合 MVP（约 2~4 周）**
`.traj` + `.ghostauto` 多文件融合、统一时间轴回放、OBB 碰撞检测与冲突报告、红蓝归属、会话保存/截图；i18n 机制骨架就位（**简中 + 英文双语**——英文是 CD 发布硬门槛，§7.2）。**发布 v0.1 上 GitHub Pages**——此版本已对 Choreo 队和 PP 队（经 .ghostauto）可用，即可去 CD 发帖收集反馈。**发布同时将 core 以 semver 发 npm 包**（v1.2 注明：GHPaths Phase 3 已入册依赖本包，发包纪律见 §4.3/§7.3）。

**Phase 2 —— PathPlanner 原生导入（约 1~2 月）**
轨迹生成移植（先核实 Dart GUI 参考实现）→ `.path` 主流约束覆盖 → `.auto` 例程语义（等待、路径串接）。罕用约束降级近似 + 警告。

**v0.2 —— 调解与标识（v1.4 规划，v0.1 发布后约 2~4 周）**
机器人队号标注（§6.1）→ 路径调解编辑 + 三格式导出（§6.3）+ 导出回开互操作回归。队号标注小而独立可先行；编辑/导出与 2027 kickoff 适配可并行。

**v0.2.5 —— 桌面版（v1.6 规划，随 v0.2 交付）**
Tauri 打包（GHPaths 产线复制改造）：纯静态壳 + CSP 放行用户自配 AI 端点 + SW 限定浏览器上下文；本机构建 .app/.dmg 冒烟；对外分发待 GitHub 放行后随发版走。

**v0.3 —— AI 操作（v1.4 规划，依赖 v0.2）**
Action API 固化（UI/测试同源的命令集，本就是好架构）→ OpenAI 兼容接入 + 密钥纪律 + undo 审计（§6.4）。AI 的主要操作对象是 v0.2 的编辑与导出命令，故排其后。

**Phase 3 —— 发布打磨与赛季节奏（按 2027 kickoff 倒排）**
多赛季场地+用户导入（含 AprilTag，§6.1）、URL 分享、PWA（§7.1）、繁体 OpenCC 转换与三语全量覆盖（§7.2）、WPILOG 对比与桌面离线版按**触发式轨道**推进（§7.3-3，触发条件满足才立项）。**2027-01 kickoff 前就位**，赶上「各队画新 auto」的需求高峰；kickoff 后第一时间适配 2027 场地与格式变更。

> 工期为数量级估计，AI 辅助开发可显著压缩；Phase 0 的样本收集环节不可省略（格式事实以实物为准）。

---

## 十一、结论

- **有没有人做过同款？** 没有。「同时吃 Choreo + PathPlanner 规划文件、融合给策略组看」的工具不存在；最近邻 103 fork（2026-03）只覆盖 PathPlanner、绑桌面编辑器，恰好验证了需求、留出了空位。
- **能不能做？** 能。MVP 所需的两种格式（`.traj`/`.ghostauto`）都自带采样状态，纯解析即回放，无算法风险；唯一硬骨头（PP 轨迹生成移植）有 MIT 双参考实现、有兜底路径、且不阻塞 MVP。
- **做成什么形态？** 独立仓库、纯前端网页（GitHub Pages）、文件本地解析零上传；core 层做成可独立发包的纯函数库——v1.2 起这是 GHPaths 已入册的既定依赖（其 §10.9/ADR-0013），不再是单向预留。
- **安装体验什么样（v1.1 定稿）？** 网页零安装为主（打开链接即用）+ PWA 一键安装为辅，全程免费——GHPaths 那套桌面「仍要打开」难题在主形态下不存在；远期桌面版才涉及，方案沿用不重开（Mac 双渠道：浏览器下载 + 终端/Homebrew，不购开发者账号）。语言：简中/繁中/英三语，简中+英文随 MVP 首发。
- **最该立刻做什么？** Phase 0 第一步：把三类实物样本文件各拿到手（`.traj`、`.ghostauto`、`.path`/`.auto`）——一天之内就能确认三种格式的真实结构，报告里所有「以实物为准」的论断随之定案。

---

## 参考资料

市场与竞品（2026-08-25 核查）：

- [FRC Team103 Presents - Collaborative PathPlanner Fork — Chief Delphi](https://www.chiefdelphi.com/t/frc-team103-presents-collaborative-pathplanner-fork/517640)
- [Cybersonics/Collaborative_Pathplanner_103_Fork — GitHub](https://github.com/Cybersonics/Collaborative_Pathplanner_103_Fork)
- [How do teams develop autos between matches? — Chief Delphi](https://www.chiefdelphi.com/t/how-do-teams-develop-autos-between-matches/520053)
- [How do you talk to alliance partners about auto compatibility? — Chief Delphi](https://www.chiefdelphi.com/t/how-do-you-talk-to-alliance-partners-about-auto-compatibility-in-reefscape/484448)
- [Team 353 POBots Open Alliance（电子表格查 auto 冲突的先例）— Chief Delphi](https://www.chiefdelphi.com/t/frc-353-pobots-open-alliance-2025/474528)
- [Choate-Robotics/AutoBOARd（单机可视化小工具参照）— GitHub](https://github.com/Choate-Robotics/AutoBOARd)

格式与生态：

- [Choreo 官网与文档](https://choreo.autos/) ／ [Saving（.chor 与 .traj 分工）](https://choreo.autos/usage/saving/) ／ [Choreo 2026 发布帖 — Chief Delphi](https://www.chiefdelphi.com/t/choreo-2026/510723)
- [SleipnirGroup/Choreo — GitHub（BSD-3）](https://github.com/SleipnirGroup/Choreo)
- [mjansen4857/pathplanner — GitHub（MIT）](https://github.com/mjansen4857/pathplanner) ／ [PathPlanner 官网](https://pathplanner.dev/)
- [PathPlannerLib 与 Choreo 互操作](https://pathplanner.dev/pplib-choreo-interop.html)
- [Introducing PathPlanner 2.0（欢迎各语言移植的官方表态）— Chief Delphi](https://www.chiefdelphi.com/t/introducing-pathplanner-2-0/397629)
- [AdvantageScope Log Files（格式支持清单；确认不开 .traj/.path）](https://docs.advantagescope.org/overview/log-files/) ／ [多文件时间对齐](https://docs.advantagescope.org/overview/log-files/)
- [wpilog-parser（TS 读 WPILOG）— npm](https://www.npmjs.com/package/wpilog-parser)

姊妹项目：

- GHPaths 可行性研究报告（v1.14，内部姊妹项目文档，不在本仓库；演出多机演控；field-model/画布/i18n 复用来源与工程纪律母本；其 §10.9/ADR-0013 已入册引用本项目 core 包——本报告 §4.3 的依据；其 §10.6/§10.8/§10.14 等工程方法论为 §7.3 移植来源）

分发与语言（v1.1 增补，方案来源 GHPaths）：

- GHPaths 报告 §7.5 分发与安装体验 / ADR-0007（免费分发定稿，内部文档）——桌面版双渠道方案母本
- GHPaths 报告 §8.7 语言设置 / ADR-0008（三语方案，内部文档）——i18n 方案母本
- [macOS Code Signing（Tauri v2 官方签名/公证指南）](https://v2.tauri.app/distribute/sign/macos/)
- [Apple removes Control-click option for skipping Gatekeeper in macOS Sequoia — AppleInsider](https://appleinsider.com/articles/24/08/06/apple-removes-control-click-option-for-skipping-gatekeeper-in-macos-sequoia)

AI harness 参考实现（v1.5 增补，2026-08-27 核查）：

- [deepseek-ai/deepseek-harness（DSH，MIT，「一切皆插件」）— GitHub](https://github.com/deepseek-ai/deepseek-harness) ／ [DeepSeek Harness 产品页（Creator mode）](https://deepseek.com/harness/en/)
- [openai/codex（Apache-2.0，agent loop + 沙箱 + 审批分级）— GitHub](https://github.com/openai/codex) ／ [How OpenAI built Codex: inside the agent loop and harness — SWE Quiz](https://swequiz.com/articles/openai-codex-architecture) ／ [Harness engineering — OpenAI](https://openai.com/index/harness-engineering/)（正文页 403，结论经仓库与公开分析交叉）

---

*本报告基于 2026-08-25 的公开资料调研与当周讨论定稿（v1.0）；2026-08-26 v1.1 增补分发与安装（§7.1，免费定稿）、三语方案（§7.2）与场地导入细节（对齐 GHPaths §8.7/§8.8）；同日 v1.2 全量对齐姊妹报告 GHPaths v1.14——§4.3 升格为既定集成计划、新增 §7.3 工程纪律与方法论、风险与路线图相应增补（来源：用户指令 2026-08-26）；同日 v1.3 定稿自有代码许可证为 Apache-2.0（用户指令）；2026-08-27 v1.4 新增三大功能入册——队号标注、调解编辑与多格式导出（§6.3）、用户自配 AI 操作（§6.4）——并修订 §7.3 不做清单、纯前端红线适配（AGENTS.md 同步增补）与风险/路线图（用户指令）；同日 v1.5 增补 §6.4 的 harness 参考实现研究（DSH + Codex，Action API 五条落地纪律，用户指令）。同日 v1.6 桌面版提前入册（用户指令）并补齐 harness 纪律落地项。同日 v1.7 增补 §7.4 主题与视觉规范（深浅双主题跟随系统 + 中性灰深色，用户指令）。`.traj`/`.ghostauto`/`.path`/`.auto` 的精确 JSON 字段以 Phase 0 实物样本为准；PathPlanner GUI（Dart）生成逻辑的可参考性以源码核实为准。市场结论有效期：至 103 fork 上游或 Choreo/PathPlanner 官方发布同类功能为止（见 §八、§九）。*
