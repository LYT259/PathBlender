/**
 * Session save contract: the native save panel's filter extension must be
 * the session extension. macOS appends the active filter's extension to the
 * suggested name — a 'json' filter turned "session-DATE.pb" into
 * "…pb.json", which isSessionFileName rejects, so every desktop ⌘S session
 * was impossible to reopen (found driving the real save/reopen flow on the
 * desktop candidate build, 2026-11-05).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionTrajectory } from '@pathblender/core';

const saveText = vi.fn();
vi.mock('../src/download', () => ({
  saveText: (...args: unknown[]) => saveText(...args),
  copyText: vi.fn(),
  saveBytes: vi.fn(),
}));
vi.mock('../src/components/FieldCanvas', async () => {
  const { forwardRef } = await import('react');
  return { FieldCanvas: forwardRef((_props: { robots: SessionTrajectory[] }, _ref) => <div data-testid="field-2d">{JSON.stringify(_props.robots)}</div>) };
});
vi.mock('../src/components/FieldCanvas3D', async () => {
  const { forwardRef } = await import('react');
  return { FieldCanvas3D: forwardRef((_props: { robots: SessionTrajectory[] }, _ref) => <div data-testid="field-3d">{JSON.stringify(_props.robots)}</div>) };
});

describe('saveSession native filter extension', () => {
  beforeEach(() => {
    saveText.mockClear();
    localStorage.clear();
  });

  it('suggests a .pb name with a .pb filter (not json)', async () => {
    const { App } = await import('../src/App');
    render(<App />);
    // ⌘S needs robots on screen; a sample route is the quickest source
    // (same pattern as the alliance-workflow suite).
    const route = new File(
      [readFileSync(resolve(__dirname, '../../../samples/ghostauto/straight_run.ghostauto'), 'utf8')],
      'straight_run.ghostauto',
    );
    fireEvent.drop(window, { dataTransfer: { files: [route] } });
    await waitFor(() => expect(screen.getByTestId('field-2d').textContent).toMatch(/samples/), { timeout: 10000 });
    fireEvent.keyDown(window, { key: 's', metaKey: true });
    await waitFor(() => expect(saveText).toHaveBeenCalled(), { timeout: 5000 });
    const [suggestedName, filterExt] = saveText.mock.calls.at(-1)!;
    expect(suggestedName).toMatch(/^session-\d{4}-\d{2}-\d{2}\.pb$/);
    // The contract that broke reopen: the filter must be pb, never json.
    expect(filterExt).toBe('pb');
    expect(`${suggestedName}`).not.toMatch(/\.pb\.json$/);
  });
});
