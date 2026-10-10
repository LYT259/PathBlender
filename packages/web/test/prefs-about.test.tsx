import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../src/i18n';
import { AppIconProvider } from '../src/app-icon';
import { PreferencesPanel } from '../src/components/PreferencesPanel';
import { BUILD_VERSION, formatBuildVersion } from '../src/build-version';
import { copyText } from '../src/download';
vi.mock('../src/download', () => ({ copyText: vi.fn(() => Promise.resolve(true)) }));
vi.mock('../src/dock-icon', () => ({ syncDockIcon: vi.fn() }));
let dark = false;
let changed: ((event: { matches: boolean }) => void) | undefined;
beforeEach(() => {
  localStorage.clear(); localStorage.setItem('pb.lang', 'en'); dark = false; changed = undefined; vi.clearAllMocks();
  vi.stubGlobal('matchMedia', () => ({ matches: dark, addEventListener: (_: string, callback: typeof changed) => { changed = callback; }, removeEventListener: vi.fn() }));
});
afterEach(() => vi.unstubAllGlobals());
function mount() { render(<AppIconProvider><I18nProvider><PreferencesPanel desktop onClose={vi.fn()} /></I18nProvider></AppIconProvider>); }
function about() { fireEvent.click(screen.getByRole('tab', { name: 'About' })); }
function icon() { return document.querySelector('.preferences-product-icon'); }
describe('About identity', () => {
  it('displays and copies only the same version line, with the build hash when available', async () => {
    expect(formatBuildVersion('0.1.8-beta.30', '4b72ed9')).toBe('Version 0.1.8-beta.30 (4b72ed9)');
    expect(formatBuildVersion('0.1.8-beta.30', '')).toBe('Version 0.1.8-beta.30');
    mount(); about(); expect(document.querySelector('.preferences-version')).toHaveTextContent(BUILD_VERSION);
    fireEvent.click(screen.getByRole('button', { name: 'Copy version info' }));
    await waitFor(() => expect(copyText).toHaveBeenCalledWith(BUILD_VERSION));
    expect(vi.mocked(copyText).mock.calls[0]).toHaveLength(1);
  });
  it.each(['light', 'dark'])('keeps a fixed %s icon independent of system and interface theme', (mode) => {
    localStorage.setItem('pb.appIcon', mode); localStorage.setItem('pb.theme', mode === 'light' ? 'dark' : 'light');
    mount(); about();
    expect(icon()).toHaveAttribute('src', expect.stringContaining(mode === 'dark' ? 'night' : 'day'));
    act(() => changed?.({ matches: true }));
    expect(icon()).toHaveAttribute('src', expect.stringContaining(mode === 'dark' ? 'night' : 'day'));
  });
  it('updates system artwork live and previews a general-tab draft without persisting it', () => {
    mount(); about(); expect(icon()).toHaveAttribute('src', expect.stringContaining('day'));
    act(() => changed?.({ matches: true })); expect(icon()).toHaveAttribute('src', expect.stringContaining('night'));
    fireEvent.click(screen.getByRole('tab', { name: 'General' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'App icon' })).getByRole('radio', { name: 'Light' }));
    about(); expect(icon()).toHaveAttribute('src', expect.stringContaining('day'));
    expect(localStorage.getItem('pb.appIcon')).toBeNull();
  });
  it('runs the icon larger (user request 2026-10-07)', () => {
    mount(); about();
    expect(icon()).toHaveAttribute('width', '72');
    expect(icon()).toHaveAttribute('height', '72');
  });
  it('shows no Cancel/Save footer on About — nothing there to stage', () => {
    mount(); about();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    // The staging pair returns on sections that actually hold settings.
    fireEvent.click(screen.getByRole('tab', { name: 'General' }));
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });
});
