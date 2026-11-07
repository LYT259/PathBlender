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
//! This module holds no I/O: downloading, persistence, and the owlet CLI
//! invocation land in later tasks of the plan.

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

#[cfg(test)]
mod tests {
    use super::{parse_owlet_index, platform_artifact_key, verify_sha1};

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
}
