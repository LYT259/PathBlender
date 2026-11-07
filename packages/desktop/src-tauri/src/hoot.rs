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
//! cache dir lives here; the network download and the owlet CLI invocation
//! land in later tasks of the plan.

use std::path::{Path, PathBuf};
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
/// [`HootState::default`]; so does a damaged one — the cache dir is
/// user-writable, and degrading to fresh (re-consent plus an idempotent
/// re-download) beats erroring the import feature until the cache is cleared
/// by hand. Only genuine I/O errors propagate.
pub fn load_hoot_state(cache_dir: &Path) -> Result<HootState, String> {
    let path = hoot_dir(cache_dir).join(STATE_FILE_NAME);
    if !path.is_file() {
        return Ok(HootState::default());
    }
    let raw =
        std::fs::read_to_string(&path).map_err(|e| format!("read {}: {e}", path.display()))?;
    Ok(serde_json::from_str(&raw).unwrap_or_default())
}

/// Persist `state` atomically: serialize, write `<file>.tmp`, then rename
/// over the previous state, so a crash mid-save can never leave a
/// half-written state file. Creates `{cache_dir}/hoot/` when absent.
pub fn save_hoot_state(cache_dir: &Path, state: &HootState) -> Result<(), String> {
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

/// Derive the client-facing status from a loaded state. `downloaded` requires
/// both a recorded artifact (`file_name` and `version`, always written
/// together by a download) and the binary still present at
/// `{cache_dir}/hoot/{file_name}` — a stale record without the file, or a
/// stray binary without a record, is not a download.
fn status_from_state(cache_dir: &Path, state: &HootState) -> HootStatus {
    let downloaded = match (&state.file_name, &state.version) {
        (Some(file_name), Some(_)) => hoot_dir(cache_dir).join(file_name).is_file(),
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
/// the `hoot_accept_eula` command.
pub fn accept_eula(cache_dir: &Path) -> Result<HootStatus, String> {
    let mut state = load_hoot_state(cache_dir)?;
    state.eula_accepted = true;
    save_hoot_state(cache_dir, &state)?;
    Ok(status_from_state(cache_dir, &state))
}

fn app_cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_cache_dir()
        .map_err(|e| format!("resolve app cache dir: {e}"))
}

/// Current owlet EULA/download status for the web client. Registered on the
/// invoke handler in a later task of the plan.
#[tauri::command]
pub async fn hoot_status(app: AppHandle) -> Result<HootStatus, String> {
    let cache_dir = app_cache_dir(&app)?;
    hoot_status_in(&cache_dir)
}

/// Persist the user's owlet EULA consent and return the resulting status.
/// Registered on the invoke handler in a later task of the plan.
#[tauri::command]
pub async fn hoot_accept_eula(app: AppHandle) -> Result<HootStatus, String> {
    let cache_dir = app_cache_dir(&app)?;
    accept_eula(&cache_dir)
}

#[cfg(test)]
mod tests {
    use super::{
        accept_eula, hoot_status_in, load_hoot_state, parse_owlet_index, platform_artifact_key,
        save_hoot_state, verify_sha1, HootState, HootStatus,
    };

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
}
