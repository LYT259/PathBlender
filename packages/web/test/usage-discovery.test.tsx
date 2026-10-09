/**
 * Feature discovery at the point of use (2026-10-07 plan §4.4): the mirror
 * button states its scope where it lives. The check-your-basics import tip
 * was removed at the user's decision (2026-10-08) — these tests pin its
 * absence so it does not drift back.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  it('the check-your-basics import tip stays gone (removed 2026-10-08)', async () => {
    const first = render(<App />);
    await importOne();
    expect(screen.queryByText('Imported — check the basics first')).toBeNull();
    expect(localStorage.getItem('pb.tip.import.v1')).toBeNull();
    first.unmount();

    render(<App />);
    await importOne();
    expect(screen.queryByText('Imported — check the basics first')).toBeNull();
  });

  it('the example session never shows the import tip', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Try an example' }));
    await screen.findByText('11019', { selector: '.robot-name' }, { timeout: 10000 });
    expect(screen.queryByText('Imported — check the basics first')).toBeNull();
  });
});
