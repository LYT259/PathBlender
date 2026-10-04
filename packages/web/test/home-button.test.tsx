/**
 * Workspace home button (2026-10-04): returns to the welcome screen by
 * clearing the session, and the trip is recoverable — ⌘Z brings the
 * cleared session straight back through the history.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App';

const SAMPLES = resolve(__dirname, '../../../samples');

function importOne(rel: string): void {
  const text = readFileSync(resolve(SAMPLES, rel), 'utf-8');
  fireEvent.drop(window, {
    dataTransfer: {
      files: [new File([text], rel.split('/').pop() as string, { type: 'application/json' })],
    },
  });
}

const homeButton = () => screen.getByRole('button', { name: /Back to home/ });
const robotsList = () => screen.queryByText(/Robots \(1\)/);
const welcomeScreen = () => screen.getByRole('region', { name: /Import paths to get started/ });

describe('workspace home button', () => {
  it('clears the session back to the welcome screen', async () => {
    render(<App />);
    importOne('ghostauto/straight_run.ghostauto');
    await waitFor(() => {
      expect(robotsList()).toBeInTheDocument();
    });

    fireEvent.click(homeButton());

    expect(robotsList()).not.toBeInTheDocument();
    expect(welcomeScreen()).toBeInTheDocument();
  });

  it('undo restores the session the home button cleared', async () => {
    render(<App />);
    importOne('ghostauto/straight_run.ghostauto');
    await waitFor(() => {
      expect(robotsList()).toBeInTheDocument();
    });

    fireEvent.click(homeButton());
    await waitFor(() => {
      expect(robotsList()).not.toBeInTheDocument();
    });

    fireEvent.keyDown(window, { code: 'KeyZ', key: 'z', metaKey: true });
    await waitFor(() => {
      expect(robotsList()).toBeInTheDocument();
    });
  });
});
