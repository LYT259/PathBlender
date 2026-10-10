/**
 * Quick guide (2026-10-07 onboarding plan §1/§5): the welcome screen states
 * what the app is for and links the in-app guide; the Help menu exposes the
 * guide and the shortcuts list; the guide body follows the reader's script
 * family (zh-Hans / zh-Hant / English for everything else), and the footer
 * links the matching online full guide.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../src/i18n';
import { ThemeProvider } from '../src/theme';
import { WelcomeScreen } from '../src/components/WelcomeScreen';
import { GuideDialog } from '../src/components/GuideDialog';
import { buildMenuSpec, type MenuContext } from '../src/menu-spec';
import { en } from '../src/i18n/en';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

function t(key: keyof typeof en, params?: Record<string, string | number>): string {
  let text: string = en[key];
  for (const [k, v] of Object.entries(params ?? {})) text = text.replaceAll(`{${k}}`, String(v));
  return text;
}

function menuCtx(overrides: Partial<MenuContext> = {}): MenuContext {
  return {
    t, robotsCount: 0, hasSelection: false, selectedVisible: true, composerOpen: false,
    canUndo: false, canRedo: false, view3D: false, field3dAvailable: true,
    alliance: 'blue', fieldId: 'rebuilt-2026', fieldVariant: 'welded', andymarkAvailable: true,
    hasRenderedArt: true, fieldStyle: 'schematic', showHeatmap: false, playing: false,
    speed: 1, playbackRange: 'full', hasIssues: false, viewerOnly: false, isDesktop: false,
    ...overrides,
  };
}

describe('welcome screen links the guide', () => {
  it('the guide link fires onOpenGuide, and stays absent without a handler', () => {
    localStorage.setItem('pb.lang', 'en');
    const onOpenGuide = vi.fn();
    const view = render(<ThemeProvider><I18nProvider>
      <WelcomeScreen onImport={() => {}} onOpenSession={() => {}} onTryExample={() => {}} />
    </I18nProvider></ThemeProvider>);
    expect(screen.queryByRole('button', { name: en['menu.userGuide'] })).toBeNull();
    view.unmount();
    render(<ThemeProvider><I18nProvider>
      <WelcomeScreen onImport={() => {}} onOpenSession={() => {}} onTryExample={() => {}} onOpenGuide={onOpenGuide} />
    </I18nProvider></ThemeProvider>);
    fireEvent.click(screen.getByRole('button', { name: en['menu.userGuide'] }));
    expect(onOpenGuide).toHaveBeenCalledTimes(1);
  });
});

describe('Help menu leads with the guide entries', () => {
  it('carries open-guide and open-shortcuts ahead of the project link (web)', () => {
    const help = buildMenuSpec(menuCtx()).find((m) => m.label === 'Help')!;
    const ids = help.items.map((e) => e.id ?? `role:${e.role}`);
    expect(ids).toEqual(['open-tour', 'open-guide', 'open-shortcuts', 'role:separator', 'github', 'role:separator', 'about']);
  });

  it('desktop appends the update check after About', () => {
    const help = buildMenuSpec(menuCtx({ isDesktop: true })).find((m) => m.label === 'Help')!;
    expect(help.items.map((e) => e.id ?? `role:${e.role}`)).toEqual(
      ['open-tour', 'open-guide', 'open-shortcuts', 'role:separator', 'github', 'role:separator', 'about', 'check-update'],
    );
  });
});

describe('guide dialog body follows the script family', () => {
  const mount = () => render(<I18nProvider>
    <GuideDialog onClose={() => {}} onOpenShortcuts={() => {}} onOpenUrl={() => {}} />
  </I18nProvider>);

  it('Simplified Chinese reads the zh-Hans body', () => {
    localStorage.setItem('pb.lang', 'zh');
    mount();
    expect(screen.getByText('联盟切换与左右镜像')).toBeInTheDocument();
    // The button names in the body match the zh UI labels (左右镜像, not 镜像).
    expect(screen.getByText(/左右镜像（单台机器人）/)).toBeInTheDocument();
  });

  it('Traditional Chinese reads the zh-Hant body', () => {
    // zh-tw is the pre-withdrawal choice (migrates to zh-hant on load);
    // zh-hant is the selectable generic row — both must read the Hant body.
    for (const code of ['zh-tw', 'zh-hant', 'zh-hk']) {
      localStorage.setItem('pb.lang', code);
      mount();
      expect(screen.getByText('聯盟切換與左右鏡像'), code).toBeInTheDocument();
      expect(screen.getByText(/左右鏡像（單台機器人）/), code).toBeInTheDocument();
      cleanup();
    }
  });

  it('every other language reads the English body', () => {
    localStorage.setItem('pb.lang', 'fr');
    mount();
    expect(screen.getByText('Alliance switch vs. left/right mirror')).toBeInTheDocument();
  });

  it('the footer links the matching online full guide', () => {
    localStorage.setItem('pb.lang', 'zh');
    mount();
    expect(screen.getByRole('link', { name: '完整指南（在线）' })).toHaveAttribute(
      'href', expect.stringContaining('docs/user-guide.zh.md'),
    );
  });

  it('the shortcuts button hands off to the shortcut dialog', () => {
    localStorage.setItem('pb.lang', 'en');
    const onOpenShortcuts = vi.fn();
    render(<I18nProvider>
      <GuideDialog onClose={() => {}} onOpenShortcuts={onOpenShortcuts} onOpenUrl={() => {}} />
    </I18nProvider>);
    fireEvent.click(screen.getByRole('button', { name: en['help.title'] }));
    expect(onOpenShortcuts).toHaveBeenCalledTimes(1);
  });
});
