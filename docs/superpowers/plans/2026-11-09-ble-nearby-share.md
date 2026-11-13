# BLE 纯蓝牙附近分享（Nearby Share over pure BLE）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 两台运行 PathBlender 桌面版的电脑（Mac ↔ Windows，Mac ↔ Mac）之间，通过**纯 BLE GATT**（不建 Wi-Fi / 热点 / Wi-Fi Direct / 不经互联网）交换路径类文件：发送方选文件 → 接收方广播 → 发现/连接 → 双方各自显式确认（比对校验码）→ 逐文件确认 → 加密分块传输 → SHA-256 校验 → 接收方把字节构造成 `File` 喂给现有 `importFiles` 统一解析管线。网页版对入口给出明确的「仅桌面版」提示。

**Architecture:** Tauri Rust 原生双角色——`btleplug 0.13.5` 做 central（扫描/连接/GATT client，发送方），`ble-peripheral-rust 0.2.0` 做 peripheral（GATT server，接收方）。协议层（帧编解码、X25519+HKDF+ChaCha20-Poly1305 加密、文件名净化、发送/接收状态机）全部是**不接触无线电的纯 Rust 模块**，经注入 seam（trait 时钟/trait 传输）做 TDD；central/peripheral 只是薄适配层；Tauri 命令层把会话事件经 `Channel` 推给 web（沿用 hoot 模式）。web 侧只做 UI（复用 `Dialog`/`btn`/progress 惯例与 i18n），收完文件后**不自行解析**，一律走 `App.tsx` 的 `importFiles` → core 统一轨迹模型（红线 3：绝不执行接收字节）。

**Tech Stack:** Rust（Tauri v2 `packages/desktop/src-tauri`，`cargo test`）、TypeScript/React（`packages/web`，Vitest + jsdom）、i18n 40 语言完整字典纪律。

**Spec:** 本计划「Spec 基线」（下方已核实事实）+ 私有《PathBlender 红皮书》§16.40（2026-11-03 用户确认记录）。红皮书为私有文件；执行者只需本计划即可开工。

> **修订记录**：r2（2026-11-09，实施前独立审查 2 Critical + 多 Important 落实）——加密帧显式携带 8B LE counter 且 AAD 认证 counter、重放丢弃/重传重新 seal、CHUNK 145B、文件名 110B、明文白名单（仅 HELLO/HELLO_ACK/PROTO_ERROR，CONFIRM 后明文 SESSION_CANCEL 忽略）、`SenderSession::on_connected`、删除 15min 整会话上限、未 Accept 的 CHUNK → FILE_CANCEL(protocol)、offset≠0 一律 NACK（WinRT 无分段写）、依赖/命令数/i18n/平台提示等一致性修正。以本文为准，r1 的隐式计数器与 160/120 上限全部作废。

### Spec 基线（2026-11-09 本 setup 会话逐项核实，执行时以此为准）

**已核实（源码在手，非 README 命名推断）：**

- `btleplug 0.13.5`（MIT OR Apache-2.0，https://github.com/deviceplug/btleplug，crate 已下载拆包核对）：**仅 central 角色**。API：`Manager::adapters()`、`Adapter::events()`（`CentralEvent::PeripheralDiscovered/Updated/Disconnected` 等）、`start_scan(ScanFilter { services })`、`peripherals()`、`Peripheral::connect()/discover_services()/characteristics()/write(&char, data, WriteType::WithResponse|WithoutResponse)/subscribe()/notifications()/is_connected()/disconnect()`。macOS 后端 CoreBluetooth（objc2 0.6.4 / objc2-core-bluetooth 0.3.2），Windows 后端 WinRT（windows 0.62）——与本项目 Cargo.lock 现有版本**完全同线**（objc2 0.6.4、windows 0.62.2、tokio 1.53.1、uuid 1.26、sha2 0.10.9 均已在锁内）。
- `ble-peripheral-rust 0.2.0`（MIT，https://github.com/rohitsangwan01/ble-peripheral-rust，crate 已下载拆包核对）：peripheral/GATT server。API：`Peripheral::new(Sender<PeripheralEvent>)`；事件 `PeripheralEvent::{StateUpdate{is_powered}, CharacteristicSubscriptionUpdate{request, subscribed}, ReadRequest{request, offset, responder}, WriteRequest{request, value, offset, responder}}`——`WriteRequest` 带 oneshot responder，可回 `RequestResponse::Success` 或 ATT 错误码（`InvalidOffset`/`RequestNotSupported`/…）实现 **NACK**；`CharacteristicProperty::{Read, Write, WriteWithoutResponse, Notify, Indicate, …}` 在 WinRT 后端映射 `GattCharacteristicProperties`（Notify→Notify、Indicate→Indicate，winrt/characteristic_utils.rs）与 CoreBluetooth 后端映射 `CBCharacteristicProperties`（corebluetooth/characteristic_utils.rs）**均已实现**；`update_characteristic(uuid, value)` WinRT 走 `NotifyValueAsync`、macOS 走 `updateValue:forCharacteristic:onSubscribedCentrals:`（可发 notify/indicate，具体由 characteristic properties 决定）；`start_advertising(name, &[Uuid])` / `stop_advertising` / `add_service(&Service)` / `is_powered` / `is_advertising`。macOS 后端**自起专用线程 + current-thread runtime**（corebluetooth/peripheral_manager.rs `PERIPHERAL_THREAD`），不依赖宿主 tokio runtime；其 Apple 依赖为 objc2 0.5.2 / objc2-core-bluetooth 0.2.2（与项目 objc2 0.6.4 不同 major，Cargo 允许多 semver major 共存，仅增加编译量）；Windows 依赖 windows 0.57（与锁内 0.62 共存同理）。已知源码内注释级注意点：macOS 缓存 value 的 characteristic 只能 Read 否则崩溃——本计划所有 characteristic 一律 `value: None`（动态应答）。
- 项目现状：`packages/desktop/src-tauri/src/lib.rs:638` invoke_handler 注册（hoot 4 命令在前）；`lib.rs:713` 原生导入过滤器数组；`lib.rs:484` `ALLOWED_EXTERNAL_URL_PREFIXES`；`tauri.conf.json` bundle.macOS `"infoPlist": "Info.plist"`，现 `Info.plist` 刻意为空 `<dict/>`（macOS 最低系统 13.0 → 只需 `NSBluetoothAlwaysUsageDescription`）。web：`App.tsx:140` `IS_DESKTOP`、`App.tsx:488` `importFiles`、`App.tsx:483/486` `wpilogQueue`/`hootQueue` 挂载点（1774-1790）、`menu-spec.ts:126` `fileItems`、`App.tsx:1570` `pb-menu-{id}` 事件绑定、`components/Dialog.tsx:4`、`hoot/client.ts` invoke/Channel 惯例、`hoot/HootImportFlow.css` 极简样式惯例。
- 基线（worktree `feat/ble-nearby-share` @ 09c6d7d2 = 0.1.10-beta.17，2026-11-09 实测）：`npm run typecheck` 0 错误；`npm test` 142 文件 / 1514 测试全绿；`cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml` 43 通过 0 失败（注意：cargo 编译需要 `packages/web/dist` 存在——worktree 里跑 cargo 前先 `npm run build` 或从主树 APFS 克隆 `packages/web/dist`，该产物 gitignored 不入库）。

**边界与未验（不得写成已实现）：**

- 真实无线电行为（扫描互见、连接稳定性、吞吐、断连恢复）**未经任何真机验证**；CI 无 BLE 硬件。全部单测均为纯逻辑/loopback，**不得表述为真机结果**。
- Windows peripheral 角色受蓝牙硬件/驱动影响（红皮书 §16.40）；必须运行时能力检测并如实上报，不承诺所有 Windows 可作接收方。
- FIRST 赛事合规：E301/E302/R905 的澄清**尚未向 FIRST 提交/获得**。功能完成 ≠ 比赛合规；对外文案一律不称「已获 FIRST 许可」。
- Linux：本轮**不支持**（协议/适配代码 cfg 保持可编译，命令层直接返回 `ble-unsupported-platform`，UI 明示）。是否支持留待红皮书后续评估。

## Global Constraints

- **纯 BLE 红线**：只用 BLE GATT（btleplug central + ble-peripheral-rust peripheral）。**禁止**引入任何 Wi-Fi / 热点 / Wi-Fi Direct / 802.11 / 后端服务器 / 遥测（红线 1、红皮书 §16.40）。真机验收必须包含「双方关掉 Wi-Fi 仍能完成传输」一项（证明无 802.11 依赖）。
- **不自制加密**：只用成熟原语——X25519（x25519-dalek）+ HKDF-SHA256（hkdf+sha2）+ ChaCha20-Poly1305 AEAD（chacha20poly1305）。SAS 校验码 = HKDF 派生截断，属标准 KDF 用法。协议帧格式是应用层设计（允许自定），密码学原语一个都不自研。
- **双方显式同意**：①会话级——两侧屏幕各显示同一个 6 位校验码，双方用户各自点「校验码一致」后双方互换 CONFIRM 帧才进入传输（MITM 中继会使两侧码不同）；②文件级——接收方对每个文件（名称/大小）单独 Accept/Reject。
- **接收完成才构造 File，且只走统一解析**：Rust 收完并校验 SHA-256 后暂存内存；web 侧取回字节 → `new File([bytes], name)` → `importFiles(files)`（`App.tsx:488`）→ 既有 parsePathFile / session / wpilog 分流。**绝不把接收字节写盘执行、绝不让 web 绕过 importFiles 自行解析。**
- **测试诚实**：loopback/纯逻辑测试在命名与注释中标明（`loopback`/`pure`），真机项进「外部不可验收项」与验收清单；CI 无无线电。
- **平台**：功能仅 macOS 13+ / Windows 10+；Linux 桌面构建返回 `ble-unsupported-platform`；网页构建入口点击给 `ble.webUnsupported` 提示（不静默、不报错崩溃）。
- **macOS 权限**：`Info.plist` 增加 `NSBluetoothAlwaysUsageDescription`——陈述句用途说明（非疑问句），macOS 系统弹窗原样展示；不做 InfoPlist.strings 本地化（macOS 按 key 查本地化、缺省回退 plist 原值），单一英文串即可触发弹窗，文案见 Task 9。
- **依赖纪律**：新增 crate 仅限下列（全部 MIT / MIT OR Apache-2.0 / MIT-Apache-BSD，商用友好，红线 2）：`btleplug 0.13.5`、`ble-peripheral-rust 0.2.0`、`x25519-dalek 2.0.1`、`chacha20poly1305 0.10.1`、`hkdf 0.12.4`、`rand_core 0.6`(features=["getrandom"])、`sha2 0.10`（锁内 0.10.9，直接声明复用）、`async-trait 0.1`、`futures 0.3`（按需）。不升级既有依赖；objc2 0.5 / windows 0.57 多版本共存如实接受并在 NOTICE 标注。
- **命名即契约**：GATT UUID、命令名、错误码前缀、i18n 键一经本计划定稿不再改名；改要同步文档与消费者。
- **i18n 完整性**：新增 `ble.*` 键补齐全部分字典（40 语言，`en.ts` 为基准；typecheck `Record<MessageKey, string>` 强制）。
- **工程纪律**：Tauri invoke 参数 camelCase；Tauri v2 响应 serde `rename_all = "camelCase"`；提交英文 conventional commit、一任务一提交；不改红皮书/工程日志（私有文件，worktree 内不存在）；三端验证与发布走 AGENTS 交付流程（见「发布流程」节）。
- **UI 纪律**：复用 `Dialog`、`.btn`/`.btn accent`、progress 元素与 hoot 流的样式惯例；新 CSS 只引用既有 CSS 变量/类名，**不新定颜色/间距/字号字面值**（用户要求：不新定视觉参数）。

## Review Focus

1. **双方确认不可绕过** —— 没有两边 CONFIRM 帧不出一个 CHUNK；接收方 Reject 的文件一个字节都不落地。测试钉在 Task 4/5/6。
2. **MITM/重放/错误码** —— 中继攻击下两侧 SAS 码必不相同；重放密文（同 counter）只被丢弃、绝不重复触发动作；AEAD 解密失败走 resync→取消的受控路径而不是 panic。测试钉在 Task 3/4/5/6。
3. **文件名净化** —— `../../evil.traj`、`NUL`、控制字符、超长名在接收端被净化，importFiles 拿到的是净名。测试钉在 Task 2/11。
4. **断连/取消清理** —— 任何时刻断连或取消：扫描/广播停、连接断、暂存半成品丢弃、无残留定时任务、UI 落到明确终态。测试钉在 Task 5/7/8/11。
5. **网页版入口** —— web 构建点 BLE 入口得到明确「仅桌面版」提示，不是静默无反应或异常。测试钉在 Task 11。
6. **收尾导入复用** —— 接收完成只构造 File 并走 `importFiles`；解析失败照常走既有错误 UI，不因 BLE 引入第二条解析路径。测试钉在 Task 11。

---

## 协议规格（v1，定稿即契约）

### GATT 布局

- Service UUID：`a6afd4b9-1989-4ccc-9f3d-63893d4dc802`（128-bit v4，2026-11-09 `uuidgen` 生成后固定）
- Characteristic（控制/数据合一，双向）：`23f860e0-5ec2-46d5-9e4c-3a3c4fb42c93`，properties `[Write, WriteWithoutResponse, Notify, Indicate]`，permissions `[Readable, Writeable]`，`value: None`（动态应答，规避 ble-peripheral-rust macOS 缓存值崩溃注释）。
- 广播：`start_advertising("PathBlender", [SVC_UUID])`；central 用 `ScanFilter { services: [SVC_UUID] }` 过滤。
- 方向：sender→receiver = central **写**该特征（`WriteType::WithResponse`，天然有序+回压）；receiver→sender = peripheral `update_characteristic`（notify/indicate）+ central `subscribe`/`notifications()`。

### 帧编码（单特征上分帧；2026-11-09 r2 修订：显式计数器）

**明文帧**（仅 `HELLO(0x01)` / `HELLO_ACK(0x02)` / `PROTO_ERROR(0x1F)` 三类，握手期专用）= `u8 type ‖ u16 payload_len(LE) ‖ payload`，总长 ≤ **180**（MTU 185 − 3 头安全值；HELLO 内协商 `max_frame` 取 min，v1 双端恒 180）。HELLO 最大体实测 112B ≤ 180。

**加密帧**（其余全部类型）外层信封 = `u8 type ‖ u16 ct_len(LE) ‖ u64 counter(LE) ‖ ciphertext`，其中：
- `ciphertext = ChaCha20-Poly1305(key_dir, nonce, plaintext_body, aad)`，tag 16B 含在 ct 内；
- `nonce = 12B = [4B direction tag（0x01 sender→receiver / 0x02 反向）‖ 8B LE counter]`；
- `aad = session_id(8B) ‖ counter(8B LE)` —— **counter 必须被认证**（防剥离/篡改计数器）；
- `counter` 每方向独立、从 1 起、单调递增、**永不复用**。每次 `seal`（包括重传同一明文）都分配新 counter 并重新加密——**禁止重放缓存密文**；nonce 唯一性由此保证；
- 接收端接受规则：**严格递增**即可、不要求连续（丢帧后后续新 counter 照常解密）；`counter ≤ 已接受最大值` 视为重放/重复 → **直接丢弃，不解密、不重复触发任何动作**（重传去重由应用层 chunk seq 负责，见 CHUNK_ACK/RESYNC）；AEAD 认证失败不推进已接受最大值（走 resync，连续 3 帧失败 → SESSION_CANCEL(protocol)）。
- 由此全帧恒一发到位（≤ max_frame），**写入 offset 恒为 0**，不做分段写。

**尺寸常量（定稿）**：`MAX_FRAME = 180`；加密帧信封开销 = 3B 外头 + 8B counter + 16B tag = **27B** → 加密明文体上限 `MAX_ENCRYPTED_BODY = 153`；`MAX_CHUNK_DATA = 145`（CHUNK 体 2+4+2+145=153，信封恰 180）；FILE_BEGIN 文件名上限 `MAX_NAME_BYTES = 110`（体 2+1+110+8+32=153，信封恰 180）。Task 1/3 用断言钉死所有帧型最大体 seal 后 ≤ 180。

`session_id = HKDF(info="pb-ble-sid")` 前 8 字节，双方一致，进 AAD。

### 帧类型（u8）

| 值 | 名 | 方向 | 密文 | 载荷 |
|---|---|---|---|---|
| 0x01 | HELLO | sender→receiver | 明文 | `u8 proto_ver(=1) ‖ u16 max_frame ‖ 8B instance_id ‖ 32B ecdh_pub ‖ str8 app_ver(≤32B) ‖ str8 label(≤32B)` |
| 0x02 | HELLO_ACK | receiver→sender | 明文 | 同 HELLO 结构 |
| 0x1F | PROTO_ERROR | 双向 | 明文 | `u8 code(1=version,2=malformed)` |
| 0x04 | CONFIRM | 双向 | 密文 | `u8 accepted(0/1)` |
| 0x10 | FILE_BEGIN | sender→receiver | 密文 | `u16 file_index ‖ u8 name_len ‖ name(≤110B, UTF-8, 已净化) ‖ u64 size ‖ 32B sha256` |
| 0x11 | FILE_ACCEPT | receiver→sender | 密文 | `u16 file_index ‖ u8 accepted` |
| 0x12 | CHUNK | sender→receiver | 密文 | `u16 file_index ‖ u32 seq(0 起) ‖ u16 data_len ‖ data(≤145B)`；到达时该 file_index **未 Accept** → 丢弃并发 FILE_CANCEL(protocol) |
| 0x13 | CHUNK_ACK | receiver→sender | 密文 | `u16 file_index ‖ u32 cum_seq`（≤cum_seq 全部收妥） |
| 0x14 | RESYNC | receiver→sender | 密文 | `u16 file_index ‖ u32 expected_seq` |
| 0x15 | FILE_END | sender→receiver | 密文 | `u16 file_index` |
| 0x16 | FILE_DONE | receiver→sender | 密文 | `u16 file_index ‖ u8 sha256_ok` |
| 0x17 | FILE_CANCEL | 双向 | 密文 | `u16 file_index ‖ u8 reason(1=user,2=timeout,3=protocol,4=hash-mismatch,5=too-large)` |
| 0x18 | SESSION_CANCEL | 双向 | 密文 | `u8 reason(1=user,2=timeout,3=protocol,4=disconnect)`。明文 SESSION_CANCEL 仅握手期（CONFIRM 前）可接受；**双方 CONFIRM 之后收到明文 SESSION_CANCEL 一律忽略**（只计数，不动作） |
| 0x19 | KEEPALIVE | 双向 | 密文 | 空（任一侧空闲 >10s 发，两侧 tick 均可产生） |

**明文类型白名单**（定稿）：`is_cleartext_type(t) = t ∈ {0x01, 0x02, 0x1F}`。PROTO_ERROR 虽然值大（0x1F）仍是明文——错误路径可能出现在密钥派生之前。其余任意 type 的明文帧在 Ready 后一律忽略。

### 密钥时间表

1. GATT 连接 + 服务发现完成后，适配层调 `SenderSession::on_connected()` → sender 发 HELLO（带一次性 X25519 `StaticSecret` 公钥，随会话生成、drop 时 zeroize），同时启动握手计时；receiver 等 HELLO 到达后回 HELLO_ACK（带自己公钥）。
2. 双方：`shared = X25519(sk, peer_pk)`；`salt = sort(instance_id_sender, instance_id_receiver) 拼接`（字典序小者在前，保证两侧一致）；`okm = HKDF-SHA256(ikm=shared, salt, info="PathBlender-BLE-v1")` 64 字节 → `key_s2r = okm[0..32]`、`key_r2s = okm[32..64]`（方向按 sender/receiver 角色而非 instance 顺序）。
3. `session_id = HKDF-SHA256(ikm=shared, salt, info="pb-ble-sid", len=8)`；`sas_code = HKDF-SHA256(ikm=shared, salt, info="pb-ble-sas-v1", len=4) → u32 % 1_000_000 → 十进制 6 位零填充`。两侧屏幕显示同一码；用户逐位比对后各自确认。
4. CONFIRM(accepted=1) 双向收齐 → 传输态；任一侧 accepted=0 或用户拒绝 → SESSION_CANCEL(reason=user) → 拆链。
5. 加密从 CONFIRM 后第一个帧开始；两侧各持两个 `DirCrypto`（发方向 + 收方向），counter/AAD/重放规则见「帧编码」。

### 状态机

**Receiver（peripheral 侧）**：`Advertising → Connected → Handshaking(HELLO→HELLO_ACK) → Verifying(SAS 已显示，等双方 CONFIRM) → Ready → [PerFile: FilePending(FILE_BEGIN) → FileAccepted / FileRejected → Receiving(CHUNK…) → FileVerifying(FILE_END→sha256→FILE_DONE) ]* → Complete(全部文件终态) → Teardown`。
**Sender（central 侧）**：`Scanning → Connecting → Handshaking(HELLO→等 HELLO_ACK) → Verifying → Ready → [PerFile: FileOffering(FILE_BEGIN→FILE_ACCEPT) → Sending(窗口 8、未 ACK 定时重传) → FileClosing(FILE_END→等 FILE_DONE) ]* → Complete → Teardown`。

超时（注入时钟统一毫秒；**r2 修订：删除固定 15min 整会话上限**——慢链路上 2 MiB 文件必然超时是错误设计；只用以下分段超时 + 用户随时取消，吞吐事实不做任何预设）：握手 30s（`on_connected` 起）；SAS/文件确认等待 300s；CHUNK_ACK 等待 15s/窗口（重传 ≤5 次后 FILE_CANCEL(timeout)）；接收空闲 30s（KEEPALIVE 空闲 >10s 双向发送，见上表）。任一超时 → 对应 CANCEL → Teardown；链路层断连事件 → 直接 Teardown 并上报 `ble-disconnected`。无整会话时长上限。

### 错误语义（Rust `Result<_, String>` 前缀码，web 按 `ble-*` 前缀映射 i18n）

`ble-unsupported-platform` / `ble-bluetooth-off` / `ble-peripheral-unavailable` / `ble-busy`（同一时刻仅一会话）/ `ble-scan-failed:{detail}` / `ble-connect-failed:{detail}` / `ble-not-found`（设备已消失）/ `ble-handshake-timeout` / `ble-protocol-version` / `ble-protocol-error` / `ble-not-confirmed` / `ble-file-rejected` / `ble-hash-mismatch` / `ble-too-large:{size}`（单文件 > 2 MiB）/ `ble-timeout` / `ble-disconnected` / `ble-cancelled`。
接收端 ATT 应答：正常 `Success`；**写入 offset ≠ 0 → `RequestNotSupported`**（WinRT `GattWriteRequest` 不做 CoreBluetooth 式 offset 分段写；协议帧恒 ≤ max_frame 一发到位，分段写是协议错误）；载荷 > max_frame → `RequestNotSupported`（触发发送端 resync）；解不开密文 → 计数，连续 3 帧 → SESSION_CANCEL(protocol)；counter 重放帧（≤ 已接受最大值）→ 静默丢弃，不回应、不触发动作。

### 容量与体验（如实口径）

单文件上限 **2 MiB**（`ble-too-large` 并提示用 U 盘——§16.40 大文件继续 U 盘工作流）。**吞吐不预设任何事实**：不写预期量级、不写估时；真机 Mac↔Windows 实测后才写入文档。UI 必须始终显示进度与取消（慢链路长传输是常态而非异常——见状态机超时的 r2 修订）。

---

### Task 1: Rust 协议帧编解码 `ble/proto.rs`（纯函数，零新依赖）

**Files:**
- Create: `packages/desktop/src-tauri/src/ble/mod.rs`（`pub mod proto;` + 本包公共 re-export，后续任务逐个追加 `pub mod`）
- Create: `packages/desktop/src-tauri/src/ble/proto.rs`
- Modify: `packages/desktop/src-tauri/src/lib.rs`（仅加 `mod ble;` 一行，放 `mod hoot;` 旁）

**Interfaces:**
- Produces（后续所有任务依赖；常量定稿不可改）:
  ```rust
  pub const PB_SVC_UUID: [u8;16];      // a6afd4b9-1989-4ccc-9f3d-63893d4dc802（字节常量写死；Task 7/8 引入 uuid crate 时提供 `pb_svc_uuid() -> uuid::Uuid` 换算辅助）
  pub const PB_CH_UUID:  [u8;16];      // 23f860e0-5ec2-46d5-9e4c-3a3c4fb42c93
  pub const PROTO_VER: u8 = 1;
  pub const MAX_FRAME: usize = 180;             // 线上总长上限（明文帧与加密信封共用）
  pub const ENVELOPE_OVERHEAD: usize = 27;      // 3B 外头 + 8B counter + 16B AEAD tag
  pub const MAX_ENCRYPTED_BODY: usize = 153;    // = MAX_FRAME - ENVELOPE_OVERHEAD；加密帧明文体上限
  pub const MAX_CHUNK_DATA: usize = 145;        // CHUNK 体 2+4+2+145 = 153
  pub const MAX_NAME_BYTES: usize = 110;        // FILE_BEGIN 体 2+1+110+8+32 = 153（Task 2 sanitize 同一上限）
  pub enum Frame { Hello(HelloBody), HelloAck(HelloBody), ProtoError{code:u8},
      Sealed(SealedBody),                        // 解码出的加密信封（ct 未开）；session 层开箱后再 decode_encrypted_body
      Confirm{accepted:bool}, FileBegin(FileBegin), FileAccept{file_index:u16, accepted:bool},
      Chunk{file_index:u16, seq:u32, data:Vec<u8>},
      ChunkAck{file_index:u16, cum_seq:u32}, Resync{file_index:u16, expected_seq:u32}, FileEnd{file_index:u16},
      FileDone{file_index:u16, ok:bool}, FileCancel{file_index:u16, reason:u8}, SessionCancel{reason:u8}, Keepalive }
  pub struct SealedBody { pub frame_type: u8, pub counter: u64, pub ct: Vec<u8> }  // type‖ct_len‖counter‖ct 的解码产物
  pub struct HelloBody { pub proto_ver: u8, pub max_frame: u16, pub instance_id: [u8;8],
                         pub ecdh_pub: [u8;32], pub app_ver: String, pub label: String }  // 两 str 各 ≤32B
  pub struct FileBegin { pub file_index: u16, pub name: String, pub size: u64, pub sha256: [u8;32] }
  pub enum WireError { Truncated, UnknownType(u8), TooLong(usize), BadUtf8, Malformed }
  pub fn is_cleartext_type(t: u8) -> bool;                      // t ∈ {0x01, 0x02, 0x1F}（定稿白名单）
  pub fn encode(frame: &Frame) -> Vec<u8>;                       // 明文类型 → type‖len‖payload；Sealed → type‖ct_len‖counter‖ct
  pub fn decode(bytes: &[u8]) -> Result<Frame, WireError>;       // 明文类型解全帧；其余类型解出 Frame::Sealed；长度/字符串上限全校验
  pub fn encode_encrypted_body(frame: &Frame) -> Vec<u8>;        // 加密类型的明文体（type‖len‖payload）——session seal 它
  pub fn decode_encrypted_body(frame_type: u8, body: &[u8]) -> Result<Frame, WireError>;  // DirCrypto.open 后的二次解码
  pub fn frame_type_of(bytes: &[u8]) -> Option<u8>;
  ```
- 注意：本任务**不**加任何依赖（uuid 以字节常量表达；Task 7 引入 uuid crate 时再提供换算辅助）。

- [ ] **Step 1: 写失败测试**（`proto.rs` 内 `#[cfg(test)] mod tests`）：
  - 往返全帧型（构造→encode→decode→相等）；加密类型走 `encode_encrypted_body → decode_encrypted_body` 往返，`Sealed` 信封字段（frame_type/counter/ct）往返一致。
  - 截断输入 → `Truncated`；未知 type → `UnknownType`；CHUNK data 146B / FILE_BEGIN name 111B → `TooLong`/`Malformed`；Hello `label` 33B → `Malformed`；非法 UTF-8 → `BadUtf8`；`frame_type_of` 对空/短输入 None。
  - **尺寸断言（r2 新增，防止只改常量不改测试）**：`encode(Hello 最大体).len() == 112 ≤ MAX_FRAME`；对每个加密类型构造**最大体**（CHUNK data=MAX_CHUNK_DATA、FILE_BEGIN name=MAX_NAME_BYTES、其余类型天然小）断言 `encode_encrypted_body(&f).len() - 3 + ENVELOPE_OVERHEAD == MAX_FRAME`（即 seal 后恰 180，Task 3 会再用真实 seal 复核总长）。
  - `is_cleartext_type`：0x01/0x02/0x1F true；0x04/0x10/0x12/0x18 false。
  Run: `cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml ble::proto`
  Expected: FAIL（模块不存在）
- [ ] **Step 2: 实现** `encode/decode`（手写小端读写，不用 serde——帧格式是对外契约，字节级钉死）。文件头注释写明 UUID 来源与「定稿即契约」。
  Run: 同上 Expected: PASS
- [ ] **Step 3: 全量回归 + Commit**
  Run: `cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml`（43+ 新增全绿）
  ```bash
  git add packages/desktop/src-tauri/src/ble/mod.rs packages/desktop/src-tauri/src/ble/proto.rs packages/desktop/src-tauri/src/lib.rs
  git commit -m "feat(desktop): BLE nearby-share wire protocol codec"
  ```

---

### Task 2: Rust 文件名净化 `ble/sanitize.rs`（纯函数，零新依赖）

**Files:**
- Create: `packages/desktop/src-tauri/src/ble/sanitize.rs`（mod.rs 加 `pub mod sanitize;`）

**Interfaces:**
  ```rust
  /// 接收端显示与 File 构造共用的净化：拒绝路径语义、控制字符；保 UTF-8 原样（不做 NFC——文档已记）。
  /// 上限与 FILE_BEGIN 线上上限对齐（proto::MAX_NAME_BYTES = 110）。
  /// 规则：去 BOM；剔除 U+0000..U+001F 与 U+007F；替换 '/' '\\' 为 '_'；剥离 ".." 段（前后含分隔符或整段）；首尾空白去掉；
  /// 空结果 → "file"；字节数 >110 → 按 char 边界截到 ≤110。
  pub fn sanitize_file_name(raw: &str) -> String;
  pub fn is_plausible_share_name(s: &str) -> bool; // 净化后再校验：非空、≤110B、无路径分隔符（防御深度，供 web 端复用断言）
  ```

- [ ] **Step 1: 写失败测试**：`"a.traj"` 原样；`"../../evil.traj"` → `"evil.traj"`；`"a/b\\c.traj"` → `"a_b_c.traj"`；`"NUL\0.traj"` 去控制字符；`""`/`"   "` → `"file"`；日文+emoji 原样保留（UTF-8 不破）；111+ 字节截断且不切半字符、结果 ≤110；`is_plausible_share_name` 对净化结果恒 true、对原始路径串 false；净化结果恒满足 `proto` 的 FILE_BEGIN 上限（跨模块断言，钉死两处常量一致）。
  Run: `cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml ble::sanitize` Expected: FAIL→实现→PASS
- [ ] **Step 2: Commit**
  ```bash
  git add packages/desktop/src-tauri/src/ble/sanitize.rs packages/desktop/src-tauri/src/ble/mod.rs
  git commit -m "feat(desktop): sanitize received file names for nearby share"
  ```

---

### Task 3: Rust 加密层 `ble/crypto.rs`（成熟原语封装 + 官方测试向量）

**Files:**
- Create: `packages/desktop/src-tauri/src/ble/crypto.rs`
- Modify: `packages/desktop/src-tauri/Cargo.toml`（dependencies 追加，全部注释来源与许可）:
  ```toml
  # BLE nearby share: standard primitives only (no hand-rolled crypto).
  x25519-dalek = "2.0.1"            # MIT OR Apache-2.0 — X25519 ECDH (RFC 7748)
  chacha20poly1305 = "0.10.1"       # MIT OR Apache-2.0 — AEAD (RFC 8439)
  hkdf = "0.12.4"                   # MIT OR Apache-2.0 — HKDF (RFC 5869); reuses locked sha2 0.10.9
  sha2 = "0.10"                     # 已在锁内（transitive），显式声明复用
  rand_core = { version = "0.6", features = ["getrandom"] }  # MIT OR Apache-2.0 — OsRng
  ```

**Interfaces:**
  ```rust
  pub struct SessionKeys { pub session_id: [u8;8], pub key_s2r: [u8;32], pub key_r2s: [u8;32], pub sas_code: String /* 6 位十进制 */ }
  pub fn derive_session_keys(my_sk: &x25519_dalek::StaticSecret, my_instance: &[u8;8],
                             peer_pk: &x25519_dalek::PublicKey, peer_instance: &[u8;8]) -> SessionKeys;
  pub struct SealedFrame { pub counter: u64, pub ct: Vec<u8> }    // proto::SealedBody 的加密源数据
  pub struct DirCrypto { /* key + dir_tag + session_id + next_counter + last_accepted */ }
  impl DirCrypto {
      pub fn new(key: [u8;32], dir_tag: u32, session_id: [u8;8]) -> Self;   // dir_tag: 1=s2r, 2=r2s
      /// counter 从 1 起单调递增、每次调用必取新值（重传同一明文也重新 seal）；
      /// nonce = dir_tag(4B) ‖ counter(8B LE)；aad = session_id ‖ counter(8B LE)（认证 counter）。
      pub fn seal(&mut self, plaintext: &[u8]) -> SealedFrame;
      /// 严格递增收帧：counter ≤ last_accepted → Err(Replayed)（不解密、不触发动作）；
      /// counter > last_accepted 才尝试解密（丢帧造成的空档不要求填补）；
      /// 成功 → last_accepted = counter 并返回明文；认证失败 → Err(OpenFailed) 且 **不前进** last_accepted（调用方走 resync）。
      pub fn open(&mut self, sealed: &SealedFrame) -> Result<Vec<u8>, CryptoError>;
  }
  pub enum CryptoError { Replayed, OpenFailed }
  pub fn sha256(bytes: &[u8]) -> [u8;32];   // 完整性校验用（导出供 session 用）
  ```

- [ ] **Step 1: 写失败测试**（钉官方向量，防实现漂移）：
  - X25519 RFC 7748 §6.1 两个测试向量（共享 secret 字节逐位断言）。
  - HKDF-SHA256 RFC 5869 Test Case 1（逐字节）。
  - ChaCha20-Poly1305 RFC 8439 §2.8.2 加密向量（密文+tag）。
  - `derive_session_keys` 对称性：A/B 两视角（同一对密钥、instance 顺序不同）算出**完全相同**的 session_id / 双向 key / sas_code。
  - SAS 稳定性：同一输入恒定 6 位；不同 shared secret（改 1 字节）→ 码不同（概率性崩溃排除：用固定向量断言）。
  - `DirCrypto` 基础：seal→open 往返；篡改 1 字节 ct → OpenFailed 且再次 open 同密文仍失败；counter 单调（同明文两次 seal → 两个 SealedFrame counter 不同、密文不同、均可 open）。
  - **r2 新增——丢帧/重放/重传三件套**：
    ①丢 notify 后仍能解密：open(counter=1) 成功后跳过 2、3、4，直接 open(counter=5) → 成功（不要求连续）；
    ②重复 counter 丢弃：open(counter=5) 成功后再 open(同一 SealedFrame{counter:5}) → Err(Replayed)，且期间无任何解密副作用；
    ③重传不重放缓存密文：同一明文 seal 两次得 s1/s2（counter 递增），先 open(s2) 再 open(s1) → s1 为 Replayed（旧 counter）；模拟「重发旧密文」场景断言被丢弃。
  - **r2 新增——全帧型最大体 seal 后 ≤180**：对每个加密帧型构造最大体（CHUNK data=MAX_CHUNK_DATA、FILE_BEGIN name=MAX_NAME_BYTES、CONFIRM/FILE_ACCEPT/CHUNK_ACK/RESYNC/FILE_END/FILE_DONE/FILE_CANCEL/SESSION_CANCEL/KEEPALIVE 天然体）`proto::encode_encrypted_body` → `seal` → `proto::encode(Frame::Sealed(...))` 断言总长 ≤ MAX_FRAME（CHUNK 与 FILE_BEGIN 恰 ==180）。与 Task 1 的纯长度断言互为印证。
  Run: `cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml ble::crypto` Expected: FAIL
- [ ] **Step 2: 实现**（HKDF 两段 extract/expand；SAS = expand 输出 4 字节 u32_be % 1_000_000 零填充；文件头注释写明向量出处 RFC 条款）。确认 `cargo tree -i sha2` 无第二 sha2。
  Run: 同上 + `cargo tree --manifest-path packages/desktop/src-tauri/Cargo.toml -i sha2 | head -5`
  Expected: PASS；单一 sha2 0.10.9
- [ ] **Step 3: Commit**
  ```bash
  git add packages/desktop/src-tauri/src/ble/crypto.rs packages/desktop/src-tauri/src/ble/mod.rs packages/desktop/src-tauri/Cargo.toml packages/desktop/src-tauri/Cargo.lock
  git commit -m "feat(desktop): X25519+HKDF+ChaCha20-Poly1305 session crypto for BLE share"
  ```

---

### Task 4: Rust 接收端状态机 `ble/session/mod.rs` + `ble/session/receiver.rs`（纯逻辑，可注入 seam）

**Files:**
- Create: `packages/desktop/src-tauri/src/ble/session/mod.rs`（公共类型：`SessionEvent`、`Action`、`AttResult`（Success / RequestNotSupported）、`Clock`、`ShareLimits`）
- Create: `packages/desktop/src-tauri/src/ble/session/receiver.rs`

**Interfaces（Task 6/7/9 依赖，纯逻辑、零无线电）:**
  ```rust
  pub trait Clock { fn now_ms(&self) -> u64; }              // 测试注入假时钟
  pub struct ShareLimits { pub max_file_bytes: u64 /* 2 MiB */, pub max_files: usize /* 16 */ }
  pub enum Action {
      Send(Frame),                                           // 经当前特征发出（明文或已加密——由 session 内部 DirCrypto 完成）
      Teardown,                                              // 停广播/断连/清暂存
      Emit(SessionEvent),
  }
  pub enum SessionEvent {                                    // 命令层翻译给 web 的原始事件（见 Task 9 的 serde 版本）
      PoweredOn, PoweredOff,
      SasCode(String), ConfirmPending { peer_label: String, peer_version: String },
      Confirmed,                                             // 双方 CONFIRM 收齐
      FileRequest { file_index: u16, name: String, size: u64 },
      FileResult { file_index: u16, accepted: bool },
      Progress { file_index: u16, received: u64, total: u64 },
      FileVerified { file_index: u16, ok: bool },
      Done { ok_count: usize, fail_count: usize },
      Failed { code: &'static str, detail: String },
      Cancelled,
      Disconnected,
  }
  pub struct ReceiverSession { /* 持一次性 X25519 StaticSecret（随会话生成，drop 时 zeroize——与 Task 3 derive 签名类型一致） */ }
  impl ReceiverSession {
      pub fn new(rng: &mut (impl rand_core::CryptoRng + rand_core::RngCore), clock: std::sync::Arc<dyn Clock>, app_ver: &str, label: &str, limits: ShareLimits) -> Self;
      pub fn on_write(&mut self, bytes: &[u8]) -> (Vec<Action>, AttResult);   // peripheral WriteRequest 进来（offset≠0 的写在适配层已被 NACK，不会到这）；返回动作 + ATT 应答（Success / RequestNotSupported）
      pub fn on_user_confirm(&mut self, accepted: bool) -> Vec<Action>;   // SAS 确认
      pub fn on_user_file(&mut self, file_index: u16, accepted: bool) -> Vec<Action>;
      pub fn on_user_cancel(&mut self) -> Vec<Action>;
      pub fn on_disconnect(&mut self) -> Vec<Action>;
      pub fn tick(&mut self) -> Vec<Action>;                    // 超时驱动 + 空闲 >10s 发 KEEPALIVE（双向）
      pub fn take_files(&mut self) -> Vec<ReceivedFile>;         // 仅 Complete 后有值；{ index, sanitized_name, bytes }
  }
  ```
  设计约束：`on_write` 内部完成 `proto::decode` → 明文白名单/密文信封分流（`Frame::Sealed` → `DirCrypto::open`（Replayed → 静默丢、零动作；OpenFailed → resync 计数）→ `decode_encrypted_body`）→ 状态转移；ATT 应答结果随返回值供 Task 7 喂给 ble-peripheral-rust 的 responder。

- [ ] **Step 1: 写失败测试**（假时钟 + 直接喂帧；明文帧手工 encode、密文帧由对侧假 sender 用同一 keys 构造——helper 放 tests 模块）：
  - HELLO 版本不符（ver=2）→ PROTO_ERROR(version) + Teardown。
  - 正常握手 → SasCode + ConfirmPending 事件；双方 on_user_confirm(true) 互换 CONFIRM 后 → Confirmed。
  - 单侧 confirm(false) → SESSION_CANCEL(user) + Teardown。
  - **双方 CONFIRM 后收到明文 SESSION_CANCEL（及其他任何明文帧）→ 忽略**（零动作、只计协议噪声；握手期明文 SESSION_CANCEL 才可接受）。
  - FILE_BEGIN → FileRequest 事件；on_user_file(false) → FILE_ACCEPT(0)，无任何 CHUNK 被接受。
  - **未 Accept 文件的 CHUNK 到达 → 丢弃该帧并发 FILE_CANCEL(protocol)**（r2 新增；防止未确认流偷偷推进）。
  - on_user_file(true) 后 CHUNK 递增 → Progress；乱序/解密失败 → RESYNC(expected_seq)；恢复后 FILE_END → sha256 匹配 → FILE_DONE(ok)+FileVerified(true)+Done。
  - **counter 语义（r2）**：同一密文帧重投（同 counter）→ 静默丢弃、Progress 不重复；counter 跳档（丢 2 帧后直接收 counter+3）→ 正常解密处理。
  - 篡改 1 字节重组结果 → FILE_DONE(ok=false)+Failed(ble-hash-mismatch)。
  - size > 2 MiB 的 FILE_BEGIN → FILE_CANCEL(too-large)；name > 110B 的 FILE_BEGIN → ATT NACK + 不产生 FileRequest。
  - 文件名 `../x.traj` 的 FILE_BEGIN → FileRequest.name 已净化。
  - tick 超时：握手 30s、确认 300s、空闲 30s → 各自 CANCEL + Teardown + Failed(code)；**无整会话上限断言**：假时钟推进远超 15min 但持续有合法活动 → 不因总时长取消。
  - 空闲 10s tick → 发出 KEEPALIVE（接收侧方向）。
  Run: `cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml ble::session::receiver` Expected: FAIL
- [ ] **Step 2: 实现**（状态枚举 + 明确转移；暂存 `Vec<u8>` 逐文件；sha256 用 Task 3 的 `sha256`）。
  Run: 同上 Expected: PASS
- [ ] **Step 3: Commit**
  ```bash
  git add packages/desktop/src-tauri/src/ble/session
  git commit -m "feat(desktop): pure receiver state machine for BLE nearby share"
  ```

---

### Task 5: Rust 发送端状态机 `ble/session/sender.rs`（窗口/重传/取消，纯逻辑）

**Files:**
- Create: `packages/desktop/src-tauri/src/ble/session/sender.rs`

**Interfaces:**
  ```rust
  pub struct SenderSession { /* 同 seam 风格；持一次性 X25519 StaticSecret（drop 时 zeroize） */ }
  impl SenderSession {
      pub fn new(...同 Receiver 参数..., files: Vec<ShareFile>) -> Self;  // ShareFile { name: String(已本地净化), bytes: Vec<u8> }；构造时逐文件算 sha256、拒 >2MiB（构造 Err BleTooLarge）
      pub fn on_connected(&mut self) -> Vec<Action>;                 // r2 新增：GATT 连接+服务发现完成后由适配层调用——发出 HELLO 并启动握手计时（此前状态机停在 Connecting，不发任何帧）
      pub fn on_hello_ack(&mut self, body: HelloBody) -> Vec<Action>;     // 派生 keys → SasCode/ConfirmPending
      pub fn on_user_confirm(&mut self, accepted: bool) -> Vec<Action>;
      pub fn on_notify(&mut self, bytes: &[u8]) -> Vec<Action>;           // receiver→sender 帧（FILE_ACCEPT/CHUNK_ACK/RESYNC/FILE_DONE/…；内部走同一 Sealed→open→decode 流，Replayed 帧静默丢）
      pub fn on_disconnect(&mut self) -> Vec<Action>;
      pub fn tick(&mut self) -> Vec<Action>;                              // 重传计时（15s 窗口 ACK 超时 ×5）+ 空闲 >10s 发 KEEPALIVE；无全局会话超时
      pub fn on_user_cancel(&mut self) -> Vec<Action>;
  }
  ```
  发送窗口：in-flight ≤ 8 CHUNK；ACK 推进窗口；RESYNC 从 expected_seq 回退重发；重传计数按 chunk 累计，>5 → FILE_CANCEL(timeout)。**重传一律对明文体重新 `DirCrypto::seal`（新 counter 新密文），禁止缓存/重发旧密文**——发送侧发出的每一帧 counter 严格递增。握手超时 30s 从 `on_connected` 起计（tick 驱动），超时 → Failed(ble-handshake-timeout) + Teardown。

- [ ] **Step 1: 写失败测试**：`on_connected` 前零帧输出、调用后恰发一个 HELLO 且 tick 30s 无 HELLO_ACK → handshake-timeout 取消；整链多文件（含 1 个被拒）终态 Done 统计正确；ACK 部分（cum<已发）→ 只重发缺失；RESYNC 回退后不重发已 ACK；FILE_ACCEPT(false) → 跳过该文件继续下一个；receiver 中途 SESSION_CANCEL → Teardown + Cancelled；假时钟推进到 5 次重传上限 → FILE_CANCEL(timeout)；KEEPALIVE 空闲 10s 生成（发送侧方向）；**重传帧 counter 严格递增**（收集全部出站信封 counter 断言无重复且单调）；**慢链路长传输**：假时钟以大步进模拟 45 分钟总时长、期间活动持续 → 正常完成（无全局上限回归）。
  Run: `cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml ble::session::sender` Expected: FAIL→实现→PASS
- [ ] **Step 2: Commit**
  ```bash
  git add packages/desktop/src-tauri/src/ble/session/sender.rs packages/desktop/src-tauri/src/ble/session/mod.rs
  git commit -m "feat(desktop): pure sender state machine with windowed retransmit"
  ```

---

### Task 6: Rust loopback 集成（协议逻辑全链，**明确标注非真机**）

**Files:**
- Create: `packages/desktop/src-tauri/src/ble/session/loopback_tests.rs`（`#[cfg(test)]`，由 session/mod.rs `#[cfg(test)] mod loopback_tests;` 引入）

**Interfaces:** 消费 Task 4/5 两个状态机 + 内存队列 transport（`VecDeque<(Direction, Vec<u8>)>` 泵循环：两侧轮流 `on_*` 直到动作稳定），假时钟手动推进。

- [ ] **Step 1: 写测试**（文件头注释：`// Loopback = two pure state machines wired in memory. No radio, no OS Bluetooth. NOT a real-device result.`）：
  - 3 文件（.traj = `MAX_CHUNK_DATA`(145B)×若干块 / 800B 单文件（跨多块）/ 拒收 1 个）完整走完：receiver `take_files()` 字节与发送原件逐字节相等、名字净化正确、Done 统计 2/1。
  - MITM 模拟：插一个「中继」持有独立密钥对分别与两端握手 → 两端 `SasCode` 不相等（断言不同）。
  - 模拟丢帧（transport 丢弃第 5 个 CHUNK）→ 重传窗口推进 → 仍完整收妥；重传帧 counter 与原帧不同（重新 seal）。
  - **重放注入（r2）**：把某密文帧原样重投一次 → 接收端静默丢弃，Progress/FILE_DONE 等动作不重复触发，链路继续正常收尾。
  - 模拟断连注入 → 双方 Teardown、无悬挂 Action。
  - **慢链路（r2，取代已删除的 15min 整会话上限测试）**：假时钟以 1s 步进模拟 45 分钟虚拟时长、每步活动正常推进 → 完整完成，无因总时长触发的取消。
  Run: `cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml ble::session::loopback` Expected: 先按需修 seam → PASS
- [ ] **Step 2: Commit**
  ```bash
  git add packages/desktop/src-tauri/src/ble/session
  git commit -m "test(desktop): loopback integration of BLE share protocol logic"
  ```

---

### Task 7: Rust peripheral 适配 `ble/peripheral.rs`（ble-peripheral-rust 薄壳）

**Files:**
- Create: `packages/desktop/src-tauri/src/ble/peripheral.rs`
- Modify: `packages/desktop/src-tauri/Cargo.toml`（追加依赖 + 注释共存说明）:
  ```toml
  ble-peripheral-rust = "0.2.0"   # MIT — GATT server (CoreBluetooth / WinRT GattServiceProvider)
  async-trait = "0.1"             # MIT — PeripheralImpl trait 需要
  uuid = "1"                       # 锁内 1.26；仅 GATT UUID 常量换算（协议 UUID 全为固定常量，无 v4 随机生成需求——不加 features）
  # 注意：该 crate 在 Apple 拉入 objc2 0.5 线、在 Windows 拉入 windows 0.57 线——与锁内 0.6/0.62 多版本共存（Cargo 允许），编译量增加已接受并记 NOTICE。
  ```
  （uuid 在本任务声明一次，Task 8 不再重复。）

**Interfaces（Task 9 依赖）:**
  ```rust
  pub struct PeripheralRadio { /* 持 ble_peripheral_rust::Peripheral + 事件泵任务 */ }
  impl PeripheralRadio {
      pub async fn start(&mut self) -> Result<(), BleRadioError>;   // new() + 等 StateUpdate powered + add_service(PB 服务) + start_advertising("PathBlender", [SVC])
      pub async fn stop(&mut self) -> Result<(), BleRadioError>;    // stop_advertising + 清理
      pub async fn send_frame(&mut self, frame: &Frame) -> Result<(), BleRadioError>;  // update_characteristic(PB_CH, encoded)
      pub async fn events(&mut self) -> ...;                        // 泵 PeripheralEvent → ReceiverSession::on_* / ATT responder 应答
      pub fn powered(&self) -> Option<bool>;
  }
  ```
  Pump semantics: `WriteRequest{value, offset}` → **offset ≠ 0 → directly `RequestNotSupported` NACK, do not enter session** (WinRT `GattWriteRequest` does not do CoreBluetooth-style offset segmented writes; protocol frames are always sent in one shot ≤ max_frame, non-zero offset is a protocol error); offset == 0 → `session.on_write(value)` → in the actions, `Send` goes through `send_frame` (encode the Sealed envelope and send it), NACK codes go through `responder.send(WriteRequestResponse{ response: RequestNotSupported })`, success goes through `Success`; `CharacteristicSubscriptionUpdate(subscribed=false)` is treated as peer disconnection intent → `on_disconnect`; `StateUpdate(is_powered=false)` → PoweredOff event.

- [ ] **Step 1: 写失败测试**（**不碰真蓝牙**——把「事件→session 调用→responder/update」的映射逻辑抽成纯函数 `pub fn map_peripheral_event(ev, session) -> Vec<RadioAction>` 后直测）：
  - WriteRequest(合法 HELLO 字节, offset=0) → session.on_write 被调、responder Success；
  - WriteRequest(垃圾超长, offset=0) → responder RequestNotSupported、session 收到 on_write（由其返回 NACK）；
  - **WriteRequest(offset≠0) → 直接 RequestNotSupported、session.on_write 零调用**（r2）；
  - subscribed=false → on_disconnect；powered off → PoweredOff。
  Run: `cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml ble::peripheral` Expected: FAIL→实现→PASS（真无线电路径标注 CI 不可验）
- [ ] **Step 2: 验证依赖落锁不破坏现有树**
  Run: `cargo tree --manifest-path packages/desktop/src-tauri/Cargo.toml -i objc2 | head; cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml`
  Expected: objc2 0.6.4 与 0.5.2 并存列出；全测试绿
- [ ] **Step 3: Commit**
  ```bash
  git add packages/desktop/src-tauri/src/ble/peripheral.rs packages/desktop/src-tauri/src/ble/mod.rs packages/desktop/src-tauri/Cargo.toml packages/desktop/src-tauri/Cargo.lock
  git commit -m "feat(desktop): GATT peripheral adapter over ble-peripheral-rust"
  ```

---

### Task 8: Rust central 适配 `ble/central.rs`（btleplug 薄壳）

**Files:**
- Create: `packages/desktop/src-tauri/src/ble/central.rs`
- Modify: `packages/desktop/src-tauri/Cargo.toml`:
  ```toml
  btleplug = "0.13.5"   # MIT OR Apache-2.0（crate 声明 MIT/Apache-2.0/BSD-3-Clause 任选）— central 角色；依赖线与锁内 objc2 0.6.4 / windows 0.62 / tokio 1.53.1 一致
  futures = "0.3"       # 仅当适配层确需自行组合 stream（events/notifications 合流）时声明并使用；否则不加（btleplug 自带 futures 依赖线，勿无谓声明）
  ```
  连接建立路径（r2 对齐）：`connect → discover_services → 找到 PB_CH → subscribe` 全部完成后调 `SenderSession::on_connected()`，此后才可能出现首帧 HELLO。

**Interfaces（Task 9 依赖）:**
  ```rust
  #[async_trait]
  pub trait CentralRadio: Send {                 // 测试可换 FakeRadio
      async fn adapter_powered(&self) -> Result<bool, BleRadioError>;
      async fn scan(&mut self, on_discovered: Box<dyn Fn(DiscoveredPeer) + Send>) -> Result<(), BleRadioError>;  // ScanFilter{services:[SVC]}；DiscoveredPeer { id: String, label: String, rssi: Option<i16> }
      async fn stop_scan(&mut self) -> Result<(), BleRadioError>;
      async fn connect(&mut self, id: &str) -> Result<Box<dyn GattLink>, BleRadioError>;  // connect + discover_services + 找 PB_CH + subscribe
      async fn disconnect_all(&mut self) -> Result<(), BleRadioError>;
  }
  pub trait GattLink: Send { async fn write(&mut self, bytes: &[u8]) -> Result<(), BleRadioError>; async fn notifications(&mut self) -> ...; async fn close(&mut self); }
  pub struct BtleplugRadio { /* 包 platform::Manager/Adapter */ }
  impl CentralRadio for BtleplugRadio { ... }    // 真实现
  ```
  映射纯函数 `pub fn peer_label_from(props: &btleplug::PeripheralProperties) -> String`（local_name → "PathBlender (name)"，无 name → id 截断）供直测。

- [ ] **Step 1: 写失败测试**（FakeRadio + 纯函数）：label 映射（有/无 local_name）；ScanFilter 常量含 SVC_UUID（暴露 `pub fn scan_filter() -> btleplug::api::ScanFilter` 直测其 services）；scan→discovered 回调携带 id/label；connect 返回的 link write 编码透传 + notification 字节→frame decode 路径（喂合成 notification）。真 btleplug 路径编译断言（`impl CentralRadio for BtleplugRadio` 存在）不跑无线电。
  Run: `cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml ble::central` Expected: FAIL→实现→PASS
- [ ] **Step 2: Commit**
  ```bash
  git add packages/desktop/src-tauri/src/ble/central.rs packages/desktop/src-tauri/src/ble/mod.rs packages/desktop/src-tauri/Cargo.toml packages/desktop/src-tauri/Cargo.lock
  git commit -m "feat(desktop): central-role BLE adapter over btleplug"
  ```

---

### Task 9: Rust 命令层 + lib.rs 注册 + Info.plist 权限 + 平台门

**Files:**
- Create: `packages/desktop/src-tauri/src/ble/commands.rs`
- Modify: `packages/desktop/src-tauri/src/lib.rs`（`mod ble;` 已有；`invoke_handler`（L638 起）追加 **9** 个命令，与下方 Interfaces 一一对应）
- Modify: `packages/desktop/src-tauri/Info.plist`（`<dict>` 内加键；文件头注释同步改写——原注释声称「无本地网络流量」，BLE 属本地蓝牙不属于网络栈，注释如实更新并注明系统弹窗键）
- Modify: `packages/desktop/src-tauri/tauri.conf.json` 无改动（infoPlist 引用已存在）

**Interfaces（web Task 10/11 依赖；serde 全部 `rename_all = "camelCase"`）:**
  ```rust
  #[derive(serde::Serialize)] #[serde(rename_all="camelCase")]
  pub struct BleCapabilities { pub platform_supported: bool, pub central_powered: Option<bool>, pub peripheral_powered: Option<bool> }
  #[derive(serde::Serialize, Clone)] #[serde(rename_all="camelCase")]
  pub enum BleEvent {
      Discovered { devices: Vec<BlePeer> },                    // BlePeer { id, label }（增量合并后整表回推）
      Hello { peerLabel: String, peerVersion: String }, SasCode { code: String }, ConfirmPending,
      Confirmed, FileRequest { fileIndex: u16, name: String, size: u64 }, FileResult { fileIndex: u16, accepted: bool },
      Progress { fileIndex: u16, sent: u64, total: u64 }, FileVerified { fileIndex: u16, ok: bool },
      Done { okCount: usize, failCount: usize }, Failed { code: String, detail: String }, Cancelled, Disconnected,
      Capabilities { caps: BleCapabilities },
  }
  #[derive(serde::Deserialize)] #[serde(rename_all="camelCase")]
  pub struct ShareFileArg { pub name: String, pub data: Vec<u8> }   // web 传 Uint8Array（hoot_convert 同惯例）
  #[derive(serde::Serialize)] #[serde(rename_all="camelCase")]
  pub struct ReceivedFile { pub name: String, pub data: Vec<u8> }   // 已净化；web new File([Uint8Array], name)

  #[tauri::command] pub async fn ble_capabilities() -> Result<BleCapabilities, String>;       // Linux → {platform_supported:false,...}；mac/win 查 radio powered（查不到 → None 字段）
  #[tauri::command] pub async fn ble_start_scan(on_event: tauri::ipc::Channel<BleEvent>) -> Result<(), String>;      // ble-busy 互斥；事件泵
  #[tauri::command] pub async fn ble_stop_scan() -> Result<(), String>;
  #[tauri::command] pub async fn ble_send_files(device_id: String, files: Vec<ShareFileArg>, on_event: tauri::ipc::Channel<BleEvent>) -> Result<(), String>;
  #[tauri::command] pub async fn ble_start_receiver(on_event: tauri::ipc::Channel<BleEvent>) -> Result<(), String>;   // 广播 + 会话泵；peripheral 不可用 → ble-peripheral-unavailable
  #[tauri::command] pub async fn ble_confirm_session(accepted: bool) -> Result<(), String>;
  #[tauri::command] pub async fn ble_respond_file(file_index: u16, accepted: bool) -> Result<(), String>;
  #[tauri::command] pub async fn ble_take_received_files() -> Result<Vec<ReceivedFile>, String>;  // 终态后一次性取走并清
  #[tauri::command] pub async fn ble_cancel() -> Result<(), String>;   // 任一模式：停扫描/停广播/断连/清态
  ```
  全局会话管理：`Mutex<Option<ActiveBleSession>>`，同刻一会话（`ble-busy`）；命令把 `SessionEvent` 翻译成 `BleEvent` 推 Channel。平台门常量 `pub const PLATFORM_SUPPORTED: bool = cfg!(any(target_os="macos", target_os="windows"));`。
  Info.plist 键：`NSBluetoothAlwaysUsageDescription` = "PathBlender uses Bluetooth to exchange path files directly between nearby computers. No files are sent over the internet."（**陈述句、非疑问句**——macOS 在系统弹窗中把它作为用途说明原样展示；本计划定稿不引入 InfoPlist.strings 本地化，macOS 按 key 查本地化、缺省回退 plist 原值，行为已核实口径写死、不留开放问句）。

- [ ] **Step 1: 写失败测试**：
  - `include_str!("../../Info.plist")` 断言包含 `NSBluetoothAlwaysUsageDescription`（防回归删除）。
  - `SessionEvent → BleEvent` 翻译纯函数逐变体断言（camelCase 字段名以 serde_json::to_value 快照钉死）。
  - 会话互斥：`SessionManager::begin()` 二次调用 → Err("ble-busy")；`ble_cancel` 后可再 begin（纯逻辑测试，不起 radio）。
  - 平台门：`PLATFORM_SUPPORTED` 在测试目标（macOS）为 true；`capabilities_on_unsupported()` 返回 platform_supported=false 的映射纯函数直测。
  Run: `cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml ble::commands` Expected: FAIL
- [ ] **Step 2: 实现并注册**（lib.rs invoke_handler 追加顺序：`ble_capabilities, ble_start_scan, ble_stop_scan, ble_send_files, ble_start_receiver, ble_confirm_session, ble_respond_file, ble_take_received_files, ble_cancel`）。
  Run: `cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml` Expected: PASS（全量）
- [ ] **Step 3: Commit**
  ```bash
  git add packages/desktop/src-tauri/src/ble/commands.rs packages/desktop/src-tauri/src/ble/mod.rs packages/desktop/src-tauri/src/lib.rs packages/desktop/src-tauri/Info.plist
  git commit -m "feat(desktop): Tauri commands and macOS Bluetooth permission for nearby share"
  ```

---

### Task 10: web 客户端 `ble/client.ts`（invoke 封装，桌面专用）

**Files:**
- Create: `packages/web/src/ble/client.ts`
- Test: `packages/web/test/ble-client.test.ts`

**Interfaces:**
  ```ts
  export interface BleCapabilities { platformSupported: boolean; centralPowered: boolean | null; peripheralPowered: boolean | null }
  export interface BlePeer { id: string; label: string }
  export type BleEvent =
    | { kind: 'discovered'; devices: BlePeer[] } | { kind: 'hello'; peerLabel: string; peerVersion: string }
    | { kind: 'sasCode'; code: string } | { kind: 'confirmPending' } | { kind: 'confirmed' }
    | { kind: 'fileRequest'; fileIndex: number; name: string; size: number }
    | { kind: 'fileResult'; fileIndex: number; accepted: boolean }
    | { kind: 'progress'; fileIndex: number; sent: number; total: number }
    | { kind: 'fileVerified'; fileIndex: number; ok: boolean }
    | { kind: 'done'; okCount: number; failCount: number }
    | { kind: 'failed'; code: string; detail: string }
    | { kind: 'cancelled' } | { kind: 'disconnected' } | { kind: 'capabilities'; caps: BleCapabilities };
  export async function bleCapabilities(): Promise<BleCapabilities>;
  export async function bleStartScan(onEvent: (e: BleEvent) => void): Promise<void>;
  export async function bleStopScan(): Promise<void>;
  export async function bleSendFiles(deviceId: string, files: Array<{ name: string; data: Uint8Array }>, onEvent: (e: BleEvent) => void): Promise<void>;
  export async function bleStartReceiver(onEvent: (e: BleEvent) => void): Promise<void>;
  export async function bleConfirmSession(accepted: boolean): Promise<void>;
  export async function bleRespondFile(fileIndex: number, accepted: boolean): Promise<void>;
  export async function bleTakeReceivedFiles(): Promise<Array<{ name: string; data: Uint8Array }>>;
  export async function bleCancel(): Promise<void>;
  export function bleErrorCode(err: unknown): string | null;   // /^(ble-[a-z0-9-]+?)(?::|$)/
  ```
  注：Rust 端 `BleEvent` 是 enum；serde 序列化为 `{ "discovered": {...} }` 形态还是本计划的 `{ kind: ... }` —— **契约钉死为后者**：Rust 侧 `BleEvent` 用 `#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]`（serde 内部标签），两端一致，web 不再转换。

- [ ] **Step 1: 写失败测试**（`vi.mock('@tauri-apps/api/core')` 沿 `hoot-client.test.ts` 惯例）：命令名/参数 camelCase（`deviceId`、`fileIndex`、`onEvent` Channel）；事件经 Channel 回调透传并映射 union；`bleTakeReceivedFiles` 返回 bytes 数组形态；`bleErrorCode` 前缀提取、普通 Error → null。
  Run: `npm test -w @pathblender/web -- ble-client` Expected: FAIL
- [ ] **Step 2: 实现**（纯封装无 UI）。
  Run: 同上 Expected: PASS
- [ ] **Step 3: Commit**
  ```bash
  git add packages/web/src/ble/client.ts packages/web/test/ble-client.test.ts
  git commit -m "feat(web): typed client for desktop BLE nearby-share commands"
  ```

---

### Task 11: web UI — `ShareDialog` + App/菜单接线 + importFiles 收尾

**Files:**
- Create: `packages/web/src/ble/ShareDialog.tsx`
- Create: `packages/web/src/ble/ShareDialog.css`（仅复用：`width: min(520px, calc(100vw - 32px))` 同 hoot-dialog、flex gap 沿 hoot-body；**禁止新字面颜色/新字号**，色一律 `var(--…)` 既有变量）
- Modify: `packages/web/src/menu-spec.ts`（`fileItems` 在 `import-folder` 后追加 `{ shareBle }`：`!ctx.viewerOnly` 时 `item('share-ble', t('ble.menu'))`）
- Modify: `packages/web/src/App.tsx`：
  - state：`const [bleShareOpen, setBleShareOpen] = useState(false);`
  - 菜单 handler：`menuHandlersRef.current['share-ble'] = () => setBleShareOpen(true);`
  - 挂载（`HootImportFlow` 挂载块后）：`{bleShareOpen && <ShareDialog onClose={() => { setBleShareOpen(false); void bleCancel().catch(() => undefined); }} onReceived={(files) => { setBleShareOpen(false); void importFiles(files.map(({ name, data }) => new File([data], name))); }} />}`
- Test: `packages/web/test/ble-share-dialog.test.tsx`

**Interfaces:**
  ```ts
  interface ShareDialogProps {
    onClose: () => void;                                          // 用户关闭（内部先 bleCancel）
    onReceived: (files: Array<{ name: string; data: Uint8Array }>) => void;   // 仅在 Done(okCount>0) 后触发一次；App 负责转 File → importFiles
  }
  ```
  组件内部状态机（UI 视角）：`ModePick（发送/接收/说明） → [Send: Scan(list) → PickDevice → Connecting → SasConfirm → Sending(progress bar) → Summary] / [Receive: Advertising → SasConfirm → PerFile(Accept/Reject 对话) → Receiving(progress) → Summary]`；`failed/cancelled/disconnected` → 错误行 + 关闭按钮。规则：
  - 打开即 `bleCapabilities()`，两条不可混用提示：**web 壳**（`IS_DESKTOP` false）→ 一律 `ble.webUnsupported`（浏览器，提示用 U 盘）；**桌面但平台不支持**（Linux，`platformSupported === false`）→ `ble.unsupportedPlatform`（提示仅 macOS/Windows 桌面版可用）。两者都只留关闭。`peripheralPowered === false` → 接收按钮旁提示 `ble.peripheralOff`（仍可作发送方）。
  - 桌面判定：`IS_DESKTOP` false 时**不 invoke**任何 ble 命令，直接提示（防 web 壳崩）。
  - 发送文件选择：`<input type="file" multiple>`（复用既有隐藏 input 惯例，App.tsx:1612 风格）→ 读 `arrayBuffer`；>2 MiB → 本地即拒 `ble.tooLarge`（不发起传输）。
  - SAS 阶段：显示本机 `sasCode` + 说明「与对方屏幕比对」+ 两按钮（一致/不一致）→ `bleConfirmSession`。
  - 接收 `fileRequest` → 显示 name/size + Accept/Reject → `bleRespondFile`；全部终态 `done` → `bleTakeReceivedFiles()` → `onReceived`。
  - 进度：`<progress value max>`（hoot-progress 同款）+ `ble.progress {pct}%` 文案。
  - 任何时刻右上关闭 = `bleCancel` + `onClose`。

- [ ] **Step 1: 写失败测试**（`vi.mock('./client')`；jsdom）：
  ①web 壳（IS_DESKTOP false mock）打开 → 渲染 `ble.webUnsupported`、零 invoke；
  ②发送全链：capabilities OK → scan 事件 devices → 点击设备 → sasCode 事件显示码 → 点击一致 → confirmSession 被调 → progress 事件更新 progress 值 → done(2,0) → `bleSendFiles` 参数含所选文件名/字节（input 用 jsdom File mock）；
  ③接收全链：startReceiver → sasCode → 确认 → fileRequest(name='../evil.traj' 已是 Rust 净化后的 'evil.traj' 模拟) → Accept → progress → done(1,0) → takeReceivedFiles → onReceived 收到 {name:'evil.traj', data}，且 **App 层接线的 fake**（测试里传 spy onReceived）拿到后调用方会用 `new File`（断言 onReceived 被调、name 净化）；
  ④拒绝文件：fileRequest → Reject → respondFile(idx,false)；done(0,1) → onReceived 不触发；
  ⑤失败路径：failed 事件 code='ble-disconnected' → 显示 `ble.disconnected` 文案键；关闭 → bleCancel 被调；
  ⑥>2MiB 文件选择 → 显示 tooLarge、bleSendFiles 零调用。
  Run: `npm test -w @pathblender/web -- ble-share-dialog` Expected: FAIL
- [ ] **Step 2: 实现组件与 App 接线**（注意 App.tsx import `ShareDialog` 与 `bleCancel`；菜单/快捷入口仅在桌面渲染菜单本体已有区分——web 的 DOM MenuBar 也渲染该 item，点击走同一 handler → web 提示路径，满足「web 明确提示」）。
  Run: `npm test -w @pathblender/web -- ble-share-dialog && npm test -w @pathblender/web && npm run typecheck -w @pathblender/web`
  Expected: PASS（全量回归）
- [ ] **Step 3: Commit**
  ```bash
  git add packages/web/src/ble/ShareDialog.tsx packages/web/src/ble/ShareDialog.css packages/web/src/menu-spec.ts packages/web/src/App.tsx packages/web/test/ble-share-dialog.test.tsx
  git commit -m "feat(web): nearby-share dialog over pure BLE with unified import handoff"
  ```

---

### Task 12: i18n — `ble.*` 键补齐全语言

**Files:**
- Modify: `packages/web/src/i18n/en.ts`（`hoot.*` 块后追加；下方 27 键为定稿全集）及所有完整字典（typecheck 点名）；`en-gb.ts` 仅需分叉时加覆盖。

**键与英文基准文案（简洁纪律；下方 27 键为定稿全集，Task 11 渲染键必须 ⊆ 此集）：**
`ble.menu` 'Share nearby (Bluetooth)' · `ble.title` 'Share nearby over Bluetooth' · `ble.webUnsupported` 'Nearby share runs in the PathBlender desktop app. On the web, exchange files with a USB drive instead.' · `ble.unsupportedPlatform` 'Nearby share is available on the macOS and Windows desktop apps.' · `ble.bluetoothOff` 'Bluetooth is off on this computer — turn it on and reopen this dialog.' · `ble.peripheralOff` 'This computer cannot act as the receiving device — use the other computer to receive.' · `ble.send` 'Send files' · `ble.receive` 'Receive files' · `ble.scanning` 'Searching for nearby PathBlender devices…' · `ble.scanningEmpty` 'No devices found yet. Open this dialog on the other computer and choose Receive.' · `ble.stopScan` 'Stop searching' · `ble.connecting` 'Connecting…' · `ble.sasTitle` 'Confirm the matching code' · `ble.sasBody` 'Compare the code below with the one on the other computer. Proceed only if they match exactly: {code}' · `ble.sasMatch` 'Codes match' · `ble.sasDiffer` 'They do not match' · `ble.waitingPeer` 'Waiting for the other side to confirm…' · `ble.incoming` '“{name}” ({size}) wants to send a file. Accept?' · `ble.accept` 'Accept' · `ble.reject` 'Reject' · `ble.progress` 'Transferring… {pct}%' · `ble.summary` 'Done: {ok} sent, {fail} failed.' · `ble.tooLarge` 'Files over 2 MB are better shared with a USB drive — Bluetooth would be too slow.' · `ble.disconnected` 'The other device disconnected.' · `ble.cancelled` 'Transfer cancelled.' · `ble.failed` 'Nearby share failed: {code}' · `ble.close` 'Close'

- [ ] **Step 1: en.ts 加键 → typecheck 列缺 → 逐语言补译**（40 语言纪律；直译不机翻腔）。
  Run: `npm run typecheck -w @pathblender/web && npm test -w @pathblender/web -- i18n` Expected: PASS
- [ ] **Step 2: Commit**
  ```bash
  git add packages/web/src/i18n
  git commit -m "feat(i18n): add ble.* strings across all storefront languages"
  ```

---

### Task 13: 文档 + NOTICE + 许可文本

**Files:**
- Create: `docs/ble-nearby-share.md`（协议文档：帧表、密钥时间表、状态机、安全模型（SAS+AEAD 的边界：防被动窃听与中继检测，**不**声称防一切攻击）、能力检测语义、容量与吞吐「未实测」标注、真机验收清单模板、FIRST 边界声明——**明确写「尚未向 FIRST 提交澄清，不宣称赛事合规」**（引红皮书 §16.40 口径，不引用私有文件名））
- Modify: `NOTICE.md`（新增依赖条目：btleplug、ble-peripheral-rust、x25519-dalek、chacha20poly1305、hkdf、rand_core、async-trait——名称+许可+官方 URL+用途一句；标注 objc2 0.5 / windows 0.57 多版本共存源于 ble-peripheral-rust）
- Create: `licenses/ble-peripheral-rust-MIT.txt`、`licenses/btleplug-LICENSE.md`（MIT/Apache-2.0/BSD-3 三许可原文拷贝）、`licenses/x25519-dalek-LICENSE`、`licenses/chacha20poly1305-LICENSE`、`licenses/hkdf-LICENSE`（MIT OR Apache-2.0 双许可原文，从 crate 包内 LICENSE 文件逐字拷贝，勿手打）
- Modify: `README.md` + 8 份本地化 README（`README.zh-CN.md` 等）功能列表各加一句（桌面版纯蓝牙附近分享；网页版不支持）；`docs/user-guide.en.md` / `docs/user-guide.zh.md` 各加小节（入口、双方确认流程、2 MiB 上限、大文件 U 盘、比赛使用前自查当季规则的提醒）

- [ ] **Step 1: 写文档**（对外文案简洁纪律；如实标注「真机互通验证以验收记录为准」）。
- [ ] **Step 2: 许可核对**：`grep -L` 确认 NOTICE 新条目都有 licenses 文件；`sha256sum` 记录在 docs/ble-nearby-share.md 附录。
- [ ] **Step 3: Commit**
  ```bash
  git add docs/ble-nearby-share.md NOTICE.md licenses README.md README.*.md docs/user-guide.en.md docs/user-guide.zh.md
  git commit -m "docs: BLE nearby-share protocol, licensing and honest verification status"
  ```

---

### Task 14: 最终验证（本地全量门禁 + 真机验收执行 + 独立整分支复核）

**本地门禁（全绿才算完成）：**
- [ ] `npm run typecheck`（0 错误）
- [ ] `npm test`（基线 142 文件/1514 全部 + 新增全绿）
- [ ] `cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml`（基线 43 + 新增全绿）
- [ ] `git diff --check` 干净；`git status` 无计划外改动（`sw.js` 构建噪音按 AGENTS 还原）
- [ ] `node scripts/check-version.mjs` 通过（版本未被本分支私改——抬号属交付链）

**三端验证（AGENTS Beta 交付流程，合并前对最终候选执行）：**
- Mac（本机隔离环境，不覆盖用户 /Applications 路径的日常 App——按 install-desktop 的隔离验证惯例）+ Linux（验证主机 已指定的验证主机，离线则如实标未验并按流程处理）+ Windows（CI Beta gate：真实 NSIS 构建/安装/启动；BLE 无线电 CI 不可验，如实标注）。任一端失败不得合入。

**真机验收清单（执行后把结果如实写入 `docs/ble-nearby-share.md` 验收记录节；没做就标「未验」）：**
1. Mac ↔ Mac（同一台也可双实例）：发现→SAS 确认→单文件 .traj 传输→SHA 校验→importFiles 正常出轨迹；
2. Mac ↔ Windows：同上 + 记录实测吞吐与 100 KiB / 1 MiB 耗时（写入文档，替换「未实测」标注）；Windows 端做接收方与发送方各一次（peripheral 能力差异）；
3. **双方关闭 Wi-Fi 再跑一次**（证明纯 BLE、无 802.11 依赖）；
4. 拒收/取消/中途断连/超时四个负路径的真机表现（UI 终态正确、无残留）；
5. macOS 首次触发系统蓝牙弹窗、拒绝授权后的降级提示；
6. 蓝牙关闭状态打开对话框的提示。
CI 与单测**不得**填入本清单结果——清单只收真机证据。

**独立整分支复核（独立会话、只读）：** 对整分支 diff 复核——协议实现与文档一致性、加密用法无自研原语、净化无绕过、错误语义与 i18n 键对齐、测试诚实性（loopback 未冒充真机）、依赖许可与 NOTICE 完整、无遥测/无网络栈引入、隐私扫描（无个人路径/邮箱）。复核结论记入交付记录。

**Commit（本任务无代码，若有验收记录更新则一并提交）：**
```bash
git add docs/ble-nearby-share.md
git commit -m "docs: record BLE nearby-share verification evidence"
```

---

## 发布流程（合并与发版，按 AGENTS 常设授权执行）

1. **变基与抬号**：`git rebase origin/beta` → `node scripts/bump-version.mjs beta "Nearby share over Bluetooth (desktop): peer-verified BLE file exchange"`（40 语更新说明纪律；撞号先变基重跑）。
2. **PR**：经 `op run` 包装 `create-pr-as-app.mjs --create --base beta --head feat/ble-nearby-share`（键 `pr-create:lyt259/pathblender:feat/ble-nearby-share:beta`）。
3. **独立复核**通过 → 委托 LYT259 Approve → `op run` 包装 `beta-merge:<N>` 合入 beta。
4. **Pre-release**：CI 自动出 Mac Universal DMG / Windows EXE / Linux 包；回查 Actions 全绿 + Release 与资产真实存在（含 11 资产基线）才算发布完成。
5. **收尾链**：deploy 双站回查 → `op run install-desktop` 装机密封冒烟 → 删除已并入分支（本地 `-d` + 远端 `--delete`）→ `worktree-status.mjs --prune` → 工程日志记当日结果与证据（工程日志不属本计划提交物，由交付会话按纪律写入）。
6. **红皮书状态升级**（由控制器/交付会话执行，证据分级按 §16.40 第 4 条）：只有真机验收过才把「接口具备实现基础」升为「原型在具体设备通过」；「特定赛季/赛事使用范围获澄清」永远等 FIRST 官方答复，不因发版而写。

## 外部不可验收项（不得伪造，如实挂起）

1. **真实 BLE 无线电行为**：本机无第二台真机时的 Mac↔Windows 互传、吞吐、断连恢复——全部未验；验收清单留空标「未验」。任何单测/loopback 结果不得填入。
2. **Windows peripheral 角色硬件差异**：不同蓝牙适配器/驱动是否可广播须真机矩阵；CI 无硬件。
3. **CoreBluetooth/WinRT 真实弹窗与授权拒绝路径**：macOS 系统弹窗文案与拒绝后的行为须真机确认。
4. **BLE 吞吐量**：文档在实测前只写「未实测」，不写预期量级、不写估时（r2：吞吐零预设），不承诺速度。
5. **FIRST 赛事合规**：澄清请求未提交（红皮书 §16.40 仅记录问题）；对外一切文案不得称已获许可。
6. **ble-peripheral-rust 0.2.0 的平台边缘行为**（如 macOS `update_characteristic` 无订阅者时静默 Ok、WinRT `NotifyValueAsync` 无订阅者行为）：源码已读、协议层用应用层 ACK 兜底，但真实表现待真机验收确认；若实测发现丢帧语义差异，修复按新任务处理，不改本计划契约。

## 依赖清单（定稿；版本钉住，升级需主动决策）

| crate | 版本 | 许可 | 官方 URL | 用途 |
|---|---|---|---|---|
| btleplug | 0.13.5 | MIT OR Apache-2.0（三选一任选） | https://github.com/deviceplug/btleplug | central：扫描/连接/GATT client |
| ble-peripheral-rust | 0.2.0 | MIT | https://github.com/rohitsangwan01/ble-peripheral-rust | peripheral：GATT server（CoreBluetooth + WinRT GattServiceProvider） |
| x25519-dalek | 2.0.1 | MIT OR Apache-2.0 | https://github.com/dalek-cryptography/curve25519-dalek/tree/main/x25519-dalek | X25519 ECDH（RFC 7748） |
| chacha20poly1305 | 0.10.1 | MIT OR Apache-2.0 | https://github.com/RustCrypto/AEADs | AEAD（RFC 8439） |
| hkdf | 0.12.4 | MIT OR Apache-2.0 | https://github.com/RustCrypto/KDFs | HKDF-SHA256（RFC 5869） |
| rand_core | 0.6 (+getrandom) | MIT OR Apache-2.0 | https://github.com/rust-random/rand | OsRng 密钥生成 |
| sha2 | 0.10（锁内 0.10.9） | MIT OR Apache-2.0 | https://github.com/RustCrypto/hashes | SHA-256 完整性 |
| uuid | 1（锁内 1.26.0，无 features） | MIT OR Apache-2.0 | https://github.com/uuid-rs/uuid | GATT UUID 常量换算（协议 UUID 全固定，无 v4 随机生成） |
| async-trait | 0.1 | MIT OR Apache-2.0 | https://github.com/dtolnay/async-trait | PeripheralImpl/CentralRadio trait |
| futures | 0.3（按需） | MIT OR Apache-2.0 | https://github.com/rust-lang/futures-rs | stream 组合（仅 Task 8 确需时声明） |

间接新增（经 btleplug/ble-peripheral-rust，均在 NOTICE 标注）：tokio 1.53.1（锁内已有）、tokio-stream、dashmap、bitflags、static_assertions、thiserror、objc2 0.5 线（Apple）、objc2-core-bluetooth 0.2.2、objc2-foundation 0.2.2、windows 0.57 线（Windows）、bluer/dbus（Linux，cfg 不参与 mac/win 构建）。

## 参考来源（本计划写作时已读）

- btleplug 0.13.5 与 ble-peripheral-rust 0.2.0 crate 源码（crates.io .crate 包逐文件核读，2026-11-09）。
- 项目：`AGENTS.md`（Beta 交付流程/协作 v2/红线）、红皮书 §16.40（私有）、`scripts/new-worktree.sh`、`packages/desktop/src-tauri/src/{lib,hoot}.rs`、`packages/web/src/App.tsx`、`menu-spec.ts`、`hoot/*`、`components/Dialog.tsx`、`i18n/*`。
- 基线实测：本 worktree `feat/ble-nearby-share` @ 09c6d7d2（2026-11-09）：typecheck 0 错误；npm test 142 文件/1514 全绿；cargo test 43/43 全绿（需先备 `packages/web/dist`）。
