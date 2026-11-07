# HOOT 桌面导入（官方 owlet 转换 → WPILOG 管线）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 桌面版直接选择 `.hoot` 日志，首次同意条款后从 CTRE 官方分发点运行时下载 owlet 转换器，本地转成 `.wpilog` 并完整复用现有 WPILOG 导入管线；网页版对 `.hoot` 给出明确的「用桌面版或预转换」提示。

**Architecture:** 不解析、不逆向 `.hoot` 二进制格式。core 只新增一个纯函数 probe（读工作包已核实的 compliancy 字段做准入判断）；Rust shell 新增一个 `hoot` 模块，负责 EULA 同意状态、owlet 的官方 index 解析 / 下载 / SHA-1 校验、以及调用官方 CLI `owlet -f wpilog in out` 的转换命令；web 侧在 `importFiles` 入口按 `.hoot` 分流——桌面走 EULA/下载/转换对话框后把产物塞进现有 `wpilogQueue`，浏览器给出明确提示。产物进入 `WpilogImportDialog` 后与今天的 `.wpilog` 完全同路（位姿/时段选择、碰撞、会话、导出全部复用）。

**Tech Stack:** TypeScript（`@pathblender/core` + React web，Vitest）、Rust（Tauri v2，`cargo test`）、CTRE 官方 owlet（运行时下载，不进依赖树、不进仓库）、i18n 40 语言字典。

**Spec:** 本计划自带的「Spec 基线」（下方引文，来自 2026-11-07 工作包分配的已核实事实，一手来源已逐项复核）+ 私有《PathBlender 红皮书》§6.1 / §7.3-3 / 格式矩阵中 HOOT 行（后续待办：不上传日志、手工转换不算原生支持、需先核查官方工具与许可）。红皮书为私有文件，不在仓库内；执行者只需本计划即可开工。

### Spec 基线（2026-11-07 已核实，执行时以此为准）

- `.hoot` 无公开二进制格式规范、无 WASM 解码器——**禁止逆向格式**（CTRE EULA 禁止逆向；再分发需许可）。
- owlet 是 CTRE 官方转换器，分发于 `https://redist.ctr-electronics.com/index.json`（实测 2026-11-07 抓取）：`Tools[]` 中 `Name == "owlet"` 的条目含多个 `Items[]`，每项有 `Version`（如 `25.0.1`）、`Compliancy`（如 `10`）与 `Urls` 映射；平台工件键为 `macosuniversal`、`windowsx86-64.exe`、`linuxx86-64`（另有 linuxarm32/64，本项目用不到），每个工件同时发布 `…-sha1` 与 `…-md5`（**无 sha256**）。
- 官方 CLI 用法（Phoenix 6 官方文档 Signal Logging 页，v6.docs.ctr-electronics.com）：`owlet -f wpilog "input.hoot" "output.wpilog"`。
- `.hoot` 文件头偏移 70 处为 compliancy 版本字段，**< 6 不被任何 owlet 版本支持**（工作包核实；`index.json` 的 `ChannelCompliancy` 表佐证：2024 通道 = 6）。字段宽度/端序以小端 u32 实现，**待真实样本核验**（见「外部不可验收项」）。
- **无真实 `.hoot` 样本**（合法渠道未获得）。全部测试用合成桩；真实转换链路验证挂起，不得伪造。
- 商业红线：owlet 不捆绑、不再分发；首次使用必须显式同意条款；用户日志零上传（本地转换、临时文件用后删除）。

## Global Constraints

- **零上传**：用户日志与转换产物只在本地处理；不新增任何网络上报；Rust/web 均不得把日志内容写入日志文件或打印。
- **不逆向**：对 `.hoot` 的唯一读取是 core probe 的 compliancy 字段（偏移 70，u32 LE，`< 6` 拒绝）；不解析其余任何字节。
- **不捆绑**：owlet 二进制永不进入仓库、CI 产物或依赖声明；只在用户首次导入时从 `redist.ctr-electronics.com` 下载，且必须先经用户同意（EULA 对话框 → `hoot_accept_eula` 落盘后才允许下载/转换）。
- **许可**：自有代码 Apache-2.0；新增依赖仅 `sha1`（RustCrypto，MIT OR Apache-2.0，商用友好）；`reqwest`/`tempfile` 沿用 Cargo.lock 既有版本（reqwest 0.13.4、tempfile 3.27.0，transitive 已在树内，不得顺手升级）。
- **平台**：转换仅桌面（macOS `macosuniversal`、Windows `windowsx86-64.exe`、Linux `linuxx86-64`）；其余平台返回 `hoot-unsupported-platform`；网页构建永远只给提示。
- **测试诚实**：无真实样本——不得把合成字节声称为真实 `.hoot`；测试名与注释必须标明 stub；真实链路验证列入「外部不可验收项」。
- **i18n 完整性**：新增 `hoot.*` 键必须补齐所有完整字典（40 语言纪律，`en.ts` 为基准；typecheck 的 `Record<MessageKey, string>` 会强制列出缺漏）。
- **工程纪律**：Tauri v2 invoke 参数 camelCase；Node ≥23.6；提交信息英文、一任务一提交；不改红皮书/工程日志（私有文件，worktree 内不存在）；对外文档文案简洁。
- **合并前**（收尾，非本计划任务内代码）：按 AGENTS.md 跑 `node scripts/bump-version.mjs beta "…"` 及三端验证流程。

## Review Focus

1. **浏览器里丢入 `.hoot`** —— 用户最可能的操作；必须得到「桌面版可转 / Phoenix Tuner 预转换」的明确提示，而不是今天的通用解析报错。测试钉在 Task 7。
2. **compliancy < 6 的旧日志** —— 必须在进 owlet 之前就被拒并说明原因，不产生无意义的转换失败。测试钉在 Task 1（probe）与 Task 7（分流）。
3. **owlet 非零退出 / stderr** —— 转换失败必须逐文件报出 stderr 尾部，成功的文件照常导入，不整批报废。测试钉在 Task 5（Rust 错误映射）与 Task 8（多文件部分成功）。
4. **下载损坏或哈希不符** —— 校验失败必须删净半成品、报错可重试；不得把坏文件当成已下载状态。测试钉在 Task 4。
5. **二次导入（已同意、已下载）** —— 不得再弹 EULA、不得再联网；同时文件 compliancy 高于已下载 owlet 的 compliancy 时要提示「日志比转换器新」。测试钉在 Task 3、Task 4 与 Task 8。

---

### Task 1: core HOOT probe（纯函数 + 导出）

**Files:**
- Create: `packages/core/src/parsers/hoot.ts`
- Modify: `packages/core/src/index.ts`（在 wpilog 导出块旁追加导出）
- Test: `packages/core/test/hoot-probe.test.ts`

**Interfaces:**
- Consumes: 无（不依赖 wpilog 模块）。
- Produces（后续 Task 7/8 依赖的精确签名）:
  ```ts
  export const HOOT_COMPLIANCY_OFFSET = 70;   // 工作包已核实；真实样本待验
  export const HOOT_MIN_COMPLIANCY = 6;
  export type HootProbeResult =
    | { kind: 'convertible'; compliancy: number }
    | { kind: 'rejected'; reason: 'truncated' | 'compliancy-too-old'; compliancy: number | null };
  export function isHootFileName(name: string): boolean;      // /\.hoot$/i
  export function probeHootFile(bytes: Uint8Array): HootProbeResult;
  ```

- [ ] **Step 1: 写失败测试**（全部用合成字节，测试文件头注释注明「合成桩，无真实样本」）

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HOOT_COMPLIANCY_OFFSET, HOOT_MIN_COMPLIANCY, isHootFileName, probeHootFile } from '../src/parsers/hoot';

/** 合成 .hoot 桩：全零字节，仅在 compliancy 偏移写入小端 u32。 */
function stubHoot(compliancy: number, len = 128): Uint8Array {
  const b = new Uint8Array(len);
  new DataView(b.buffer).setUint32(HOOT_COMPLIANCY_OFFSET, compliancy, true);
  return b;
}

describe('hoot probe (synthetic stubs only)', () => {
  it('routes by file name', () => {
    expect(isHootFileName('Log.hoot')).toBe(true);
    expect(isHootFileName('a.hoot.bak')).toBe(false);
  });
  it('accepts compliancy >= 6 and reports the number', () => {
    expect(probeHootFile(stubHoot(6))).toEqual({ kind: 'convertible', compliancy: 6 });
    expect(probeHootFile(stubHoot(13))).toEqual({ kind: 'convertible', compliancy: 13 });
  });
  it('rejects compliancy < 6 (no owlet supports it)', () => {
    expect(probeHootFile(stubHoot(5))).toEqual({ kind: 'rejected', reason: 'compliancy-too-old', compliancy: 5 });
    expect(probeHootFile(stubHoot(0))).toEqual({ kind: 'rejected', reason: 'compliancy-too-old', compliancy: 0 });
  });
  it('rejects files shorter than offset+4 as truncated', () => {
    expect(probeHootFile(stubHoot(9, HOOT_COMPLIANCY_OFFSET + 3)))
      .toEqual({ kind: 'rejected', reason: 'truncated', compliancy: null });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**
  Run: `npm test -w @pathblender/core -- hoot-probe`
  Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `packages/core/src/parsers/hoot.ts`**

  文件头注释写明依据（工作包核实事实：偏移 70 compliancy、<6 不支持、小端 u32 为实现选择待真实样本核验）。`probeHootFile`：长度 < 74 → truncated；否则 DataView 读 `getUint32(70, true)`，`>= HOOT_MIN_COMPLIANCY` → convertible。无其他分支。

- [ ] **Step 4: 在 `packages/core/src/index.ts` 导出**（`isHootFileName`、`probeHootFile`、两个常量、`HootProbeResult`，紧邻现有 wpilog 导出块）并跑全量
  Run: `npm test -w @pathblender/core && npm run typecheck -w @pathblender/core`
  Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/parsers/hoot.ts packages/core/src/index.ts packages/core/test/hoot-probe.test.ts
git commit -m "feat(core): probe CTRE .hoot header for converter eligibility"
```

---

### Task 2: Rust — owlet 分发 index 解析、平台键、SHA-1 校验（纯函数）

**Files:**
- Create: `packages/desktop/src-tauri/src/hoot.rs`
- Modify: `packages/desktop/src-tauri/src/lib.rs`（仅加 `mod hoot;`，本任务不动其他）
- Modify: `packages/desktop/src-tauri/Cargo.toml`（加依赖：`sha1 = "0.10"`、`tempfile = "3"`、`reqwest = { version = "0.13", default-features = false, features = ["rustls-tls"] }`）
- Test: `packages/desktop/src-tauri/src/hoot.rs` 内 `#[cfg(test)] mod tests`

**Interfaces:**
- Consumes: Cargo.lock 既有 reqwest 0.13.4 / tempfile 3.27.0（声明后不得引入第二份 TLS 栈）。
- Produces（Task 4/5 依赖）:
  ```rust
  pub struct IndexSelection { pub version: String, pub compliancy: u32, pub url: String, pub sha1: String }
  pub fn platform_artifact_key() -> Option<&'static str>; // cfg: "macosuniversal" | "windowsx86-64.exe" | "linuxx86-64"
  pub fn parse_owlet_index(json: &str, artifact_key: &str) -> Result<IndexSelection, String>;
  pub fn verify_sha1(bytes: &[u8], expected_hex: &str) -> bool;
  ```

- [ ] **Step 1: 写失败测试**（内嵌精简 fixture——用真实抓取的 index.json 裁剪：两个 owlet Items（25.0.0 与 25.0.1），断言取版本号最大者；版本比较按数字元组 `25.0.1 > 1.0.1.1 > 9.x`；缺平台键 → Err；sha1 十六进制大小写不敏感、错值 false；`platform_artifact_key` 在当前编译目标返回非 None）。
  Run: `cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml hoot`
  Expected: FAIL（函数未定义）

- [ ] **Step 2: 实现三个纯函数**（`parse_owlet_index`：serde 解析 `Tools[]` → `Name=="owlet"` → `Items[]` → 版本数字元组取最大 → 从 `Urls` 取 `{artifact_key}` 与 `{artifact_key}-sha1`，缺失即 Err；`verify_sha1`：`sha1::Sha1` 摘要与小写化十六进制比对）。`Cargo.toml` 依赖加注释「reqwest/tempfile 已在 lock（transitive），显式声明复用；sha1 为唯一新增 crate」。
  Run: `cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml hoot`
  Expected: PASS

- [ ] **Step 3: 验证无依赖分叉**
  Run: `cargo tree --manifest-path packages/desktop/src-tauri/Cargo.toml -i reqwest`
  Expected: 仅一个 reqwest 0.13.4 被复用（无版本重复）

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src-tauri/src/hoot.rs packages/desktop/src-tauri/src/lib.rs packages/desktop/src-tauri/Cargo.toml packages/desktop/src-tauri/Cargo.lock
git commit -m "feat(desktop): parse CTRE owlet distribution index and verify artifacts"
```

---

### Task 3: Rust — EULA/下载状态落盘与 `hoot_status` / `hoot_accept_eula` 命令

**Files:**
- Modify: `packages/desktop/src-tauri/src/hoot.rs`

**Interfaces:**
- Consumes: Task 2 的 `IndexSelection`。
- Produces（Task 4/5 与 web Task 6 依赖；serde 字段 camelCase 序列化，Tauri invoke 惯例）:
  ```rust
  #[derive(serde::Serialize, Clone)]
  #[serde(rename_all = "camelCase")]   // 响应字段也走 camelCase（serde 默认 snake_case 会与 web 端类型不符）
  pub struct HootStatus { pub eula_accepted: bool, pub downloaded: bool,
                          pub version: Option<String>, pub compliancy: Option<u32> }
  #[tauri::command] pub async fn hoot_status(app: AppHandle) -> Result<HootStatus, String>;
  #[tauri::command] pub async fn hoot_accept_eula(app: AppHandle) -> Result<HootStatus, String>;
  ```
  状态文件：`{app_cache_dir}/hoot/owlet-state.json`（`HootState { eula_accepted, version, compliancy, sha1, file_name }`）；二进制落 `{app_cache_dir}/hoot/{file_name}`。`downloaded == 文件存在且 state 有记录`。

- [ ] **Step 1: 写失败测试**：状态读写往返（`tempfile::tempdir()` 当 cache dir）——新环境 `{false,false,None,None}`；accept 后 `{true,false,None,None}` 且重启（重新读文件）仍 true；state 记录了 version 但文件缺失 → `downloaded=false`。
  Run: `cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml hoot`
  Expected: FAIL

- [ ] **Step 2: 实现** `HootState` 读写（`load_hoot_state(dir)` / `save_hoot_state(dir,&state)`，原子写 `.tmp` 后 rename；目录不存在则建）与两个命令（薄封装，无其他副作用）。`lib.rs` 暂不注册（Task 5 统一注册）。
  Run: `cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml hoot`
  Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src-tauri/src/hoot.rs
git commit -m "feat(desktop): persist owlet EULA consent and download state"
```

---

### Task 4: Rust — `hoot_download_owlet`（官方下载 + SHA-1 校验 + 进度）

**Files:**
- Modify: `packages/desktop/src-tauri/src/hoot.rs`

**Interfaces:**
- Consumes: Task 2 `parse_owlet_index`/`verify_sha1`/`platform_artifact_key`、Task 3 状态层。
- Produces（web Task 6/8 依赖）:
  ```rust
  #[derive(serde::Serialize, Clone)]
  pub struct DownloadProgress { pub downloaded: u64, pub total: u64 }
  #[tauri::command]
  pub async fn hoot_download_owlet(app: AppHandle, on_progress: tauri::ipc::Channel<DownloadProgress>)
      -> Result<HootStatus, String>;
  ```
  错误码（String 前缀，web 按前缀映射 i18n）：`hoot-eula-required`、`hoot-unsupported-platform`、`hoot-download-failed:{detail}`、`hoot-hash-mismatch:{artifact}`。幂等：已下载且哈希仍符 → 直接返回现状不联网。

- [ ] **Step 1: 写失败测试**（网络隔离——把编排逻辑做成可注入 `fetch` 的纯函数再测）：
  ```rust
  async fn download_via<F: Fn(&str) -> Result<Vec<u8>, String>>(fetch: F, index_json: &'static str, dir: &Path) -> Result<HootStatus, String>
  ```
  测试：①fake fetch 返回与 fixture sha1 一致的字节 → 文件落盘、state 记录 `{version, compliancy, sha1}`、返回 `downloaded=true`；②字节与 sha1 不符 → Err 以 `hoot-hash-mismatch` 开头**且目标文件不存在**（半成品删净）；③未同意 EULA → `hoot-eula-required`；④重复调用第二次 → 不再调用 fetch（计数器断言为 1）。
  Run: `cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml hoot`
  Expected: FAIL

- [ ] **Step 2: 实现**：命令内 `reqwest::get(index_url).await` 取 index.json 文本 → `parse_owlet_index` → 用 `Response::chunk()` 循环累计并 `Channel` 发 `DownloadProgress` → 全量 `verify_sha1` 通过后原子写入最终路径（unix `PermissionsExt::from_mode(0o755)`）→ 写 state。失败路径删除半成品。可注入 seam 覆盖「解析→校验→落盘→幂等」整链；chunk 进度发射只在命令薄壳里，单测不覆盖（三端真机验证兜底）。真实网络不在单测内执行（见「外部不可验收项」）。
  Run: `cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml hoot`
  Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src-tauri/src/hoot.rs
git commit -m "feat(desktop): download official owlet converter with SHA-1 gate"
```

---

### Task 5: Rust — `hoot_convert` 命令 + 注册 + 原生导入过滤器 + 外链白名单

**Files:**
- Modify: `packages/desktop/src-tauri/src/hoot.rs`（convert）
- Modify: `packages/desktop/src-tauri/src/lib.rs:574-582`（invoke_handler 注册 4 个命令）、`lib.rs:636-649`（导入过滤器加 `"hoot"`）、`lib.rs:423-442`（`open_external` 白名单加 CTRE 文档/EULA 域）

**Interfaces:**
- Consumes: Task 3/4 状态与 owlet 路径；Task 2 `verify_sha1`（对已下载文件复核）。
- Produces（web Task 6/8 依赖）:
  ```rust
  #[derive(serde::Serialize)]
  #[serde(rename_all = "camelCase")]   // 序列化为 wpilogName / wpilogBase64，与 Task 6 的 web 类型一致
  pub struct HootConverted { pub wpilog_name: String, pub wpilog_base64: String }
  #[tauri::command]
  pub async fn hoot_convert(app: AppHandle, file_name: String, data: Vec<u8>) -> Result<HootConverted, String>;
  ```
  行为：未同意 → `hoot-eula-required`；未下载/文件缺失 → `hoot-owlet-missing`；`tempfile` 建临时目录写 `{stem}.hoot` → `std::process::Command` 跑 `owlet -f wpilog {in} {out}.wpilog`（参数构造独立成 `pub fn owlet_args(in:&Path,out:&Path)->Vec<String>`）→ 非零退出 → `hoot-convert-failed:{stderr 尾部 ≤500 字符}`；成功读输出字节 base64 返回，`wpilog_name = {stem}.wpilog`。临时目录用后删除（成功失败都删）。**不打印任何文件内容**。
- 白名单：前缀判定抽成纯函数 `pub fn is_allowed_external_url(url: &str) -> bool`（`open_external` 调用它），匹配数组 `["https://github.com/LYT259/pathblender", "https://v6.docs.ctr-electronics.com/", "https://www.ctr-electronics.com/"]`。

- [ ] **Step 1: 写失败测试**：
  - `owlet_args` 断言 `["-f", "wpilog", in, out]`（官方文档钉死）。
  - convert 编排注入 runner：stub runner（把预置 wpilog fixture 字节写到 out 路径）→ 返回值携带原字节与 `stem.wpilog` 名；stub runner 返回非零+stderr → Err 以 `hoot-convert-failed:` 开头且含 stderr 尾部；未同意 EULA → `hoot-eula-required`；转换后临时目录不存在。
  - `open_external` 白名单：`is_allowed_external_url("https://v6.docs.ctr-electronics.com/en/stable/…")` 放行、`("https://evil.example")` 与 `("https://github.com/LYT259/pathblender.evil")` 拒绝（纯函数直测，沿用 `dock_icon_resource_is_a_fixed_whitelist` 风格）。
  Run: `cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml hoot`
  Expected: FAIL

- [ ] **Step 2: 实现 convert 与注册**；lib.rs 过滤器数组加 `"hoot"`（放在 `"wpilog"` 之后）。注册顺序：`hoot_status, hoot_accept_eula, hoot_download_owlet, hoot_convert`。
  Run: `cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml`
  Expected: PASS（含既有 `dock_icon…` 测试）

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src-tauri/src/hoot.rs packages/desktop/src-tauri/src/lib.rs
git commit -m "feat(desktop): convert .hoot via official owlet CLI and gate by EULA"
```

---

### Task 6: web — hoot client（invoke 封装，桌面专用）

**Files:**
- Create: `packages/web/src/hoot/client.ts`
- Test: `packages/web/test/hoot-client.test.ts`

**Interfaces:**
- Consumes: Task 3-5 的命令契约。
- Produces（Task 8 依赖）:
  ```ts
  export interface HootStatus { eulaAccepted: boolean; downloaded: boolean; version: string | null; compliancy: number | null }
  export interface HootConvertedFile { wpilogName: string; wpilogBase64: string }
  export type DownloadProgress = { downloaded: number; total: number };
  export async function hootStatus(): Promise<HootStatus>;
  export async function hootAcceptEula(): Promise<HootStatus>;
  export async function hootDownloadOwlet(onProgress?: (p: DownloadProgress) => void): Promise<HootStatus>; // @tauri-apps/api/core Channel
  export async function hootConvert(fileName: string, data: Uint8Array): Promise<HootConvertedFile>;
  export function hootErrorCode(err: unknown): string | null;  // "hoot-eula-required" 等前缀提取
  ```

- [ ] **Step 1: 写失败测试**（沿用 `app-icon.test.tsx` 的 `vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }))` 惯例，断言命令名、camelCase 参数 `{fileName, data}`、Channel 进度回调透传、base64→Uint8Array 解码、错误字符串前缀提取返回 null 对普通 Error）。
  Run: `npm test -w @pathblender/web -- hoot-client`
  Expected: FAIL

- [ ] **Step 2: 实现**（纯封装，无 UI；`hootErrorCode` 取 `err.message` 的 `hoot-…` 前缀至第一个 `:`）。
  Run: `npm test -w @pathblender/web -- hoot-client`
  Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/hoot/client.ts packages/web/test/hoot-client.test.ts
git commit -m "feat(web): typed client for desktop HOOT conversion commands"
```

---

### Task 7: web — `.hoot` 分流（浏览器提示 / 桌面入队）+ probe 前置拒绝

**Files:**
- Create: `packages/web/src/hoot/gate.ts`
- Modify: `packages/web/src/App.tsx`（`importFiles` 开头，现 `wpilogFiles` 过滤之前，参照 `App.tsx:481-489`）
- Test: `packages/web/test/hoot-gate.test.ts`

**Interfaces:**
- Consumes: Task 1 `isHootFileName`/`probeHootFile`；`App.tsx:140` 的 `IS_DESKTOP`。
- Produces（Task 8 依赖）:
  ```ts
  export type HootGateError =
    | { key: 'hoot.webUnsupported' }
    | { key: 'hoot.tooOld'; vars: { v: number } }
    | { key: 'hoot.truncated' };
  export interface RoutedHoot {
    desktopQueue: Array<{ file: File; relPath: string }>;   // 仅桌面、且 probe convertible
    errors: Array<{ relPath: string } & HootGateError>;
  }
  export async function routeHootFiles(
    incoming: Array<{ file: File; relPath: string }>, isDesktop: boolean,
  ): Promise<RoutedHoot>;
  ```

- [ ] **Step 1: 写失败测试**（纯函数，jsdom）：①浏览器 + `.hoot` → `desktopQueue` 空、errors 含 `hoot.webUnsupported`；②浏览器 + 普通 `.traj` → 两边都空（非 hoot 不归本函数管，由断言『不产生错误』钉住）；③桌面 + compliancy=5 桩（`new File([stubBytes]…)`）→ `hoot.tooOld` vars.v=5；④桌面 + compliancy=9 桩 → 入 desktopQueue；⑤桌面 + 短文件 → `hoot.truncated`。
  Run: `npm test -w @pathblender/web -- hoot-gate`
  Expected: FAIL

- [ ] **Step 2: 实现 gate.ts 并接进 App.tsx**：`importFiles` 在 wpilog 分流前调用 `routeHootFiles`；errors 经 `tr(key, vars)` 追加进 `nextErrors`；`desktopQueue` 非空则 `setHootQueue(prev => […(prev ?? []), …queue])`——`hootQueue` state（`useState<Array<{ file: File; relPath: string }> | null>(null)`）**在本任务创建**（本任务结束时仅 set、不渲染，保证可编译；挂载在 Task 8 补）。同时确保 `.hoot` 不再落进后续 `parsePathFile` 分支（从 `textIncoming` 排除）。
  Run: `npm test -w @pathblender/web -- hoot-gate && npm test -w @pathblender/web -- open-with`
  Expected: PASS（open-with 回归：pb-open-files 交付普通文件不受影响）

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/hoot/gate.ts packages/web/src/App.tsx packages/web/test/hoot-gate.test.ts
git commit -m "feat(web): route .hoot imports to desktop flow with explicit web notice"
```

---

### Task 8: web — `HootImportFlow` 对话框（EULA → 下载 → 逐文件转换 → 复用 WPILOG 管线）

**Files:**
- Create: `packages/web/src/hoot/HootImportFlow.tsx`
- Create: `packages/web/src/hoot/HootImportFlow.css`（沿用 `WpilogImportDialog.css` 的极简风格）
- Modify: `packages/web/src/App.tsx`（`hootQueue` state；挂载于 `WpilogImportDialog` 挂载点旁，`App.tsx:1677-1683`；`finishHootImport` 回调）
- Test: `packages/web/test/hoot-flow.test.tsx`

**Interfaces:**
- Consumes: Task 6 client；Task 7 的 `desktopQueue`；现有 `Dialog` 组件、`useI18n`、`WpilogIncomingFile`。
- Produces（App 接线用）:
  ```ts
  interface HootImportFlowProps {
    files: Array<{ file: File; relPath: string }>;
    onConverted: (files: Array<{ relPath: string; file: File }>) => void; // file 命名 {stem}.wpilog，relPath 保留原目录
    onFailures: (failures: Array<{ relPath: string; message: string }>) => void;
    onCancel: () => void;
  }
  ```
  状态机：挂载即 `hootStatus()`；对每个 file 先 `await file.arrayBuffer()` → `probeHootFile` 复核（Task 7 已过一遍，这里取 compliancy 数值供下述比较）→ 未同意 → EULA 页（条款摘要 + 外链（走 `openProjectOnDesktop` 同款 invoke `open_external`，URL 常量 `CTRE_EULA_URL` 执行时从 v6.docs.ctr-electronics.com 钉取并记入 format-facts）+ 「同意并下载」/「暂不」）；同意 → `hootAcceptEula()` → 下载页（Channel 进度百分比）；完成 → 逐文件 `hootConvert`（显示 `hoot.converting {name}`）；文件 compliancy > `status.compliancy` → 该文件记 `hoot.newerThanConverter` 失败。结束：有产物 → `onConverted`；有失败 → `onFailures`（两者可同时发生）；用户「暂不」→ `onCancel()` 静默退出。错误码经 `hootErrorCode` 映射 i18n，未知前缀回退原文。

- [ ] **Step 1: 写失败测试**（`vi.mock('./client')` 代替真实 invoke；wpilog 产物用 `samples/wpilog/WPILIB_TBD_aba74b981a582b4b.wpilog` 读成桩产物字节）：
  ①未同意 → 渲染 EULA 文案与两个按钮；点「同意并下载」→ 依次调用 `hootAcceptEula`、`hootDownloadOwlet`（进度回调更新百分比）、`hootConvert`（每文件一次，参数为原始文件名+字节）；产物 `onConverted` 的 file 名为 `{stem}.wpilog`；
  ②两文件其一 convert 抛 `hoot-convert-failed:boom` → `onConverted` 含成功者、`onFailures` 含失败者及其 relPath；
  ③已同意已下载（status 直接 true）→ 不渲染 EULA、`hootAcceptEula`/`hootDownloadOwlet` 零调用；
  ④文件 compliancy=99 桩 > status.compliancy=10 → 该文件失败 `hoot.newerThanConverter`、不调用 convert；
  ⑤转换产物为垃圾字节 → `onConverted` 照常上交（后续 `WpilogImportDialog` 的 `wpilog.inspectFailed` 既有路径负责报错——本测试只断言 flow 不自行丢弃）。
  Run: `npm test -w @pathblender/web -- hoot-flow`
  Expected: FAIL

- [ ] **Step 2: 实现对话框与 App 接线**（`finishHootImport`：清 `hootQueue`，`onConverted` 映射成 `WpilogIncomingFile[]` 追加进 `setWpilogQueue`——从这一刻起与手选 `.wpilog` 完全同路；`onFailures` 并入 `setErrors`；不新增其他全局 state）。
  Run: `npm test -w @pathblender/web -- hoot-flow && npm test -w @pathblender/web`
  Expected: PASS（全量 web 回归）

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/hoot/HootImportFlow.tsx packages/web/src/hoot/HootImportFlow.css packages/web/src/App.tsx packages/web/test/hoot-flow.test.tsx
git commit -m "feat(web): EULA/download/convert flow reusing the WPILOG import dialog"
```

---

### Task 9: i18n — `hoot.*` 键补齐全语言

**Files:**
- Modify: `packages/web/src/i18n/en.ts` 及所有被 typecheck 点名的完整字典（`nn.ts` 这类完整表都要补；`en-gb.ts`/`zh-hk.ts`/`zh-mo.ts` 覆盖表仅在措辞需要分叉时加键）
- Test: 既有 i18n/字典完整性测试（typecheck + `packages/web/test` 全量即覆盖）

**Interfaces:**
- Consumes: Task 7/8 引用的键（全集即下述 14 键，英文基准文案）。

- [ ] **Step 1: 在 `en.ts` 追加键块**（放在 `wpilog.*` 块之后；文案简洁，遵守对外文案纪律）：
  `hoot.title` 'Import CTRE logs (.hoot)'、`hoot.eulaTitle` 'CTRE converter terms'、`hoot.eulaBody` 'PathBlender downloads CTRE's official owlet converter from redist.ctr-electronics.com the first time you import a .hoot log. It runs locally; your logs are never uploaded.'、`hoot.eulaLink` 'Open CTRE licensing info'、`hoot.eulaAgree` 'Agree and download'、`hoot.eulaDecline` 'Not now'、`hoot.downloading` 'Downloading official converter… {pct}%'、`hoot.converting` 'Converting {name}…'、`hoot.webUnsupported` '.hoot logs are converted by the official CTRE tool in the PathBlender desktop app. On the web, convert them to .wpilog with Phoenix Tuner first.'、`hoot.tooOld` 'This .hoot log predates 2024 (compliancy {v} < 6); no official converter supports it.'、`hoot.truncated` 'This file is too short to be a .hoot log.'、`hoot.newerThanConverter` 'This log is newer than the downloaded converter — update PathBlender and retry.'、`hoot.convertFailed` 'Conversion failed for {name}: {message}'、`hoot.owletMissing` 'The CTRE converter is not available on this platform yet.'
- [ ] **Step 2: `npm run typecheck -w @pathblender/web` 列出全部缺键字典 → 逐语言补译**（40 语言纪律；无把握的短句以英文语义直译，不机翻腔）。
  Run: `npm run typecheck -w @pathblender/web && npm test -w @pathblender/web`
  Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/i18n
git commit -m "feat(i18n): add hoot.* strings across all storefront languages"
```

---

### Task 10: 文档与收尾核查

**Files:**
- Modify: `README.md:57-58` 及所有带同句的本地化 README（`grep -l "hoot" README*.md`）；`docs/user-guide.en.md:52`、`docs/user-guide.zh.md:35`；`docs/formats/format-facts.md`（新增「CTRE `.hoot`」节，遵循已核查/待实测两类口径）

**Interfaces:** 无代码接口。

- [ ] **Step 1: 改写 README/user-guide 的 `.hoot` 句**：桌面版直接导入 `.hoot`（首次下载官方 owlet、本地转换、日志不上传）；网页版仍需 Phoenix Tuner 预转换 `.wpilog`。**保留诚实标注**：真实 CTRE 日志的端到端验证仍待样本（原文 "verified against WPILib-written logs; CTRE-converted files …" 的未验证口径继续适用于 owlet 产物，见外部不可验收项 #1）。
- [ ] **Step 2: `docs/formats/format-facts.md` 新增 HOOT 节**：已核查＝index.json 结构（Tools/owlet/Items/Version/Compliancy/Urls、sha1+md5、三平台工件名）、官方 CLI、ChannelCompliancy 表、偏移 70 compliancy<6 门槛（含「小端 u32 为实现选择」）、EULA 约束（不逆向、不捆绑、运行时下载）；待实测＝真实样本转换、字段端序/宽度实测、owlet 输出对 WPILOG 管线的实际兼容性、macOS 未签名二进制 Gatekeeper 行为。每条附来源（官方文档 URL / 抓取日期）。
- [ ] **Step 3: 全量核查**
  Run: `npm run typecheck && npm test && cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml && git diff --check && git status`
  Expected: 全绿；工作区除本分支文件外无多余改动（构建噪音 `sw.js` 若被改写按 AGENTS 还原）

- [ ] **Step 4: Commit**

```bash
git add README.md README.*.md docs/user-guide.en.md docs/user-guide.zh.md docs/formats/format-facts.md
git commit -m "docs: describe desktop .hoot import via official owlet converter"
```

---

## 外部不可验收项（不得伪造，验证挂起清单）

1. **真实 `.hoot` → wpilog 转换正确性**：合法渠道无真实样本。全部单测用合成桩；`samples/` 不得添加伪造的「真实」样本。在获得用户提供的真机日志并完成导入回放验证前，README/发布说明不得宣称「已验证支持 CTRE 日志」，只能如实描述「经官方 owlet 转换」。**该项是本工作包验收的唯一硬缺口，收尾时必须原样上报。**
2. **真实 CDN 下载链路**：CI 与单测不联网下载 owlet（EULA 与环境限制）；下载编排仅以注入 fetch 的桩测试覆盖。真机首次下载需在桌面三端验证（AGENTS Beta 交付流程）时人工确认，含 SHA-1 校验、断网重试表现。
3. **compliancy 字段的端序/宽度**：偏移 70、`<6` 不支持来自工作包核实；小端 u32 是实现选择，未经真实文件比对。字段已隔离为常量 + format-facts 待实测条目，若实测不符只需改常量与 probe 测试。
4. **owlet CLI 稳定性**：`owlet -f wpilog in out` 钉自 Phoenix 6 官方文档（2026-11-07）；未来版本变更 CLI 时表现为 `hoot-convert-failed` 带原始 stderr，不静默。
5. **macOS Gatekeeper**：reqwest 下载不附带 quarantine xattr，理论上可直接执行；未签名第三方二进制的实际拦截行为待真机验证（三端验证清单项）。
6. **CTRE EULA 原文与外链 URL**：对话框只链接官方页面、不复制条款全文（避免转载风险）；`CTRE_EULA_URL` 在 Task 8 实现时从官方文档钉取并记入 format-facts。EULA 的法律解读不属于工程验收范围。
