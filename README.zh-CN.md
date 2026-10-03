# PathBlender

[English](README.md) | **简体中文** | [繁體中文](README.zh-Hant.md)

**面向 FRC 联盟策略协作的多源自动路径融合查看器。**

把联盟伙伴各队导出的自动路径文件融合到同一场地上：统一时间轴回放 + 碰撞/干涉检查，供**策略组**赛前协调——不只是编程组的工具。它是一个**查看器**：分析手头的自动程序、找出冲突、回到所属工具改路径、重新导入、再查一遍。

![3D 场地视图](docs/screenshots/field3d.png)

## 为什么做这个

FRC 资格赛和淘汰赛中，联盟的三台机器人同时在同一块场地上跑自动程序。各队用不同的工具（Choreo、PathPlanner）规划路径，但没有人能看到所有路径放在一起会不会撞——直到比赛中真的撞了。

PathBlender 补上这个空缺：

- **多工具链导入**——Choreo `.traj`、103 队 Collaborative fork `.ghostauto`、原生 PathPlanner `.path` / `.auto`（轨迹生成已移植到 TypeScript——没有其他浏览器工具能做到这点）；
- **统一时间轴回放**——所有机器人在同一条自动时钟上（15 秒；2026 赛季 20 秒），播放/暂停/拖动/变速（0.25×–1×）；
- **碰撞与干涉检查**——全程保险杠矩形 OBB 重叠检测，冲突报告（谁和谁、什么时刻、在哪里）、越界标记、最小间距报告；
- **3D 场地视图**——2022–2026 官方场地 3D 模型（焊接场/AndyMark 场两种结构有差异时都提供），自由环绕、一键适配；无公开官方模型的赛季（2018–2020）保持 2D。2D 视图每个赛季提供示意图与渲染图两种底图，叠加官方 AprilTag 布局；
- **路线库**（桌面版）——整包导入一个队伍的 deploy 目录：无关文件自动跳过，所有路线进入路线库，每台机器人旁的选择器实时切换当前自动；PathPlanner `settings.json` 可把真实保险杠尺寸应用到机器人；

- **零安装、零上传（网页版）**——纯静态网页应用，文件解析完全在你的浏览器里完成，网页构建**不发出任何网络请求**；
- **也有桌面版**——同一界面装入轻量 Tauri 壳（macOS），增加会话保存/打开、PNG 导出、文件夹导入与应用内更新（stable 或 beta 通道）。唯一的网络活动是你主动触发的检查更新，只连接 GitHub Releases。

## 快速上手

1. 获取应用（见下）——手头没有路径文件时，先按欢迎页的**试试示例**载入内置多机器人会话，立刻体验回放与碰撞检查。
2. 把各队的路径文件导入——`.traj`、`.ghostauto`、`.path`、`.auto` 随意混拖（桌面版支持单个文件或整个文件夹；`.auto` 引用到的每个 `.path` 必须同批导入）。坏文件会逐个报错说明原因，不影响其他文件导入。
3. 按**播放**。冲突处：场地红色圆环 + 时间轴红色区段 + 冲突面板列出「谁和谁、什么时刻、在哪里」——点一条跳到那个瞬间。
4. 排查：从路线库给机器人换一条路线、切换联盟视角、拨动时间轴。确定问题所在后，回到所属队伍的工具修改、重新导出、把新文件拖进来——会话原地更新。
5. **分享**：保存会话文件、或导出 PNG 发群（桌面版功能）。

![碰撞报告](docs/screenshots/collision-report.png)

## 支持的格式

| 格式 | 来源 | 说明 |
|---|---|---|
| `.traj` | Choreo（BSD-3） | 所有已知 schema 版本；时间采样状态 |
| `.ghostauto` | Collaborative fork（103 队，MIT） | 自带保险杠几何与队名 |
| `.path` | PathPlanner（MIT） | 本地生成轨迹——移植的 PathPlannerLib 算法 |
| `.auto` | PathPlanner（MIT） | 路径序列 + 等待/命令语义 |
| `settings.json` | PathPlanner（MIT） | 该项目机器人的保险杠尺寸 |
| `.ghpb.json` | 本项目 | 会话文件：全部机器人 + 设置 + 场地 |

场地：内置 FRC 2018–2020 与 2022–2026（2021 沿用 2020 场地、无独立公开素材），另支持自定义场地导入（标定 + WPILib/PhotonVision AprilTag 布局 JSON）。

## 获取方式

- **macOS 桌面版**（Apple Silicon，macOS 13+）——从 [GitHub Releases](https://github.com/LYT259/pathblender/releases) 下载 `PathBlender_<版本号>_aarch64.dmg`，打开后把 PathBlender 拖入「应用程序」。更新：菜单 **PathBlender → 检查更新…**（Beta 版先在 **偏好设置 → 更新** 打开 Beta 通道）。Windows 与 Linux 安装包暂未提供——代码跨平台，已在计划中。发布页上的其它文件（`.tar.gz`、`.sig`、`.json`）是更新器内部文件，无需下载。
- **网页版**（查看器构建：导入、回放与检查；无会话保存/PNG 导出/文件夹导入）——[pathblender.pages.dev](https://pathblender.pages.dev)，预览通道 [pathblender-preview.pages.dev](https://pathblender-preview.pages.dev)。

## 隐私

路径文件**完全在你的设备上解析**。零后端、零账号、零遥测、零分析。网页构建不发出任何网络请求；桌面版只有你主动点「检查更新」时才联网（访问 GitHub Releases）——路径文件绝不离开应用。

另含：会话级红蓝联盟视角、机器人队号标注、上述赛季场地与官方 AprilTag 叠加、七语界面——English / 简体中文 / 繁體中文（台灣）/ 繁體中文（中國香港）/ Français / Español / Türkçe——深浅色主题跟随系统。

完整操作指南与 FAQ：[English](docs/user-guide.en.md) · [简体中文](docs/user-guide.zh.md)。

## 反馈

Bug、格式漂移报告、赛季场地问题正是我们需要的反馈。请到
[github.com/LYT259/pathblender/issues](https://github.com/LYT259/pathblender/issues)
提 issue——[反馈模板](docs/community/feedback-template.md)说明该写哪些内容（绝不会要求你公开路径文件）。社区讨论见项目的 Chief Delphi 发布帖。

## 状态

上述查看器范围已实现并通过回归测试（单元测试套件 + 脚本化真实浏览器走查）。桌面版从 [GitHub Releases](https://github.com/LYT259/pathblender/releases) 发布。

## 许可与归因

**Apache-2.0**——见 [LICENSE](./LICENSE) 和 [NOTICE.md](./NOTICE.md)。PathPlanner（MIT）、Choreo（BSD-3）、AdvantageScope 素材（BSD-3）、WPILib（BSD-3）各自保持原有许可，在 NOTICE 中逐一致谢。

场地美术与赛事名称归 FIRST 所有，按 FIRST 商标与版权材料政策用于非商业队伍策略用途，每次公开发版前复查：

> FIRST®、FIRST® Robotics Competition 和 FIRST® Tech Challenge 是 FIRST®（www.firstinspires.org）的注册商标，FIRST® 未监督、未参与、也不对本活动、产品或服务负责。
