/// PathBlender desktop shell — minimal static host (report v1.6 §7.1).
/// No sidecars, no backend, no telemetry. The only native behavior:
/// a macOS-standard menu (app menu with About/Preferences/Check-for-Updates,
/// a File menu for import/save/PNG/clear, an Edit menu) that follows
/// the app language, plus a preferences window on ?window=prefs.
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use base64::Engine as _;
use tauri::menu::{AboutMetadataBuilder, MenuBuilder, MenuItem, SubmenuBuilder};
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_updater::{Update, UpdaterExt};

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

/// Download and install the update found by `check_update`. The webview
/// relaunches afterwards; on Windows the NSIS installer exits the app
/// itself, so callers must treat install as the last reliable step.
#[tauri::command]
async fn install_update(pending: State<'_, PendingUpdate>) -> Result<(), String> {
    let update = {
        let mut guard = pending.0.lock().map_err(|e| e.to_string())?;
        guard.take()
    };
    let Some(update) = update else {
        return Err("no update was checked".into());
    };
    update
        .download_and_install(|_chunk, _total| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// UI strings per app language — every web dictionary gets a table below
/// (zh-tw carries its own wording rather than reusing zh).
struct MenuLang {
    about: &'static str,
    file: &'static str,
    edit: &'static str,
    import: &'static str,
    save: &'static str,
    png: &'static str,
    clear: &'static str,
    prefs: &'static str,
    updates: &'static str,
    hide: &'static str,
    hide_others: &'static str,
    quit: &'static str,
}

const EN: MenuLang = MenuLang {
    hide: "Hide PathBlender",
    hide_others: "Hide Others",
    quit: "Quit PathBlender",
    about: "About PathBlender",
    file: "File",
    edit: "Edit",
    import: "Import…",
    save: "Save Session…",
    png: "Export PNG…",
    clear: "Clear Session",
    prefs: "Preferences…",
    updates: "Check for Updates…",
};

const ZH: MenuLang = MenuLang {
    hide: "隐藏 PathBlender",
    hide_others: "隐藏其他",
    quit: "退出 PathBlender",
    about: "关于 PathBlender",
    file: "文件",
    edit: "编辑",
    import: "导入…",
    save: "保存会话…",
    png: "导出 PNG…",
    clear: "清空会话",
    prefs: "偏好设置…",
    updates: "检查更新…",
};

const ZH_TW: MenuLang = MenuLang {
    hide: "隱藏 PathBlender",
    hide_others: "隱藏其他",
    quit: "結束 PathBlender",
    about: "關於 PathBlender",
    file: "檔案",
    edit: "編輯",
    import: "匯入…",
    save: "儲存工作階段…",
    png: "匯出 PNG…",
    clear: "清空工作階段",
    prefs: "偏好設定…",
    updates: "檢查更新…",
};

/// Hong Kong wording. Same script, a few terms and the session word differ
/// from the Taiwan table; Macau reads this one too (report §7.2 v1.23).
const ZH_HK: MenuLang = MenuLang {
    hide: "隱藏 PathBlender",
    hide_others: "隱藏其他",
    quit: "結束 PathBlender",
    about: "關於 PathBlender",
    file: "檔案",
    edit: "編輯",
    import: "匯入…",
    save: "儲存工作階段…",
    png: "匯出 PNG…",
    clear: "清除工作階段",
    prefs: "偏好設定…",
    updates: "檢查更新…",
};

const ES: MenuLang = MenuLang {
    hide: "Ocultar PathBlender",
    hide_others: "Ocultar otros",
    quit: "Salir de PathBlender",
    about: "Acerca de PathBlender",
    file: "Archivo",
    edit: "Edición",
    import: "Importar…",
    save: "Guardar sesión…",
    png: "Exportar PNG…",
    clear: "Vaciar sesión",
    prefs: "Preferencias…",
    updates: "Buscar actualizaciones…",
};

const FR: MenuLang = MenuLang {
    hide: "Masquer PathBlender",
    hide_others: "Masquer les autres",
    quit: "Quitter PathBlender",
    about: "À propos de PathBlender",
    file: "Fichier",
    edit: "Édition",
    import: "Importer…",
    save: "Enregistrer la session…",
    png: "Exporter PNG…",
    clear: "Effacer la session",
    prefs: "Réglages…",
    updates: "Rechercher les mises à jour…",
};

const TR: MenuLang = MenuLang {
    hide: "PathBlender'i Gizle",
    hide_others: "Diğerlerini Gizle",
    quit: "PathBlender'dan Çık",
    about: "PathBlender Hakkında",
    file: "Dosya",
    edit: "Düzen",
    import: "İçe Aktar…",
    save: "Oturumu Kaydet…",
    png: "PNG Dışa Aktar…",
    clear: "Oturumu Temizle",
    prefs: "Tercihler…",
    updates: "Güncellemeleri Denetle…",
};

/// Brazilian Portuguese wording (first batch of the language expansion plan).
const PT_BR: MenuLang = MenuLang {
    hide: "Ocultar PathBlender",
    hide_others: "Ocultar Outros",
    quit: "Sair do PathBlender",
    about: "Sobre o PathBlender",
    file: "Arquivo",
    edit: "Editar",
    import: "Importar…",
    save: "Salvar Sessão…",
    png: "Exportar PNG…",
    clear: "Limpar Sessão",
    prefs: "Preferências…",
    updates: "Verificar Atualizações…",
};

/// Hebrew wording. macOS renders the native menu bar itself, so the strings
/// stay plain Hebrew text and need no RTL markup here — the web content is
/// where dir=rtl applies.
const HE: MenuLang = MenuLang {
    hide: "הסתר את PathBlender",
    hide_others: "הסתר את האחרים",
    quit: "יציאה מ-PathBlender",
    about: "אודות PathBlender",
    file: "קובץ",
    edit: "עריכה",
    import: "ייבוא…",
    save: "שמירת הפעלה…",
    png: "ייצוא PNG…",
    clear: "ניקוי הפעלה",
    prefs: "העדפות…",
    updates: "בדיקת עדכונים…",
};

// Second-batch UI languages (nl/pl/ja/ko/cs, red book §语言扩展规划): each
// follows Apple's own macOS menu localization for hide/quit/about.
const NL: MenuLang = MenuLang {
    hide: "Verberg PathBlender",
    hide_others: "Verberg andere",
    quit: "Stop PathBlender",
    about: "Over PathBlender",
    file: "Archief",
    edit: "Wijzig",
    import: "Importeer…",
    save: "Bewaar sessie…",
    png: "Exporteer PNG…",
    clear: "Wis sessie",
    prefs: "Voorkeuren…",
    updates: "Zoek naar updates…",
};

const PL: MenuLang = MenuLang {
    hide: "Ukryj PathBlender",
    hide_others: "Ukryj pozostałe",
    quit: "Zakończ PathBlender",
    about: "O programie PathBlender",
    file: "Plik",
    edit: "Edycja",
    import: "Importuj…",
    save: "Zapisz sesję…",
    png: "Eksportuj PNG…",
    clear: "Wyczyść sesję",
    prefs: "Preferencje…",
    updates: "Sprawdź uaktualnienia…",
};

const JA: MenuLang = MenuLang {
    hide: "PathBlender を隠す",
    hide_others: "ほかを隠す",
    quit: "PathBlender を終了",
    about: "PathBlender について",
    file: "ファイル",
    edit: "編集",
    import: "読み込む…",
    save: "セッションを保存…",
    png: "PNG を書き出す…",
    clear: "セッションをクリア",
    prefs: "環境設定…",
    updates: "アップデートを確認…",
};

const KO: MenuLang = MenuLang {
    hide: "PathBlender 가리기",
    hide_others: "기타 가리기",
    quit: "PathBlender 종료",
    about: "PathBlender 정보",
    file: "파일",
    edit: "편집",
    import: "가져오기…",
    save: "세션 저장…",
    png: "PNG 내보내기…",
    clear: "세션 지우기",
    prefs: "환경설정…",
    updates: "업데이트 확인…",
};

const CS: MenuLang = MenuLang {
    hide: "Skrýt PathBlender",
    hide_others: "Skrýt ostatní",
    quit: "Ukončit PathBlender",
    about: "O aplikaci PathBlender",
    file: "Soubor",
    edit: "Upravit",
    import: "Importovat…",
    save: "Uložit relaci…",
    png: "Exportovat PNG…",
    clear: "Vymazat relaci",
    prefs: "Předvolby…",
    updates: "Zkontrolovat aktualizace…",
};

/// Third-batch UI languages (de/it/ar/hi/mr/ms/ta/fil/vi/id, red book §语言扩展规划):
/// hide/quit/about follow Apple's own macOS menu localization where it exists.
const DE: MenuLang = MenuLang {
    hide: "PathBlender ausblenden",
    hide_others: "Andere ausblenden",
    quit: "PathBlender beenden",
    about: "Über PathBlender",
    file: "Ablage",
    edit: "Bearbeiten",
    import: "Importieren…",
    save: "Sitzung speichern…",
    png: "PNG exportieren…",
    clear: "Sitzung leeren",
    prefs: "Einstellungen…",
    updates: "Nach Updates suchen…",
};

const IT: MenuLang = MenuLang {
    hide: "Nascondi PathBlender",
    hide_others: "Nascondi altre",
    quit: "Esci da PathBlender",
    about: "Informazioni su PathBlender",
    file: "File",
    edit: "Modifica",
    import: "Importa…",
    save: "Salva sessione…",
    png: "Esporta PNG…",
    clear: "Svuota sessione",
    prefs: "Preferenze…",
    updates: "Controlla aggiornamenti…",
};

/// Arabic wording; like Hebrew, macOS renders the menu bar itself, so the
/// strings stay plain text and need no RTL markup here.
const AR: MenuLang = MenuLang {
    hide: "إخفاء PathBlender",
    hide_others: "إخفاء الآخرين",
    quit: "إنهاء PathBlender",
    about: "حول PathBlender",
    file: "ملف",
    edit: "تحرير",
    import: "استيراد…",
    save: "حفظ الجلسة…",
    png: "تصدير PNG…",
    clear: "مسح الجلسة",
    prefs: "التفضيلات…",
    updates: "التحقق من التحديثات…",
};

const HI: MenuLang = MenuLang {
    hide: "PathBlender छिपाएँ",
    hide_others: "अन्य छिपाएँ",
    quit: "PathBlender से बाहर निकलें",
    about: "PathBlender के बारे में",
    file: "फ़ाइल",
    edit: "संपादन",
    import: "आयात करें…",
    save: "सत्र सहेजें…",
    png: "PNG निर्यात करें…",
    clear: "सत्र साफ़ करें",
    prefs: "प्राथमिकताएँ…",
    updates: "अपडेट जाँचें…",
};

const MR: MenuLang = MenuLang {
    hide: "PathBlender लपवा",
    hide_others: "इतर लपवा",
    quit: "PathBlender मधून बाहेर पडा",
    about: "PathBlender विषयी",
    file: "फाइल",
    edit: "संपादन",
    import: "आयात करा…",
    save: "सत्र जतन करा…",
    png: "PNG निर्यात करा…",
    clear: "सत्र साफ करा",
    prefs: "प्राधान्ये…",
    updates: "अपडेट तपासा…",
};

const MS: MenuLang = MenuLang {
    hide: "Sembunyikan PathBlender",
    hide_others: "Sembunyikan Lain",
    quit: "Keluar PathBlender",
    about: "Perihal PathBlender",
    file: "Fail",
    edit: "Edit",
    import: "Muat masuk…",
    save: "Simpan Sesi…",
    png: "Eksport PNG…",
    clear: "Kosongkan Sesi",
    prefs: "Keutamaan…",
    updates: "Semak Kemas Kini…",
};

const TA: MenuLang = MenuLang {
    hide: "PathBlender ஐ மறை",
    hide_others: "மற்றவற்றை மறை",
    quit: "PathBlender இல் இருந்து வெளியேறு",
    about: "PathBlender பற்றி",
    file: "கோப்பு",
    edit: "திருத்து",
    import: "இறக்குமதி…",
    save: "அமர்வைச் சேமி…",
    png: "PNG ஏற்றுமதி…",
    clear: "அமர்வை அழி",
    prefs: "விருப்பங்கள்…",
    updates: "புதுப்பிப்புகளைச் சரிபார்…",
};

const FIL: MenuLang = MenuLang {
    hide: "Itago ang PathBlender",
    hide_others: "Itago ang Iba",
    quit: "Lisanin ang PathBlender",
    about: "Tungkol sa PathBlender",
    file: "File",
    edit: "I-edit",
    import: "Mag-import…",
    save: "I-save ang Session…",
    png: "I-export ang PNG…",
    clear: "I-clear ang Session",
    prefs: "Mga Kagustuhan…",
    updates: "Suriin ang mga Update…",
};

const VI: MenuLang = MenuLang {
    hide: "Ẩn PathBlender",
    hide_others: "Ẩn các ứng dụng khác",
    quit: "Thoát PathBlender",
    about: "Giới thiệu về PathBlender",
    file: "Tệp",
    edit: "Sửa",
    import: "Nhập…",
    save: "Lưu phiên…",
    png: "Xuất PNG…",
    clear: "Xóa phiên",
    prefs: "Tùy chọn…",
    updates: "Kiểm tra cập nhật…",
};

const ID: MenuLang = MenuLang {
    hide: "Sembunyikan PathBlender",
    hide_others: "Sembunyikan Lainnya",
    quit: "Keluar dari PathBlender",
    about: "Tentang PathBlender",
    file: "Berkas",
    edit: "Edit",
    import: "Impor…",
    save: "Simpan Sesi…",
    png: "Ekspor PNG…",
    clear: "Bersihkan Sesi",
    prefs: "Preferensi…",
    updates: "Periksa Pembaruan…",
};

// --- Batch 4: 17 new languages (ro/bg/hr/sv/el/az/hy/hu/mk/sq/sr/bs/da/nb/nn/uk/rw) ---

const RO: MenuLang = MenuLang {
    hide: "Ascundeți PathBlender",
    hide_others: "Ascundeți pe alții",
    quit: "Închideți PathBlender",
    about: "Despre PathBlender",
    file: "Fișier",
    edit: "Editare",
    import: "Importă…",
    save: "Salvează sesiunea…",
    png: "Exportă PNG…",
    clear: "Șterge sesiunea",
    prefs: "Setări…",
    updates: "Verifică actualizările…",
};

const BG: MenuLang = MenuLang {
    hide: "Скрий PathBlender",
    hide_others: "Скрий другите",
    quit: "Излез от PathBlender",
    about: "За PathBlender",
    file: "Файл",
    edit: "Редактиране",
    import: "Внос…",
    save: "Запази сесията…",
    png: "Експорт на PNG…",
    clear: "Изчисти сесията",
    prefs: "Настройки…",
    updates: "Провери за обновления…",
};

const HR: MenuLang = MenuLang {
    hide: "Sakrij PathBlender",
    hide_others: "Sakrij druge",
    quit: "Zatvori PathBlender",
    about: "O programu PathBlender",
    file: "Datoteka",
    edit: "Uredi",
    import: "Uvezi…",
    save: "Spremi sesiju…",
    png: "Izvezi PNG…",
    clear: "Obriši sesiju",
    prefs: "Postavke…",
    updates: "Provjeri ažuriranja…",
};

const SV: MenuLang = MenuLang {
    hide: "Dölj PathBlender",
    hide_others: "Dölj andra",
    quit: "Avsluta PathBlender",
    about: "Om PathBlender",
    file: "Arkiv",
    edit: "Ändra",
    import: "Importera…",
    save: "Spara session…",
    png: "Exportera PNG…",
    clear: "Rensa session",
    prefs: "Inställningar…",
    updates: "Sök efter uppdateringar…",
};

const EL: MenuLang = MenuLang {
    hide: "Απόκρυψη του PathBlender",
    hide_others: "Απόκρυψη άλλων",
    quit: "Έξοδος από το PathBlender",
    about: "Πληροφορίες για το PathBlender",
    file: "Αρχείο",
    edit: "Επεξεργασία",
    import: "Εισαγωγή…",
    save: "Αποθήκευση συνεδρίας…",
    png: "Εξαγωγή PNG…",
    clear: "Καθαρισμός συνεδρίας",
    prefs: "Ρυθμίσεις…",
    updates: "Έλεγχος για ενημερώσεις…",
};

const AZ: MenuLang = MenuLang {
    hide: "PathBlender-i gizlə",
    hide_others: "Digərlərini gizlə",
    quit: "PathBlender-dən çıx",
    about: "PathBlender haqqında",
    file: "Fayl",
    edit: "Redaktə",
    import: "İdxal…",
    save: "Sessiyanı saxla…",
    png: "PNG ixracı…",
    clear: "Sessiyani təmizlə",
    prefs: "Parametrlər…",
    updates: "Yeniləmələri yoxla…",
};

const HY: MenuLang = MenuLang {
    hide: "Թաքցնել PathBlender-ը",
    hide_others: "Թաքցնել մյուսները",
    quit: "Մտնել PathBlender-ից",
    about: "PathBlender-ի մասին",
    file: "Ֆայլ",
    edit: "Խմբագրել",
    import: "Ներմուծել…",
    save: "Պահել նիստը…",
    png: "Արտահանել PNG…",
    clear: "Մաքրել նիստը",
    prefs: "Կարգավորումներ…",
    updates: "Ստուգել թարմացումները…",
};

const HU: MenuLang = MenuLang {
    hide: "PathBlender elrejtése",
    hide_others: "Mások elrejtése",
    quit: "PathBlender bezárása",
    about: "A PathBlender névjegye",
    file: "Fájl",
    edit: "Szerkesztés",
    import: "Importálás…",
    save: "Munkamenet mentése…",
    png: "PNG exportálása…",
    clear: "Munkamenet törlése",
    prefs: "Beállítások…",
    updates: "Frissítések keresése…",
};

const MK: MenuLang = MenuLang {
    hide: "Скриј го PathBlender",
    hide_others: "Скриј ги другите",
    quit: "Излези од PathBlender",
    about: "За PathBlender",
    file: "Датотека",
    edit: "Уреди",
    import: "Увоз…",
    save: "Зачувај сесија…",
    png: "Извези PNG…",
    clear: "Исчисти сесија",
    prefs: "Поставки…",
    updates: "Провери за ажурирања…",
};

const SQ: MenuLang = MenuLang {
    hide: "Fshih PathBlender",
    hide_others: "Fshih të tjerët",
    quit: "Mbyll PathBlender",
    about: "Rreth PathBlender",
    file: "Skedar",
    edit: "Modifiko",
    import: "Importo…",
    save: "Ruaj sesionin…",
    png: "Eksporto PNG…",
    clear: "Pastro sesionin",
    prefs: "Preferencat…",
    updates: "Kontrollo për përditësime…",
};

const SR: MenuLang = MenuLang {
    hide: "Сакриј PathBlender",
    hide_others: "Сакриј остале",
    quit: "Излаз из PathBlender",
    about: "О програму PathBlender",
    file: "Фејл",
    edit: "Уреди",
    import: "Увези…",
    save: "Сачувај сесију…",
    png: "Извези PNG…",
    clear: "Очисти сесију",
    prefs: "Подешавања…",
    updates: "Провери ажурирања…",
};

const BS: MenuLang = MenuLang {
    hide: "Sakrij PathBlender",
    hide_others: "Sakrij ostale",
    quit: "Izađi iz PathBlendera",
    about: "O aplikaciji PathBlender",
    file: "Datoteka",
    edit: "Uredi",
    import: "Uvoz…",
    save: "Sačuvaj sesiju…",
    png: "Izvezi PNG…",
    clear: "Očisti sesiju",
    prefs: "Postavke…",
    updates: "Provjeri ažuriranja…",
};

const DA: MenuLang = MenuLang {
    hide: "Skjul PathBlender",
    hide_others: "Skjul andre",
    quit: "Afslut PathBlender",
    about: "Om PathBlender",
    file: "Fil",
    edit: "Rediger",
    import: "Importer…",
    save: "Gem session…",
    png: "Eksportér PNG…",
    clear: "Ryd session",
    prefs: "Indstillinger…",
    updates: "Søg efter opdateringer…",
};

const NB: MenuLang = MenuLang {
    hide: "Skjul PathBlender",
    hide_others: "Skjul andre",
    quit: "Avslutt PathBlender",
    about: "Om PathBlender",
    file: "Fil",
    edit: "Rediger",
    import: "Importer…",
    save: "Lagre sesjon…",
    png: "Eksporter PNG…",
    clear: "Fjern sesjon",
    prefs: "Innstillinger…",
    updates: "Se etter oppdateringer…",
};

const NN: MenuLang = MenuLang {
    hide: "Gøym PathBlender",
    hide_others: "Gøym andre",
    quit: "Avslutt PathBlender",
    about: "Om PathBlender",
    file: "Fil",
    edit: "Rediger",
    import: "Importér…",
    save: "Lagra sesjonen…",
    png: "Eksportér PNG…",
    clear: "Rensa sesjon",
    prefs: "Innstillingar…",
    updates: "Sjå etter oppdateringar…",
};

const UK: MenuLang = MenuLang {
    hide: "Приховати PathBlender",
    hide_others: "Приховати інші",
    quit: "Вийти з PathBlender",
    about: "Про PathBlender",
    file: "Файл",
    edit: "Редагувати",
    import: "Імпорт…",
    save: "Зберегти сесію…",
    png: "Експорт PNG…",
    clear: "Очистити сесію",
    prefs: "Налаштування…",
    updates: "Перевірити оновлення…",
};

const RW: MenuLang = MenuLang {
    hide: "Guhisha PathBlender",
    hide_others: "Guhisha ibindi",
    quit: "Funga PathBlender",
    about: "Ibyerekeye PathBlender",
    file: "Dosye",
    edit: "Hindura",
    import: "Twara…",
    save: "Bika isomo…",
    png: "Ohereza PNG…",
    clear: "Siba isomo",
    prefs: "Ibyifuzo…",
    updates: "Genzura ivugururwa…",
};

/// Every web dictionary has a menu table: `set_menu_language` used to fall
/// through to English for anything but zh/zh-tw, so a Spanish or Turkish user
/// got an English native menu next to a translated window. Adding a language
/// on the web side without adding one here is now caught by
/// `packages/web/test/i18n.test.ts`, which lists the expected codes.
fn lang_of(lang: &str) -> &'static MenuLang {
    match lang {
        "en" => &EN,
        "zh" => &ZH,
        "zh-hk" => &ZH_HK,
        "zh-tw" => &ZH_TW,
        "es" => &ES,
        "fr" => &FR,
        "tr" => &TR,
        "pt-BR" => &PT_BR,
        "he" => &HE,
        "nl" => &NL,
        "pl" => &PL,
        "ja" => &JA,
        "ko" => &KO,
        "cs" => &CS,
        "de" => &DE,
        "it" => &IT,
        "ar" => &AR,
        "hi" => &HI,
        "mr" => &MR,
        "ms" => &MS,
        "ta" => &TA,
        "fil" => &FIL,
        "vi" => &VI,
        "id" => &ID,
        "ro" => &RO,
        "bg" => &BG,
        "hr" => &HR,
        "sv" => &SV,
        "el" => &EL,
        "az" => &AZ,
        "hy" => &HY,
        "hu" => &HU,
        "mk" => &MK,
        "sq" => &SQ,
        "sr" => &SR,
        "bs" => &BS,
        "da" => &DA,
        "nb" => &NB,
        "nn" => &NN,
        "uk" => &UK,
        "rw" => &RW,
        _ => &EN,
    }
}

struct MenuState {
    lang: Mutex<String>,
}

fn build_menu(app: &AppHandle, lang: &str) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    let l = lang_of(lang);

    let app_submenu = SubmenuBuilder::new(app, "PathBlender")
        .about_with_text(l.about, Some(
            AboutMetadataBuilder::new()
                .name(Some("PathBlender".to_string()))
                .version(Some(env!("CARGO_PKG_VERSION").to_string()))
                // The standard macOS About panel appends the build number in
                // parentheses after the version; an empty one suppresses the
                // tail, so the line reads "Version x.y.z" instead of
                // "Version x.y.z (x.y.z)". (Only macOS consumes this field.)
                .short_version(Some(String::new()))
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
        .hide_with_text(l.hide)
        .hide_others_with_text(l.hide_others)
        .quit_with_text(l.quit)
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
    let builder = WebviewWindowBuilder::new(
        app,
        PREFS_WINDOW,
        WebviewUrl::App("index.html?window=prefs".into()),
    )
    .title("Preferences")
    .inner_size(780.0, 580.0)
    .min_inner_size(640.0, 480.0)
    .resizable(true);
    // Same chrome as the main window (user request 2026-10-04): an overlay
    // title bar — no native divider, no "Preferences" title text; the
    // traffic lights float over the web side's invisible drag strip.
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::Position::Logical(tauri::LogicalPosition::new(18.0, 20.0)));
    let _ = builder.build();
}

#[tauri::command]
fn open_preferences(app: AppHandle) {
    open_prefs(&app);
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

/// Menu commands drive web-state actions (save/PNG/clear/update).
/// Dispatch them as DOM CustomEvents via eval instead of Tauri events: the
/// web-side `listen()` registration can silently lose the race against
/// page load on WebKitGTK, leaving the menu dead (ADR-0003).
fn push_menu_event<R: tauri::Runtime>(app: &AppHandle<R>, name: &str) {
    let js = format!("window.dispatchEvent(new CustomEvent('pb-menu-{name}'))");
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.eval(&js);
    }
}

/// Apply the app-icon appearance choice (web-side app-icon.tsx, independent
/// from the UI theme) to the running app's Dock tile (macOS only). The
/// bundle's icon catalog already tracks the OS appearance; this runtime
/// override (`setApplicationIconImage` with explicit artwork) pins the tile
/// to the choice — in 'system' mode the web side re-pushes the OS-matching
/// artwork on every appearance flip, so no Dock re-render behavior is
/// relied upon. Missing artwork or a non-macOS host is a quiet no-op — the
/// catalog remains the fallback there.
#[tauri::command]
fn set_dock_icon(app: AppHandle, dark: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let name = if dark { "icon-night.png" } else { "icon-day.png" };
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
    let _ = (app, dark);
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
            set_menu_language,
            open_preferences,
            set_dock_icon,
            check_update,
            install_update
        ])
        .manage(MenuState {
            lang: Mutex::new(String::from("en")),
        })
        .manage(PendingUpdate(Mutex::new(None)))
        .setup(|app| {
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
            match event.id().as_ref() {
                "preferences" => open_prefs(app),
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
                                &["traj", "ghostauto", "path", "auto", "wpilog", "json"],
                            )
                            .blocking_pick_files()
                        {
                            let pairs =
                                read_open_pairs(paths.into_iter().filter_map(|p| p.into_path().ok()));
                            push_open_files(&handle, &pairs);
                        }
                    });
                }
                "save" => push_menu_event(app, "save"),
                "png" => push_menu_event(app, "png"),
                "clear" => push_menu_event(app, "clear"),
                "check-update" => push_menu_event(app, "check-update"),
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Rebuild the native menu in the app language (the web `Lang` codes); the web
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
