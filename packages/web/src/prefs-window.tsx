/**
 * The desktop ⌘, Preferences window body (`index.html?window=prefs`).
 *
 * Split out of `main.tsx` on 2026-09-24 so it can be rendered in a test:
 * main.tsx mounts eagerly into #root, which jsdom cannot import.
 *
 * */

import { LANGUAGES, langLabel, useI18n, type LangChoice } from './i18n';
import { useTheme, type ThemeMode } from './theme';
import { useUpdateChannel } from './update-channel';

export function PrefsWindow() {
  const { langChoice, setLang, t } = useI18n();
  return (
    <div className="prefs-only">
      <div className="prefs-modal static tall">
        <h3>{t('prefs.title')}</h3>
        <label className="prefs-row">
          <span>{t('prefs.language')}</span>
          <select value={langChoice} onChange={(e) => setLang(e.target.value as LangChoice)}>
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {l === 'system' ? t('prefs.langSystem') : langLabel(l)}
              </option>
            ))}
          </select>
        </label>
        <ThemeRow />
        <ChannelRow />
      </div>
    </div>
  );
}

function ChannelRow() {
  const { channel, setChannel } = useUpdateChannel();
  const { t } = useI18n();
  return (
    <label className="prefs-row">
      <span>{t('prefs.channel')}</span>
      <select value={channel} onChange={(e) => setChannel(e.target.value as 'stable' | 'beta')}>
        <option value="stable">{t('prefs.channel.stable')}</option>
        <option value="beta">{t('prefs.channel.beta')}</option>
      </select>
    </label>
  );
}

function ThemeRow() {
  const { mode, setMode } = useTheme();
  const { t } = useI18n();
  return (
    <label className="prefs-row">
      <span>{t('prefs.theme')}</span>
      <select value={mode} onChange={(e) => setMode(e.target.value as ThemeMode)}>
        <option value="system">{t('theme.system')}</option>
        <option value="dark">{t('theme.dark')}</option>
        <option value="light">{t('theme.light')}</option>
      </select>
    </label>
  );
}
