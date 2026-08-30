/// PathBlender desktop shell — minimal static host (report v1.6 §7.1).
/// No sidecars, no backend, no telemetry. The only native behavior:
/// a macOS-standard menu (app menu with About/Preferences/Check-for-Updates,
/// a File menu for import/save/share/PNG/clear, an Edit menu) that follows
/// the app language, plus a small preferences window on ?window=prefs.
use std::sync::Mutex;
use tauri::menu::{AboutMetadataBuilder, MenuBuilder, MenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;

const PREFS_WINDOW: &str = "prefs";

/// UI strings per app language (zh-tw falls back to zh where wording matches).
struct MenuLang {
    file: &'static str,
    edit: &'static str,
    import: &'static str,
    save: &'static str,
    share: &'static str,
    png: &'static str,
    clear: &'static str,
    prefs: &'static str,
    updates: &'static str,
}

const EN: MenuLang = MenuLang {
    file: "File",
    edit: "Edit",
    import: "Import…",
    save: "Save Session…",
    share: "Share…",
    png: "Export PNG…",
    clear: "Clear Session",
    prefs: "Preferences…",
    updates: "Check for Updates…",
};

const ZH: MenuLang = MenuLang {
    file: "文件",
    edit: "编辑",
    import: "导入…",
    save: "保存会话…",
    share: "分享…",
    png: "导出 PNG…",
    clear: "清空会话",
    prefs: "偏好设置…",
    updates: "检查更新…",
};

const ZH_TW: MenuLang = MenuLang {
    file: "檔案",
    edit: "編輯",
    import: "匯入…",
    save: "儲存會話…",
    share: "分享…",
    png: "匯出 PNG…",
    clear: "清空會話",
    prefs: "偏好設定…",
    updates: "檢查更新…",
};

fn lang_of(lang: &str) -> &'static MenuLang {
    match lang {
        "zh" => &ZH,
        "zh-tw" => &ZH_TW,
        _ => &EN,
    }
}

struct MenuState {
    lang: Mutex<String>,
}

fn build_menu(app: &AppHandle, lang: &str) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    let l = lang_of(lang);

    let app_submenu = SubmenuBuilder::new(app, "PathBlender")
        .about(Some(
            AboutMetadataBuilder::new()
                .name(Some("PathBlender".to_string()))
                .version(Some(env!("CARGO_PKG_VERSION").to_string()))
                .build(),
        ))
        .separator()
        .item(&MenuItem::with_id(
            app,
            "preferences",
            l.prefs,
            true,
            Some("CmdOrCtrl+,"),
        )?)
        .separator()
        .item(&MenuItem::with_id(
            app,
            "check-update",
            l.updates,
            true,
            None::<&str>,
        )?)
        .separator()
        .hide()
        .hide_others()
        .quit()
        .build()?;

    let file_submenu = SubmenuBuilder::new(app, l.file)
        .item(&MenuItem::with_id(
            app,
            "import",
            l.import,
            true,
            Some("CmdOrCtrl+O"),
        )?)
        .item(&MenuItem::with_id(
            app,
            "save",
            l.save,
            true,
            Some("CmdOrCtrl+S"),
        )?)
        .separator()
        .item(&MenuItem::with_id(app, "share", l.share, true, None::<&str>)?)
        .item(&MenuItem::with_id(app, "png", l.png, true, None::<&str>)?)
        .separator()
        .item(&MenuItem::with_id(app, "clear", l.clear, true, None::<&str>)?)
        .build()?;

    let edit_submenu = SubmenuBuilder::new(app, l.edit)
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    MenuBuilder::new(app)
        .item(&app_submenu)
        .item(&file_submenu)
        .item(&edit_submenu)
        .build()
}

fn open_prefs(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(PREFS_WINDOW) {
        let _ = win.set_focus();
        return;
    }
    let _ = WebviewWindowBuilder::new(
        app,
        PREFS_WINDOW,
        WebviewUrl::App("index.html?window=prefs".into()),
    )
    .title("Preferences")
    .inner_size(420.0, 260.0)
    .resizable(false)
    .build();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![save_file, set_menu_language])
        .manage(MenuState {
            lang: Mutex::new(String::from("en")),
        })
        .setup(|app| {
            // Apple-style sidebar material behind the translucent panels
            // (through the overlay title bar so the toolbar shares it).
            if let Some(win) = app.get_webview_window("main") {
                let _ = window_vibrancy::apply_vibrancy(
                    &win,
                    window_vibrancy::NSVisualEffectMaterial::Sidebar,
                    None,
                    None,
                );
            }
            let handle = app.handle().clone();
            *handle
                .state::<MenuState>()
                .lang
                .lock()
                .unwrap() = String::from("en");
            let menu = build_menu(&handle, "en")?;
            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            match event.id().as_ref() {
                "preferences" => open_prefs(app),
                "import" => {
                    let _ = app.emit("menu-import", ());
                }
                "save" => {
                    let _ = app.emit("menu-save", ());
                }
                "share" => {
                    let _ = app.emit("menu-share", ());
                }
                "png" => {
                    let _ = app.emit("menu-png", ());
                }
                "clear" => {
                    let _ = app.emit("menu-clear", ());
                }
                "check-update" => {
                    let _ = app.emit("menu-check-update", ());
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Rebuild the native menu in the app language (zh / zh-tw / en); the web
/// side calls this on startup and whenever the language preference changes.
#[tauri::command]
fn set_menu_language(app: AppHandle, state: State<MenuState>, lang: String) -> Result<(), String> {
    {
        let mut cur = state.lang.lock().map_err(|e| e.to_string())?;
        if *cur == lang {
            return Ok(());
        }
        *cur = lang.clone();
    }
    let menu = build_menu(&app, &lang).map_err(|e| e.to_string())?;
    app.set_menu(menu).map(|_| ()).map_err(|e| e.to_string())
}

/// Native save dialog + write. WKWebView cannot run blob downloads, so the
/// frontend hands the bytes here instead of clicking <a download>.
#[tauri::command]
async fn save_file(
    app: AppHandle,
    suggested_name: String,
    filter_ext: String,
    data: Vec<u8>,
) -> Result<Option<String>, String> {
    let filter_name = filter_ext.to_uppercase();
    let path = app
        .dialog()
        .file()
        .set_file_name(suggested_name)
        .add_filter(&filter_name, &[&filter_ext])
        .blocking_save_file();
    match path {
        None => Ok(None),
        Some(p) => {
            let path = p.into_path().map_err(|e| e.to_string())?;
            std::fs::write(&path, &data).map_err(|e| e.to_string())?;
            Ok(Some(path.to_string_lossy().into_owned()))
        }
    }
}
