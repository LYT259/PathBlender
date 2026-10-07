import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider, useI18n, LANGUAGES, type Lang } from '../src/i18n';
import { formatDecimal } from '../src/number-format';
import { FieldCanvas3D } from '../src/components/FieldCanvas3D';
import { MenuBar } from '../src/components/MenuBar';
import { ConflictPanel } from '../src/components/ConflictPanel';
import { createWelcomeExample } from '../src/welcome-example';
import type { FieldPackage } from '@pathblender/core';

// Exercise the real component's failure path without requiring a GPU.
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  return {
    ...actual,
    WebGLRenderer: class {
      constructor() { throw new Error('WebGL disabled'); }
    },
  };
});

const field: FieldPackage = { id: 'test', name: 'Test field', year: 2026, lengthM: 10, widthM: 5 };

function Fixture() {
  const { t, setLang } = useI18n();
  return <>
    <button onClick={() => setLang('he')}>Switch language</button>
    <MenuBar menus={[{ label: t('menu.file'), items: [] }, { label: t('menu.help'), items: [] }]} onCommand={() => undefined} />
    <FieldCanvas3D field={field} robots={[]} currentT={0} />
  </>;
}

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

describe('accessible labels follow the active language', () => {
  it.each(LANGUAGES.filter((lang) => lang !== 'system'))('%s: tolerance copy substitutes the live value in visible and accessible text', (lang) => {
    localStorage.setItem('pb.lang', lang);
    const robots = createWelcomeExample().robots;
    // The live value renders through the locale number format since the
    // 2026-10-07 display layer — comma languages read "0,4", point ones "0.4".
    const v04 = formatDecimal(0.4, lang as Lang, 1);
    const v07 = formatDecimal(0.7, lang as Lang, 1);
    const ui = (value: number) => <I18nProvider><ConflictPanel robots={robots} conflicts={[]} bounds={[]} onJump={() => undefined} toleranceS={value} /></I18nProvider>;
    const { container, rerender } = render(ui(0.4));
    expect(container.querySelector('.tolerance-label')).toHaveTextContent(v04);
    expect(screen.getByRole('slider').getAttribute('aria-label')).toContain(v04);
    expect(container.textContent).not.toContain('{delta}');
    rerender(ui(0.7));
    expect(container.querySelector('.tolerance-label')).toHaveTextContent(v07);
    expect(screen.getByRole('slider').getAttribute('aria-label')).toContain(v07);
    expect(container.textContent).not.toContain('{delta}');
  });

  it('names the menubar with its translated visible menu labels', () => {
    localStorage.setItem('pb.lang', 'fr');
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    render(<I18nProvider><Fixture /></I18nProvider>);
    expect(screen.getByRole('menubar')).toHaveAccessibleName('Fichier · Aide');
    expect(screen.getByRole('status')).toHaveTextContent('WebGL indisponible');
  });

  it('updates an existing failure message when switching to an RTL language', () => {
    localStorage.setItem('pb.lang', 'fr');
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    render(<I18nProvider><Fixture /></I18nProvider>);
    fireEvent.click(screen.getByText('Switch language'));
    expect(screen.getByRole('status')).toHaveTextContent('WebGL אינו זמין');
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('menubar').getAttribute('aria-label')).not.toContain('Fichier');
  });
});
