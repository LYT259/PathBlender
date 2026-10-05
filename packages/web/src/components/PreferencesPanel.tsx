import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { LANGUAGES, langLabel, useI18n, type LangChoice } from '../i18n';
import { useTheme, type ThemeMode } from '../theme';
import { useAppIcon, type IconAppearanceMode } from '../app-icon';
import { readColorblind, writeColorblind } from '../pref-sync';
import {
  MOUSE_SCHEMES,
  useDefaultConstrained,
  useMouseControls,
  usePenAsMouse,
  useReverseScrollZoom,
  type MouseControlsScheme,
} from '../mouse-controls';
import { LENGTH_UNITS, lengthUnitExample, useLengthUnit, type LengthUnit } from '../length-units';
import { useUpdateChannel, type UpdateChannel } from '../update-channel';
import { checkForUpdate, installPendingUpdate } from '../update-check';
import { APP_VERSION, noteText, VERSION_NOTES } from '../version-info';
import { copyText } from '../download';
import { VIEWER_ONLY, SITE_PREVIEW, SITE_URLS } from '../viewer';
import { Icon } from './Icon';
import { MouseControlsDiagram } from './MouseControlsDiagram';
import { IconAppearancePicker } from './IconAppearancePicker';
import './PreferencesPanel.css';

type Section = 'general' | 'controls' | 'updates' | 'about';

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
export function PreferencesPanel({ desktop, onClose, onColorblindSaved }: {
  desktop: boolean;
  onClose: () => void;
  /** Fired on Save so the hosting window applies the new palette at once —
   * the Tauri broadcast only reaches windows on desktop shells. */
  onColorblindSaved?: (on: boolean) => void;
}) {
  const { langChoice, setLang, t } = useI18n();
  const { mode, setMode } = useTheme();
  const { mode: iconMode, setMode: setIconMode } = useAppIcon();
  const { channel, setChannel } = useUpdateChannel();
  const [mouseControls, setMouseControls] = useMouseControls();
  const [lengthUnit, setLengthUnit] = useLengthUnit();
  const [reverseScroll, setReverseScroll] = useReverseScrollZoom();
  const [defaultConstrained, setDefaultConstrained] = useDefaultConstrained();
  const [penAsMouse, setPenAsMouse] = usePenAsMouse();
  const [section, setSection] = useState<Section>('general');
  const [languageDraft, setLanguageDraft] = useState<LangChoice | null>(null);
  const [themeDraft, setThemeDraft] = useState<ThemeMode | null>(null);
  // Colorblind stages like every other shared setting (user request
  // 2026-10-04): the checkbox only drafts; Save persists + broadcasts.
  const [savedColorblind, setSavedColorblind] = useState(readColorblind);
  const [colorblindDraft, setColorblindDraft] = useState<boolean | null>(null);
  const [iconDraft, setIconDraft] = useState<IconAppearanceMode | null>(null);
  const [channelDraft, setChannelDraft] = useState<UpdateChannel | null>(null);
  const [mouseDraft, setMouseDraft] = useState<MouseControlsScheme | null>(null);
  const [unitDraft, setUnitDraft] = useState<LengthUnit | null>(null);
  const [reverseDraft, setReverseDraft] = useState<boolean | null>(null);
  const [constrainedDraft, setConstrainedDraft] = useState<boolean | null>(null);
  const [penDraft, setPenDraft] = useState<boolean | null>(null);
  const [copyStatus, setCopyStatus] = useState('');
  const [updateCheck, setUpdateCheck] = useState<UpdateCheck>({ kind: 'idle' });
  const id = useId();
  const tabRefs = useRef<Partial<Record<Section, HTMLButtonElement | null>>>({});
  const sections: Section[] = desktop || VIEWER_ONLY ? ['general', 'controls', 'updates', 'about'] : ['general', 'controls', 'about'];
  const language = languageDraft ?? langChoice;
  const theme = themeDraft ?? mode;
  const icon = iconDraft ?? iconMode;
  const updateChannel = channelDraft ?? channel;
  const mouse = mouseDraft ?? mouseControls;
  const unit = unitDraft ?? lengthUnit;
  const reverse = reverseDraft ?? reverseScroll;
  const constrained = constrainedDraft ?? defaultConstrained;
  const pen = penDraft ?? penAsMouse;
  const colorblind = colorblindDraft ?? savedColorblind;
  const dirty = language !== langChoice || theme !== mode || icon !== iconMode ||
    updateChannel !== channel || mouse !== mouseControls || unit !== lengthUnit ||
    reverse !== reverseScroll || constrained !== defaultConstrained || pen !== penAsMouse ||
    colorblind !== savedColorblind;
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

  function startInstall() {
    if (updateCheck.kind !== 'found') return;
    setUpdateCheck({ kind: 'installing', version: updateCheck.version });
    void installPendingUpdate().catch(() => setUpdateCheck({ kind: 'failed' }));
  }

  function save() {
    if (language !== langChoice) setLang(language);
    if (theme !== mode) setMode(theme);
    if (icon !== iconMode) setIconMode(icon);
    if (updateChannel !== channel) {
      setChannel(updateChannel);
      // A new saved channel invalidates any result shown for the old one.
      setUpdateCheck({ kind: 'idle' });
    }
    if (mouse !== mouseControls) setMouseControls(mouse);
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

  return <div className="preferences-panel" onKeyDown={(event) => {
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
          <div className="preferences-group"><label className="preferences-setting">
            <span>{t('prefs.language')}</span>
            <select value={language} onChange={(event) => setLanguageDraft(event.target.value as LangChoice)}>
              {LANGUAGES.map((choice) => <option key={choice} value={choice}>{choice === 'system' ? t('prefs.langSystem') : langLabel(choice)}</option>)}
            </select>
          </label></div>
          <fieldset className="preferences-appearance"><legend>{t('prefs.theme')}</legend>
            <div className="preferences-theme-options">
              {(['system', 'light', 'dark'] as const).map((choice) => <label key={choice} className="preferences-theme-choice">
                <input type="radio" name={`${id}-theme`} value={choice} checked={theme === choice} onChange={() => setThemeDraft(choice)} />
                <span className={`preferences-theme-preview ${choice}`} aria-hidden="true"><i /><b /><b /></span>
                <span>{t(`theme.${choice}`)}</span>
              </label>)}
            </div>
          </fieldset>
          {desktop && <IconAppearancePicker value={icon} onChange={setIconDraft} />}
          <label className="preferences-setting">
            <span>{t('prefs.colorblind')}</span>
            <input type="checkbox" checked={colorblind} onChange={(e) => setColorblindDraft(e.target.checked)} />
          </label>
          <p className="preferences-setting-description">{t('prefs.colorblindHint')}</p>
        </>}
        {section === 'controls' && <>
          <div className="preferences-group preferences-units-group">
            <label className="preferences-setting"><span>{t('prefs.units')}</span>
              <select value={unit} onChange={(event) => setUnitDraft(event.target.value as LengthUnit)}>
                {lengthUnit === 'ftin' && <option value="ftin" hidden disabled>{t('prefs.unit.ftin')}</option>}
                {LENGTH_UNITS.map((choice) => <option key={choice} value={choice}>{t(`prefs.unit.${choice}`)}</option>)}
              </select>
            </label>
            <p className="preferences-setting-description">{`${t('prefs.units.hint')} ${lengthUnitExample(unit)}`}</p>
          </div>
          <div className="preferences-group preferences-mouse-group">
            <label className="preferences-setting"><span>{t('prefs.mouseControls')}</span>
              <select value={mouse} onChange={(event) => setMouseDraft(event.target.value as MouseControlsScheme)}>
                {MOUSE_SCHEMES.map((choice) => <option key={choice} value={choice}>{t(`prefs.mouse.${choice}`)}</option>)}
              </select>
            </label>
            <MouseControlsDiagram scheme={mouse} iconMode={icon} constrained={constrained} />
            <details className="preferences-mouse-details"><summary>{t('prefs.mouse.shortcuts')}</summary>
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
            </div></details>
            <div className="preferences-mouse-options">
            <label className="preferences-setting preferences-checkbox">
              <span>{t('prefs.mouse.reverseScroll')}</span>
              <input type="checkbox" checked={reverse} onChange={(event) => setReverseDraft(event.target.checked)} />
            </label>
            <label className="preferences-setting preferences-checkbox">
              <span>{t('prefs.mouse.defaultConstrained')}</span>
              <input type="checkbox" checked={constrained} onChange={(event) => setConstrainedDraft(event.target.checked)} />
            </label>
            <label className="preferences-setting preferences-checkbox">
              <span>{t('prefs.mouse.penAsMouse')}</span>
              <input type="checkbox" checked={pen} onChange={(event) => setPenDraft(event.target.checked)} />
            </label></div>
          </div>

        </>}
        {section === 'updates' && <>
          {desktop ? <div className="preferences-group">
            <label className="preferences-setting"><span>{t('prefs.channel')}</span>
              <select value={updateChannel} onChange={(event) => setChannelDraft(event.target.value as UpdateChannel)}>
                <option value="stable">{t('prefs.channel.stable')}</option><option value="beta">{t('prefs.channel.beta')}</option>
              </select>
            </label>
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
          </div> : <div className="preferences-group"><div className="preferences-setting"><span>{t('site.version')}</span>
            <a className="prefs-link" href={SITE_PREVIEW ? SITE_URLS.stable : SITE_URLS.preview} target="_blank" rel="noopener noreferrer">{t(SITE_PREVIEW ? 'site.backStable' : 'site.tryPreview')} ↗</a>
          </div></div>}
        </>}
        {section === 'about' && <>
          <div className="preferences-product"><strong>PathBlender</strong><span className="preferences-version" dir="ltr">Version {APP_VERSION}</span>
            <button className="btn" type="button" onClick={() => {
              void copyText(`PathBlender ${APP_VERSION} (${desktop ? 'desktop' : 'web'})\n` + VERSION_NOTES.slice(0, 5).map((note) => `${note.version} (${note.date}) — ${noteText(note.note, langChoice)}`).join('\n'))
                .then((ok) => setCopyStatus(t(ok ? 'about.copyDone' : 'about.copyFailed')));
            }}>{t('about.copy')}</button>
            <p className="preferences-copy-status" role="status">{copyStatus}</p>
          </div>
          {VERSION_NOTES.length > 0 && <div className="preferences-history"><h3>{t('prefs.releaseNotes')}</h3>
            <ol>{VERSION_NOTES.slice(0, 5).map((note) => <li key={note.version}>
              <div><strong dir="ltr">Version {note.version}</strong><time>{note.date}</time></div><p>{noteText(note.note, langChoice)}</p>
            </li>)}</ol>
          </div>}
        </>}
      </section>
      <footer className="preferences-footer"><span className="preferences-save-hint">{dirty ? t('prefs.unsaved') : ''}</span>
        <div><button type="button" className="btn" onClick={onClose}>{t('prefs.cancel')}</button>
          <button type="button" className="btn accent" disabled={!dirty} onClick={save}>{t('prefs.save')}</button></div>
      </footer>
    </div>
  </div>;
}
