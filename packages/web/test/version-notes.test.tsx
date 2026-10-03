import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PreferencesPanel } from '../src/components/PreferencesPanel';
import { I18nProvider } from '../src/i18n';
import { ThemeProvider } from '../src/theme';
import { UpdateChannelProvider } from '../src/update-channel';
import { AppIconProvider } from '../src/app-icon';
import { NOTE_LANGS, noteText, VERSION_NOTES } from '../src/version-info';

/**
 * Update-note i18n discipline (AGENTS.md 2026-10-03): the registry carries
 * every shipped UI language, dates use the YYYY.MM.DD form, and the newest
 * entry must ship ALL languages — bump-version.mjs writes English only, so
 * a bump whose translations were not filled in the same commit fails here.
 */

describe('version notes registry', () => {
  it('uses the dotted date form on every entry', () => {
    expect(VERSION_NOTES.length).toBeGreaterThan(10);
    for (const note of VERSION_NOTES) {
      expect(note.date, note.version).toMatch(/^\d{4}\.\d{2}\.\d{2}$/);
    }
  });

  it('every entry has a non-empty English note', () => {
    for (const note of VERSION_NOTES) {
      expect(note.note.en?.trim(), note.version).not.toBe('');
    }
  });

  it('the newest entry ships every UI language', () => {
    const newest = VERSION_NOTES[0];
    for (const lang of NOTE_LANGS) {
      expect(newest.note[lang]?.trim(), `${newest.version}:${lang}`).not.toBe('');
    }
  });

  it('has unique versions, newest first', () => {
    const versions = VERSION_NOTES.map((n) => n.version);
    expect(new Set(versions).size).toBe(versions.length);
    // 0.1.7-beta.6 is the newest shipped entry right now.
    expect(versions[0]).toBe('0.1.7-beta.6');
  });
});

describe('noteText fallback chain', () => {
  it('Hong Kong reads the Taiwan wording', () => {
    const note = { en: 'EN', zh: 'ZH', 'zh-tw': 'ZT' };
    expect(noteText(note, 'zh-hk')).toBe('ZT');
  });

  it('a missing language falls back to Simplified Chinese, then English', () => {
    const note = { en: 'EN', zh: 'ZH' };
    expect(noteText(note, 'fr')).toBe('ZH');
    expect(noteText({ en: 'EN' }, 'fr')).toBe('EN');
  });
});

describe('About section localizes the update notes', () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  function renderAbout(lang: string) {
    localStorage.setItem('pb.lang', lang);
    render(
      <ThemeProvider>
        <AppIconProvider>
          <UpdateChannelProvider>
            <I18nProvider>
              <PreferencesPanel desktop={false} onClose={() => {}} />
            </I18nProvider>
          </UpdateChannelProvider>
        </AppIconProvider>
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole('tab', { name: /about|关于/i }));
  }

  it('shows the Chinese note when the UI language is Chinese', () => {
    renderAbout('zh');
    expect(screen.getByText('删除设置里应用图标下方的提示行——图标选项保持不变')).toBeInTheDocument();
    expect(screen.queryByText(/Removed the app icon hint line/)).not.toBeInTheDocument();
  });

  it('shows the English note when the UI language is English', () => {
    renderAbout('en');
    expect(screen.getByText('Removed the app icon hint line in Settings — the icon choices stay')).toBeInTheDocument();
    expect(screen.queryByText('删除设置里应用图标下方的提示行')).not.toBeInTheDocument();
  });

  it('renders the dotted date form', () => {
    renderAbout('en');
    expect(screen.getAllByText('2026.10.03').length).toBeGreaterThan(0);
    expect(screen.queryByText('2026-10-03')).not.toBeInTheDocument();
  });
});
