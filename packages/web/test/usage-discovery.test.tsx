/**
 * Feature discovery at the point of use (2026-10-07 plan §4.4): the mirror
 * button states its scope where it lives; a first real import surfaces the
 * check-your-basics tip; the example never shows it (curated settings).
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { App } from '../src/App';
import { en } from '../src/i18n/en';

const sampleText = readFileSync(resolve(__dirname, '../../../samples/ghostauto/straight_run.ghostauto'), 'utf8');

beforeEach(() => localStorage.clear());

async function importOne() {
  fireEvent.drop(window, { dataTransfer: { files: [new File([sampleText], 'straight_run.ghostauto')] } });
  await screen.findByText('0001', { selector: '.robot-name' }, { timeout: 10000 });
}

describe('feature discovery at the point of use', () => {
  it('the mirror button carries its scope as an accessible description', async () => {
    render(<App />);
    await importOne();
    const mirror = screen.getAllByRole('button', { name: en['robots.mirror'] })[0]!;
    expect(mirror).toHaveAccessibleDescription(/original files stay unchanged/i);
  });

  it('a first real import surfaces the basics tip; dismissing is remembered', async () => {
    const first = render(<App />);
    await importOne();
    const tip = screen.getByText(en['onboarding.import']);
    fireEvent.click(within(tip.closest('[role="note"]')!).getByRole('button', { name: 'Dismiss tip' }));
    await waitFor(() => expect(screen.queryByText(en['onboarding.import'])).toBeNull());
    expect(localStorage.getItem('pb.tip.import.v1')).toBe('done');
    first.unmount();

    render(<App />);
    await importOne();
    expect(screen.queryByText(en['onboarding.import'])).toBeNull();
  });

  it('the example session never shows the import tip', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Try an example' }));
    await screen.findByText('11019', { selector: '.robot-name' }, { timeout: 10000 });
    expect(screen.queryByText(en['onboarding.import'])).toBeNull();
  });
});
