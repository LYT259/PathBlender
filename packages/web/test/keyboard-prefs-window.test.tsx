/**
 * The standalone desktop settings window (2026-10-06 keyboard pass): it
 * opens with focus on <body>, which left the panel's Escape handler deaf —
 * focus now lands on the panel itself and a window-level Escape backs it up.
 */
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { PrefsWindow } from '../src/prefs-window';
import { I18nProvider } from '../src/i18n';

beforeEach(() => { localStorage.clear(); localStorage.setItem('pb.lang', 'en'); });

describe('prefs window keyboard entry', () => {
  it('lands focus on the settings panel right away', async () => {
    render(<I18nProvider><PrefsWindow /></I18nProvider>);
    await waitFor(() => expect(document.activeElement?.className).toContain('preferences-panel'));
  });
});
