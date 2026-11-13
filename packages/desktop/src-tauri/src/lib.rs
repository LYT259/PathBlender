/// PathBlender desktop shell — minimal static host (report v1.6 §7.1).
/// No sidecars, no backend, no telemetry. The only native behavior:
/// a native menu rebuilt from the web's menu spec (`set_menu` — the web
/// owns the labels in every UI language; PathBlender | File | Edit | View |
/// Playback | Window | Help), a native import dialog, native save dialogs,
/// a preferences window on ?window=prefs, region-scoped native window dragging,
/// and the HOOT import's owlet EULA/download/convert commands (hoot.rs).
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use base64::Engine as _;
use tauri::menu::{
    CheckMenuItem, Menu, MenuBuilder, MenuItem,
    PredefinedMenuItem, Submenu, SubmenuBuilder,
};
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_updater::{Update, UpdaterExt};

mod ble;
mod hoot;

const PREFS_WINDOW: &str = "prefs";

/// Updater feeds per channel — the whitelist. Must stay in sync with
/// scripts/gen-latest-json.mjs (which publishes latest.json /
/// latest-beta.json onto GitHub releases). The channel choice cannot be
/// made web-side: the updater plugin's JS `check()` has no endpoint
/// override, so it is resolved here from the channel string.
///
/// `releases/latest` never resolves to a prerelease, yet the beta feed must
/// track the NEWEST beta: release.yml therefore re-uploads latest-beta.json
/// onto the current stable release with every beta tag (a live pointer, not
/// a historical artifact) so this URL always serves the newest beta feed.
/// Mechanism first shipped with the 2026-10-02 channel fix.
const FEED_STABLE: &str = "https://github.com/LYT259/pathblender/releases/latest/download/latest.json";
const FEED_BETA: &str = "https://github.com/LYT259/pathblender/releases/latest/download/latest-beta.json";

/// The update found by `check_update`, held until `install_update`
/// consumes it (the webview drives both, mirroring the plugin's JS API).
struct PendingUpdate(Mutex<Option<Update>>);

/// The exact error string the JS side matches (update-guard.ts
/// UPDATE_BLOCKED_MARKER) — rewording either side silently degrades blocked
/// installs into generic failures.
const UPDATE_BLOCKED_ERR: &str = "update blocked: unsaved session";

/// Fail-closed default: installs are blocked until the webview explicitly
/// reports a clean session — a page that never reports cannot lose work.
const UPDATE_SESSION_DIRTY_DEFAULT: bool = true;

/// Last session-dirty report from the main window. The main window owns the
/// session (and thus the dirty computation); the prefs window only installs.
struct UpdateSessionGuard(AtomicBool);

/// The main window reports its session-dirty state here after every autosave
/// transition; the flag holds the last delivered value.
#[tauri::command]
fn set_update_guard(guard: State<'_, UpdateSessionGuard>, dirty: bool) -> Result<(), String> {
    guard.0.store(dirty, Ordering::SeqCst);
    Ok(())
}

/// Gate before take: a blocked attempt must NOT consume the pending update,
/// so the retry after saving reuses the stashed update without re-checking
/// the feed.
fn gate_then_take<T>(dirty: bool, pending: &mut Option<T>) -> Result<T, &'static str> {
    if dirty {
        return Err(UPDATE_BLOCKED_ERR);
    }
    pending.take().ok_or("no update was checked")
}

#[derive(serde::Serialize)]
struct UpdateMeta {
    version: String,
}

/// Check the selected channel's feed. Ok(None) = feed reached and the app is
/// current; Err = feed unreachable (offline / no release assets yet) — the
/// UI maps that to an honest failure toast, never to "up to date".
#[tauri::command]
async fn check_update(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
    channel: String,
) -> Result<Option<UpdateMeta>, String> {
    let feed = if channel == "beta" { FEED_BETA } else { FEED_STABLE };
    let url = tauri::Url::parse(feed).map_err(|e| e.to_string())?;
    let updater = app
        .updater_builder()
        .endpoints(vec![url])
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| e.to_string())?;
    let meta = update.as_ref().map(|u| UpdateMeta {
        version: u.version.clone(),
    });
    // Scoped so the guard never survives across the async fn's await points
    // (the command future must stay Send).
    *pending.0.lock().map_err(|e| e.to_string())? = update;
    Ok(meta)
}

/// Download and install the update found by `check_update`. The session
/// guard is checked BEFORE the pending update is taken: everything after
/// that point may be interrupted by the Windows installer, so this is the
/// last controllable moment. The webview relaunches afterwards; on Windows
/// the NSIS installer exits the app itself, so callers must treat install
/// as the last reliable step.
#[tauri::command]
async fn install_update(
    pending: State<'_, PendingUpdate>,
    guard: State<'_, UpdateSessionGuard>,
) -> Result<(), String> {
    let update = {
        let mut pending = pending.0.lock().map_err(|e| e.to_string())?;
        gate_then_take(guard.0.load(Ordering::SeqCst), &mut *pending)?
    };
    update
        .download_and_install(|_chunk, _total| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/**
 * The native menu is rebuilt from the web's menu spec (menu-spec.ts →
 * `set_menu`): the page owns the labels (every UI language covered by its
 * dictionaries, no per-language Rust tables), the shell owns construction.
 * The wire tree mirrors the TS `MenuEntry`: roles map to predefined items,
 * `kind: check` to CheckMenuItem, `kind: submenu` recurses.
 */
#[derive(serde::Deserialize)]
struct MenuPayload {
    menus: Vec<MenuSectionIn>,
}

#[derive(serde::Deserialize)]
struct MenuSectionIn {
    label: String,
    #[serde(default)]
    mac_only: bool,
    #[serde(default)]
    items: Vec<MenuItemIn>,
}

#[derive(serde::Deserialize)]
struct MenuItemIn {
    #[serde(default)]
    id: String,
    #[serde(default)]
    role: String,
    #[serde(default)]
    label: String,
    #[serde(default)]
    accelerator: Option<String>,
    #[serde(default)]
    kind: String,
    #[serde(default)]
    checked: bool,
    #[serde(default)]
    enabled: bool,
    #[serde(default)]
    mac_only: bool,
    #[serde(default)]
    mac_hide: bool,
    #[serde(default)]
    items: Vec<MenuItemIn>,
}

/// Ids the shell handles itself and never forwards to the page.
const SHELL_OWNED_IDS: [&str; 2] = ["preferences", "import"];

/// Last dock artwork the web side pushed through set_dock_icon (bundled
/// resource name + resolved darkness). The About panel reads it so its icon
/// is exactly what the Dock tile shows; before the first push it falls back
/// to the classic day artwork.
static LAST_DOCK_ICON: Mutex<(String, bool)> = Mutex::new((String::new(), false));

struct MenuState {
    /// Dispatchable ids present in the current menu — on_menu_event only
    /// forwards ids the spec actually declared.
    ids: Mutex<Vec<String>>,
}

enum Built {
    Separator,
    Item(MenuItem<tauri::Wry>),
    Check(CheckMenuItem<tauri::Wry>),
    Predefined(PredefinedMenuItem<tauri::Wry>),
    Submenu(Submenu<tauri::Wry>),
}

/// Present the standard About panel with the CURRENT dock artwork as its
/// icon. The predefined about item (previous implementation) lets AppKit
/// build the panel once from the bundle icon; the runtime icon override is
/// never re-read, so after an app-icon style switch the panel kept showing
/// the stale classic art even when re-opened from the menu (user report
/// 2026-10-16). Passing the icon (plus name/version) in the options on
/// every open makes the panel content follow the choice. The version keys
/// mirror the old metadata: CARGO_PKG_VERSION plus the PB_GIT_HASH build
/// stamp in the parenthetical slot. Only macOS consumes this panel.
#[cfg(target_os = "macos")]
fn show_about_panel(app: &AppHandle) {
    use objc2::runtime::AnyObject;
    use objc2::{ClassType, MainThreadMarker};
    use objc2_app_kit::{
        NSAboutPanelOptionApplicationIcon, NSAboutPanelOptionApplicationName,
        NSAboutPanelOptionApplicationVersion, NSAboutPanelOptionVersion, NSApplication, NSImage,
    };
    use objc2_foundation::{NSDictionary, NSString};

    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    let icon_name = LAST_DOCK_ICON
        .lock()
        .ok()
        .map(|last| last.0.clone())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "icon-day.png".to_string());
    let icon = app
        .path()
        .resource_dir()
        .ok()
        .map(|dir| dir.join("icons").join(&icon_name))
        .and_then(|path| {
            let allocated = mtm.alloc::<NSImage>();
            let ns_path = NSString::from_str(&path.to_string_lossy());
            NSImage::initWithContentsOfFile(allocated, &ns_path)
        });
    let name = NSString::from_str("PathBlender");
    let version = NSString::from_str(env!("CARGO_PKG_VERSION"));
    let short_version = NSString::from_str(env!("PB_GIT_HASH"));
    // Extern statics (the AppKit option-key constants) read under one block.
    let (key_icon, key_name, key_version, key_short) = unsafe {
        (
            NSAboutPanelOptionApplicationIcon,
            NSAboutPanelOptionApplicationName,
            NSAboutPanelOptionApplicationVersion,
            NSAboutPanelOptionVersion,
        )
    };
    let mut keys: Vec<&NSString> = Vec::new();
    let mut values: Vec<&AnyObject> = Vec::new();
    if let Some(icon) = icon.as_ref() {
        keys.push(key_icon);
        values.push(icon.as_super().as_super());
    }
    keys.push(key_name);
    values.push(name.as_super().as_super());
    keys.push(key_version);
    values.push(version.as_super().as_super());
    keys.push(key_short);
    values.push(short_version.as_super().as_super());
    let options = NSDictionary::from_slices(&keys, &values);
    unsafe {
        NSApplication::sharedApplication(mtm)
            .orderFrontStandardAboutPanelWithOptions(&options);
    }
}

fn build_entry(app: &AppHandle, e: &MenuItemIn, ids: &mut Vec<String>) -> tauri::Result<Option<Built>> {
    if e.mac_only && !cfg!(target_os = "macos") {
        return Ok(None);
    }
    if e.mac_hide && cfg!(target_os = "macos") {
        return Ok(None);
    }
    if !e.role.is_empty() {
        return Ok(Some(match e.role.as_str() {
            "separator" => Built::Separator,
            // About is a plain item the shell handles itself (macOS is the
            // only platform where the role entry is built — the app menu is
            // mac_only): the predefined variant caches the bundle icon in
            // its panel forever, so it cannot follow the runtime icon
            // override (show_about_panel). Role entries carry no `enabled`
            // in the web spec (they were predefined one-shots) — the serde
            // default is false, which would gray the item out and swallow
            // the click, so it is forced enabled here.
            "about" => {
                ids.push("about".to_string());
                Built::Item(MenuItem::with_id(app, "about", &e.label, true, None::<&str>)?)
            }
            "hide" => Built::Predefined(PredefinedMenuItem::hide(app, Some(&e.label))?),
            "hideOthers" => Built::Predefined(PredefinedMenuItem::hide_others(app, Some(&e.label))?),
            "quit" => Built::Predefined(PredefinedMenuItem::quit(app, Some(&e.label))?),
            "minimize" => Built::Predefined(PredefinedMenuItem::minimize(app, Some(&e.label))?),
            "zoom" => Built::Predefined(PredefinedMenuItem::maximize(app, Some(&e.label))?),
            // The clipboard roles need their title passed through as well:
            // AppKit falls back to its own English defaults here, because the
            // bundle ships no .lproj (the roles above already take our label).
            "cut" => Built::Predefined(PredefinedMenuItem::cut(app, Some(&e.label))?),
            "copy" => Built::Predefined(PredefinedMenuItem::copy(app, Some(&e.label))?),
            "paste" => Built::Predefined(PredefinedMenuItem::paste(app, Some(&e.label))?),
            "selectAll" => Built::Predefined(PredefinedMenuItem::select_all(app, Some(&e.label))?),
            _ => return Ok(None),
        }));
    }
    match e.kind.as_str() {
        "check" => {
            ids.push(e.id.clone());
            Ok(Some(Built::Check(CheckMenuItem::with_id(
                app, &e.id, &e.label, e.checked, e.enabled, e.accelerator.as_deref(),
            )?)))
        }
        "submenu" => {
            let sub = build_submenu(app, &e.label, &e.items, ids)?;
            Ok(Some(Built::Submenu(sub)))
        }
        _ => {
            if !e.id.is_empty() {
                ids.push(e.id.clone());
            }
            Ok(Some(Built::Item(MenuItem::with_id(
                app, &e.id, &e.label, e.enabled, e.accelerator.as_deref(),
            )?)))
        }
    }
}

/// Build one submenu with all its entries (the fold stays inside this
/// function — SubmenuBuilder's Manager generic must not cross a boundary).
fn build_submenu(app: &AppHandle, label: &str, items: &[MenuItemIn], ids: &mut Vec<String>) -> tauri::Result<Submenu<tauri::Wry>> {
    let mut b = SubmenuBuilder::new(app, label);
    for e in items {
        match build_entry(app, e, ids)? {
            Some(Built::Separator) => b = b.separator(),
            Some(Built::Item(i)) => b = b.item(&i),
            Some(Built::Check(c)) => b = b.item(&c),
            Some(Built::Predefined(p)) => b = b.item(&p),
            Some(Built::Submenu(s)) => b = b.item(&s),
            None => {}
        }
    }
    b.build()
}

fn build_menu_from_spec(app: &AppHandle, payload: &MenuPayload, ids: &mut Vec<String>) -> tauri::Result<Menu<tauri::Wry>> {
    let mut top = MenuBuilder::new(app);
    for section in &payload.menus {
        if section.mac_only && !cfg!(target_os = "macos") {
            continue;
        }
        let sub = build_submenu(app, &section.label, &section.items, ids)?;
        top = top.item(&sub);
    }
    top.build()
}

/// Minimal fallback until the page pushes the real (localized) menu — the
/// app menu needs About/Quit roles to stay usable during page load. About
/// is a plain id'd item handled like the spec-built one (show_about_panel
/// on macOS; the page's About tab elsewhere) — the predefined variant
/// would pin the bundle icon in its panel forever.
fn startup_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let sub = SubmenuBuilder::new(app, "PathBlender")
        .item(&MenuItem::with_id(app, "about", "About PathBlender", true, None::<&str>)?)
        .quit_with_text("Quit PathBlender")
        .build()?;
    MenuBuilder::new(app).item(&sub).build()
}

/// `updates` steers the window at the Updates section and starts a check
/// there (menu "Check for Updates", user request 2026-10-16): an
/// already-open window gets a `pb-prefs-go-updates` DOM CustomEvent — the
/// same eval channel as menu commands (ADR-0003), stashed on `window` in
/// case the page is still loading — while a fresh window is created with
/// `?go=updates`, which its mount path reads (an eval into a webview that
/// hasn't navigated yet would be lost).
fn open_prefs(app: &AppHandle, updates: bool) {
    if let Some(win) = app.get_webview_window(PREFS_WINDOW) {
        if updates {
            let _ = win.eval(
                "window.__pbGoUpdates=1;\
                 window.dispatchEvent(new CustomEvent('pb-prefs-go-updates'))",
            );
        }
        let _ = win.set_focus();
        return;
    }
    // Windows/WebView2 deadlocks when a window is built synchronously inside
    // a command or native menu event. Only creation moves off that thread;
    // focusing or re-targeting an existing window remains synchronous.
    #[cfg(target_os = "windows")]
    {
        let handle = app.clone();
        let _ = std::thread::spawn(move || create_prefs_window(&handle, updates));
    }
    #[cfg(not(target_os = "windows"))]
    create_prefs_window(app, updates);
}

fn create_prefs_window(app: &AppHandle, updates: bool) {
    let url = if updates {
        "index.html?window=prefs&go=updates"
    } else {
        "index.html?window=prefs"
    };
    let builder = WebviewWindowBuilder::new(app, PREFS_WINDOW, WebviewUrl::App(url.into()))
    .title("Preferences")
    .inner_size(780.0, 580.0)
    .min_inner_size(640.0, 480.0)
    .resizable(true);
    // Same chrome as the main window (user request 2026-10-04): an overlay
    // title bar — no native divider, no "Preferences" title text; the
    // traffic lights float over the web side's invisible drag strip.
    // The traffic-light position mirrors the main window's
    // tauri.conf.json trafficLightPosition (18, 35) — keep the two in sync
    // so the buttons sit at the exact same window offset in both windows
    // (AX-verified: close button lands at offset (17, 25) from the origin).
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::Position::Logical(tauri::LogicalPosition::new(18.0, 35.0)));
    if let Err(error) = builder.build() {
        eprintln!("failed to create Preferences window: {error}");
    }
    #[cfg(target_os = "macos")]
    if let Some(win) = app.get_webview_window(PREFS_WINDOW) {
        disable_webview_scroll_bounce(&win);
    }
}

/// macOS 26+ rubber-bands the entire window (title bar included) when the
/// webview is scrolled past a content edge: WKWebView is an AppKit "elastic
/// scrolling" view, and per NSResponder.h such views forward boundary scroll
/// events up the responder chain — where the system answers with a
/// window-level bounce. The app document never scrolls (html/body are
/// height:100%), so every two-finger scroll read as pure bounce. AppKit
/// exposes no window-side opt-out (no public NSWindow API, verified against
/// the macOS 27 SDK); the only lever is the WebKit-private bounce switch —
/// the macOS twin of iOS `scrollView.bounces` (wry#557). The web side adds
/// `overscroll-behavior: none` as the second layer of the same cut. Called
/// after each webview exists; a removed selector degrades to stock behavior
/// via the respondsToSelector guard.
#[cfg(target_os = "macos")]
fn disable_webview_scroll_bounce<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    let _ = window.with_webview(|webview| {
        use objc2::runtime::AnyObject;
        use objc2::{msg_send, sel};
        let wk = webview.inner() as *mut AnyObject;
        if wk.is_null() {
            return;
        }
        // SAFETY: with_webview runs this closure on the main thread (these
        // selectors are main-thread-only) and the WKWebView pointer is valid
        // only inside it. Undeclared selectors cannot be sent unchecked, so
        // each send is gated on respondsToSelector first.
        unsafe {
            let obj = &*wk;
            let rubber: bool = msg_send![obj, respondsToSelector: sel!(_setRubberBandingEnabled:)];
            if rubber {
                let _: () = msg_send![obj, _setRubberBandingEnabled: false];
            }
            let vert: bool = msg_send![obj, respondsToSelector: sel!(_setAlwaysBounceVertical:)];
            if vert {
                let _: () = msg_send![obj, _setAlwaysBounceVertical: false];
            }
            let horiz: bool = msg_send![obj, respondsToSelector: sel!(_setAlwaysBounceHorizontal:)];
            if horiz {
                let _: () = msg_send![obj, _setAlwaysBounceHorizontal: false];
            }
        }
    });
}

/// Enable AppKit's native background drag only while the pointer is over a
/// declared blank chrome region. Tao reads this flag synchronously from the
/// real leftMouseDown event; the web layer also keeps startDragging() as a
/// fallback. The source window is used so main and preferences stay isolated.
#[tauri::command]
fn set_window_background_movable(window: tauri::WebviewWindow, movable: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let target = window.clone();
        let (tx, rx) = std::sync::mpsc::channel();
        window
            .run_on_main_thread(move || {
                let _ = tx.send(set_native_window_background_movable(&target, movable));
            })
            .map_err(|e| format!("window drag dispatch failed: {e}"))?;
        rx.recv()
            .map_err(|_| "window drag task ended without a result".to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (&window, movable);
        Ok(())
    }
}

#[cfg(target_os = "macos")]
fn set_native_window_background_movable(
    window: &tauri::WebviewWindow,
    movable: bool,
) -> Result<(), String> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSWindow;

    if MainThreadMarker::new().is_none() {
        return Err("window drag requires the main thread".to_string());
    }
    let raw = window
        .ns_window()
        .map_err(|e| format!("window has no native handle: {e}"))?;
    if raw.is_null() {
        return Err("window has no native NSWindow".to_string());
    }
    // SAFETY: ns_window returns the live source window on the main thread;
    // the pointer is only borrowed for this setter.
    let ns_window: &NSWindow = unsafe { &*(raw as *mut NSWindow) };
    ns_window.setMovableByWindowBackground(movable);
    Ok(())
}

/// Open an allowed external link in the user's system browser (handoff
/// 2026-10-05). A plain `target="_blank"` anchor is not routed outward by
/// WKWebView / WebKitGTK, so the web layer asks the shell. The allowlist
/// keeps this from becoming a generic URL launcher — the workspace only ever
/// passes the project's own GitHub URL, plus CTRE's owlet documentation and
/// EULA domains, which the HOOT import flow opens.
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    if !is_allowed_external_url(&url) {
        return Err(format!("url not allowed: {url}"));
    }
    #[cfg(target_os = "macos")]
    let spawned = std::process::Command::new("open").arg(&url).status();
    #[cfg(target_os = "linux")]
    let spawned = std::process::Command::new("xdg-open").arg(&url).status();
    #[cfg(target_os = "windows")]
    let spawned = std::process::Command::new("cmd")
        .args(["/c", "start", "", &url])
        .status();
    match spawned {
        Ok(status) if status.success() => Ok(()),
        Ok(status) => Err(format!("opener exited with {status}")),
        Err(e) => Err(e.to_string()),
    }
}

/// The fixed external-URL allowlist for [`open_external`]: the project's own
/// GitHub repo plus CTRE's owlet documentation and EULA domains (opened by
/// the HOOT import flow).
const ALLOWED_EXTERNAL_URL_PREFIXES: [&str; 3] = [
    "https://github.com/LYT259/pathblender",
    "https://v6.docs.ctr-electronics.com/",
    "https://www.ctr-electronics.com/",
];

/// Whether `url` falls under one of the allowed external prefixes. Entries
/// ending in `/` (the CTRE domains) cover every path beneath them; the bare
/// repo URL matches only itself or a `/`-delimited subpath beneath it, so a
/// longer name that merely starts with the same characters
/// (`…/pathblender.evil`) is refused.
pub fn is_allowed_external_url(url: &str) -> bool {
    ALLOWED_EXTERNAL_URL_PREFIXES.iter().any(|prefix| {
        if prefix.ends_with('/') {
            url.starts_with(prefix)
        } else {
            *prefix == url
                || (url.len() > prefix.len()
                    && url.starts_with(prefix)
                    && url.as_bytes()[prefix.len()] == b'/')
        }
    })
}

#[tauri::command]
fn open_preferences(app: AppHandle, updates: Option<bool>) {
    open_prefs(&app, updates.unwrap_or(false));
}

/// (file name, base64 bytes) pairs — the payload shape of the web side's
/// `pb-open-files` CustomEvent (ADR-0003).
fn read_open_pairs(paths: impl IntoIterator<Item = PathBuf>) -> Vec<(String, String)> {
    paths
        .into_iter()
        .filter_map(|path| {
            if !path.is_file() {
                return None;
            }
            let name = path.file_name()?.to_string_lossy().into_owned();
            let bytes = std::fs::read(&path).ok()?;
            Some((
                name,
                base64::engine::general_purpose::STANDARD.encode(bytes),
            ))
        })
        .collect()
}

/// Push files into the page as a DOM CustomEvent via eval — push-only, no
/// Tauri event listener involved, so nothing can race page load (ADR-0003).
fn push_open_files<R: tauri::Runtime>(app: &AppHandle<R>, pairs: &[(String, String)]) {
    if pairs.is_empty() {
        return;
    }
    let json = serde_json::to_string(pairs).expect("serialize open-with files");
    let js = format!(
        "window.__pbOpenPayload={json};\
         window.dispatchEvent(new CustomEvent('pb-open-files',\
         {{detail:window.__pbOpenPayload}}))"
    );
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.eval(&js);
    }
}

/// Menu commands drive web-state actions (save/clear/update).
/// Dispatch them as DOM CustomEvents via eval instead of Tauri events: the
/// web-side `listen()` registration can silently lose the race against
/// page load on WebKitGTK, leaving the menu dead (ADR-0003).
fn push_menu_event<R: tauri::Runtime>(app: &AppHandle<R>, name: &str) {
    let js = format!("window.dispatchEvent(new CustomEvent('pb-menu-{name}'))");
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.eval(&js);
    }
}

/// Apply the app-icon preferences (web-side app-icon.tsx, independent from
/// the UI theme) to the running app's Dock tile (macOS only). The bundle's
/// icon catalog already tracks the OS appearance; this runtime override
/// (`setApplicationIconImage` with explicit artwork) pins the tile to the
/// choice — in 'system' mode the web side re-pushes the OS-matching
/// artwork on every appearance flip, so no Dock re-render behavior is
/// relied upon. `style` selects the artwork family (classic red/black vs
/// monochrome white/black); the mapping below is a fixed whitelist of
/// bundled resource names — a caller-provided path is never accepted.
/// Missing artwork or a non-macOS host is a quiet no-op — the catalog
/// remains the fallback there.
fn dock_icon_resource(style: &str, dark: bool) -> &'static str {
    match (style, dark) {
        ("monochrome", false) => "icon-mono-day.png",
        ("monochrome", true) => "icon-mono-night.png",
        (_, false) => "icon-day.png",
        (_, true) => "icon-night.png",
    }
}

#[tauri::command]
fn set_dock_icon(app: AppHandle, dark: bool, style: Option<String>) -> Result<(), String> {
    let name = dock_icon_resource(style.as_deref().unwrap_or("classic"), dark);
    if let Ok(mut last) = LAST_DOCK_ICON.lock() {
        *last = (name.to_string(), dark);
    }
    #[cfg(target_os = "macos")]
    {
        let path = app
            .path()
            .resource_dir()
            .map_err(|e| e.to_string())?
            .join("icons")
            .join(name);
        if !path.is_file() {
            return Ok(());
        }
        app.run_on_main_thread(move || apply_dock_icon(&path))
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app;
    Ok(())
}

/// AppKit calls must stay on the main thread; the marker proves we're there
/// and carries `alloc` (objc2 0.6 ties allocation to the main-thread marker).
#[cfg(target_os = "macos")]
fn apply_dock_icon(path: &std::path::Path) {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSApplication, NSImage};
    use objc2_foundation::NSString;
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    let ns_path = NSString::from_str(&path.to_string_lossy());
    let allocated = mtm.alloc::<NSImage>();
    let image = NSImage::initWithContentsOfFile(allocated, &ns_path);
    if let Some(image) = image {
        unsafe {
            NSApplication::sharedApplication(mtm).setApplicationIconImage(Some(&image));
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Open-with: files passed on the command line (double-click / "open
    // with") are read locally and pushed into the page once loading
    // finishes — same `pb-open-files` channel the native import picker
    // uses (ADR-0003).
    let opened = read_open_pairs(std::env::args().skip(1).map(PathBuf::from));
    let delivered = AtomicBool::new(false);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            save_file,
            set_menu,
            open_preferences,
            open_external,
            set_dock_icon,
            set_window_background_movable,
            check_update,
            install_update,
            hoot::hoot_status,
            hoot::hoot_accept_eula,
            hoot::hoot_download_owlet,
            hoot::hoot_convert,
            set_update_guard,
            ble::commands::ble_capabilities,
            ble::commands::ble_start_scan,
            ble::commands::ble_stop_scan,
            ble::commands::ble_send_files,
            ble::commands::ble_start_receiver,
            ble::commands::ble_confirm_session,
            ble::commands::ble_respond_file,
            ble::commands::ble_take_received_files,
            ble::commands::ble_cancel
        ])
        .manage(MenuState {
            ids: Mutex::new(Vec::new()),
        })
        .manage(PendingUpdate(Mutex::new(None)))
        .manage(UpdateSessionGuard(AtomicBool::new(
            UPDATE_SESSION_DIRTY_DEFAULT,
        )))
        .setup(|app| {
            // Debug-branch diagnostic scaffolding (debug/windows-main-webview,
            // NOT a product fix): tauri creates config windows before this
            // closure runs, which leaves no way to pass WebView2 browser
            // arguments to the main window. The config marks it `create:
            // false` so it is built here from the very same config instead.
            // Without the diagnostic env vars below the window is built
            // exactly as before; the extra args only ever come from the
            // one-shot CDP workflow on this branch.
            let main_config = app
                .config()
                .app
                .windows
                .iter()
                .find(|w| w.label == "main")
                .cloned()
                .expect("main window config missing from tauri.conf.json");
            let mut main_builder = WebviewWindowBuilder::from_config(app.handle(), &main_config)?;
            if let Ok(extra_args) = std::env::var("PB_DEBUG_WEBVIEW_BROWSER_ARGS") {
                let extra_args = extra_args.trim();
                if !extra_args.is_empty() {
                    // `additional_browser_args` REPLACES wry's built-in
                    // defaults (wry-0.57.1 webview2/mod.rs builds
                    // `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection`
                    // only when no args are given), so the defaults are
                    // restated verbatim before the diagnostic flags. WebView2
                    // requires webviews with different browser arguments to
                    // use different data directories — the diagnostic
                    // workflow always sets PB_DEBUG_WEBVIEW_DATA_DIR.
                    main_builder = main_builder.additional_browser_args(&format!(
                        "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection {extra_args}"
                    ));
                    if let Ok(dir) = std::env::var("PB_DEBUG_WEBVIEW_DATA_DIR") {
                        let dir = dir.trim();
                        if !dir.is_empty() {
                            main_builder = main_builder.data_directory(PathBuf::from(dir));
                        }
                    }
                }
            }
            main_builder.build()?;
            let menu = startup_menu(app.handle())?;
            app.set_menu(menu)?;
            #[cfg(target_os = "macos")]
            if let Some(win) = app.get_webview_window("main") {
                disable_webview_scroll_bounce(&win);
            }
            Ok(())
        })
        .on_page_load(move |webview, payload| {
            if payload.event() != tauri::webview::PageLoadEvent::Finished
                || opened.is_empty()
                || delivered.swap(true, Ordering::SeqCst)
            {
                return;
            }
            let json = serde_json::to_string(&opened).expect("serialize argv files");
            let js = format!(
                "window.__pbOpenPayload={json};\
                 window.dispatchEvent(new CustomEvent('pb-open-files',\
                 {{detail:window.__pbOpenPayload}}))"
            );
            let _ = webview.eval(&js);
        })
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            match id {
                // About panel with the current dock artwork (macOS); other
                // platforms have no native panel — the page's About tab
                // serves the same purpose and already follows the icon
                // preference.
                "about" => {
                    #[cfg(target_os = "macos")]
                    {
                        let handle = app.clone();
                        let _ = app.run_on_main_thread(move || show_about_panel(&handle));
                    }
                    #[cfg(not(target_os = "macos"))]
                    push_menu_event(app, "about");
                }
                "preferences" => open_prefs(app, false),
                "import" => {
                    // The shell owns the picker and pushes the chosen files
                    // through the open-with channel — the web-side hidden
                    // <input>.click() path loses the listener race on
                    // WebKitGTK (ADR-0003). Blocking dialogs must run off
                    // the main thread, hence the dedicated thread.
                    let handle = app.clone();
                    std::thread::spawn(move || {
                        if let Some(paths) = handle
                            .dialog()
                            .file()
                            .add_filter(
                                "Autonomous paths & sessions",
                                &["traj", "ghostauto", "path", "auto", "wpilog", "hoot", "json"],
                            )
                            .blocking_pick_files()
                        {
                            let pairs =
                                read_open_pairs(paths.into_iter().filter_map(|p| p.into_path().ok()));
                            push_open_files(&handle, &pairs);
                        }
                    });
                }
                // Every other id comes from the web's menu spec — forward it
                // verbatim so the page's handler table picks it up.
                _ => {
                    if SHELL_OWNED_IDS.contains(&id) {
                        return;
                    }
                    let known = app
                        .state::<MenuState>()
                        .ids
                        .lock()
                        .map(|ids| ids.iter().any(|i| i == id))
                        .unwrap_or(false);
                    if known {
                        push_menu_event(app, id);
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Rebuild the whole native menu from the web's spec. The page calls this
/// on startup and whenever the language or any menu-visible state changes.
#[tauri::command]
fn set_menu(app: AppHandle, state: State<MenuState>, payload: serde_json::Value) -> Result<(), String> {
    let parsed: MenuPayload = serde_json::from_value(payload).map_err(|e| format!("bad menu spec: {e}"))?;
    let mut ids = Vec::new();
    let menu = build_menu_from_spec(&app, &parsed, &mut ids).map_err(|e| e.to_string())?;
    *state.ids.lock().map_err(|e| e.to_string())? = ids;
    app.set_menu(menu).map(|_| ()).map_err(|e| e.to_string())
}

/// Native save dialog + write. WKWebView cannot run blob downloads, so the
/// frontend hands the bytes here instead of clicking <a download>. The
/// blocking dialog runs on a dedicated thread: on GTK it dispatches to the
/// main loop, and blocking inside the async command can strand the worker
/// (ADR-0003).
#[tauri::command]
async fn save_file(
    app: AppHandle,
    suggested_name: String,
    filter_ext: String,
    data: Vec<u8>,
) -> Result<Option<String>, String> {
    let filter_name = filter_ext.to_uppercase();
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let path = app
            .dialog()
            .file()
            .set_file_name(suggested_name)
            .add_filter(&filter_name, &[&filter_ext])
            .blocking_save_file();
        let _ = tx.send(path);
    });
    let path = rx.recv().map_err(|e| e.to_string())?;
    match path {
        None => Ok(None),
        Some(p) => {
            let path = p.into_path().map_err(|e| e.to_string())?;
            std::fs::write(&path, &data).map_err(|e| e.to_string())?;
            Ok(Some(path.to_string_lossy().into_owned()))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        dock_icon_resource, gate_then_take, is_allowed_external_url, UPDATE_BLOCKED_ERR,
        UPDATE_SESSION_DIRTY_DEFAULT,
    };
    use std::sync::atomic::{AtomicBool, Ordering};

    /// The whitelist is the whole contract: every (style, dark) pair maps to
    /// one of the four bundled dock resources, and anything unexpected falls
    /// back to the classic pair — never a caller-controlled path.
    #[test]
    fn dock_icon_resource_is_a_fixed_whitelist() {
        assert_eq!(dock_icon_resource("classic", false), "icon-day.png");
        assert_eq!(dock_icon_resource("classic", true), "icon-night.png");
        assert_eq!(dock_icon_resource("monochrome", false), "icon-mono-day.png");
        assert_eq!(dock_icon_resource("monochrome", true), "icon-mono-night.png");
        assert_eq!(dock_icon_resource("", false), "icon-day.png");
        assert_eq!(dock_icon_resource("neon", true), "icon-night.png");
        // Path-like input is just an unknown style: classic fallback.
        assert_eq!(dock_icon_resource("../../etc/passwd", false), "icon-day.png");
    }

    /// The fixed prefix allowlist is the whole `open_external` contract: the
    /// repo URL and paths beneath it, plus CTRE's owlet docs and EULA domains
    /// the HOOT import flow opens. Everything else — unrelated hosts, longer
    /// names that merely start with a whitelisted string, a downgraded
    /// scheme, the www-less apex — is refused.
    #[test]
    fn external_url_whitelist_covers_the_repo_and_hoot_ctr_domains() {
        assert!(is_allowed_external_url("https://github.com/LYT259/pathblender"));
        assert!(is_allowed_external_url(
            "https://github.com/LYT259/pathblender/releases/latest"
        ));
        assert!(is_allowed_external_url("https://v6.docs.ctr-electronics.com/en/stable/"));
        assert!(is_allowed_external_url("https://www.ctr-electronics.com/"));
        assert!(!is_allowed_external_url("https://evil.example"));
        // Starts with the repo URL's characters but is a different name.
        assert!(!is_allowed_external_url("https://github.com/LYT259/pathblender.evil"));
        // Same-string pitfalls: scheme downgrade and the www-less apex are
        // not the whitelisted origins.
        assert!(!is_allowed_external_url("http://github.com/LYT259/pathblender"));
        assert!(!is_allowed_external_url("https://ctr-electronics.com/"));
    }

    /// A blocked attempt must NOT consume the pending update: the retry after
    /// saving reuses the stashed update without re-checking the feed.
    #[test]
    fn gate_blocks_before_consuming_the_pending_update() {
        let mut pending = Some("update");
        assert_eq!(gate_then_take(true, &mut pending), Err(UPDATE_BLOCKED_ERR));
        assert_eq!(pending, Some("update"));
    }

    #[test]
    fn gate_passes_clean_sessions_through() {
        let mut pending = Some("update");
        assert_eq!(gate_then_take(false, &mut pending), Ok("update"));
        assert_eq!(pending, None);
    }

    #[test]
    fn clean_but_unchecked_is_still_the_no_update_error() {
        let mut pending: Option<&str> = None;
        assert_eq!(gate_then_take(false, &mut pending), Err("no update was checked"));
    }

    /// The JS side matches on this exact string (update-guard.ts) — rewording
    /// either side silently degrades blocked installs into generic failures.
    #[test]
    fn blocked_error_string_is_pinned_to_the_js_marker() {
        assert_eq!(UPDATE_BLOCKED_ERR, "update blocked: unsaved session");
    }

    /// Fail-closed: before the webview ever reports, installs are blocked.
    #[test]
    fn guard_defaults_to_blocked() {
        assert!(UPDATE_SESSION_DIRTY_DEFAULT);
        assert!(AtomicBool::new(UPDATE_SESSION_DIRTY_DEFAULT).load(Ordering::SeqCst));
    }
}
