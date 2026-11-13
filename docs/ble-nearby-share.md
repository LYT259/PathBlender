# Nearby share over Bluetooth (desktop)

PathBlender's desktop app can exchange path files directly between two nearby
computers over Bluetooth Low Energy (BLE) — no Wi-Fi, hotspot, or internet
connection is used at any point. The sender picks files, the receiver
advertises, both users compare a 6-digit code shown on both screens, and each
file is transferred encrypted in chunks with a SHA-256 check. Received bytes
are only turned into in-memory files and fed through the same unified import
pipeline as manual imports; they are never written to disk or executed.

This document describes the wire protocol, the security model, and — honestly —
what has and has not been verified. It is the reference for the acceptance
checklist in [the verification section](#verification-status).

## Scope and platform gates

- Desktop app only, on macOS 13+ and Windows 10+. The web build shows an
  explicit "desktop app only" message instead of the feature. Linux builds
  answer every command with `ble-unsupported-platform`.
- One nearby-share session at a time per app instance (`ble-busy`).
- Pure BLE GATT is the only transport. There is no Wi-Fi, Wi-Fi Direct,
  hotspot, backend, or telemetry involvement; the macOS permission string
  says exactly this.

### Capability detection semantics

`bleCapabilities` returns:

| Field | Meaning |
| --- | --- |
| `platformSupported` | `false` on Linux (all other fields then `null`); `true` on macOS/Windows. |
| `centralPowered` | Sender-side radio power: `true`/`false`, or `null` when it could not be determined. |
| `peripheralPowered` | Receiver-side radio power: `true`/`false`, or `null` when unknown. |

`null` means *unknown*, not *off*. A `peripheralPowered` of `false` means this
machine cannot act as the receiving device right now (UI then suggests using
the other computer as receiver); it does **not** promise that every machine
reporting `true` will advertise successfully — Windows peripheral capability
varies with Bluetooth hardware and drivers and is [not verified across
devices](#verification-status). Capabilities are probed at runtime and
reported as measured; nothing is assumed.

How the receiver side arrives at its answer:

- The native peripheral manager is created once per process and shared by
  every receive session — the underlying library only honors the first
  manager created per process, so later sessions must reuse it. One internal
  task owns that manager's event stream, caches the latest radio power
  state, and registers the GATT service once, re-registering only after the
  radio is seen turning off.
- The power cache starts *unknown*, and on macOS CoreBluetooth reports that
  pre-authorization Unknown state as `false`. A raw `false` reading is
  therefore never by itself read as "Bluetooth off": a raw `true` settles
  the state immediately, and otherwise the app waits — bounded at 2 s — for
  the radio's actual state update. If none arrives (permission decision
  still pending, or an adapter that never reports), `peripheralPowered`
  surfaces as `null` and starting a receive fails with
  `ble-peripheral-unavailable` rather than guessing. A definitive off report
  does surface as `false` and blocks receive start with `ble-bluetooth-off`.
- Only the receiver side applies this bounded wait; the sender side reports
  adapter power as measured, `null` until an adapter event provides a value.

## Command and event surface (desktop ↔ web)

Nine Tauri commands (arguments camelCase) drive the feature:
`bleCapabilities`, `bleStartScan`, `bleStopScan`, `bleSendFiles`,
`bleStartReceiver`, `bleConfirmSession`, `bleRespondFile`,
`bleTakeReceivedFiles`, `bleCancel`. A single session at a time is enforced;
`bleCancel` tears down scan, advertising, connection, and any half-received
file state.

Session progress reaches the web layer as events over a Tauri channel. Events
are internally tagged JSON: `{"kind":"..."}` with camelCase field names, e.g.
`{"kind":"fileRequest","fileIndex":3,"name":"a.traj","size":42}` and
`{"kind":"done","okCount":2,"failCount":1}`. The complete variant set:
`discovered`, `hello`, `sasCode`, `confirmPending`, `confirmed`,
`fileRequest`, `fileResult`, `progress`, `fileVerified`, `done`, `failed`,
`cancelled`, `disconnected`, `capabilities`. Failures carry a `ble-*` code
plus detail; the codes that exist in the implementation are
`ble-unsupported-platform`, `ble-bluetooth-off`, `ble-peripheral-unavailable`,
`ble-busy`, `ble-scan-failed`, `ble-connect-failed`, `ble-not-found`,
`ble-handshake-timeout`, `ble-protocol-version`, `ble-protocol-error`,
`ble-hash-mismatch`, `ble-too-large:{size}`, `ble-too-many-files`,
`ble-timeout`, `ble-disconnected`, `ble-cancelled`.

## GATT layout

| Item | Value |
| --- | --- |
| Service UUID | `a6afd4b9-1989-4ccc-9f3d-63893d4dc802` (primary) |
| Characteristic UUID | `23f860e0-5ec2-46d5-9e4c-3a3c4fb42c93` |
| Characteristic properties | Read, Write, WriteWithoutResponse, Notify, Indicate |
| Characteristic permissions | Readable, Writeable; value answered dynamically (no cached value) |
| Advertising name | `PathBlender`; the central scans filtered on the service UUID |
| Directions | Sender → receiver: central *writes* the characteristic (with response). Receiver → sender: peripheral updates the characteristic (notify) to a subscribed central. |

Both UUIDs are fixed protocol constants ("naming is the contract"); changing
them is a protocol break, not a tweak.

## Frame encoding

All frames travel on the single characteristic. Max frame size is 180 bytes
on the wire in v1.

**Cleartext frames** are allowed only for the handshake types `HELLO (0x01)`,
`HELLO_ACK (0x02)` and `PROTO_ERROR (0x1F)` — errors may need to surface
before keys exist. Format: `u8 type ‖ u16 payload_len (LE) ‖ payload`.
Additionally a bare 4-byte `SESSION_CANCEL` is accepted only while the
session is still unconfirmed (pre-CONFIRM); after both sides confirm, any
cleartext frame is ignored (counted, no action).

**Encrypted frames** (everything else) are sealed as:

```
u8 type ‖ u16 ct_len (LE) ‖ u64 counter (LE) ‖ ciphertext
```

- `ciphertext = ChaCha20-Poly1305(key_dir, nonce, payload, aad)` — payload is
  the frame body without a duplicated inner header; the 16-byte tag is inside.
- `nonce` (12 B) = `4-byte direction tag (1 sender→receiver, 2 reverse) ‖
  8-byte LE counter`.
- `aad` (16 B) = `session_id (8 B) ‖ counter (8 B LE)` — the counter itself is
  authenticated, so it cannot be stripped or altered without detection.
- Counters are per-direction, start at 1, strictly monotonic, never reused.
  Every seal — including a retransmission of the same plaintext — allocates a
  fresh counter and re-encrypts; old ciphertext is never replayed from cache.
- Receiving rule: accept only strictly increasing counters (gaps from lost
  frames are fine); a counter ≤ the highest accepted is a replay → silently
  dropped, never decrypted, never triggers an action. An authentication
  failure does not advance the accepted maximum; three consecutive failures
  end the session with `SESSION_CANCEL(protocol)`.

**Size constants:** `MAX_FRAME = 180`; envelope overhead = 3 + 8 + 16 = 27
bytes; encrypted body cap 153 bytes; `MAX_CHUNK_DATA = 145` (CHUNK body
2+4+2+145 = 153); `MAX_NAME_BYTES = 110` (FILE_BEGIN body 2+1+110+8+32 = 153).
CHUNK and FILE_BEGIN at their maxima are exactly 180 bytes on the wire; all
other encrypted frames are smaller. Frames are always written in one shot at
offset 0 — the peripheral rejects non-zero write offsets with an ATT error.

### Frame types

| Value | Name | Direction | Cleartext | Payload |
| --- | --- | --- | --- | --- |
| 0x01 | HELLO | sender→receiver | yes | `u8 proto_ver (=1) ‖ u16 max_frame ‖ 8B instance_id ‖ 32B ecdh_pub ‖ str8 app_ver (≤32B) ‖ str8 label (≤32B)` |
| 0x02 | HELLO_ACK | receiver→sender | yes | same shape as HELLO |
| 0x1F | PROTO_ERROR | both | yes | `u8 code` (1 = version mismatch, 2 = malformed) |
| 0x04 | CONFIRM | both | no | `u8 accepted (0/1)` |
| 0x10 | FILE_BEGIN | sender→receiver | no | `u16 file_index ‖ u8 name_len ‖ name (≤110B UTF-8, sanitized) ‖ u64 size ‖ 32B sha256` |
| 0x11 | FILE_ACCEPT | receiver→sender | no | `u16 file_index ‖ u8 accepted` |
| 0x12 | CHUNK | sender→receiver | no | `u16 file_index ‖ u32 seq (from 0) ‖ u16 data_len ‖ data (≤145B)` |
| 0x13 | CHUNK_ACK | receiver→sender | no | `u16 file_index ‖ u32 cum_seq` (all seqs ≤ cum_seq received) |
| 0x14 | RESYNC | receiver→sender | no | `u16 file_index ‖ u32 expected_seq` |
| 0x15 | FILE_END | sender→receiver | no | `u16 file_index` |
| 0x16 | FILE_DONE | receiver→sender | no | `u16 file_index ‖ u8 sha256_ok` |
| 0x17 | FILE_CANCEL | both | no | `u16 file_index ‖ u8 reason` (1 user, 2 timeout, 3 protocol, 4 hash-mismatch, 5 too-large) |
| 0x18 | SESSION_CANCEL | both | pre-confirm only | `u8 reason` (1 user, 2 timeout, 3 protocol, 4 disconnect) |
| 0x19 | KEEPALIVE | both | no | empty; sent by either side after 10 s idle |
| 0x1A | SESSION_COMPLETE | sender→receiver | no | empty; all files finished — gates the receiver's file release |

A CHUNK arriving for a file the receiver has not accepted is dropped and
answered with `FILE_CANCEL(protocol)` — unconfirmed streams cannot advance.

## Key schedule

All cryptographic primitives are standard, off-the-shelf crates; nothing is
home-grown.

1. After the GATT connection and service discovery complete, the sender calls
   `on_connected()` and sends HELLO carrying a one-time X25519 public key
   (generated per session, zeroized on drop). The receiver answers HELLO_ACK
   with its own one-time key.
2. Both sides compute `shared = X25519(my_secret, peer_public)`. Handshakes
   whose shared secret is non-contributory (e.g. a low-order attack key) are
   rejected outright.
3. `salt = instance_id_sender ‖ instance_id_receiver` with the two ids sorted
   lexicographically, so both sides derive identical salts regardless of role.
4. `HKDF-SHA256(ikm = shared, salt)` produces:
   - `info = "PathBlender-BLE-v1"`, 64 bytes → `key_s2r = [0..32]`,
     `key_r2s = [32..64]` (direction keys by role, not by instance order);
   - `info = "pb-ble-sid"`, 8 bytes → `session_id` (bound into every frame's
     AAD);
   - `info = "pb-ble-sas-v1"`, 4 bytes → big-endian u32 mod 1,000,000,
     zero-padded to the 6-digit **SAS code** both screens display.
5. Both CONFIRM frames (accepted=1) collected → transfer state; any refusal
   → `SESSION_CANCEL(user)` and teardown. Encryption starts with the first
   post-CONFIRM frame.

## State machines

**Receiver (peripheral):** `AwaitHello → AwaitSas → Ready → Complete → Closed`,
with per-file handling inside Ready: FILE_BEGIN → user accept/reject →
(receiving CHUNKs → FILE_END → SHA-256 verify → FILE_DONE) → next file.
Files are released to the app only after SESSION_COMPLETE.

**Sender (central):** `Idle → Handshaking → AwaitSas → Ready → Complete →
Closed`. The sender emits nothing until `on_connected()`; per file:
FILE_BEGIN → FILE_ACCEPT → sending (window of 8 in-flight chunks, per-chunk
retransmit on a 15 s timer, ≤5 retries then `FILE_CANCEL(timeout)`) → FILE_END
(also retransmitted with the same bound) → FILE_DONE.

**Timers** (no whole-session limit exists — a slow link is expected, not an
error): handshake 30 s from connection; SAS confirmation wait 300 s; per-file
accept wait 300 s; window ACK wait 15 s; idle disconnect 30 s; keepalive after
10 s idle, both directions. Any timeout leads to the matching CANCEL and
teardown; a link-layer disconnect tears down immediately (`ble-disconnected`).

## Security model — and its limits

What the design provides:

- **Passive eavesdropping protection.** Every payload after confirmation is
  ChaCha20-Poly1305 encrypted under keys only the two parties can derive;
  a passive BLE sniffer sees frame types, sizes, timing, and ciphertext only.
  File names travel only inside encrypted FILE_BEGIN frames.
- **Tampering and replay rejection.** The AEAD tag plus the authenticated
  counter and session id make ciphertext forgery, counter stripping, and
  frame replay detectable; replays are dropped without side effects, and
  retransmissions always re-encrypt under a fresh counter.
- **Man-in-the-middle detection via human SAS comparison.** The 6-digit code
  is derived from the same key material on both sides. A relay attacker
  holding two separate handshakes makes the two screens show different codes;
  users are instructed to proceed only on an exact match. An attacker who
  blindly guesses "match" survives one confirmation with probability 10⁻⁶
  per session.
- **Consent at two levels.** The session only proceeds after both users
  confirm the matching code, and the receiver separately accepts or rejects
  every offered file by name and size; rejected files transfer zero bytes.
- **Unchanged import trust boundary.** Received bytes become in-memory files
  fed into the exact same unified parsing pipeline as manual imports — no
  second parser, no disk writes, no execution of received content.

What it does **not** claim — this is not a defense against every attack:

- A user who confirms a matching code against a malicious peer has consented
  to that peer's files; the protocol cannot judge file content. The existing
  import pipeline (and its warnings) remains the trust boundary for content.
- Radio-level denial of service (jamming, flooding, forced disconnects) is
  detectable and recoverable-by-cancel, not preventable.
- Advertising is visible to nearby scanners: the device name "PathBlender"
  and the service UUID are observable metadata during receive mode. No
  identity or location privacy is claimed over the radio.
- No protection against a compromised endpoint, a hostile OS, or physical
  access to either machine.
- The 6-digit SAS is human-compared; users who skip the comparison or confirm
  mismatched codes defeat that check. Keepalive and size/timing metadata are
  inside the encrypted frames' shape only to the extent stated above.
- Cryptography is standard and unmodified, but this protocol design has not
  been independently audited.

## Capacity and throughput

- Per file: **2 MiB hard limit** (`ble-too-large:{size}`; larger files are
  better carried on a USB drive). Per session: at most 16 files. File names
  are sanitized (path segments stripped, control characters removed,
  ≤110 bytes UTF-8) before anything reaches the import pipeline.
- **Throughput: not measured.** No expectation, estimate, or promised
  transfer time is published anywhere, because none has been observed on real
  hardware. Numbers go here only after the real-device checklist below is
  actually executed, and only as measured facts.

## Verification status

Results are tracked in tiers, and a result from one tier never fills another
tier's blanks.

**Verified in CI — pure logic and loopback, no radio and no OS Bluetooth
involvement:** the protocol layer (codec, crypto against official RFC 7748 /
RFC 5869 / RFC 8439 test vectors, receiver and sender state machines,
sanitization) is covered by pure-logic unit tests, and two real state machines
wired through in-memory queues ("loopback") verify multi-file transfers,
lost-chunk retransmit, replay injection, MITM code divergence, disconnect
cleanup, and slow-link completion. Loopback and mock results are never
real-device results and never fill the checklist below.

**Verified on real macOS, single machine only (2026-11-13, app launched in
isolation from a locally built Universal macOS DMG):** one receive lifecycle,
observed in the UI and in the macOS Bluetooth system log —

- The first-use Bluetooth permission prompt appeared with the expected usage
  string and was allowed; Send and Receive were both usable afterwards.
- The first Receive entered its wait and advertised correctly — the system
  Bluetooth daemon accepted the advertise request carrying the PathBlender
  service UUID and name. No peer HELLO arrived within the 30 s handshake
  window, so the session ended in `ble-handshake-timeout` with a Close
  control, and advertising stopped.
- A second Receive in the same process re-entered its wait and advertised
  again, without `ble-busy`, `ble-peripheral-unavailable`, or the
  `peripheralOff` hint — consistent with the process-shared peripheral
  manager. The system log shows the GATT service registered once across
  both waits, advertising started and stopped at each boundary, and the
  sessions unregistered cleanly when the app quit.
- Scope limit: the daemon accepting an advertise request is not evidence
  that any other device discovered or connected to this one. No second
  machine, no pairing, no connection, and no file transfer happened in this
  run; it verifies no part of a Mac ↔ Mac transfer.

What is **not** verified (explicitly left unclaimed):

- Mac ↔ Mac transfer end-to-end (needs two machines).
- Mac ↔ Windows transfer end-to-end, in both roles (needs a Windows machine).
- Windows peripheral (receiver) capability across Bluetooth hardware/drivers.
- Real throughput and duration at 100 KiB / 1 MiB.
- The macOS Bluetooth permission **denial** path (the prompt itself and
  allowing it are verified above; denying it is not).
- Dialog opened with Bluetooth actually turned off on a real machine
  (today: UI path only, unit-level, no radio).
- Transfer with both machines' Wi-Fi turned off (the proof that no 802.11
  dependency sneaks in; needs two machines).

### Real-device acceptance checklist (fill only with real machines)

CI, unit tests, and loopback results must never be entered here. If an item
was not run, it stays "not run". A single-machine result is marked as such
and never stands in for a two-machine item.

| # | Scenario | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Mac ↔ Mac: discover → SAS confirm → one `.traj` → SHA-256 → imports as a trajectory | not run | — |
| 2 | Mac ↔ Windows as sender; Windows as receiver: same flow, both directions | not run | — |
| 3 | Same transfer with Wi-Fi disabled on both machines (pure-BLE proof) | not run | — |
| 4 | Throughput: 100 KiB and 1 MiB files, measured durations recorded above | not run | — |
| 5 | Negative paths on real devices: reject file, cancel, mid-transfer disconnect, timeout | not run | — |
| 6 | macOS first-run Bluetooth permission prompt; denial path degrades gracefully | partial — prompt shown and allowed on macOS (item 8); denial path not run | item 8 |
| 7 | Dialog opened with Bluetooth off: correct message, no crash | not run | — |
| 8 | Single macOS receive lifecycle: first-use permission allow → Receive wait → `ble-handshake-timeout` → Close → second Receive in the same process → advertising start/stop confirmed in the system Bluetooth log | pass — single machine, 2026-11-13 | macOS Bluetooth system log, isolated run of the released Universal macOS DMG |

## FIRST competition boundary

Nearby share is a convenience feature for pit/strategy work. **No
clarification request about using this feature at FIRST events has been
submitted to FIRST, and none has been answered; PathBlender does not claim
the feature is compliant with any FIRST competition rule, in any season.**
Rules about radios, Bluetooth, and wireless devices at events change per
season and per event. Before using this feature at a competition, check the
current season's manual and event rules yourself, and fall back to a USB
drive when in doubt. (This statement reflects the project's recorded 2026-11
position that the question is open until FIRST answers it.)

## Appendix: dependencies and license texts

New Rust dependencies introduced by this feature (versions as locked in
`packages/desktop/src-tauri/Cargo.lock`):

| Crate | Version | License (as declared by the crate) | License text kept at | SHA-256 |
| --- | --- | --- | --- | --- |
| btleplug | 0.13.5 | MIT/Apache-2.0/BSD-3-Clause (any one) | `licenses/btleplug-LICENSE.md` | `95f1ea7e261c12c46fe8f67d2ddb7a92ebb1a5fd10d127e4ab3003f0701d9f56` |
| ble-peripheral-rust | 0.2.0 | MIT | `licenses/ble-peripheral-rust-MIT.txt` | `156d2e23ed7661543e14bf1ac1f156678635a07e14fb1fda939a27abf2cdf33e` |
| x25519-dalek | 2.0.1 | BSD-3-Clause | `licenses/x25519-dalek-LICENSE` | `bebc725b8cb1ba1ed1798cb505cf31bf9bce4cbe942baf358b642666ba8186bd` |
| chacha20poly1305 | 0.10.1 | MIT OR Apache-2.0 | `licenses/chacha20poly1305-LICENSE` | `d07b8cc9941f52d713c89aa87b871384a9cfda12d1eb9384805467250d2b4d96` |
| hkdf | 0.12.4 | MIT OR Apache-2.0 | `licenses/hkdf-LICENSE` | `c9f1ee2c54ba72665705cc40bbd852f9e2cd17aa974a48e7b0c388a5b309cb59` |
| rand_core | 0.6.4 | MIT OR Apache-2.0 | — | — |
| async-trait | 0.1.92 | MIT OR Apache-2.0 | — | — |

License texts are byte-for-byte copies from the published crate packages
(`cargo registry` sources); the two RustCrypto entries concatenate the
crate's `LICENSE-MIT` and `LICENSE-APACHE` files unchanged, separated by a
marker line. `rand_core` and `async-trait` are dual-licensed under the same
standard MIT/Apache-2.0 texts as the RustCrypto crates above; their standard
texts are available at their repositories (listed in [NOTICE.md](../NOTICE.md))
and are not duplicated here.

Notes:

- `x25519-dalek`'s repository root also mentions MIT OR Apache-2.0 for some
  crates in the workspace, but the published `x25519-dalek` 2.0.1 crate
  itself declares `BSD-3-Clause` in its manifest and ships that BSD-3-Clause
  text as its only LICENSE file; the table records what the crate declares
  and ships.
- `sha2 0.10.9`, `uuid 1.29.2`, `futures 0.3.34`, and `tokio` were already
  locked (transitive via the Tauri stack) and are now also declared directly
  for this feature; no second copy of any of them enters the tree.
- `ble-peripheral-rust` pulls the `objc2 0.5.3` / `objc2-core-bluetooth
  0.2.2` line on Apple platforms and the `windows 0.57.0` line on Windows.
  These coexist with the `objc2 0.6.4` and `windows 0.62.2` lines the Tauri
  stack already uses (Cargo permits multiple semver-incompatible versions;
  the cost is compile time only). `btleplug` uses the existing 0.6.4/0.62.2
  lines.
