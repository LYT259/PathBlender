# PathBlender

[English](README.md) | **简体中文** | [繁體中文](README.zh-TW.md)

**面向 FRC 联盟策略协作的多源自动路径融合查看器。**

把联盟伙伴各队导出的自动路径文件融合到同一场地上：统一时间轴回放 + 碰撞/干涉检查，供策略组赛前协调。

![3D 场地视图](docs/screenshots/field3d.png)

## 为什么做这个

FRC 资格赛和淘汰赛中，联盟的三台机器人同时在同一块 26×54 英尺的场地上跑自动程序。各队用不同的工具（Choreo、PathPlanner）规划路径，但没有人能看到所有路径放在一起会不会撞——直到比赛中真的撞了。

PathBlender 补上这个空缺：

- **多工具链导入**——Choreo `.traj`、103 队 Collaborative fork `.ghostauto`、原生 PathPlanner `.path` / `.auto`（轨迹生成已移植到 TypeScript——没有其他浏览器工具能做到这点）；
- **统一时间轴回放**——所有机器人在同一条 15 秒自动时钟上，播放/暂停/拖动/变速（0.25×–4×）；
- **碰撞与干涉检查**——全程保险杠矩形 OBB 重叠检测，冲突报告（谁和谁、什么时刻、在哪里）、越界检测、最小间距报告；**一键消解**自动寻找让所有冲突消失的最小起步延迟组合；
- **3D 场地视图**——2022–2026 官方场地 3D 模型（含焊接场/AndyMark 场两种结构变体），自由环绕视角 + Onshape 式 ViewCube 一键回标准视角；2D 视图为快速战术叠加层；
- **路径编辑器**——独立工作区（Choreo/PathPlanner 风格）：场地上拖路点或侧栏精确数值编辑；每次改动即时重算轨迹并可导出回 `.path` / `.traj` / `.ghostauto`；

  ![路径编辑器](docs/screenshots/editor.png)

- **可选 AI 助手**（默认关闭，自带密钥）——智谱 Z.ai / Claude（Anthropic）/ OpenAI / DeepSeek / 本地 Ollama；组合器式对话界面（斜杠命令、技能、附件、权限档位），只执行白名单命令，碰撞结论永远来自确定性检测器；

  ![AI 组合器](docs/screenshots/ai-composer.png)

- **零安装、零上传**——纯静态网页应用，文件解析完全在你的浏览器里完成（上述 AI 调用是唯一的网络功能，严格用户自配且默认关闭）；
- **也是桌面软件**——同一构建以轻量 Tauri 壳发布（无后端、无 sidecar），支持应用内自动更新。Windows 和 Linux 安装器将在后续版本发布。

## 快速上手

1. 用任意现代浏览器打开（发布后的链接见上方）；或启动桌面版 App。
2. 把各队的路径文件拖进窗口——`.traj`、`.ghostauto`、`.path`、`.auto` 随意混拖。多选有效；坏文件会报错说明原因，不影响其他文件导入。
3. 按**播放**。碰撞风险处：场地红色圆环 + 时间轴红色区段 + 右侧冲突面板列出「谁和谁、什么时刻、在哪里」——点一条跳到那个瞬间，或按**一键消解**获取最小延迟方案。
4. 微调：**起步延迟**（what-if，不改原文件）、机器人联盟/几何/队号，或打开**路径编辑器**修改路点。
5. **分享**：保存会话文件、复制分享链接（整个会话压缩进网址——不上传任何服务器）、或导出 PNG 发群。

![碰撞报告](docs/screenshots/collision-report.png)

## 支持的格式

| 格式 | 来源 | 说明 |
|---|---|---|
| `.traj` | Choreo（BSD-3） | 所有已知 schema 版本；时间采样状态 |
| `.ghostauto` | Collaborative fork（103 队，MIT） | 自带保险杠几何与队名 |
| `.path` | PathPlanner（MIT） | 本地生成轨迹——移植的 PathPlannerLib 算法 |
| `.auto` | PathPlanner（MIT） | 路径序列 + 等待/命令语义 |
| `.ghpb.json` | 本项目 | 会话文件：全部机器人 + 设置 + 场地 |

## 隐私

路径文件**完全在你的浏览器里解析**。零后端、零账号、零遥测、零分析——应用不发出任何网络请求。分享链接只包含压缩后的会话数据本身（在 URL 哈希中，除非你复制否则不离开页面）。API 密钥仅存本地存储，绝不进入会话文件、分享链接、导出物或日志。

另含：红蓝联盟归一化、机器人几何编辑与队号标注、八个赛季场地（2018–2020、2022–2026——2021 年无公开正射场地素材）带官方 AprilTag 叠加、自定义场地导入（标定 + WPILib/PhotonVision JSON）、深浅色主题跟随系统，界面三语（English / 简体中文 / 繁體中文）。

![多机融合](docs/screenshots/multi-robot-fusion.png)
![简体中文界面](docs/screenshots/i18n-zh.png)

完整操作指南与 FAQ：
[English](docs/user-guide.en.md) ·
[简体中文](docs/user-guide.zh.md)。

## 状态

可工作的 MVP——上述全部功能已实现并通过回归测试（127 个自动化测试 + 真实浏览器走查）。尚未公开部署。完整规划见[《可行性研究报告》](./PathBlender_可行性研究报告.md)。

## 许可与归因

**Apache-2.0**——见 [LICENSE](./LICENSE) 和 [NOTICE.md](./NOTICE.md)。PathPlanner（MIT）、Choreo（BSD-3）、AdvantageScope 素材（BSD-3）、WPILib（BSD-3）各自保持原有许可，在 NOTICE 中逐一致谢。

场地美术与赛事名称归 FIRST 所有，按 FIRST 商标与版权材料政策用于非商业队伍策略用途，每次公开发版前复查：

> FIRST®、FIRST® Robotics Competition 和 FIRST® Tech Challenge 是 FIRST®（www.firstinspires.org）的注册商标，FIRST® 未监督、未参与、也不对本活动、产品或服务负责。
