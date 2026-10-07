# Known issues & limitations

> The release generator embeds the matching language section below. Remove fixed issues in the same change that fixes them. Installer availability is derived from the release artifact manifest.

<!-- language: en -->

- **PathPlanner `.path` timing is an estimate** — trajectories are regenerated locally with a generic robot profile. Timing can differ from the real robot; treat near-miss collision results as advisory.
- **Season coverage** — built-in fields cover 2022–2026. Other seasons require custom field import (field image and calibration; AprilTag layout is optional).
- **Update checks contact GitHub** — the desktop app downloads update feeds and packages from GitHub Releases. Path files remain local and are never uploaded.

<!-- language: zh -->

- **PathPlanner `.path` 时间为估算值**——轨迹按通用机器人参数在本地重算，时间可能与实车不同；临界碰撞结论请当作参考。
- **赛季覆盖**——内置场地覆盖 2022–2026；其他赛季需导入自定义场地（场地图片与标定，AprilTag 布局可选）。
- **检查更新会连接 GitHub**——桌面版从 GitHub Releases 下载更新源和更新包；路径文件始终留在本地，绝不上传。

<!-- language: zh-hk -->

- **PathPlanner `.path` 時間為估算值**——軌跡按通用機械人參數在本機重新計算，時間可能與實際機械人不同；臨界碰撞結果請作參考。
- **賽季涵蓋範圍**——內建場地涵蓋 2022–2026；其他賽季需匯入自訂場地（場地圖片與校準，AprilTag 佈局為選填項目）。
- **檢查更新會連接 GitHub**——桌面版從 GitHub Releases 下載更新來源和安裝套件；路徑檔案始終留在本機，絕不上傳。
