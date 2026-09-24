/**
 * AI retreat acceptance (2026-09-20, extended 2026-09-24): while AI_ENABLED is
 * false no assistant entry point is reachable — toolbar, inspector tab, the
 * in-app Preferences dialog **and the desktop ⌘, window**. The first pass
 * gated App.tsx only, so the desktop preferences window kept rendering the
 * whole provider/AI-key form until the user spotted it; the second case below
 * is why the body now lives in its own module.
 * The assistant code itself stays intact for its return, which the last case
 * proves by flipping the flag.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { App } from '../src/App';
import { PrefsWindow } from '../src/prefs-window';
import { I18nProvider } from '../src/i18n';
import { ThemeProvider } from '../src/theme';
import { UpdateChannelProvider } from '../src/update-channel';
import { AI_ENABLED } from '../src/ai/availability';

beforeEach(() => localStorage.clear());

const withProviders = (ui: ReactNode) => (
  <ThemeProvider>
    <UpdateChannelProvider>
      <I18nProvider>{ui}</I18nProvider>
    </UpdateChannelProvider>
  </ThemeProvider>
);

describe('AI availability gate', () => {
  it.skipIf(AI_ENABLED)('exposes no assistant entry points anywhere in the app', () => {
    render(<App />);

    // Toolbar sparkle + inspector tab.
    expect(screen.queryByRole('button', { name: 'Assistant' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ai assistant/i })).not.toBeInTheDocument();

    // Preferences: the AI settings section is gone too.
    fireEvent.click(screen.getByRole('button', { name: /preferences/i }));
    expect(screen.queryByText('AI Assistant')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/api key/i)).not.toBeInTheDocument();
  });

  it.skipIf(AI_ENABLED)('exposes none in the desktop Preferences window either', () => {
    render(withProviders(<PrefsWindow />));
    expect(document.querySelector('.prefs-ai')).toBeNull();
    expect(screen.queryByText('AI Assistant')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/api key/i)).not.toBeInTheDocument();
    // The window itself is still the language / theme / channel card set.
    expect(screen.getAllByRole('combobox')).toHaveLength(3);
  });

  it('flipping the flag back brings the desktop block with it', async () => {
    // The retreat is a gate, not a deletion (report §6.4: 代码与测试保留).
    // resetModules gives the mocked availability a whole fresh graph, so the
    // providers have to be re-imported from it too — a top-level I18nProvider
    // would hand the new component a different React context.
    vi.resetModules();
    vi.doMock('../src/ai/availability', () => ({ AI_ENABLED: true }));
    try {
      const { PrefsWindow: Live } = await import('../src/prefs-window');
      const { I18nProvider: LiveI18n } = await import('../src/i18n');
      const { ThemeProvider: LiveTheme } = await import('../src/theme');
      const { UpdateChannelProvider: LiveChannel } = await import('../src/update-channel');
      render(
        <LiveTheme>
          <LiveChannel>
            <LiveI18n>
              <Live />
            </LiveI18n>
          </LiveChannel>
        </LiveTheme>,
      );
      const block = document.querySelector('.prefs-ai');
      expect(block).not.toBeNull();
      expect(within(block as Element).getByRole('heading', { name: /ai assistant/i })).toBeInTheDocument();
    } finally {
      vi.doUnmock('../src/ai/availability');
    }
  });
});
