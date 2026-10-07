# PathBlender

[English](README.md) | [简体中文](README.zh-CN.md) | **繁體中文（中國香港）** | [Español](README.es.md) | [Français](README.fr.md) | [Türkçe](README.tr.md) | [Português (Brasil)](README.pt-BR.md) | [עברית](README.he.md)

**面向 FRC 聯盟策略協作的多源自動路徑融合檢視器。**

> **比賽前：把聯盟各隊的自動路徑放到同一塊場地上，同時播放，趁還來得及改方案的時候發現機器人之間的衝突。**

把聯盟夥伴各隊匯出的自動路徑檔案融合到同一場地上：統一時間軸回放 + 碰撞/干涉檢查，供**策略組**賽前協調——不只是程式組的工具。它是一個**檢視器**：分析手上的自動程式、找出衝突、回到所屬工具改路徑、重新匯入、再查一遍。

![3D 場地視圖](docs/screenshots/field3d.png)

## 為什麼做這個

FRC 資格賽與淘汰賽中，聯盟的三台機器人同時在同一塊場地上跑自動程式。各隊用不同的工具（Choreo、PathPlanner）規劃路徑，但沒有人能看到所有路徑放在一起會不會撞——直到比賽中真的撞了。

PathBlender 補上這個空缺：

- **多工具鏈匯入**——Choreo `.traj`、103 隊 Collaborative fork `.ghostauto`、原生 PathPlanner `.path` / `.auto`（軌跡生成已移植到 TypeScript——沒有其他瀏覽器工具能做到這點）；
- **統一時間軸回放**——所有機器人在同一條自動時鐘上（15 秒；2026 賽季 20 秒），播放/暫停/拖動/變速（0.25×–1×）；
- **碰撞與干涉檢查**——全程保險桿矩形 OBB 重疊檢測，衝突報告（誰和誰、什麼時刻、在哪裡）、越界標記；
- **3D 場地視圖**——2022–2026 官方場地 3D 模型（焊接場/AndyMark 場兩種結構有差異時都提供），自由環繞、一鍵適配；自訂匯入的場地維持 2D。2D 視圖每個賽季提供示意圖與渲染圖兩種底圖，疊加官方 AprilTag 佈局；
- **路線庫**——整包匯入一個隊伍的 deploy 目錄：無關檔案自動跳過，所有路線進入路線庫，每台機器人旁的選擇器即時切換目前自動；PathPlanner `settings.json` 可把真實保險桿尺寸套用到機器人；

- **零安裝、零上傳（網頁版）**——純靜態網頁應用，檔案解析完全在你的瀏覽器裡完成，網頁建構**不發出任何網路請求**；
- **也有桌面版**——同一介面裝入輕量 Tauri 殼（macOS、Windows、Linux），增加工作階段儲存/開啟、GIF 回放與方案包匯出、應用內更新（stable 或 beta 通道）。唯一的網路活動是你主動觸發的檢查更新，只連線 GitHub Releases。

## 快速上手

1. 取得應用（見下）——手上沒有路徑檔案時，先按歡迎頁的**試試範例**載入內建多機器人工作階段，立刻體驗回放與碰撞檢查。
2. 把各隊的路徑檔案匯入——`.traj`、`.ghostauto`、`.path`、`.auto` 隨意混合（網頁版與桌面版都支援單一檔案或整個資料夾；`.auto` 引用到的每個 `.path` 必須同批匯入）。壞檔案會逐一報錯說明原因，不影響其他檔案匯入。
3. 按**播放**。衝突處：場地紅色圓環 + 時間軸紅色區段 + 衝突面板列出「誰和誰、什麼時刻、在哪裡」——點一條跳到那個瞬間。
4. 排查：從路線庫幫機器人換一條路線、切換聯盟視角、撥動時間軸。確定問題所在後，回到所屬隊伍的工具修改、重新匯出、把新檔案拖進來——工作階段原地更新。
5. **分享**：儲存工作階段檔案，或匯出 2D 視圖的 GIF 回放／方案包傳群組（桌面版功能）。

![碰撞報告](docs/screenshots/collision-report.png)

## 支援的格式

| 格式 | 來源 | 說明 |
|---|---|---|
| `.traj` | Choreo（BSD-3） | 所有已知 schema 版本；時間取樣狀態 |
| `.ghostauto` | Collaborative fork（103 隊，MIT） | 自帶保險桿幾何與隊名 |
| `.path` | PathPlanner（MIT） | 本地生成軌跡——移植的 PathPlannerLib 演算法 |
| `.auto` | PathPlanner（MIT） | 路徑序列 + 等待/命令語義 |
| `settings.json` | PathPlanner（MIT） | 該專案機器人的保險桿尺寸 |
| `.pb` | 本專案 | 工作階段檔案：全部機器人 + 設定 + 場地（舊名 `.ghpb.json` 仍可開啟） |

場地：內建 FRC 2022–2026，另支援自訂場地匯入（標定 + WPILib/PhotonVision AprilTag 佈局 JSON）——其他賽季或練習場地可走自訂匯入。

## 取得方式

- **macOS**（macOS 13+；Apple Silicon 與 Intel 一個通用包）——從 [GitHub Releases](https://github.com/LYT259/pathblender/releases) 下載 `PathBlender_<版本號>_universal.dmg`，打開後把 PathBlender 拖入「應用程式」。
- **Windows**（x86_64）——同一發布頁的 `*_x64-setup.exe` 安裝包。
- **Linux**（x86_64）——同一發布頁的 DEB / AppImage / RPM 包。應用內更新走 AppImage；DEB/RPM 使用者下載新套件覆蓋安裝即可更新。
- 更新：選單 **PathBlender → 檢查更新…**（Beta 版先在 **偏好設定 → 更新** 開啟 Beta 通道）。發布頁上的其它檔案（`.tar.gz`、`.sig`、`.json`）是更新器內部檔案，無需下載。
- **網頁版**（檢視器建構：與桌面版相同的匯入——單一檔案或整個資料夾——加上回放與檢查；無工作階段儲存/開啟、GIF 回放與方案包匯出）——[pathblender.pages.dev](https://pathblender.pages.dev)。

## 隱私

路徑檔案**完全在你的裝置上解析**。零後端、零帳號、零遙測、零分析。網頁建構不發出任何網路請求；桌面版只有你主動點「檢查更新」時才連網（存取 GitHub Releases）——路徑檔案絕不離開應用程式。

另含：工作階段級紅藍聯盟視角、機器人隊號標註、上述賽季場地與官方 AprilTag 疊加、40 種介面語言——English / 简体中文 / 繁體中文（中國香港）/ Français / Español / Deutsch / Italiano / Português (Brasil) / Nederlands / Polski / Čeština / Türkçe / Ελληνικά / עברית / العربية / हिन्दी / 日本語 / 한국어，完整清單見介面語言選單——深淺色主題跟隨系統。

完整操作指南與 FAQ：[English](docs/user-guide.en.md) · [简体中文](docs/user-guide.zh.md)。

## 回饋

Bug、格式漂移報告、賽季場地問題正是我們需要的回饋。請到
[github.com/LYT259/pathblender/issues](https://github.com/LYT259/pathblender/issues)
提 issue——[回饋範本](docs/community/feedback-template.md)說明該寫哪些內容（絕不會要求你公開路徑檔案）。社群討論見專案的 Chief Delphi 發布帖。

## 狀態

上述檢視器範圍已實作並通過回歸測試（單元測試套件 + 腳本化真實瀏覽器走查）。桌面版從 [GitHub Releases](https://github.com/LYT259/pathblender/releases) 發布。

## 授權與歸因

**Apache-2.0**——見 [LICENSE](./LICENSE) 與 [NOTICE.md](./NOTICE.md)。PathPlanner（MIT）、Choreo（BSD-3）、AdvantageScope 素材（BSD-3）、WPILib（BSD-3）各自保持原有授權，在 NOTICE 中逐一致謝。

場地美術與賽事名稱歸 FIRST 所有，按 FIRST 商標與版權材料政策用於非商業隊伍策略用途，每次公開發版前複查：

> FIRST®、FIRST® Robotics Competition 和 FIRST® Tech Challenge 是 FIRST®（www.firstinspires.org）的註冊商標，FIRST® 未監督、未參與、也不對本活動、產品或服務負責。
