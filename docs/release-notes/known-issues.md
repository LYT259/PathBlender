# Known issues & limitations / 已知问题与限制

> Maintenance note: this file is embedded verbatim into every GitHub Release
> body and updater feed by `scripts/release-notes-for.mjs`. Keep it
> user-facing, bilingual (EN + 简体中文), and current — a fixed issue MUST be
> removed here in the same release that fixes it.

- **PathPlanner `.path` timing is an estimate** — `.path` files store
  waypoints only; the trajectory is regenerated locally with a generic robot
  profile, so timeline timing can differ from the real robot by a few hundred
  milliseconds. Treat near-miss collision verdicts as advisory.
  `.path` 轨迹时间为估算值——文件只存路径点，时间轴按通用机器人参数本地重算，
  与实车可能相差几百毫秒；临界碰撞结论请当作参考。
- **Season coverage** — fields 2022–2026 are built in. Other seasons
  (2018–2021 and earlier) have no bundled assets; they can still be used
  through custom field import (field image + calibration, AprilTag layout
  optional). 赛季覆盖 2022–2026；2018–2021 及更早赛季无内置素材，可走自定义
  场地导入（场地图片 + 标定，AprilTag 布局可选）。
- **Desktop installers are macOS-only for now** (Apple Silicon). Windows and
  Linux builds are planned. 桌面安装包当前仅 macOS（Apple Silicon），
  Windows/Linux 计划中。
- **Update checks contact GitHub** (desktop only): checking for updates
  downloads the feed and, when an update exists, the package from GitHub
  Releases. Path files are still parsed entirely locally and never leave the
  app. 桌面版检查更新会连接 GitHub 下载更新源与更新包；路径文件始终本地解析、
  绝不上传。
