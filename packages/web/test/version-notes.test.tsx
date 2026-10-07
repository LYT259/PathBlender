import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PreferencesPanel } from '../src/components/PreferencesPanel';
import { I18nProvider } from '../src/i18n';
import { ThemeProvider } from '../src/theme';
import { UpdateChannelProvider } from '../src/update-channel';
import { AppIconProvider } from '../src/app-icon';
import { APP_VERSION, NOTE_LANGS, noteText, VERSION_NOTES } from '../src/version-info';

/**
 * Update-note i18n discipline (2026-10-03): the registry carries
 * every shipped UI language, dates use the YYYY.MM.DD form, and EVERY entry
 * must ship ALL languages — bump-version.mjs writes English only, so a bump
 * whose translations were not filled in the same commit fails here.
 *
 * Scope hardening (2026-10-04): this check used to cover only the newest
 * entry, so once any newer entry landed, an older incomplete entry passed
 * forever. v0.1.7-beta.14 slipped through exactly that way — the tag's CI
 * checks job caught it (release never published), but the broken entry sat
 * on beta unnoticed. Now every entry is held to the full language set.
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

  it('every entry ships every UI language, not just the newest', () => {
    for (const note of VERSION_NOTES) {
      for (const lang of NOTE_LANGS) {
        expect(note.note[lang]?.trim() ?? '', `${note.version}:${lang}`).not.toBe('');
      }
    }
  });

  it('has unique versions with the shipped version first', () => {
    const versions = VERSION_NOTES.map((n) => n.version);
    expect(new Set(versions).size).toBe(versions.length);
    expect(versions[0]).toBe(APP_VERSION);
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
    const { zh, en } = VERSION_NOTES[0].note;
    expect(zh).toBeTruthy();
    expect(zh).not.toBe(en);
    expect(screen.getByText(zh!)).toBeInTheDocument();
    expect(screen.queryByText(en)).not.toBeInTheDocument();
  });

  it('shows the English note when the UI language is English', () => {
    renderAbout('en');
    const { zh, en } = VERSION_NOTES[0].note;
    expect(screen.getByText(en)).toBeInTheDocument();
    expect(screen.queryByText(zh!)).not.toBeInTheDocument();
  });

  it('renders the dotted date form', () => {
    renderAbout('en');
    const { date } = VERSION_NOTES[0];
    expect(screen.getAllByText(date).length).toBeGreaterThan(0);
    expect(screen.queryByText(date.replaceAll('.', '-'))).not.toBeInTheDocument();
  });
});
