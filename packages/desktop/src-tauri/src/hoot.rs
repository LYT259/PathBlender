//! HOOT desktop import — owlet distribution plumbing, pure-function layer.
//!
//! Source of truth for the index shape is the real CTRE distribution index
//! (<https://redist.ctr-electronics.com/index.json>, fetched 2026-11-07): a
//! `Tools[]` array whose `Name == "owlet"` entry carries `Items[]`, each with
//! `Version` (dot-separated numeric tuple, e.g. `25.0.1` / `1.0.1.1`),
//! `Compliancy`, and a `Urls` map. Each platform artifact is published under
//! three keys — `{key}`, `{key}-md5`, `{key}-sha1` (no sha256).
//!
//! Two facts deviate from the plan/brief text and follow the fetched sample
//! instead (AGENTS.md red line 3: format facts follow real samples):
//!
//! * The Windows `Urls` map key is `windowsx86-64` — the `.exe` suffix lives
//!   only in the artifact URL, not in the map key. Every item of the fetched
//!   index was enumerated; none has a `windowsx86-64.exe` key.
//! * Version ordering is the numeric-tuple rule the brief states. Under that
//!   rule the order is `25.0.1 > 9.x > 1.0.1.1`; the brief's example chain
//!   `25.0.1 > 1.0.1.1 > 9.x` contradicts its own rule and is not used.
//!
//! Persistence of the owlet EULA consent and download record under the app
//! cache dir lives here, as does the official-artifact download (index fetch,
//! SHA-1 gate, atomic install, idempotent re-entry) and the owlet CLI
//! invocation that converts one `.hoot` log to wpilog.

use std::path::{Path, PathBuf};
use base64::Engine as _;
use tauri::{AppHandle, Manager};

/// The selected owlet release for a platform artifact — the output of
/// [`parse_owlet_index`]. `sha1` is the lowercase hex digest published under
/// `{artifact_key}-sha1`; `url` points at the official redistribution point.
#[derive(Debug)]
pub struct IndexSelection {
    pub version: String,
    pub compliancy: u32,
    pub url: String,
    pub sha1: String,
}

/// The owlet artifact key for the compile target, as used in the index's
/// `Urls` map: `macosuniversal`, `windowsx86-64`, or `linuxx86-64`.
/// Returns `None` on targets PathBlender desktop builds do not cover.
pub fn platform_artifact_key() -> Option<&'static str> {
    if cfg!(target_os = "macos") {
        Some("macosuniversal")
    } else if cfg!(target_os = "windows") {
        Some("windowsx86-64")
    } else if cfg!(target_os = "linux") {
        Some("linuxx86-64")
    } else {
        None
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "PascalCase")]
struct IndexDoc {
    #[serde(default)]
    tools: Vec<ToolEntry>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "PascalCase")]
struct ToolEntry {
    #[serde(default)]
    name: String,
    #[serde(default)]
    items: Vec<ItemEntry>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "PascalCase")]
struct ItemEntry {
    version: String,
    compliancy: u32,
    #[serde(default)]
    urls: std::collections::HashMap<String, String>,
}

/// `25.0.1` → `[25, 0, 1]`; any non-numeric component makes the whole
/// version unrankable (`None`), and such items are skipped rather than
/// failing the parse.
fn version_tuple(version: &str) -> Option<Vec<u64>> {
    version
        .split('.')
        .map(|part| part.parse::<u64>().ok())
        .collect::<Option<Vec<u64>>>()
}

/// Pick the newest `owlet` item from a CTRE distribution index and return its
/// `{artifact_key}` URL and `{artifact_key}-sha1` digest. Versions compare as
/// numeric tuples (so `25.0.1` beats `9.99.0`); items whose version is not a
/// dot-separated number list are skipped. Errors name what was missing.
pub fn parse_owlet_index(json: &str, artifact_key: &str) -> Result<IndexSelection, String> {
    let doc: IndexDoc =
        serde_json::from_str(json).map_err(|e| format!("invalid owlet index: {e}"))?;
    let owlet = doc
        .tools
        .iter()
        .find(|tool| tool.name == "owlet")
        .ok_or_else(|| "owlet entry not found in index".to_string())?;
    let (_, best) = owlet
        .items
        .iter()
        .filter_map(|item| version_tuple(&item.version).map(|tuple| (tuple, item)))
        .max_by(|(a, _), (b, _)| a.cmp(b))
        .ok_or_else(|| "owlet index has no versioned items".to_string())?;
    let url = best.urls.get(artifact_key).ok_or_else(|| {
        format!("owlet {} has no '{artifact_key}' artifact", best.version)
    })?;
    let sha1_key = format!("{artifact_key}-sha1");
    let sha1 = best
        .urls
        .get(&sha1_key)
        .ok_or_else(|| format!("owlet {} has no '{sha1_key}' entry", best.version))?;
    Ok(IndexSelection {
        version: best.version.clone(),
        compliancy: best.compliancy,
        url: url.clone(),
        sha1: sha1.clone(),
    })
}

/// SHA-1 the bytes and compare against `expected_hex`, case-insensitively.
pub fn verify_sha1(bytes: &[u8], expected_hex: &str) -> bool {
    use sha1::{Digest, Sha1};
    let digest = Sha1::digest(bytes);
    let actual: String = digest.iter().map(|byte| format!("{byte:02x}")).collect();
    actual == expected_hex.to_ascii_lowercase()
}

/// Persisted owlet bookkeeping, stored as JSON at
/// `{app_cache_dir}/hoot/owlet-state.json`. `version`/`compliancy`/`sha1`/
/// `file_name` describe the downloaded owlet artifact and stay `None` until
/// the first successful download.
#[derive(Debug, Default, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HootState {
    pub eula_accepted: bool,
    pub version: Option<String>,
    pub compliancy: Option<u32>,
    pub sha1: Option<String>,
    pub file_name: Option<String>,
}

/// Snapshot for the web client — the response of `hoot_status` and
/// `hoot_accept_eula`. Serialized with camelCase keys to match the Tauri
/// invoke convention the web side types against.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HootStatus {
    pub eula_accepted: bool,
    pub downloaded: bool,
    pub version: Option<String>,
    pub compliancy: Option<u32>,
}

/// Subdirectory of the app cache dir holding the state file and the owlet
/// binary.
const HOOT_DIR_NAME: &str = "hoot";
/// Name of the persisted state file inside that directory.
const STATE_FILE_NAME: &str = "owlet-state.json";

fn hoot_dir(cache_dir: &Path) -> PathBuf {
    cache_dir.join(HOOT_DIR_NAME)
}

/// Load the persisted state. A missing state file reads as a fresh
/// [`HootState::default`]; so does a damaged one (unparseable JSON or invalid
/// UTF-8) — the cache dir is user-writable, and degrading to fresh
/// (re-consent plus an idempotent re-download) beats erroring the import
/// feature until the cache is cleared by hand. Only genuine I/O errors
/// propagate.
pub fn load_hoot_state(cache_dir: &Path) -> Result<HootState, String> {
    let path = hoot_dir(cache_dir).join(STATE_FILE_NAME);
    if !path.is_file() {
        return Ok(HootState::default());
    }
    // Bytes, not a String: non-UTF-8 damage must land in the same
    // degrade-to-fresh path as unparseable JSON, not surface as an error.
    let raw = std::fs::read(&path).map_err(|e| format!("read {}: {e}", path.display()))?;
    Ok(serde_json::from_slice(&raw).unwrap_or_default())
}

/// Persist `state` atomically: serialize, write `<file>.tmp`, then rename
/// over the previous state, so a crash mid-save can never leave a
/// half-written state file. Creates `{cache_dir}/hoot/` when absent. Refuses
/// a `file_name` that is not a pure basename (see [`is_safe_basename`]) —
/// our own writes must never persist a record that could resolve outside the
/// hoot dir.
pub fn save_hoot_state(cache_dir: &Path, state: &HootState) -> Result<(), String> {
    if let Some(name) = state.file_name.as_deref() {
        if !is_safe_basename(name) {
            return Err(format!("refusing to persist non-basename owlet file name {name:?}"));
        }
    }
    let dir = hoot_dir(cache_dir);
    std::fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    let json =
        serde_json::to_string_pretty(state).map_err(|e| format!("serialize state: {e}"))?;
    let final_path = dir.join(STATE_FILE_NAME);
    let tmp_path = dir.join(format!("{STATE_FILE_NAME}.tmp"));
    std::fs::write(&tmp_path, json).map_err(|e| format!("write {}: {e}", tmp_path.display()))?;
    std::fs::rename(&tmp_path, &final_path)
        .map_err(|e| format!("publish {}: {e}", final_path.display()))?;
    Ok(())
}

/// A recordable owlet file name: exactly one path component — no separators
/// (`/`, `\`, or `:` — backslash separates on Windows, and a colon makes
/// `C:owlet` a drive-relative path there), and not `.`, `..`, or empty.
/// Task 4 derives the name from `platform_artifact_key`, so legitimate names
/// always pass; the rule exists so a tampered or buggy record can never
/// resolve — or, in Task 5, execute — outside `{cache_dir}/hoot/`.
fn is_safe_basename(name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && !name.contains('/')
        && !name.contains('\\')
        && !name.contains(':')
}

/// Resolve the recorded owlet binary's on-disk path, but only for a
/// pure-basename `file_name` (see [`is_safe_basename`]) — anything else
/// yields `None`. The status computation here and the convert command in a
/// later task must both go through this helper instead of joining
/// `file_name` themselves.
pub fn owlet_binary_path(cache_dir: &Path, state: &HootState) -> Option<PathBuf> {
    let name = state.file_name.as_deref()?;
    if !is_safe_basename(name) {
        return None;
    }
    Some(hoot_dir(cache_dir).join(name))
}

/// Derive the client-facing status from a loaded state. `downloaded` requires
/// a recorded `version`, a basename-safe `file_name` (via
/// [`owlet_binary_path`]), and the binary still present at the resolved path
/// — a stale record without the file, a stray binary without a record, or a
/// tampered path-like name is not a download.
fn status_from_state(cache_dir: &Path, state: &HootState) -> HootStatus {
    let downloaded = match (&state.version, owlet_binary_path(cache_dir, state)) {
        (Some(_), Some(binary)) => binary.is_file(),
        _ => false,
    };
    HootStatus {
        eula_accepted: state.eula_accepted,
        downloaded,
        version: state.version.clone(),
        compliancy: state.compliancy,
    }
}

/// Read persisted state from `cache_dir` and derive the status — the core of
/// the `hoot_status` command.
pub fn hoot_status_in(cache_dir: &Path) -> Result<HootStatus, String> {
    let state = load_hoot_state(cache_dir)?;
    Ok(status_from_state(cache_dir, &state))
}

/// Record EULA consent, preserving any existing download record — the core of
/// the `hoot_accept_eula` command. A record whose `file_name` is not a safe
/// basename (external tampering; see [`is_safe_basename`]) is dropped
/// wholesale instead of failing the save: consent must never be held hostage
/// to a poisoned record, and the next download re-records idempotently.
pub fn accept_eula(cache_dir: &Path) -> Result<HootStatus, String> {
    let mut state = load_hoot_state(cache_dir)?;
    if let Some(name) = state.file_name.as_deref() {
        if !is_safe_basename(name) {
            state = HootState::default();
        }
    }
    state.eula_accepted = true;
    save_hoot_state(cache_dir, &state)?;
    Ok(status_from_state(cache_dir, &state))
}

fn app_cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_cache_dir()
        .map_err(|e| format!("resolve app cache dir: {e}"))
}

/// Current owlet EULA/download status for the web client.
#[tauri::command]
pub async fn hoot_status(app: AppHandle) -> Result<HootStatus, String> {
    let cache_dir = app_cache_dir(&app)?;
    hoot_status_in(&cache_dir)
}

/// Persist the user's owlet EULA consent and return the resulting status.
#[tauri::command]
pub async fn hoot_accept_eula(app: AppHandle) -> Result<HootStatus, String> {
    let cache_dir = app_cache_dir(&app)?;
    accept_eula(&cache_dir)
}

// ---- official artifact download (Task 4) ----------------------------------

/// The CTRE distribution index — the single network entry point for owlet.
const OWLET_INDEX_URL: &str = "https://redist.ctr-electronics.com/index.json";

/// Per-chunk download progress for the web client, reported through the
/// command's channel while the artifact streams in.
#[derive(serde::Serialize, Clone)]
pub struct DownloadProgress {
    pub downloaded: u64,
    pub total: u64,
}

/// Install the process-default rustls CryptoProvider (ring) before this
/// module's first reqwest call, using the guarded idiom tauri-plugin-updater
/// uses (its src/updater.rs: `CryptoProvider::get_default().is_none()` before
/// `ring::default_provider().install_default()`). reqwest is built here with
/// `rustls-no-provider`, and the updater plugin may never run in a session
/// that only imports HOOT logs — without this, the download fails at TLS
/// provider setup.
fn install_ring_tls_provider() {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        // Only fails if a provider already got installed concurrently —
        // exactly the case the guard means to yield to.
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
}

/// The pre-network gate every download passes: EULA consent first (the legal
/// gate — before any network byte), then platform support. Yields the loaded
/// state and the platform artifact key.
fn hoot_download_gate(
    cache_dir: &Path,
    artifact_key: Option<&'static str>,
) -> Result<(HootState, &'static str), String> {
    let state =
        load_hoot_state(cache_dir).map_err(|e| format!("hoot-download-failed:{e}"))?;
    if !state.eula_accepted {
        return Err("hoot-eula-required".to_string());
    }
    let key = artifact_key.ok_or_else(|| "hoot-unsupported-platform".to_string())?;
    Ok((state, key))
}

/// Whether the recorded download is still intact — "already downloaded AND
/// the hash still matches": a complete record (version + sha1), a
/// basename-safe name resolving through [`owlet_binary_path`] to an existing
/// file, and file bytes that still hash to the recorded sha1. Repeat imports
/// with an intact artifact skip the network entirely; a tampered or corrupted
/// cache re-downloads.
fn cached_download_is_current(cache_dir: &Path, state: &HootState) -> bool {
    match (
        state.sha1.as_deref(),
        state.version.as_deref(),
        owlet_binary_path(cache_dir, state),
    ) {
        (Some(recorded_sha1), Some(_), Some(path)) => match std::fs::read(&path) {
            Ok(bytes) => verify_sha1(&bytes, recorded_sha1),
            Err(_) => false,
        },
        _ => false,
    }
}

/// The recorded on-disk name for the owlet binary, derived solely from the
/// platform artifact key plus a fixed `.exe` extension on Windows — never
/// from the artifact URL or any other fetched string, so it is always a pure
/// basename (see [`is_safe_basename`]).
fn owlet_file_name(artifact_key: &str) -> String {
    if cfg!(target_os = "windows") {
        format!("owlet-{artifact_key}.exe")
    } else {
        format!("owlet-{artifact_key}")
    }
}

/// Where a download-in-progress stages bytes before its atomic rename.
fn partial_artifact_path(cache_dir: &Path, artifact_key: &str) -> PathBuf {
    hoot_dir(cache_dir).join(format!("{}.tmp", owlet_file_name(artifact_key)))
}

/// Gate `bytes` through the selection's published sha1, then atomically
/// publish the artifact and the full state record. On mismatch or any write
/// failure the partial output is deleted so nothing half-written survives;
/// the record — version, compliancy, sha1, file_name — is persisted in one
/// atomic save, so a binary without its record (or vice versa) is never
/// observable. Only reachable behind the consent gate, hence `true`.
fn install_owlet_artifact(
    cache_dir: &Path,
    artifact_key: &str,
    selection: &IndexSelection,
    bytes: &[u8],
) -> Result<HootStatus, String> {
    if !verify_sha1(bytes, &selection.sha1) {
        // Also sweep a stale partial from an earlier crashed attempt, so the
        // retry starts from nothing.
        let _ = std::fs::remove_file(partial_artifact_path(cache_dir, artifact_key));
        return Err(format!("hoot-hash-mismatch:{artifact_key}"));
    }
    let dir = hoot_dir(cache_dir);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("hoot-download-failed:create {}: {e}", dir.display()))?;
    let tmp_path = partial_artifact_path(cache_dir, artifact_key);
    let final_path = dir.join(owlet_file_name(artifact_key));
    let fail = |detail: String| {
        let _ = std::fs::remove_file(&tmp_path);
        format!("hoot-download-failed:{detail}")
    };
    std::fs::write(&tmp_path, bytes)
        .map_err(|e| fail(format!("write {}: {e}", tmp_path.display())))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tmp_path, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| fail(format!("chmod {}: {e}", tmp_path.display())))?;
    }
    std::fs::rename(&tmp_path, &final_path)
        .map_err(|e| fail(format!("publish {}: {e}", final_path.display())))?;
    let state = HootState {
        eula_accepted: true,
        version: Some(selection.version.clone()),
        compliancy: Some(selection.compliancy),
        sha1: Some(selection.sha1.clone()),
        file_name: Some(owlet_file_name(artifact_key)),
    };
    save_hoot_state(cache_dir, &state)
        .map_err(|e| format!("hoot-download-failed:record state: {e}"))?;
    Ok(status_from_state(cache_dir, &state))
}

/// The injectable download orchestration — the unit-test seam covering the
/// whole consent → idempotence → parse → fetch → verify → persist chain with
/// zero network: pass a fake `fetch` and an index document. The
/// [`hoot_download_owlet`] command runs the same steps through the same
/// helpers with real reqwest calls and chunk-progress emission (thin shell;
/// real-device verification covers what unit tests cannot).
// Test-only by design (the command mirrors its steps because the seam's
// fetch is sync while reqwest is async): the cfg_attr silences only this
// item's dead_code lint, and only in non-test builds — test builds keep the
// lint live, and every other warning stays visible.
#[cfg_attr(not(test), allow(dead_code))]
pub fn download_via<F: Fn(&str) -> Result<Vec<u8>, String>>(
    fetch: F,
    artifact_key: Option<&'static str>,
    index_json: &str,
    cache_dir: &Path,
) -> Result<HootStatus, String> {
    let (state, key) = hoot_download_gate(cache_dir, artifact_key)?;
    if cached_download_is_current(cache_dir, &state) {
        return Ok(status_from_state(cache_dir, &state));
    }
    let selection =
        parse_owlet_index(index_json, key).map_err(|e| format!("hoot-download-failed:{e}"))?;
    let bytes = fetch(&selection.url).map_err(|e| format!("hoot-download-failed:{e}"))?;
    install_owlet_artifact(cache_dir, key, &selection, &bytes)
}

/// GET the distribution index as text. Transport failures carry the
/// `hoot-download-failed` code the web side maps.
async fn fetch_index_text() -> Result<String, String> {
    let response = reqwest::get(OWLET_INDEX_URL)
        .await
        .map_err(|e| format!("hoot-download-failed:fetch index: {e}"))?;
    response
        .text()
        .await
        .map_err(|e| format!("hoot-download-failed:read index: {e}"))
}

/// Stream the selected artifact, accumulating in memory and reporting
/// [`DownloadProgress`] per chunk. Progress is best-effort: a closed or slow
/// channel must never fail the download itself.
async fn fetch_artifact_with_progress(
    url: &str,
    on_progress: &tauri::ipc::Channel<DownloadProgress>,
) -> Result<Vec<u8>, String> {
    let mut response = reqwest::get(url)
        .await
        .map_err(|e| format!("hoot-download-failed:fetch artifact: {e}"))?;
    let total = response.content_length().unwrap_or(0);
    let mut bytes = Vec::with_capacity(total as usize);
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("hoot-download-failed:read artifact: {e}"))?
    {
        bytes.extend_from_slice(&chunk);
        let _ = on_progress.send(DownloadProgress {
            downloaded: bytes.len() as u64,
            total,
        });
    }
    Ok(bytes)
}

/// Download the official owlet converter for this platform: fetch the CTRE
/// distribution index, stream the selected artifact with progress reports,
/// and publish it only after the full-content SHA-1 gate. Idempotent — an
/// intact recorded download returns the current status without any network.
#[tauri::command]
pub async fn hoot_download_owlet(
    app: AppHandle,
    on_progress: tauri::ipc::Channel<DownloadProgress>,
) -> Result<HootStatus, String> {
    install_ring_tls_provider();
    let cache_dir = app_cache_dir(&app)?;
    let artifact_key = platform_artifact_key();
    // Consent and platform gates run before the first network byte.
    let (state, key) = hoot_download_gate(&cache_dir, artifact_key)?;
    if cached_download_is_current(&cache_dir, &state) {
        return Ok(status_from_state(&cache_dir, &state));
    }
    let index_text = fetch_index_text().await?;
    let selection =
        parse_owlet_index(&index_text, key).map_err(|e| format!("hoot-download-failed:{e}"))?;
    let bytes = fetch_artifact_with_progress(&selection.url, &on_progress).await?;
    install_owlet_artifact(&cache_dir, key, &selection, &bytes)
}

// ---- .hoot → wpilog conversion (Task 5) ------------------------------------

/// The most stderr characters a `hoot-convert-failed` detail may carry —
/// enough of a tail to diagnose a failed conversion, never a dump of the
/// whole log (and never the user's file contents).
const CONVERT_STDERR_TAIL_CHARS: usize = 500;

/// The conversion result for the web client — Task 6/8's typed contract:
/// the output name and its bytes as standard base64.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HootConverted {
    pub wpilog_name: String,
    pub wpilog_base64: String,
}

/// What the conversion orchestration needs from one owlet CLI run — the
/// success flag and stderr. The real runner maps a
/// `std::process::Command::output()` into this; stub runners construct it
/// directly, keeping unit tests free of any real process execution.
#[derive(Debug)]
pub struct OwletRun {
    pub success: bool,
    pub stderr: Vec<u8>,
}

/// The official owlet CLI argument list (pinned to the owlet documentation):
/// `-f wpilog` selects the output format, then the input and output paths in
/// that order — `owlet -f wpilog {in} {out}`.
pub fn owlet_args(input: &Path, output: &Path) -> Vec<String> {
    vec![
        "-f".to_string(),
        "wpilog".to_string(),
        input.to_string_lossy().into_owned(),
        output.to_string_lossy().into_owned(),
    ]
}

/// The last `max_chars` characters of an owlet stderr, lossily decoded.
fn stderr_tail(stderr: &[u8], max_chars: usize) -> String {
    let text = String::from_utf8_lossy(stderr);
    let count = text.chars().count();
    text.chars().skip(count.saturating_sub(max_chars)).collect()
}

/// The pre-execution gate: EULA consent first (the legal gate — before any
/// execution), then a vouchable owlet — the binary must resolve exclusively
/// through [`owlet_binary_path`] and still hash to the recorded sha1 (via
/// [`cached_download_is_current`], the same re-verification the download's
/// idempotence uses). Any gap yields `hoot-owlet-missing`, which the web side
/// maps to the re-download path.
fn convert_gate(cache_dir: &Path, state: &HootState) -> Result<PathBuf, String> {
    if !state.eula_accepted {
        return Err("hoot-eula-required".to_string());
    }
    let Some(binary) = owlet_binary_path(cache_dir, state) else {
        return Err("hoot-owlet-missing".to_string());
    };
    if !cached_download_is_current(cache_dir, state) {
        return Err("hoot-owlet-missing".to_string());
    }
    Ok(binary)
}

/// The injectable conversion orchestration — the unit-test seam for the
/// whole gate → temp input → CLI → output-read → base64 chain with zero real
/// owlet execution: pass a fake runner. The [`hoot_convert`] command runs the
/// same steps through [`run_owlet_cli`] with a real `std::process::Command`.
/// The per-conversion temp dir is removed on success and failure alike
/// (`TempDir` drops even through early error returns), and no file content is
/// ever printed — stderr only travels inside the capped error detail.
pub fn convert_via<F: FnOnce(&Path, &[String]) -> Result<OwletRun, String>>(
    cache_dir: &Path,
    file_name: &str,
    data: &[u8],
    run: F,
) -> Result<HootConverted, String> {
    let state = load_hoot_state(cache_dir)?;
    let binary = convert_gate(cache_dir, &state)?;
    // `file_stem` strips any directory components, so even a path-like
    // file name from the web side yields a pure stem and the work files
    // stay inside the temp dir.
    let stem = Path::new(file_name)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .ok_or_else(|| format!("hoot-convert-failed:no .hoot stem in {file_name:?}"))?
        .to_string();
    let work = tempfile::tempdir()
        .map_err(|e| format!("hoot-convert-failed:create temp dir: {e}"))?;
    let input_path = work.path().join(format!("{stem}.hoot"));
    let output_path = work.path().join(format!("{stem}.wpilog"));
    std::fs::write(&input_path, data)
        .map_err(|e| format!("hoot-convert-failed:write {stem}.hoot: {e}"))?;
    match run(&binary, &owlet_args(&input_path, &output_path)) {
        Ok(result) if result.success => {
            let wpilog = std::fs::read(&output_path)
                .map_err(|e| format!("hoot-convert-failed:read {stem}.wpilog: {e}"))?;
            Ok(HootConverted {
                wpilog_name: format!("{stem}.wpilog"),
                wpilog_base64: base64::engine::general_purpose::STANDARD.encode(wpilog),
            })
        }
        Ok(result) => Err(format!(
            "hoot-convert-failed:{}",
            stderr_tail(&result.stderr, CONVERT_STDERR_TAIL_CHARS)
        )),
        Err(detail) => Err(format!("hoot-convert-failed:{detail}")),
    }
}

/// Run the real owlet CLI (the command's runner): capture the process output
/// and keep only what the orchestration consumes. Spawn failures carry the
/// `hoot-convert-failed` code; no path or file content is added to the error.
fn run_owlet_cli(program: &Path, args: &[String]) -> Result<OwletRun, String> {
    let output = std::process::Command::new(program)
        .args(args)
        .output()
        .map_err(|e| format!("run owlet: {e}"))?;
    Ok(OwletRun {
        success: output.status.success(),
        stderr: output.stderr,
    })
}

/// Convert one `.hoot` log to wpilog with the official owlet CLI: gate on
/// EULA consent and a hash-verified download, convert through a throwaway
/// temp dir, and return the output name plus its bytes as base64.
#[tauri::command]
pub async fn hoot_convert(
    app: AppHandle,
    file_name: String,
    data: Vec<u8>,
) -> Result<HootConverted, String> {
    let cache_dir = app_cache_dir(&app)?;
    convert_via(&cache_dir, &file_name, &data, run_owlet_cli)
}

#[cfg(test)]
mod tests {
    use super::{
        accept_eula, convert_via, download_via, hoot_status_in, load_hoot_state, owlet_args,
        parse_owlet_index, platform_artifact_key, save_hoot_state, verify_sha1, HootConverted,
        HootState, HootStatus, OwletRun,
    };
    use std::path::Path;

    /// Trimmed copy of the real distribution index (fetched 2026-11-07): the
    /// corvus tool is kept (with a higher version than any owlet item) to pin
    /// the `Name == "owlet"` filter, and owlet keeps two items — 25.0.0 and
    /// 25.0.1 — with every Urls key each real item has. Values are verbatim
    /// from the fetch; expectations below are hand-checked against it.
    const REAL_INDEX_TRIMMED: &str = r#"{
  "JsonVersion": "1.0.0.0",
  "Tools": [
    {
      "Name": "corvus",
      "Items": [
        {
          "Version": "26.0.0",
          "Compliancy": 18,
          "Urls": {
            "macosuniversal": "https://redist.ctr-electronics.com/tools/corvus/26.0.0/corvus-26.0.0-macosuniversal",
            "macosuniversal-md5": "a2362d808a4447b56862d559dfc4059e",
            "macosuniversal-sha1": "0412268aa7c8029675b85fa9474b0ebb251f49e5"
          }
        }
      ]
    },
    {
      "Name": "owlet",
      "Items": [
        {
          "Version": "25.0.0",
          "Compliancy": 9,
          "Urls": {
            "linuxx86-64": "https://redist.ctr-electronics.com/tools/owlet/25.0.0/owlet-25.0.0-linuxx86-64",
            "linuxx86-64-md5": "8b68593fa2521e12bad193cdc86c2065",
            "linuxx86-64-sha1": "813b3f3cd25bf9fe21e68c2718b133c61fe09fc7",
            "macosuniversal": "https://redist.ctr-electronics.com/tools/owlet/25.0.0/owlet-25.0.0-macosuniversal",
            "macosuniversal-md5": "086580122607882b5478e57b96d504d0",
            "macosuniversal-sha1": "994e1bac9f8adcc59af716bb80dca8076d32de0b",
            "windowsx86-64": "https://redist.ctr-electronics.com/tools/owlet/25.0.0/owlet-25.0.0-windowsx86-64.exe",
            "windowsx86-64-md5": "170c9825ea4ef4e11568ca72ce63ec33",
            "windowsx86-64-sha1": "70f2e27f9d0234227fb6bdb82c3a0e453e80c828"
          }
        },
        {
          "Version": "25.0.1",
          "Compliancy": 10,
          "Urls": {
            "linuxx86-64": "https://redist.ctr-electronics.com/tools/owlet/25.0.1/owlet-25.0.1-linuxx86-64",
            "linuxx86-64-md5": "4750ae185d56687f396b1ac083f07150",
            "linuxx86-64-sha1": "d8fe9583d9137729215b31b8cbe0124c46a244a1",
            "macosuniversal": "https://redist.ctr-electronics.com/tools/owlet/25.0.1/owlet-25.0.1-macosuniversal",
            "macosuniversal-md5": "7b2aa4c851154b5227078ad5d61305a3",
            "macosuniversal-sha1": "faabeaa34e5134707cfccccb4df077296877be08",
            "windowsx86-64": "https://redist.ctr-electronics.com/tools/owlet/25.0.1/owlet-25.0.1-windowsx86-64.exe",
            "windowsx86-64-md5": "94505f934ec2e941a51bc19bed88ca76",
            "windowsx86-64-sha1": "27c4bf558a2ed5e9b954cad85e6595b6815ad444"
          }
        }
      ]
    }
  ]
}"#;

    /// Minimal index with one owlet item per version — a crafted input for
    /// the ordering/error cases; expectations stay hand-written literals.
    fn index_with_owlet_versions(versions: &[&str]) -> String {
        let items: Vec<String> = versions
            .iter()
            .map(|v| {
                format!(
                    "{{\"Version\": \"{v}\", \"Compliancy\": 10, \"Urls\": {{\
                     \"macosuniversal\": \"https://example.invalid/owlet-{v}\",\
                     \"macosuniversal-md5\": \"00000000000000000000000000000000\",\
                     \"macosuniversal-sha1\": \"1111111111111111111111111111111111111111\"}}}}"
                )
            })
            .collect();
        format!(
            "{{\"JsonVersion\": \"1.0.0.0\", \"Tools\": [{{\"Name\": \"owlet\", \"Items\": [{}]}}]}}",
            items.join(",")
        )
    }

    #[test]
    fn selects_the_newest_owlet_version_from_the_trimmed_real_index() {
        let sel = parse_owlet_index(REAL_INDEX_TRIMMED, "macosuniversal")
            .expect("25.0.1 is present with all keys");
        assert_eq!(sel.version, "25.0.1");
        assert_eq!(sel.compliancy, 10);
        assert_eq!(
            sel.url,
            "https://redist.ctr-electronics.com/tools/owlet/25.0.1/owlet-25.0.1-macosuniversal"
        );
        assert_eq!(sel.sha1, "faabeaa34e5134707cfccccb4df077296877be08");
    }

    #[test]
    fn version_ordering_is_a_numeric_tuple_not_a_string_compare() {
        // A string compare ranks "9.99.0" above "25.0.1" ("9" > "2").
        let idx = index_with_owlet_versions(&["25.0.1", "9.99.0"]);
        assert_eq!(
            parse_owlet_index(&idx, "macosuniversal")
                .expect("both items are well-formed")
                .version,
            "25.0.1"
        );
        // Four-component versions compare as tuples too: (9,99,0) > (1,0,1,1),
        // so under the numeric rule the order is 25.0.1 > 9.x > 1.0.1.1 — the
        // brief's example chain "25.0.1 > 1.0.1.1 > 9.x" breaks its own rule.
        let idx = index_with_owlet_versions(&["9.99.0", "1.0.1.1"]);
        assert_eq!(
            parse_owlet_index(&idx, "macosuniversal")
                .expect("both items are well-formed")
                .version,
            "9.99.0"
        );
    }

    #[test]
    fn missing_artifact_key_for_the_selected_item_is_an_error() {
        // The newest owlet item ships only linux keys — asking for macOS must
        // fail instead of falling back to an older item or another tool.
        let idx = r#"{"Tools": [{"Name": "owlet", "Items": [{"Version": "25.0.1", "Compliancy": 10, "Urls": {"linuxx86-64": "https://example.invalid/l", "linuxx86-64-sha1": "2222222222222222222222222222222222222222"}}, {"Version": "24.0.0", "Compliancy": 8, "Urls": {"macosuniversal": "https://example.invalid/m", "macosuniversal-sha1": "3333333333333333333333333333333333333333"}}]}]}"#;
        let err = parse_owlet_index(idx, "macosuniversal")
            .expect_err("the selected item lacks the macosuniversal key");
        assert!(err.contains("macosuniversal"), "error names the artifact: {err}");
    }

    #[test]
    fn missing_sha1_companion_key_is_an_error() {
        // The url key exists but only its -md5 companion — an md5 digest must
        // never be accepted where a sha1 is required.
        let idx = r#"{"Tools": [{"Name": "owlet", "Items": [{"Version": "25.0.1", "Compliancy": 10, "Urls": {"macosuniversal": "https://example.invalid/m", "macosuniversal-md5": "44444444444444444444444444444444"}}]}]}"#;
        let err = parse_owlet_index(idx, "macosuniversal")
            .expect_err("no macosuniversal-sha1 key exists");
        assert!(err.contains("sha1"), "error names the sha1 key: {err}");
        assert!(!err.contains("4444"), "the md5 value must not leak into the selection: {err}");
    }

    #[test]
    fn index_without_an_owlet_tool_is_an_error() {
        let idx = r#"{"Tools": [{"Name": "corvus", "Items": []}]}"#;
        let err = parse_owlet_index(idx, "macosuniversal")
            .expect_err("no owlet entry exists");
        assert!(err.contains("owlet"), "error names the tool: {err}");
    }

    /// Characterization of the fetched sample: the Windows map key carries no
    /// `.exe` suffix — the suffix is part of the artifact URL only. Pinned so
    /// the Task 4 download cannot regress to the plan's "windowsx86-64.exe".
    #[test]
    fn windows_artifact_key_has_no_exe_suffix_in_the_urls_map() {
        let sel = parse_owlet_index(REAL_INDEX_TRIMMED, "windowsx86-64")
            .expect("the real index keys windows artifacts without .exe");
        assert_eq!(
            sel.url,
            "https://redist.ctr-electronics.com/tools/owlet/25.0.1/owlet-25.0.1-windowsx86-64.exe"
        );
        assert_eq!(sel.sha1, "27c4bf558a2ed5e9b954cad85e6595b6815ad444");
    }

    #[test]
    fn platform_artifact_key_matches_the_real_index_urls_map() {
        #[cfg(target_os = "macos")]
        assert_eq!(platform_artifact_key(), Some("macosuniversal"));
        #[cfg(target_os = "windows")]
        assert_eq!(platform_artifact_key(), Some("windowsx86-64"));
        #[cfg(target_os = "linux")]
        assert_eq!(platform_artifact_key(), Some("linuxx86-64"));
    }

    #[test]
    fn verify_sha1_is_hex_case_insensitive_and_rejects_wrong_digests() {
        // fc803d624a7bdf770ee6f21db86f4165cd4f97b7 = SHA-1("PathBlender owlet
        // fixture"), computed independently of the implementation.
        assert!(verify_sha1(
            b"PathBlender owlet fixture",
            "fc803d624a7bdf770ee6f21db86f4165cd4f97b7"
        ));
        assert!(verify_sha1(
            b"PathBlender owlet fixture",
            "FC803D624A7BDF770EE6F21DB86F4165CD4F97B7"
        ));
        // One hex digit off, different bytes, and a truncated digest all fail.
        assert!(!verify_sha1(
            b"PathBlender owlet fixture",
            "fc803d624a7bdf770ee6f21db86f4165cd4f97b8"
        ));
        assert!(!verify_sha1(
            b"PathBlender owlet fixtureX",
            "fc803d624a7bdf770ee6f21db86f4165cd4f97b7"
        ));
        assert!(!verify_sha1(
            b"PathBlender owlet fixture",
            "fc803d"
        ));
        // da39a3ee…afd80709 = SHA-1 of the empty byte string.
        assert!(verify_sha1(b"", "da39a3ee5e6b4b0d3255bfef95601890afd80709"));
    }

    // ---- EULA / download state persistence (Task 3) ------------------------
    // All fixtures are synthetic: a full download record for owlet 25.0.1 and
    // a stub binary. `tempdir()` stands in for the app cache dir.

    fn downloaded_state() -> HootState {
        HootState {
            eula_accepted: true,
            version: Some("25.0.1".to_string()),
            compliancy: Some(10),
            sha1: Some("d8fe9583d9137729215b31b8cbe0124c46a244a1".to_string()),
            file_name: Some("owlet-25.0.1-macosuniversal".to_string()),
        }
    }

    fn fresh_status() -> HootStatus {
        HootStatus {
            eula_accepted: false,
            downloaded: false,
            version: None,
            compliancy: None,
        }
    }

    #[test]
    fn fresh_environment_reports_no_eula_no_download_and_no_version() {
        let cache = tempfile::tempdir().expect("tempdir");
        // No hoot/ dir, no state file — a first run must read as all-clear
        // rather than erroring on the missing file.
        assert_eq!(
            hoot_status_in(cache.path()).expect("missing state file means fresh state"),
            fresh_status()
        );
    }

    #[test]
    fn accepting_the_eula_persists_across_restart() {
        let cache = tempfile::tempdir().expect("tempdir");
        let accepted = accept_eula(cache.path()).expect("accept persists state");
        assert_eq!(
            accepted,
            HootStatus {
                eula_accepted: true,
                downloaded: false,
                version: None,
                compliancy: None,
            }
        );
        // "Restart": the status is recomputed from the file on disk, not from
        // the in-memory state the accept call just built.
        assert_eq!(
            hoot_status_in(cache.path()).expect("state file was written"),
            HootStatus {
                eula_accepted: true,
                downloaded: false,
                version: None,
                compliancy: None,
            }
        );
        // Atomic write: the tmp file must be gone once save returns, so a
        // later load can never observe a half-written state.
        assert!(!cache
            .path()
            .join("hoot")
            .join("owlet-state.json.tmp")
            .exists());
    }

    #[test]
    fn accepting_the_eula_preserves_an_existing_download_record() {
        let cache = tempfile::tempdir().expect("tempdir");
        save_hoot_state(cache.path(), &downloaded_state()).expect("save state");
        std::fs::write(
            cache.path().join("hoot").join("owlet-25.0.1-macosuniversal"),
            b"stub owlet binary (synthetic)",
        )
        .expect("write stub binary");
        // Re-accepting (a defensive second invoke from the web side) must keep
        // the record — a bare `eula_accepted: true` reset would force a
        // needless re-download and re-consent on the next import.
        let status = accept_eula(cache.path()).expect("accept keeps the record");
        assert_eq!(
            status,
            HootStatus {
                eula_accepted: true,
                downloaded: true,
                version: Some("25.0.1".to_string()),
                compliancy: Some(10),
            }
        );
    }

    #[test]
    fn recorded_version_without_the_binary_is_not_downloaded() {
        let cache = tempfile::tempdir().expect("tempdir");
        save_hoot_state(cache.path(), &downloaded_state()).expect("save state");
        // The full record round-trips — sha1 and file_name included — so a
        // serde field rename on HootState cannot silently drop download facts.
        assert_eq!(
            load_hoot_state(cache.path()).expect("reload state"),
            downloaded_state()
        );
        // But with no binary on disk the state is a stale record, not a
        // download: `downloaded == file exists && state has a record`.
        assert_eq!(
            hoot_status_in(cache.path()).expect("status"),
            HootStatus {
                eula_accepted: true,
                downloaded: false,
                version: Some("25.0.1".to_string()),
                compliancy: Some(10),
            }
        );
    }

    #[test]
    fn downloaded_requires_both_the_binary_file_and_a_state_record() {
        let cache = tempfile::tempdir().expect("tempdir");
        let binary = cache.path().join("hoot").join("owlet-25.0.1-macosuniversal");
        std::fs::create_dir_all(binary.parent().expect("parent dir")).expect("mkdir");
        std::fs::write(&binary, b"stub owlet binary (synthetic)").expect("write binary");
        // A binary without a state record (state file wiped, file kept) is not
        // a download PathBlender can vouch for.
        assert_eq!(
            hoot_status_in(cache.path()).expect("status"),
            fresh_status()
        );
        // Record + binary together are what `downloaded` means.
        save_hoot_state(cache.path(), &downloaded_state()).expect("save state");
        let status = hoot_status_in(cache.path()).expect("status");
        assert!(status.downloaded, "state record and binary on disk");
    }

    #[test]
    fn corrupt_state_file_reads_as_fresh_state_not_an_error() {
        let cache = tempfile::tempdir().expect("tempdir");
        std::fs::create_dir_all(cache.path().join("hoot")).expect("mkdir");
        std::fs::write(
            cache.path().join("hoot").join("owlet-state.json"),
            b"{ not json",
        )
        .expect("write corrupt state");
        // The cache dir is user-writable; a damaged state file must degrade to
        // fresh state (worst case: re-consent plus an idempotent re-download)
        // instead of erroring the import feature until the cache is cleared.
        assert_eq!(
            hoot_status_in(cache.path()).expect("corrupt state degrades to fresh"),
            fresh_status()
        );
    }

    #[test]
    fn non_utf8_state_file_reads_as_fresh_state_not_an_error() {
        let cache = tempfile::tempdir().expect("tempdir");
        std::fs::create_dir_all(cache.path().join("hoot")).expect("mkdir");
        // Invalid UTF-8 (e.g. binary-mangled or truncated mid-escape): the same
        // damaged-state ruling as unparseable JSON — degrade to fresh, never
        // brick the import feature on a read error.
        std::fs::write(
            cache.path().join("hoot").join("owlet-state.json"),
            [0xFF, 0xFE, 0x7B, 0x81],
        )
        .expect("write non-UTF-8 state");
        assert_eq!(
            hoot_status_in(cache.path()).expect("non-UTF-8 state degrades to fresh"),
            fresh_status()
        );
    }

    #[test]
    fn parent_escaping_file_name_is_never_reported_downloaded() {
        let cache = tempfile::tempdir().expect("tempdir");
        std::fs::create_dir_all(cache.path().join("hoot")).expect("mkdir");
        // The escaped target EXISTS at {tmp}/pwned, reachable from {tmp}/hoot
        // via "../pwned" — an unvalidated join would report it downloaded.
        // The state file itself is hand-written the way an external edit would
        // produce it; the status boundary must refuse the record instead.
        std::fs::write(cache.path().join("pwned"), b"escaped stub binary").expect("write target");
        std::fs::write(
            cache.path().join("hoot").join("owlet-state.json"),
            r#"{"eulaAccepted":true,"version":"25.0.1","compliancy":10,"sha1":"d8fe9583d9137729215b31b8cbe0124c46a244a1","fileName":"../pwned"}"#,
        )
        .expect("write tampered state");
        let status = hoot_status_in(cache.path()).expect("status still loads");
        assert!(!status.downloaded, "escaping file_name must never resolve outside hoot/");
        // The safe parts of the record still surface; only the path is refused.
        assert_eq!(status.version, Some("25.0.1".to_string()));
        assert_eq!(status.compliancy, Some(10));
    }

    #[test]
    fn nested_path_file_name_is_never_reported_downloaded() {
        let cache = tempfile::tempdir().expect("tempdir");
        std::fs::create_dir_all(cache.path().join("hoot").join("sub")).expect("mkdir");
        // A nested name stays inside hoot/, but the contract is a single path
        // component — subdirectories are not a download we vouch for either.
        std::fs::write(
            cache.path().join("hoot").join("sub").join("owlet.bin"),
            b"stub owlet binary (synthetic)",
        )
        .expect("write nested binary");
        std::fs::write(
            cache.path().join("hoot").join("owlet-state.json"),
            r#"{"eulaAccepted":true,"version":"25.0.1","compliancy":10,"sha1":"d8fe9583d9137729215b31b8cbe0124c46a244a1","fileName":"sub/owlet.bin"}"#,
        )
        .expect("write tampered state");
        let status = hoot_status_in(cache.path()).expect("status still loads");
        assert!(!status.downloaded, "file_name must be a pure basename");
    }

    #[test]
    fn save_refuses_non_basename_file_names() {
        let cache = tempfile::tempdir().expect("tempdir");
        // Every entry is a path (or path component) rather than a file name;
        // persisting any of them would let the record resolve outside the
        // hoot/ dir on some platform — backslash is a separator on Windows,
        // and a colon makes `C:owlet.exe` a drive-relative path there (and a
        // path/separator surrogate on classic Mac paths) even with no slash.
        for bad in [
            "../pwned",
            "sub/owlet.bin",
            "..\\pwned",
            "/absolute/owlet",
            "C:\\owlet.exe",
            "C:owlet.exe",
            "owlet:ads",
            ".",
            "..",
            "",
        ] {
            let mut state = downloaded_state();
            state.file_name = Some(bad.to_string());
            assert!(
                save_hoot_state(cache.path(), &state).is_err(),
                "save must refuse file_name {bad:?}"
            );
        }
        // The legitimate platform-derived basename (Task 4's rule:
        // owlet-{artifact_key}, plus a fixed `.exe` on Windows) still saves.
        save_hoot_state(cache.path(), &downloaded_state()).expect("basename saves");
    }

    #[test]
    fn accept_eula_recovers_from_a_tampered_file_name_record() {
        let cache = tempfile::tempdir().expect("tempdir");
        std::fs::create_dir_all(cache.path().join("hoot")).expect("mkdir");
        // An external edit planted a path-like file_name. Consent must still
        // save (never strand the user at the EULA gate with a hard error):
        // the untrustworthy download record is dropped wholesale — keeping
        // version/sha1 without the binary would advertise a download the
        // status layer cannot vouch for.
        std::fs::write(
            cache.path().join("hoot").join("owlet-state.json"),
            r#"{"eulaAccepted":true,"version":"25.0.1","compliancy":10,"sha1":"d8fe9583d9137729215b31b8cbe0124c46a244a1","fileName":"../pwned"}"#,
        )
        .expect("write tampered state");
        let status = accept_eula(cache.path()).expect("consent saves despite poisoned record");
        assert_eq!(
            status,
            HootStatus {
                eula_accepted: true,
                downloaded: false,
                version: None,
                compliancy: None,
            }
        );
        assert_eq!(
            load_hoot_state(cache.path()).expect("reload state"),
            HootState {
                eula_accepted: true,
                ..HootState::default()
            }
        );
    }

    #[test]
    fn status_serializes_with_camel_case_keys_for_the_web_client() {
        let json = serde_json::to_string(&HootStatus {
            eula_accepted: true,
            downloaded: false,
            version: Some("25.0.1".to_string()),
            compliancy: Some(10),
        })
        .expect("serialize status");
        // Hand-written wire literal: the web client (Task 6) types these
        // camelCase keys — serde's snake_case default would break the contract.
        assert_eq!(
            json,
            r#"{"eulaAccepted":true,"downloaded":false,"version":"25.0.1","compliancy":10}"#
        );
    }

    // ---- download orchestration (Task 4) ------------------------------------
    // All network-free: `download_via` takes an injected fetch, so these tests
    // exercise parse → verify → persist → idempotent against tempdirs only.

    /// Synthetic artifact bytes; 4ac8a1b506732acc1126cbff7cb39dbf5b8c8748 is
    /// SHA-1("PathBlender owlet download fixture"), computed with `shasum`
    /// independently of `verify_sha1` (expectations must not derive from the
    /// code under test).
    const STUB_ARTIFACT_BYTES: &[u8] = b"PathBlender owlet download fixture";
    const STUB_ARTIFACT_SHA1: &str = "4ac8a1b506732acc1126cbff7cb39dbf5b8c8748";

    /// Hand-written per-platform literal for the recorded file name — the
    /// naming rule is `owlet-{platform_artifact_key}` plus a fixed `.exe` on
    /// Windows only, never anything from the artifact URL.
    #[cfg(target_os = "macos")]
    const EXPECTED_FILE_NAME: &str = "owlet-macosuniversal";
    #[cfg(target_os = "windows")]
    const EXPECTED_FILE_NAME: &str = "owlet-windowsx86-64.exe";
    #[cfg(target_os = "linux")]
    const EXPECTED_FILE_NAME: &str = "owlet-linuxx86-64";
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    const EXPECTED_FILE_NAME: &str = "";

    /// Index fixture carrying every desktop platform key (like the real
    /// index), each pointing at example.invalid with the same synthetic sha1,
    /// so the current target's `platform_artifact_key()` always resolves.
    fn download_index_fixture() -> String {
        format!(
            r#"{{"Tools": [{{"Name": "owlet", "Items": [{{"Version": "25.0.1", "Compliancy": 10, "Urls": {{
                "macosuniversal": "https://example.invalid/owlet-macosuniversal",
                "macosuniversal-sha1": "{STUB_ARTIFACT_SHA1}",
                "windowsx86-64": "https://example.invalid/owlet-windowsx86-64",
                "windowsx86-64-sha1": "{STUB_ARTIFACT_SHA1}",
                "linuxx86-64": "https://example.invalid/owlet-linuxx86-64",
                "linuxx86-64-sha1": "{STUB_ARTIFACT_SHA1}"}}}}]}}]}}"#
        )
    }

    /// A tempdir with EULA consent already persisted.
    fn eula_accepted_cache() -> tempfile::TempDir {
        let cache = tempfile::tempdir().expect("tempdir");
        accept_eula(cache.path()).expect("accept eula");
        cache
    }

    #[test]
    fn download_persists_verified_artifact_and_full_state_record() {
        let cache = eula_accepted_cache();
        let calls = std::cell::Cell::new(0u32);
        let key = platform_artifact_key().expect("test host is a desktop target");
        let expected_url = format!("https://example.invalid/owlet-{key}");
        let status = download_via(
            |url: &str| {
                // The fetch must target the selected artifact's URL — not the
                // index, not another platform's key.
                assert_eq!(url, expected_url, "fetch must use the selected artifact URL");
                calls.set(calls.get() + 1);
                Ok(STUB_ARTIFACT_BYTES.to_vec())
            },
            platform_artifact_key(),
            &download_index_fixture(),
            cache.path(),
        )
        .expect("sha1-matching bytes install");
        assert_eq!(
            status,
            HootStatus {
                eula_accepted: true,
                downloaded: true,
                version: Some("25.0.1".to_string()),
                compliancy: Some(10),
            }
        );
        assert_eq!(calls.get(), 1, "exactly one artifact fetch");
        // The full record — version, compliancy, sha1, file_name — lands in a
        // single save (a partial record would read as not-downloaded).
        let state = load_hoot_state(cache.path()).expect("reload state");
        assert_eq!(state.version.as_deref(), Some("25.0.1"));
        assert_eq!(state.compliancy, Some(10));
        assert_eq!(state.sha1.as_deref(), Some(STUB_ARTIFACT_SHA1));
        assert_eq!(state.file_name.as_deref(), Some(EXPECTED_FILE_NAME));
        // The bytes on disk are exactly what fetch returned.
        let written = std::fs::read(cache.path().join("hoot").join(EXPECTED_FILE_NAME))
            .expect("artifact written");
        assert_eq!(written, STUB_ARTIFACT_BYTES);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(cache.path().join("hoot").join(EXPECTED_FILE_NAME))
                .expect("metadata")
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o755, "artifact must be executable");
        }
    }

    #[test]
    fn hash_mismatch_deletes_partial_output_and_names_the_artifact() {
        let cache = eula_accepted_cache();
        let hoot = cache.path().join("hoot");
        std::fs::create_dir_all(&hoot).expect("mkdir");
        // A stale partial from an imagined earlier crashed attempt: the
        // mismatch path must leave zero partial output, not merely skip
        // writing new bytes.
        std::fs::write(hoot.join(format!("{EXPECTED_FILE_NAME}.tmp")), b"stale partial")
            .expect("stale tmp");
        let bad_index =
            download_index_fixture().replace(STUB_ARTIFACT_SHA1, "0000000000000000000000000000000000000000");
        let err = download_via(
            |_| Ok(b"tampered bytes".to_vec()),
            platform_artifact_key(),
            &bad_index,
            cache.path(),
        )
        .expect_err("bytes do not match the published sha1");
        assert!(
            err.starts_with("hoot-hash-mismatch:"),
            "web maps this prefix: {err}"
        );
        assert!(
            err.contains(platform_artifact_key().expect("desktop target")),
            "error names the artifact key: {err}"
        );
        assert!(
            !hoot.join(EXPECTED_FILE_NAME).exists(),
            "no half-written final artifact"
        );
        assert!(
            !hoot.join(format!("{EXPECTED_FILE_NAME}.tmp")).exists(),
            "stale partial cleaned up"
        );
    }

    #[test]
    fn download_without_eula_consent_touches_no_network() {
        let cache = tempfile::tempdir().expect("tempdir");
        let calls = std::cell::Cell::new(0u32);
        let err = download_via(
            |_| {
                calls.set(calls.get() + 1);
                Ok(STUB_ARTIFACT_BYTES.to_vec())
            },
            platform_artifact_key(),
            &download_index_fixture(),
            cache.path(),
        )
        .expect_err("consent must gate the download");
        assert_eq!(err, "hoot-eula-required");
        assert_eq!(calls.get(), 0, "no fetch before consent");
        assert!(
            !cache.path().join("hoot").exists(),
            "the gate writes nothing either"
        );
    }

    #[test]
    fn repeat_download_with_intact_artifact_never_refetches() {
        let cache = eula_accepted_cache();
        let calls = std::cell::Cell::new(0u32);
        let fetch = |_url: &str| {
            calls.set(calls.get() + 1);
            Ok(STUB_ARTIFACT_BYTES.to_vec())
        };
        let first = download_via(
            fetch,
            platform_artifact_key(),
            &download_index_fixture(),
            cache.path(),
        )
        .expect("first download");
        let second = download_via(
            fetch,
            platform_artifact_key(),
            &download_index_fixture(),
            cache.path(),
        )
        .expect("second call short-circuits");
        assert_eq!(calls.get(), 1, "second call must not hit the network");
        assert_eq!(first, second);
        assert!(second.downloaded);
    }

    #[test]
    fn corrupted_cached_artifact_is_rehashed_and_redownloaded() {
        let cache = eula_accepted_cache();
        let calls = std::cell::Cell::new(0u32);
        let fetch = |_url: &str| {
            calls.set(calls.get() + 1);
            Ok(STUB_ARTIFACT_BYTES.to_vec())
        };
        download_via(
            fetch,
            platform_artifact_key(),
            &download_index_fixture(),
            cache.path(),
        )
        .expect("first download");
        // Tamper with the cached binary: "already downloaded" requires the
        // hash to STILL match, so this must re-fetch and restore.
        std::fs::write(
            cache.path().join("hoot").join(EXPECTED_FILE_NAME),
            b"corrupted on disk",
        )
        .expect("tamper");
        let status = download_via(
            fetch,
            platform_artifact_key(),
            &download_index_fixture(),
            cache.path(),
        )
        .expect("re-download over stale bytes");
        assert_eq!(calls.get(), 2, "hash-stale cache must re-fetch");
        assert!(status.downloaded);
        let restored = std::fs::read(cache.path().join("hoot").join(EXPECTED_FILE_NAME))
            .expect("artifact restored");
        assert_eq!(restored, STUB_ARTIFACT_BYTES);
    }

    #[test]
    fn unsupported_platform_key_fails_before_any_fetch() {
        let cache = eula_accepted_cache();
        let calls = std::cell::Cell::new(0u32);
        let err = download_via(
            |_| {
                calls.set(calls.get() + 1);
                Ok(Vec::new())
            },
            None,
            &download_index_fixture(),
            cache.path(),
        )
        .expect_err("no artifact exists for this target");
        assert_eq!(err, "hoot-unsupported-platform");
        assert_eq!(calls.get(), 0);
    }

    #[test]
    fn transport_and_parse_failures_carry_the_download_failed_code() {
        let cache = eula_accepted_cache();
        // A damaged index document is a download failure, not a raw parse
        // error the web side cannot map.
        let err = download_via(
            |_| Ok(STUB_ARTIFACT_BYTES.to_vec()),
            platform_artifact_key(),
            "{ not json",
            cache.path(),
        )
        .expect_err("index damage");
        assert!(
            err.starts_with("hoot-download-failed:"),
            "prefix contract: {err}"
        );
        // Same for the transport error surfaced by the injected fetch.
        let err = download_via(
            |_| Err("connection reset".to_string()),
            platform_artifact_key(),
            &download_index_fixture(),
            cache.path(),
        )
        .expect_err("fetch error");
        assert!(
            err.starts_with("hoot-download-failed:"),
            "prefix contract: {err}"
        );
        assert!(err.contains("connection reset"), "detail survives: {err}");
    }

    // ---- convert orchestration (Task 5) --------------------------------------
    // Process-free: `convert_via` takes an injected runner, so the gate →
    // temp input → CLI → output read → base64 chain runs against tempdirs
    // and stub runners only — no real owlet binary is ever executed in unit
    // tests (real-device verification is the plan's separate step).

    /// Synthetic .hoot input bytes handed to `convert_via`.
    const STUB_HOOT_BYTES: &[u8] = b"stub hoot log (synthetic)";
    /// Synthetic wpilog bytes a stub runner "produces"; the base64 literal is
    /// `base64` of exactly these bytes, computed with the host `base64` tool
    /// independently of the implementation.
    const STUB_WPILOG_BYTES: &[u8] = b"PathBlender wpilog fixture";
    const STUB_WPILOG_BASE64: &str = "UGF0aEJsZW5kZXIgd3BpbG9nIGZpeHR1cmU=";

    /// A tempdir with EULA consent and an intact recorded owlet install: the
    /// synthetic artifact bytes on disk under the platform-derived name plus
    /// the full matching record — exactly what the convert gate (via
    /// `cached_download_is_current`) demands.
    fn owlet_installed_cache() -> tempfile::TempDir {
        let cache = eula_accepted_cache();
        save_hoot_state(
            cache.path(),
            &HootState {
                eula_accepted: true,
                version: Some("25.0.1".to_string()),
                compliancy: Some(10),
                sha1: Some(STUB_ARTIFACT_SHA1.to_string()),
                file_name: Some(EXPECTED_FILE_NAME.to_string()),
            },
        )
        .expect("save state");
        let hoot = cache.path().join("hoot");
        std::fs::create_dir_all(&hoot).expect("mkdir");
        std::fs::write(hoot.join(EXPECTED_FILE_NAME), STUB_ARTIFACT_BYTES).expect("write owlet");
        cache
    }

    #[test]
    fn owlet_args_is_format_wpilog_then_in_then_out() {
        // Hand-written literals — the official owlet CLI invocation order
        // (owlet docs): format flag, format name, input path, output path.
        // A reordered variant is a wrong CLI call, not a style change.
        assert_eq!(
            owlet_args(Path::new("/work/match.hoot"), Path::new("/work/match.wpilog")),
            vec![
                "-f".to_string(),
                "wpilog".to_string(),
                "/work/match.hoot".to_string(),
                "/work/match.wpilog".to_string(),
            ]
        );
    }

    #[test]
    fn convert_runs_the_recorded_owlet_and_returns_its_output_base64() {
        let cache = owlet_installed_cache();
        let mut program_seen = None;
        let mut args_seen = None;
        let converted =
            convert_via(cache.path(), "match.hoot", STUB_HOOT_BYTES, |program, args| {
                program_seen = Some(program.to_path_buf());
                args_seen = Some(args.to_vec());
                // The CLI runs only after the caller's bytes are on disk at
                // the input path; the stub "converts" by writing the fixture
                // output to the path owlet was told to write.
                assert_eq!(
                    std::fs::read(&args[2]).expect("input written before the run"),
                    STUB_HOOT_BYTES,
                    "input file must hold the caller's bytes when the CLI runs"
                );
                std::fs::write(&args[3], STUB_WPILOG_BYTES).expect("stub writes output");
                Ok(OwletRun {
                    success: true,
                    stderr: Vec::new(),
                })
            })
            .expect("a verified install converts");
        assert_eq!(converted.wpilog_name, "match.wpilog");
        // Hand-computed base64 literal — not STANDARD.encode of the fixture.
        assert_eq!(converted.wpilog_base64, STUB_WPILOG_BASE64);
        let args = args_seen.expect("runner invoked");
        // The executable is the recorded binary resolved through
        // owlet_binary_path — never a fresh join (the same-looking path here
        // is pinned literally so a bypass shows up as a mismatch).
        assert_eq!(
            program_seen.expect("runner invoked"),
            cache.path().join("hoot").join(EXPECTED_FILE_NAME),
            "executable must be the recorded owlet path"
        );
        assert_eq!(&args[0..2], &["-f".to_string(), "wpilog".to_string()]);
        assert!(args[2].ends_with("match.hoot"), "input named {{stem}}.hoot: {}", args[2]);
        assert!(args[3].ends_with("match.wpilog"), "output named {{stem}}.wpilog: {}", args[3]);
        let work = Path::new(&args[3])
            .parent()
            .expect("temp work dir")
            .to_path_buf();
        assert!(
            work != cache.path().join("hoot"),
            "conversion never runs inside the cache dir"
        );
        assert!(!work.exists(), "temp dir removed after success");
    }

    #[test]
    fn convert_failure_carries_the_stderr_tail_capped_at_500_chars() {
        let cache = owlet_installed_cache();
        // 603 chars: returning the whole stderr would exceed the 500-char cap.
        let long_stderr = format!("{}END", "0123456789".repeat(60));
        assert_eq!(long_stderr.chars().count(), 603);
        let mut out_seen = None;
        let err = convert_via(cache.path(), "match.hoot", STUB_HOOT_BYTES, |_program, args| {
            out_seen = Some(args[3].clone());
            Ok(OwletRun {
                success: false,
                stderr: long_stderr.clone().into_bytes(),
            })
        })
        .expect_err("a non-zero owlet exit is a per-file failure");
        assert!(err.starts_with("hoot-convert-failed:"), "web maps this prefix: {err}");
        assert!(err.contains("END"), "the stderr tail survives: {err}");
        assert!(
            err["hoot-convert-failed:".len()..].chars().count() <= 500,
            "detail capped at 500 chars"
        );
        let work = Path::new(&out_seen.expect("runner invoked"))
            .parent()
            .expect("temp work dir")
            .to_path_buf();
        assert!(!work.exists(), "temp dir removed after failure");
        // A short stderr travels whole under the same code.
        let err = convert_via(cache.path(), "match.hoot", STUB_HOOT_BYTES, |_, _| {
            Ok(OwletRun {
                success: false,
                stderr: b"cannot open input".to_vec(),
            })
        })
        .expect_err("short stderr case");
        assert_eq!(err, "hoot-convert-failed:cannot open input");
        // A spawn failure carries its detail under the same code.
        let err = convert_via(cache.path(), "match.hoot", STUB_HOOT_BYTES, |_, _| {
            Err("permission denied".to_string())
        })
        .expect_err("spawn failure case");
        assert_eq!(err, "hoot-convert-failed:permission denied");
    }

    #[test]
    fn convert_without_eula_consent_never_executes_owlet() {
        let cache = tempfile::tempdir().expect("tempdir");
        let mut runs = 0u32;
        let err = convert_via(cache.path(), "match.hoot", STUB_HOOT_BYTES, |_, _| {
            runs += 1;
            Ok(OwletRun {
                success: true,
                stderr: Vec::new(),
            })
        })
        .expect_err("consent must gate execution of the downloaded binary");
        assert_eq!(err, "hoot-eula-required");
        assert_eq!(runs, 0, "no execution before consent");
        assert!(!cache.path().join("hoot").exists(), "the gate writes nothing");
    }

    #[test]
    fn convert_without_a_vouchable_owlet_binary_reports_it_missing() {
        // Consent but no download record at all.
        let cache = eula_accepted_cache();
        let mut runs = 0u32;
        let err = convert_via(cache.path(), "match.hoot", STUB_HOOT_BYTES, |_, _| {
            runs += 1;
            Ok(OwletRun {
                success: true,
                stderr: Vec::new(),
            })
        })
        .expect_err("nothing is recorded");
        assert_eq!(err, "hoot-owlet-missing");
        assert_eq!(runs, 0);
        // A full record whose binary file is gone (a stale record).
        let cache = owlet_installed_cache();
        std::fs::remove_file(cache.path().join("hoot").join(EXPECTED_FILE_NAME))
            .expect("remove binary");
        let err = convert_via(cache.path(), "match.hoot", STUB_HOOT_BYTES, |_, _| {
            Ok(OwletRun {
                success: true,
                stderr: Vec::new(),
            })
        })
        .expect_err("stale record without the file");
        assert_eq!(err, "hoot-owlet-missing");
        // A tampered path-like recorded name whose escape target exists and
        // hashes right: resolution must go exclusively through
        // owlet_binary_path, so a fresh join of the recorded name must never
        // reach the runner.
        let cache = tempfile::tempdir().expect("tempdir");
        std::fs::create_dir_all(cache.path().join("hoot")).expect("mkdir");
        std::fs::write(cache.path().join("pwned"), STUB_ARTIFACT_BYTES).expect("write target");
        std::fs::write(
            cache.path().join("hoot").join("owlet-state.json"),
            format!(
                r#"{{"eulaAccepted":true,"version":"25.0.1","compliancy":10,"sha1":"{STUB_ARTIFACT_SHA1}","fileName":"../pwned"}}"#
            ),
        )
        .expect("write tampered state");
        let mut runs = 0u32;
        let err = convert_via(cache.path(), "match.hoot", STUB_HOOT_BYTES, |_, _| {
            runs += 1;
            Ok(OwletRun {
                success: true,
                stderr: Vec::new(),
            })
        })
        .expect_err("path-like record must not resolve");
        assert_eq!(err, "hoot-owlet-missing");
        assert_eq!(runs, 0, "a joined path would have executed {tmp}/pwned", tmp = cache.path().display());
    }

    #[test]
    fn convert_refuses_to_execute_a_binary_that_no_longer_matches_the_recorded_sha1() {
        let cache = owlet_installed_cache();
        // Swap the bytes under the recorded name: the recorded sha1 is the
        // only thing vouching for the executable, so it must not run.
        std::fs::write(
            cache.path().join("hoot").join(EXPECTED_FILE_NAME),
            b"tampered replacement",
        )
        .expect("tamper");
        let mut runs = 0u32;
        let err = convert_via(cache.path(), "match.hoot", STUB_HOOT_BYTES, |_, _| {
            runs += 1;
            Ok(OwletRun {
                success: true,
                stderr: Vec::new(),
            })
        })
        .expect_err("a hash-stale binary must not execute");
        assert_eq!(err, "hoot-owlet-missing", "missing maps to the re-download remedy");
        assert_eq!(runs, 0, "the swapped binary never ran");
    }

    #[test]
    fn convert_derives_a_pure_stem_so_path_like_names_stay_in_the_temp_dir() {
        let cache = owlet_installed_cache();
        let mut input_seen = None;
        let converted =
            convert_via(cache.path(), "../match.hoot", STUB_HOOT_BYTES, |_, args| {
                input_seen = Some(args[2].clone());
                std::fs::write(&args[3], STUB_WPILOG_BYTES).expect("stub writes output");
                Ok(OwletRun {
                    success: true,
                    stderr: Vec::new(),
                })
            })
            .expect("conversion succeeds");
        assert_eq!(converted.wpilog_name, "match.wpilog");
        let input_owned = input_seen.expect("runner invoked");
        let input = Path::new(&input_owned);
        assert!(input.ends_with("match.hoot"), "stem only: {}", input.display());
        let work = input.parent().expect("temp work dir");
        assert!(
            work.starts_with(std::env::temp_dir()),
            "input lives in the temp dir: {}",
            work.display()
        );
        assert!(!work.starts_with(cache.path()), "input never lands in the cache dir");
    }

    #[test]
    fn converted_serializes_with_camel_case_keys_for_the_web_client() {
        let json = serde_json::to_string(&HootConverted {
            wpilog_name: "match.wpilog".to_string(),
            wpilog_base64: STUB_WPILOG_BASE64.to_string(),
        })
        .expect("serialize converted");
        // Hand-written wire literal — Task 6/8 type these camelCase keys;
        // serde's snake_case default would break the contract.
        assert_eq!(
            json,
            r#"{"wpilogName":"match.wpilog","wpilogBase64":"UGF0aEJsZW5kZXIgd3BpbG9nIGZpeHR1cmU="}"#
        );
    }
}
