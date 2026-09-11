# PathBlender

[English](README.md) | [简体中文](README.zh-CN.md) | **繁體中文**

**面向 FRC 聯盟策略協作的多源自動路徑融合檢視器。**

把聯盟夥伴各隊匯出的自動路徑檔案融合到同一塊場地上：統一時間軸回放 + 碰撞/干涉檢查，供策略組賽前協調。

![3D 場地視圖](docs/screenshots/field3d.png)

## 為什麼做這個

FRC 資格賽和淘汰賽中，聯盟的三台機器人同時在同一塊 26×54 英尺的場地上跑自動程式。各隊用不同的工具（Choreo、PathPlanner）規劃路徑，但沒有人能看到所有路徑放在一起會不會撞——直到比賽中真的撞了。

PathBlender 補上這個空缺：

- **多工具鏈匯入**——Choreo `.traj`、103 隊 Collaborative fork `.ghostauto`、原生 PathPlanner `.path` / `.auto`（軌跡生成已移植到 TypeScript——沒有其他瀏覽器工具能做到這點）；
- **統一時間軸回放**——所有機器人在同一條 15 秒自動時鐘上，播放/暫停/拖動/變速（0.25×–1×）；
- **碰撞與干涉檢查**——全程保險槓矩形 OBB 重疊檢測，衝突報告（誰和誰、什麼時刻、在哪裡）、越界檢測、最小間距報告；**一鍵消解**自動尋找讓所有衝突消失的最小起步延遲組合；
- **3D 場地視圖**——2022–2026 官方場地 3D 模型（含焊接場/AndyMark 場兩種結構變體），自由環繞視角 + Onshape 式 ViewCube 一鍵回標準視角；2D 視圖為快速戰術疊加層；
- **路徑編輯器**——獨立工作區（Choreo/PathPlanner 風格）：場地上拖路點或側欄精確數值編輯；每次改動即時重算軌跡並可匯出回 `.path` / `.traj` / `.ghostauto`；

  ![路徑編輯器](docs/screenshots/editor.png)

- **可選 AI 助手**（預設關閉，自帶密鑰）——智譜 Z.ai / Claude（Anthropic）/ OpenAI / DeepSeek / 本地 Ollama；組合器式對話介面（斜線命令、技能、附件、權限檔位），只執行白名單命令，碰撞結論永遠來確定性檢測器；

  ![AI 組合器](docs/screenshots/ai-composer.png)

- **零安裝、零上傳**——純靜態網頁應用，檔案解析完全在你的瀏覽器裡完成（上述 AI 呼叫是唯一的網絡功能，嚴格使用者自配且預設關閉）；
- **也是桌面軟體**——同一建構以輕量 Tauri 殼發布（無後端、無 sidecar），支援應用內自動更新。Windows 和 Linux 安裝器將在後續版本發布。

## 快速上手

1. 用任意現代瀏覽器開啟（發布後的連結見上方）；或啟動桌面版 App。
2. 把各隊的路徑檔案拖進視窗——`.traj`、`.ghostauto`、`.path`、`.auto` 隨意混拖。多選有效；壞檔案會報錯說明原因，不影響其他檔案匯入。
3. 按**播放**。碰撞風險處：場地紅色圓環 + 時間軸紅色區段 + 右側衝突面板列出「誰和誰、什麼時刻、在哪裡」——點一條跳到那個瞬間，或按**一鍵消解**獲取最小延遲方案。
4. 微調：**起步延遲**（what-if，不改原檔案）、機器人聯盟/幾何/隊號，或開啟**路徑編輯器**修改路點。
5. **分享**：儲存會話檔案、複製分享連結（整個會話壓縮進網址——不上傳任何伺服器）、或匯出 PNG 發群。

![碰撞報告](docs/screenshots/collision-report.png)

## 支援的格式

| 格式 | 來源 | 說明 |
|---|---|---|
| `.traj` | Choreo（BSD-3） | 所有已知 schema 版本；時間取樣狀態 |
| `.ghostauto` | Collaborative fork（103 隊，MIT） | 自帶保險槓幾何與隊名 |
| `.path` | PathPlanner（MIT） | 本地生成軌跡——移植的 PathPlannerLib 演算法 |
| `.auto` | PathPlanner（MIT） | 路徑序列 + 等待/命令語義 |
| `.ghpb.json` | 本專案 | 會話檔案：全部機器人 + 設定 + 場地 |

## 隱私

路徑檔案**完全在你的瀏覽器裡解析**。零後端、零帳號、零遙測、零分析——應用不發出任何網路請求。分享連結只包含壓縮後的會話資料本身（在 URL 雜湊中，除非你複製否則不離開頁面）。API 金鑰僅存本地儲存，絕不進入會話檔案、分享連結、匯出物或日誌。

另含：紅藍聯盟歸一化、機器人幾何編輯與隊號標註、八個賽季場地（2018–2020、2022–2026——2021 年無公開正射場地素材）帶官方 AprilTag 疊加、自訂場地匯入（標定 + WPILib/PhotonVision JSON）、深淺色主題跟隨系統，介面三語（English / 簡體中文 / 繁體中文）。

![多機融合](docs/screenshots/multi-robot-fusion.png)
![簡體中文介面](docs/screenshots/i18n-zh.png)

完整操作指南與 FAQ：
[English](docs/user-guide.en.md) ·
[簡體中文](docs/user-guide.zh.md)。

## 狀態

可工作的 MVP——上述全部功能已實現並通過回歸測試（自動化測試 + 真實瀏覽器走查）。尚未公開部署。

## 授權與歸因

**Apache-2.0**——見 [LICENSE](./LICENSE) 和 [NOTICE.md](./NOTICE.md)。PathPlanner（MIT）、Choreo（BSD-3）、AdvantageScope 素材（BSD-3）、WPILib（BSD-3）各自保持原有授權，在 NOTICE 中逐一致謝。

場地美術與賽事名稱歸 FIRST 所有，按 FIRST 商標與版權材料政策用於非商業隊伍策略用途，每次公開發版前複查：

> FIRST®、FIRST® Robotics Competition 和 FIRST® Tech Challenge 是 FIRST®（www.firstinspires.org）的註冊商標，FIRST® 未監督、未參與、也不對本活動、產品或服務負責。
