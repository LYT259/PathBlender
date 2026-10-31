import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '../src/i18n';
import { ProjectSupport, StarLink } from '../src/components/ProjectSupport';
import { supportEnabled } from '../src/project-support';

vi.mock('../src/project-support', async (original) => ({
  ...await original<typeof import('../src/project-support')>(), SHOW_PROJECT_SUPPORT: true,
}));
beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('public repository invitations', () => {
  it('fails closed in production, even with a preview URL; only development can preview', () => {
    expect(supportEnabled(false, false, '')).toBe(false);
    expect(supportEnabled(false, false, '?support-preview=1')).toBe(false);
    expect(supportEnabled(false, true, '?support-preview=1')).toBe(true);
    expect(supportEnabled(false, true, '?support-preview=true')).toBe(false);
    expect(supportEnabled(true, false, '')).toBe(true);
  });
  it('opens a plain repository link without a star-status or login request', () => {
    render(<I18nProvider><StarLink /></I18nProvider>);
    const link = screen.getByRole('link', { name: 'Star on GitHub' });
    expect(link).toHaveAttribute('href', 'https://github.com/LYT259/pathblender');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).not.toHaveAttribute('aria-pressed');
  });
  it('remembers dismissal across mounts, leaving the permanent link available', () => {
    const first = render(<I18nProvider><ProjectSupport dismissible /></I18nProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss this invitation' }));
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    first.unmount();
    render(<I18nProvider><ProjectSupport dismissible /><StarLink /></I18nProvider>);
    expect(screen.queryByRole('button', { name: 'Dismiss this invitation' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Star on GitHub' })).toHaveLength(1);
  });
  it('keeps about-page support available after invitation dismissal', () => {
    localStorage.setItem('pb.support-invitation.dismissed.v1', '1');
    render(<I18nProvider><ProjectSupport /></I18nProvider>);
    expect(screen.getByRole('link', { name: 'Star on GitHub' })).toBeInTheDocument();
  });
  it('can dismiss when invitation storage is unavailable', () => {
    // Real jsdom Storage and the fallback stub differ in method ownership;
    // install the test doubles as explicit own properties on either form.
    const originalRead = localStorage.getItem.bind(localStorage);
    const originalWrite = localStorage.setItem.bind(localStorage);
    const read = vi.fn((key: string) => {
      if (key === 'pb.support-invitation.dismissed.v1') throw new Error('unavailable');
      return originalRead(key);
    });
    const write = vi.fn((key: string, value: string) => {
      if (key === 'pb.support-invitation.dismissed.v1') throw new Error('unavailable');
      return originalWrite(key, value);
    });
    Object.defineProperty(localStorage, 'getItem', { configurable: true, value: read });
    Object.defineProperty(localStorage, 'setItem', { configurable: true, value: write });
    try {
      render(<I18nProvider><ProjectSupport dismissible /></I18nProvider>);
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss this invitation' }));
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
      expect(read).toHaveBeenCalledWith('pb.support-invitation.dismissed.v1');
      expect(write).toHaveBeenCalledWith('pb.support-invitation.dismissed.v1', '1');
    } finally {
      Object.defineProperty(localStorage, 'getItem', { configurable: true, value: originalRead });
      Object.defineProperty(localStorage, 'setItem', { configurable: true, value: originalWrite });
    }
  });
});
