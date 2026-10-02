import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../src/i18n';
import { ThemeProvider, useTheme } from '../src/theme';
import { WelcomeScreen } from '../src/components/WelcomeScreen';

const bridge = vi.hoisted(() => ({ receive: undefined as undefined | ((key: string, value: string) => void) }));
vi.mock('../src/pref-sync', () => ({
  isDesktop: false,
  broadcastPref: vi.fn(),
  listenPrefs: (receive: typeof bridge.receive) => { bridge.receive = receive; return () => { bridge.receive = undefined; }; },
}));
function Preview() {
  const { setMode } = useTheme();
  return <><button onClick={() => setMode('dark')}>Dark</button><button onClick={() => setMode('light')}>Light</button><button onClick={() => setMode('system')}>System</button>
    <WelcomeScreen onImport={() => {}} onOpenSession={() => {}} onTryExample={() => {}} /></>;
}
beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

it.each([false, true])('follows the app preference even when the OS dark preference is %s', (osDark) => {
  let systemChange: ((event: { matches: boolean }) => void) | undefined;
  vi.stubGlobal('matchMedia', () => ({ matches: osDark, addEventListener: (_: string, cb: typeof systemChange) => { systemChange = cb; }, removeEventListener: vi.fn() }));
  const view = render(<ThemeProvider><I18nProvider><Preview /></I18nProvider></ThemeProvider>);
  const icon = () => view.container.querySelector('.start-brand-icon')!;
  expect(icon()).toHaveAttribute('src', expect.stringContaining(osDark ? 'app-icon-night' : 'app-icon-day'));
  fireEvent.click(view.getByText('Dark'));
  expect(icon()).toHaveAttribute('src', expect.stringContaining('app-icon-night'));
  fireEvent.click(view.getByText('Light'));
  expect(icon()).toHaveAttribute('src', expect.stringContaining('app-icon-day'));
  act(() => bridge.receive?.('theme', 'dark'));
  expect(icon()).toHaveAttribute('src', expect.stringContaining('app-icon-night'));
  fireEvent.click(view.getByText('System'));
  act(() => systemChange?.({ matches: !osDark }));
  expect(icon()).toHaveAttribute('src', expect.stringContaining(osDark ? 'app-icon-day' : 'app-icon-night'));
});
