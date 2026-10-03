import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { LANGUAGES, langLabel, useI18n, type LangChoice } from '../i18n';
import { useTheme, type ThemeMode } from '../theme';
import {
  MOUSE_SCHEMES,
  useMouseControls,
  type MouseControlsScheme,
} from '../mouse-controls';
import { lengthUnitExample, LENGTH_UNITS, useLengthUnit, type LengthUnit } from '../length-units';
import { useUpdateChannel, type UpdateChannel } from '../update-channel';
import { APP_VERSION, VERSION_NOTES } from '../version-info';
import { formatVersionDisplay } from '../version';
import { copyText } from '../download';
import { VIEWER_ONLY, SITE_PREVIEW, SITE_URLS } from '../viewer';
import { Icon } from './Icon';
import { IconAppearancePicker, type IconAppearanceMode } from './IconAppearancePicker';
import './PreferencesPanel.css';

type Section = 'general' | 'updates' | 'about';

/** Shared settings; changes only reach other windows after Save. */
export function PreferencesPanel({ desktop, onClose }: { desktop: boolean; onClose: () => void }) {
  const { langChoice, setLang, t } = useI18n();
  const { mode, setMode } = useTheme();
  const { channel, setChannel } = useUpdateChannel();
  const [mouseControls, setMouseControls] = useMouseControls();
  const [lengthUnit, setLengthUnit] = useLengthUnit();
  const [section, setSection] = useState<Section>('general');
  const [languageDraft, setLanguageDraft] = useState<LangChoice | null>(null);
  const [themeDraft, setThemeDraft] = useState<ThemeMode | null>(null);
  const [channelDraft, setChannelDraft] = useState<UpdateChannel | null>(null);
  const [mouseDraft, setMouseDraft] = useState<MouseControlsScheme | null>(null);
  const [unitDraft, setUnitDraft] = useState<LengthUnit | null>(null);
  // UI-only preview: intentionally excluded from Save/dirty and native effects.
  // The implementation task will replace this with an independent saved preference.
  const [iconPreview, setIconPreview] = useState<IconAppearanceMode>('system');
  const [copyStatus, setCopyStatus] = useState('');
  const id = useId();
  const tabRefs = useRef<Partial<Record<Section, HTMLButtonElement | null>>>({});
  const sections: Section[] = desktop || VIEWER_ONLY ? ['general', 'updates', 'about'] : ['general', 'about'];
  const language = languageDraft ?? langChoice;
  const theme = themeDraft ?? mode;
  const updateChannel = channelDraft ?? channel;
  const mouse = mouseDraft ?? mouseControls;
  const unit = unitDraft ?? lengthUnit;
  const dirty = language !== langChoice || theme !== mode || updateChannel !== channel ||
    mouse !== mouseControls || unit !== lengthUnit;

  function navigate(event: KeyboardEvent<HTMLButtonElement>, current: Section) {
    const index = sections.indexOf(current);
    let next: Section | undefined;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = sections[(index + 1) % sections.length];
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = sections[(index + sections.length - 1) % sections.length];
    if (event.key === 'Home') next = sections[0];
    if (event.key === 'End') next = sections.at(-1);
    if (next) { event.preventDefault(); setSection(next); tabRefs.current[next]?.focus(); }
  }

  function save() {
    if (language !== langChoice) setLang(language);
    if (theme !== mode) setMode(theme);
    if (updateChannel !== channel) setChannel(updateChannel);
    if (mouse !== mouseControls) setMouseControls(mouse);
    if (unit !== lengthUnit) setLengthUnit(unit);
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
          <Icon name={item === 'general' ? 'settings' : item === 'updates' ? 'refresh' : 'info'} size={17} />
          {t(`prefs.section.${item}`)}
        </button>)}
      </div>
    </aside>
    <div className="preferences-main">
      <section className="preferences-content" role="tabpanel" tabIndex={0}
        key={section} id={`${id}-${section}-panel`} aria-labelledby={`${id}-${section}-tab`}>
        <header className="preferences-heading"><h2>{t(`prefs.section.${section}`)}</h2><p>{t(`prefs.description.${section}`)}</p></header>
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
          {desktop && <IconAppearancePicker value={iconPreview} onChange={setIconPreview} />}
          <div className="preferences-group">
            <label className="preferences-setting"><span>{t('prefs.mouseControls')}</span>
              <select value={mouse} onChange={(event) => setMouseDraft(event.target.value as MouseControlsScheme)}>
                {MOUSE_SCHEMES.map((choice) => <option key={choice} value={choice}>{t(`prefs.mouse.${choice}`)}</option>)}
              </select>
            </label>
            <p className="preferences-setting-description">{t('prefs.mouse.hint')}</p>
            <table className="preferences-mouse-table"><caption className="sr-only">{t('prefs.mouse.table')}</caption><tbody>
              {(['left', 'middle', 'right', 'wheel'] as const).map((button) => <tr key={button}>
                <th scope="row">{t(`prefs.mouse.btn.${button}`)}</th>
                <td>{t(`prefs.mouse.${mouse}.${button}`)}</td>
              </tr>)}
            </tbody></table>
          </div>
          <div className="preferences-group">
            <label className="preferences-setting"><span>{t('prefs.units')}</span>
              <select value={unit} onChange={(event) => setUnitDraft(event.target.value as LengthUnit)}>
                {LENGTH_UNITS.map((choice) => <option key={choice} value={choice}>{t(`prefs.unit.${choice}`)}</option>)}
              </select>
            </label>
            <p className="preferences-setting-description">{t('prefs.units.hint')}: {lengthUnitExample(unit)}</p>
          </div>
        </>}
        {section === 'updates' && <>
          {desktop ? <div className="preferences-group">
            <label className="preferences-setting"><span>{t('prefs.channel')}</span>
              <select value={updateChannel} onChange={(event) => setChannelDraft(event.target.value as UpdateChannel)}>
                <option value="stable">{t('prefs.channel.stable')}</option><option value="beta">{t('prefs.channel.beta')}</option>
              </select>
            </label>
            <p className="preferences-setting-description">{t(updateChannel === 'stable' ? 'prefs.stableHint' : 'prefs.betaHint')}</p>
          </div> : <div className="preferences-group"><div className="preferences-setting"><span>{t('site.version')}</span>
            <a className="prefs-link" href={SITE_PREVIEW ? SITE_URLS.stable : SITE_URLS.preview} target="_blank" rel="noopener noreferrer">{t(SITE_PREVIEW ? 'site.backStable' : 'site.tryPreview')} ↗</a>
          </div></div>}
          <p className="preferences-current-version">{t('about.version')} <strong>{formatVersionDisplay(APP_VERSION)}</strong></p>
        </>}
        {section === 'about' && <>
          <div className="preferences-product"><strong>PathBlender</strong><span>{formatVersionDisplay(APP_VERSION)}</span><code>{APP_VERSION}</code>
            <button className="btn" type="button" onClick={() => {
              void copyText(`PathBlender ${APP_VERSION} (${desktop ? 'desktop' : 'web'})\n` + VERSION_NOTES.slice(0, 5).map((note) => `${note.version} (${note.date}) — ${note.note}`).join('\n'))
                .then((ok) => setCopyStatus(t(ok ? 'about.copyDone' : 'about.copyFailed')));
            }}>{t('about.copy')}</button>
            <p className="preferences-copy-status" role="status">{copyStatus}</p>
          </div>
          {VERSION_NOTES.length > 0 && <div className="preferences-history"><h3>{t('prefs.releaseNotes')}</h3>
            <ol>{VERSION_NOTES.slice(0, 5).map((note) => <li key={note.version}>
              <div><strong>{formatVersionDisplay(note.version)}</strong><time dateTime={note.date}>{note.date}</time></div><p>{note.note}</p>
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
