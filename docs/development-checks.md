# Development checks

Run these commands from the repository root. See also [release checks](releasing.md).

## Verification

Four checks, all run locally — none of them ships with the app:

| Layer | Command | What it proves |
| --- | --- | --- |
| Unit + jsdom suites | `npm test` (or `-w @pathblender/core` / `-w @pathblender/web`) | Parsers, geometry, fusion and collision maths, and component behaviour in a simulated DOM. |
| Pointer walkthrough | `npm run build -w @pathblender/web && npm run preview -w @pathblender/web`, then `node scripts/browser-walkthrough.mjs` | The production build driven with a real mouse and real files: folder import, the composer's click-and-drag placement, save/restore through an actual download, all 43 languages including RTL, artwork repaints, service worker, and 3D (model, lit robots, ViewCube picks, season switches). |
| Keyboard walkthrough | same preview server, then `node scripts/keyboard-walkthrough.mjs` | The same app driven with the keyboard only — every main workflow has to be completable without a mouse. |
| Website gate check | `VITE_VIEWER_ONLY=1 npm run build -w @pathblender/web`, then `node scripts/serve-dist.mjs 4179` and `VIEWER_BASE=http://localhost:4179/ node scripts/viewer-check.mjs` | The hosted viewer build keeps import, playback, collision checking and timeline arranging, asks nothing outside its own origin on load, follows the OS language on first visit — and cannot write a file out through any route, including the Ctrl/Cmd+S accelerators that have no button at all. Re-run it whenever a save or export affordance moves. |

All three browser harnesses print `PASS`/`FAIL` per step, exit non-zero on any
failure and save screenshots to `/tmp/pb-shots`. Run them after any
user-visible change and before a release; when the UI changes, update the
harness in the same pull request — a check that targets a retired control
fails the next person rather than protecting them.

中文：以上四项都只在本机跑、不随软件发布。单元测试验算法与组件行为；两个
走查脚本在真实浏览器里把成品点一遍（一个只用鼠标，一个只用键盘）；最后一条是网站
门控自查——发布出去的查看器构建要留住导入/回放/检查/编排，首屏不发本站以外的
请求、首访跟随系统语言，同时任何入口都不能写文件（包括根本没有按钮的
Ctrl/Cmd+S 快捷键）。改动界面或导出入口时，请在同一个 PR 里同步这些脚本。
