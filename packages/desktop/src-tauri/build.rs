use std::process::Command;

fn main() {
    tauri_build::build();

    // Embed the git commit this build came from, so the macOS About panel can
    // trace any installed copy to its exact code (PB_GIT_HASH). Falls back to
    // the empty string outside a git checkout — the panel then omits the
    // parenthetical, matching the pre-hash behavior.
    let hash = Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();
    println!("cargo:rustc-env=PB_GIT_HASH={hash}");
}
