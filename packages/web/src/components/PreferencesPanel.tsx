import { SelectControl } from './SelectControl';
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useI18n, type LangChoice } from '../i18n';
import { useTheme, type ThemeMode } from '../theme';
import { useAppIcon, ICON_STYLE_ARTWORK, type IconAppearanceMode, type IconStyle } from '../app-icon';
import { readColorblind, writeColorblind } from '../pref-sync';
import {
  CUSTOM_MOUSE_BUTTONS,
  DEFAULT_CUSTOM_MOUSE_MAP,
  MOUSE_SCHEMES,
  useCustomMouseControls,
  useDefaultConstrained,
  useMouseControls,
  usePenAsMouse,
  useReverseScrollZoom,
  type CustomMouseAction,
  type CustomMouseButton,
  type CustomMouseMap,
  type MouseControlsScheme,
} from '../mouse-controls';
import { LENGTH_UNITS, useLengthUnit, type LengthUnit } from '../length-units';
import { useUpdateChannel, type UpdateChannel } from '../update-channel';
import { checkForUpdate, installPendingUpdate } from '../update-check';
import { APP_VERSION, noteText, VERSION_NOTES } from '../version-info';
import { BUILD_VERSION } from '../build-version';
import { ProjectSupport } from './ProjectSupport';
import { copyText } from '../download';
import { Icon } from './Icon';
import { LanguagePicker } from './LanguagePicker';
import { MouseControlsDiagram } from './MouseControlsDiagram';
import { IconAppearancePicker } from './IconAppearancePicker';
import './PreferencesPanel.css';

type Section = 'general' | 'controls' | 'updates' | 'about';

/**
 * The About history lists the running version's whole cycle — its first
 * beta through its final release (user request 2026-10-16) — not the old
 * fixed five-entry window, which cut a long cycle off mid-run. When the
 * next cycle's first beta ships, the list resets to that cycle; older
 * releases stay readable in the GitHub release notes.
 */
const CYCLE_BASE = APP_VERSION.replace(/-.*$/, '');
const CYCLE_NOTES = VERSION_NOTES.filter(
  (note) => note.version === CYCLE_BASE || note.version.startsWith(`${CYCLE_BASE}-`),
);

/**
 * The settings-window update check is a two-step flow (unlike the native
 * menu's one-shot check→install→relaunch): Check only queries the feed;
 * a found update surfaces an "Install and relaunch" button the user must
 * click before anything is downloaded.
 */
type UpdateCheck =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'upToDate' }
  | { kind: 'found'; version: string }
  | { kind: 'installing'; version: string }
  | { kind: 'failed' };

/** Shared settings; changes only reach other windows after Save. */
export function PreferencesPanel({ desktop, onClose, onColorblindSaved, initialSection, autoCheckUpdates }: {
  desktop: boolean;
  onClose: () => void;
  /** Fired on Save so the hosting window applies the new palette at once —
   * the Tauri broadcast only reaches windows on desktop shells. */
  onColorblindSaved?: (on: boolean) => void;
  /** Landing section — the prefs window created for updates starts there. */
  initialSection?: Section;
  /** Start the update check once on mount (the ?go=updates window). */
  autoCheckUpdates?: boolean;
}) {
  const { lang, langChoice, setLang, t } = useI18n();
  const { mode, setMode } = useTheme();
  const { mode: iconMode, style: iconStyle, systemDark, setMode: setIconMode, setStyle: setIconStyle } = useAppIcon();
  const { channel, setChannel } = useUpdateChannel();
  const [mouseControls, setMouseControls] = useMouseControls();
  const [customMouse, setCustomMouse] = useCustomMouseControls();
  const [lengthUnit, setLengthUnit] = useLengthUnit();
  const [reverseScroll, setReverseScroll] = useReverseScrollZoom();
  const [defaultConstrained, setDefaultConstrained] = useDefaultConstrained();
  const [penAsMouse, setPenAsMouse] = usePenAsMouse();
  const [section, setSection] = useState<Section>(initialSection ?? 'general');
  const [languageDraft, setLanguageDraft] = useState<LangChoice | null>(null);
  const [themeDraft, setThemeDraft] = useState<ThemeMode | null>(null);
  // Colorblind stages like every other shared setting (user request
  // 2026-10-04): the checkbox only drafts; Save persists + broadcasts.
  const [savedColorblind, setSavedColorblind] = useState(readColorblind);
  const [colorblindDraft, setColorblindDraft] = useState<boolean | null>(null);
  const [iconDraft, setIconDraft] = useState<IconAppearanceMode | null>(null);
  const [iconStyleDraft, setIconStyleDraft] = useState<IconStyle | null>(null);
  const [channelDraft, setChannelDraft] = useState<UpdateChannel | null>(null);
  const [mouseDraft, setMouseDraft] = useState<MouseControlsScheme | null>(null);
  const [customDraft, setCustomDraft] = useState<CustomMouseMap | null>(null);
  const [unitDraft, setUnitDraft] = useState<LengthUnit | null>(null);
  const [reverseDraft, setReverseDraft] = useState<boolean | null>(null);
  const [constrainedDraft, setConstrainedDraft] = useState<boolean | null>(null);
  const [penDraft, setPenDraft] = useState<boolean | null>(null);
  const [copyStatus, setCopyStatus] = useState('');
  const [updateCheck, setUpdateCheck] = useState<UpdateCheck>({ kind: 'idle' });
  const id = useId();
  const tabRefs = useRef<Partial<Record<Section, HTMLButtonElement | null>>>({});
  // The website keeps no Updates section (user request 2026-10-07): the site
  // itself is the beta channel and never self-updates, so the tab is
  // desktop-only.
  const sections: Section[] = desktop ? ['general', 'controls', 'updates', 'about'] : ['general', 'controls', 'about'];
  const language = languageDraft ?? langChoice;
  const theme = themeDraft ?? mode;
  const icon = iconDraft ?? iconMode;
  const iconStyleValue = iconStyleDraft ?? iconStyle;
  const updateChannel = channelDraft ?? channel;
  const mouse = mouseDraft ?? mouseControls;
  const customEffective = customDraft ?? customMouse;
  const unit = unitDraft ?? lengthUnit;
  const reverse = reverseDraft ?? reverseScroll;
  const constrained = constrainedDraft ?? defaultConstrained;
  const pen = penDraft ?? penAsMouse;
  const colorblind = colorblindDraft ?? savedColorblind;
  const dirty = language !== langChoice || theme !== mode || icon !== iconMode ||
    iconStyleValue !== iconStyle ||
    updateChannel !== channel || mouse !== mouseControls || unit !== lengthUnit ||
    reverse !== reverseScroll || constrained !== defaultConstrained || pen !== penAsMouse ||
    colorblind !== savedColorblind ||
    (customDraft !== null && JSON.stringify(customDraft) !== JSON.stringify(customMouse));
  const updateStatusText =
    updateCheck.kind === 'checking' ? t('prefs.checking')
      : updateCheck.kind === 'upToDate' ? t('updates.upToDate')
        : updateCheck.kind === 'found' ? t('prefs.updateAvailable', { v: updateCheck.version })
          : updateCheck.kind === 'installing' ? t('updates.downloading', { v: updateCheck.version })
            : updateCheck.kind === 'failed' ? t('updates.failed')
              : '';
  // A channel draft that differs from the saved channel does NOT steer the
  // check — say so next to the button, in the saved channel's own name.
  const savedChannelHint = channelDraft != null && channelDraft !== channel
    ? t('prefs.checkSavedChannel', { channel: t(channel === 'stable' ? 'prefs.channel.stable' : 'prefs.channel.beta') })
    : '';

  function navigate(event: KeyboardEvent<HTMLButtonElement>, current: Section) {
    const index = sections.indexOf(current);
    let next: Section | undefined;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = sections[(index + 1) % sections.length];
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = sections[(index + sections.length - 1) % sections.length];
    if (event.key === 'Home') next = sections[0];
    if (event.key === 'End') next = sections.at(-1);
    if (next) { event.preventDefault(); setSection(next); tabRefs.current[next]?.focus(); }
  }

  function startUpdateCheck() {
    // Re-entrancy guard: while a check (or an install) is in flight a second
    // click must not fire another native request.
    if (updateCheck.kind === 'checking' || updateCheck.kind === 'installing') return;
    // The check uses the SAVED channel (context value), not the draft —
    // the draft only takes effect after Save.
    setUpdateCheck({ kind: 'checking' });
    void checkForUpdate(channel, (e) => {
      if (e.kind === 'found') setUpdateCheck({ kind: 'found', version: e.version });
      else if (e.kind === 'upToDate') setUpdateCheck({ kind: 'upToDate' });
      else setUpdateCheck({ kind: 'failed' });
    });
  }

  // Landing on Updates from outside (menu "Check for Updates", user request
  // 2026-10-16). The desktop shell has two delivery paths: it creates this
  // window with ?go=updates (→ initialSection + autoCheckUpdates props) or
  // re-targets an already-open one with a shell-eval'd pb-prefs-go-updates
  // CustomEvent. The listener must survive re-renders with a fresh check
  // closure, hence the ref (same pattern as App's menuHandlersRef).
  const startUpdateCheckRef = useRef(startUpdateCheck);
  startUpdateCheckRef.current = startUpdateCheck;
  const goUpdates = useCallback(() => {
    setSection('updates');
    startUpdateCheckRef.current();
  }, []);
  useEffect(() => {
    window.addEventListener('pb-prefs-go-updates', goUpdates);
    return () => window.removeEventListener('pb-prefs-go-updates', goUpdates);
  }, [goUpdates]);
  useEffect(() => {
    // The freshly created ?go=updates window starts its check on mount…
    if (autoCheckUpdates) goUpdates();
    // …and if the shell eval'd the event into a window whose page was still
    // loading, the dispatch was lost — the __pbGoUpdates stash survives it.
    const w = window as { __pbGoUpdates?: unknown };
    if (w.__pbGoUpdates) {
      delete w.__pbGoUpdates;
      goUpdates();
    }
  }, [autoCheckUpdates, goUpdates]);

  function startInstall() {
    if (updateCheck.kind !== 'found') return;
    setUpdateCheck({ kind: 'installing', version: updateCheck.version });
    void installPendingUpdate().catch(() => setUpdateCheck({ kind: 'failed' }));
  }

  function save() {
    if (language !== langChoice) setLang(language);
    if (theme !== mode) setMode(theme);
    // Style first, then appearance: both state updates land in the same
    // commit, so the provider re-syncs the Dock tile once with the final
    // pair — no intermediate wrong-artwork flash between the two.
    if (iconStyleValue !== iconStyle) setIconStyle(iconStyleValue);
    if (icon !== iconMode) setIconMode(icon);
    if (updateChannel !== channel) {
      setChannel(updateChannel);
      // A new saved channel invalidates any result shown for the old one.
      setUpdateCheck({ kind: 'idle' });
    }
    if (mouse !== mouseControls) setMouseControls(mouse);
    if (customDraft !== null) {
      setCustomMouse(customDraft);
      setCustomDraft(null); // deep-compared against the store, so drop it once saved
    }
    if (unit !== lengthUnit) setLengthUnit(unit);
    if (reverse !== reverseScroll) setReverseScroll(reverse);
    if (constrained !== defaultConstrained) setDefaultConstrained(constrained);
    if (pen !== penAsMouse) setPenAsMouse(pen);
    if (colorblind !== savedColorblind) {
      writeColorblind(colorblind);
      setSavedColorblind(colorblind);
      onColorblindSaved?.(colorblind);
    }
    // Save keeps the window open (user request 2026-10-02): drafts become
    // current, dirty clears, and the user closes via Cancel/Escape/⌘W when
    // done — matching System Settings' persist-in-place behavior.
  }

  return <div className="preferences-panel" tabIndex={-1} onKeyDown={(event) => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
  }}>
    <aside className="preferences-sidebar">
      <h1>{t('prefs.title')}</h1>
      <div className="preferences-nav" role="tablist" aria-label={t('prefs.title')}>
        {sections.map((item) => <button key={item} ref={(element) => { tabRefs.current[item] = element; }}
          type="button" role="tab" id={`${id}-${item}-tab`} aria-controls={`${id}-${item}-panel`}
          aria-selected={section === item} tabIndex={section === item ? 0 : -1}
          onClick={() => setSection(item)} onKeyDown={(event) => navigate(event, item)}>
          <Icon name={item === 'general' ? 'settings' : item === 'controls' ? 'mouse' : item === 'updates' ? 'refresh' : 'info'} size={17} />
          {t(`prefs.section.${item}`)}
        </button>)}
      </div>
    </aside>
    <div className="preferences-main">
      <section className="preferences-content" role="tabpanel" tabIndex={0}
        key={section} id={`${id}-${section}-panel`} aria-labelledby={`${id}-${section}-tab`}>
        <header className="preferences-heading"><h2>{t(`prefs.section.${section}`)}</h2></header>
        {section === 'general' && <>
          <div className="preferences-group preferences-language-group">
            <div className="preferences-setting">
              <span id={`${id}-language-label`}>{t('prefs.language')}</span>
              <LanguagePicker value={language} onChange={setLanguageDraft} labelledBy={`${id}-language-label`} />
            </div>
          </div>
          <fieldset className="preferences-appearance"><legend>{t('prefs.theme')}</legend>
            <div className="preferences-theme-options">
              {(['system', 'light', 'dark'] as const).map((choice) => <label key={choice} className="preferences-theme-choice">
                <input type="radio" name={`${id}-theme`} value={choice} checked={theme === choice} onChange={() => setThemeDraft(choice)} />
                <span className={`preferences-theme-preview ${choice}`} aria-hidden="true"><i /><b /><b /></span>
                <span>{t(`theme.${choice}`)}</span>
              </label>)}
            </div>
          </fieldset>
          {desktop && <IconAppearancePicker value={icon} onChange={setIconDraft}
            style={iconStyleValue} onStyleChange={setIconStyleDraft} />}
          <label className="preferences-setting preferences-checkbox">
            <span>{t('prefs.colorblind')}</span>
            <input type="checkbox" checked={colorblind} onChange={(e) => setColorblindDraft(e.target.checked)} />
          </label>
        </>}
        {section === 'controls' && <>
          <div className="preferences-group preferences-units-group">
            <div className="preferences-setting"><span id={`${id}-units-label`}>{t('prefs.units')}</span>
              <SelectControl aria-labelledby={`${id}-units-label`} value={unit} onValueChange={(value) => setUnitDraft(value as LengthUnit)}>
                {lengthUnit === 'ftin' && <option value="ftin" hidden disabled>{t('prefs.unit.ftin')}</option>}
                {LENGTH_UNITS.map((choice) => <option key={choice} value={choice}>{t(`prefs.unit.${choice}`)}</option>)}
              </SelectControl>
            </div>
          </div>
          <div className="preferences-group preferences-mouse-group">
            <div className="preferences-setting"><span id={`${id}-mouse-label`}>{t('prefs.mouseControls')}</span>
              <SelectControl aria-labelledby={`${id}-mouse-label`} value={mouse} onValueChange={(value) => setMouseDraft(value as MouseControlsScheme)}>
                {MOUSE_SCHEMES.map((choice) => <option key={choice} value={choice}>{t(`prefs.mouse.${choice}`)}</option>)}
              </SelectControl>
            </div>
            <MouseControlsDiagram scheme={mouse} iconMode={icon} iconStyle={iconStyleValue} constrained={constrained} custom={customEffective} />
            {mouse === 'custom'
              ? <CustomMouseEditor
                  map={customEffective}
                  onChange={(button, action) => setCustomDraft({ ...customEffective, [button]: action })}
                  onReset={() => setCustomDraft({ ...DEFAULT_CUSTOM_MOUSE_MAP })}
                />
              : <details className="preferences-mouse-details"><summary>{t('prefs.mouse.shortcuts')}</summary>
            <div className="preferences-mouse-table">
              {(mouse === 'solidworks'
                // SOLIDWORKS: Alt+middle is Roll View (its own row); the
                // constrained checkbox only re-tunes plain middle drag.
                ? [
                  { label: constrained ? 'prefs.mouse.constrained' : 'prefs.mouse.rotate', bind: 'prefs.mouse.solidworks.rotate' },
                  { label: 'prefs.mouse.roll', bind: 'prefs.mouse.solidworks.roll' },
                  { label: 'prefs.mouse.pan', bind: 'prefs.mouse.solidworks.pan' },
                  { label: 'prefs.mouse.zoom', bind: 'prefs.mouse.solidworks.zoom' },
                ] as const
                // Onshape: the constrained checkbox swaps the plain/Alt rows.
                : [
                  { label: constrained ? 'prefs.mouse.constrained' : 'prefs.mouse.rotate', bind: 'prefs.mouse.onshape.rotate' },
                  { label: constrained ? 'prefs.mouse.rotate' : 'prefs.mouse.constrained', bind: 'prefs.mouse.onshape.constrained' },
                  { label: 'prefs.mouse.pan', bind: 'prefs.mouse.onshape.pan' },
                  { label: 'prefs.mouse.zoom', bind: 'prefs.mouse.onshape.zoom' },
                ] as const
              ).map((row) => <div key={row.bind} className="preferences-mouse-row">
                <span>{t(row.label)}</span>
                <strong>{t(row.bind)}</strong>
              </div>)}
            </div></details>}
            <div className="preferences-mouse-options">
            <label className="preferences-setting preferences-checkbox">
              <span>{t('prefs.mouse.reverseScroll')}</span>
              <input type="checkbox" checked={reverse} onChange={(event) => setReverseDraft(event.target.checked)} />
            </label>
            {/* The constrained-rotate default only steers the presets; in the
                custom scheme constrained rotation is a directly assignable
                action, so the checkbox would do nothing there. */}
            {mouse !== 'custom' && <label className="preferences-setting preferences-checkbox">
              <span>{t('prefs.mouse.defaultConstrained')}</span>
              <input type="checkbox" checked={constrained} onChange={(event) => setConstrainedDraft(event.target.checked)} />
            </label>}
            <label className="preferences-setting preferences-checkbox">
              <span>{t('prefs.mouse.penAsMouse')}</span>
              <input type="checkbox" checked={pen} onChange={(event) => setPenDraft(event.target.checked)} />
            </label></div>
          </div>

        </>}
        {section === 'updates' && <div className="preferences-group">
          <div className="preferences-setting"><span id={`${id}-channel-label`}>{t('prefs.channel')}</span>
            <SelectControl aria-labelledby={`${id}-channel-label`} value={updateChannel} onValueChange={(value) => setChannelDraft(value as UpdateChannel)}>
              <option value="stable">{t('prefs.channel.stable')}</option><option value="beta">{t('prefs.channel.beta')}</option>
            </SelectControl>
          </div>
          <div className="preferences-update-check">
            <div className="update-actions">
              <button type="button" className="btn accent" disabled={updateCheck.kind === 'checking' || updateCheck.kind === 'installing'}
                aria-describedby={`${id}-update-status`} onClick={startUpdateCheck}><Icon name="refresh" size={15} />{t('prefs.checkUpdates')}</button>
              {updateCheck.kind === 'found' &&
                <button type="button" className="btn" onClick={startInstall}>{t('prefs.installUpdate')}</button>}
            </div>
            <p id={`${id}-update-status`} role="status">{updateStatusText}</p>
            {savedChannelHint && <p>{savedChannelHint}</p>}
          </div>
        </div>}
        {section === 'about' && <>
          <div className="preferences-product"><div className="preferences-product-title"><strong>PathBlender</strong><img
            className="preferences-product-icon" alt="" width="72" height="72"
            src={(icon === 'system' ? systemDark : icon === 'dark')
              ? ICON_STYLE_ARTWORK[iconStyleValue].dark
              : ICON_STYLE_ARTWORK[iconStyleValue].light} />
          </div><span className="preferences-version" dir="ltr">{BUILD_VERSION}</span>
            <button className="btn" type="button" onClick={() => {
              void copyText(BUILD_VERSION)
                .then((ok) => setCopyStatus(t(ok ? 'about.copyDone' : 'about.copyFailed')));
            }}>{t('about.copy')}</button>
            <p className="preferences-copy-status" role="status">{copyStatus}</p>
          </div>
          <ProjectSupport />
          {CYCLE_NOTES.length > 0 && <div className="preferences-history"><h3>{t('prefs.releaseNotes')}</h3>
            {/* Resolved `lang`, not the raw choice: 'system' hits no note
                key, so Follow-system readers would fall to the zh default. */}
            <ol>{CYCLE_NOTES.map((note) => <li key={note.version}>
              <div><strong dir="ltr">Version {note.version}</strong><time>{note.date}</time></div><p>{noteText(note.note, lang)}</p>
            </li>)}</ol>
          </div>}
        </>}
      </section>
      {/* About holds nothing editable (user request 2026-10-07): no footer
         buttons there — General/Controls/Updates keep the staging pair. */}
      {section !== 'about' && <footer className="preferences-footer"><span className="preferences-save-hint">{dirty ? t('prefs.unsaved') : ''}</span>
        <div><button type="button" className="btn" onClick={onClose}>{t('prefs.cancel')}</button>
          <button type="button" className="btn accent" disabled={!dirty} onClick={save}>{t('prefs.save')}</button></div>
      </footer>}
    </div>
  </div>;
}

/** The six actions a custom drag button can hold (option order = table order). */
const CUSTOM_ACTIONS: CustomMouseAction[] = ['rotate', 'constrained', 'pan', 'zoom', 'roll', 'none'];

/**
 * Assignment rows for the custom scheme: one select per drag button
 * (user request 2026-10-07 — a per-modifier matrix read as too complex).
 * Modifier combos are fixed rules, stated below the rows rather than
 * edited; the wheel has no row on purpose: it always zooms and only its
 * direction reverses via the existing checkbox.
 */
function CustomMouseEditor({ map, onChange, onReset }: {
  map: CustomMouseMap;
  onChange: (button: CustomMouseButton, action: CustomMouseAction) => void;
  onReset: () => void;
}) {
  const { t } = useI18n();
  const caption = t('prefs.mouse.custom.editor');
  return <div className="preferences-mouse-custom">
    <p className="preferences-mouse-custom-caption">{caption}</p>
    <div className="preferences-mouse-custom-grid" role="group" aria-label={caption}>
      {CUSTOM_MOUSE_BUTTONS.map((button) => <div key={button} className="preferences-mouse-custom-row">
        <span>{t(`prefs.mouse.btn.${button}`)}</span>
        <SelectControl className="preferences-mouse-custom-select" value={map[button]}
          aria-label={t('prefs.mouse.custom.buttonAria', { button: t(`prefs.mouse.btn.${button}`) })}
          onValueChange={(value) => onChange(button, value as CustomMouseAction)}>
          {CUSTOM_ACTIONS.map((action) => <option key={action} value={action}>{t(`prefs.mouse.${action}`)}</option>)}
        </SelectControl>
      </div>)}
    </div>
    <p className="preferences-setting-description">{t('prefs.mouse.custom.derived')}</p>
    <p className="preferences-setting-description">{t('prefs.mouse.custom.wheelNote')}</p>
    <button type="button" className="btn preferences-mouse-custom-reset" onClick={onReset}>{t('prefs.mouse.custom.reset')}</button>
  </div>;
}
