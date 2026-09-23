/**
 * The folder PICKER path (not the drag-and-drop path).
 *
 * The library tests drive `fireEvent.drop`, which never touches the input
 * element — so the picker could be, and was, completely broken in silence:
 * `webkitdirectory` was assigned as a JS property (which WebKit ignores), the
 * panel fell back to file mode, a chosen folder returned zero files, and
 * `if (files?.length)` swallowed it. Every test here asserts either the
 * attribute the engine reads or the message the user sees on failure —
 * never a silent no-op.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';

const samples = resolve(__dirname, '../../../samples');

function folderFile(samplePath: string, relPath: string) {
  const file = new File([readFileSync(resolve(samples, samplePath), 'utf8')], relPath.split('/').at(-1)!, {
    type: 'application/json',
  });
  Object.defineProperty(file, 'webkitRelativePath', { value: relPath });
  return file;
}

/** The input the toolbar's folder button drives. */
function picker(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[webkitdirectory]');
  if (!input) throw new Error('no input carries the webkitdirectory attribute');
  return input;
}

/** Hand the input a FileList-shaped result, the way the engine does. */
function pick(input: HTMLInputElement, files: File[]) {
  Object.defineProperty(input, 'files', { value: files, configurable: true, writable: true });
  fireEvent.change(input);
}

async function bannerText(): Promise<string> {
  await waitFor(() => expect(document.querySelector('.import-banner')).not.toBeNull());
  // textContent, not innerText: jsdom does not implement innerText.
  return document.querySelector('.import-banner')!.textContent ?? '';
}

beforeEach(() => localStorage.clear());

describe('folder picker wiring', () => {
  it('declares directory mode as content attributes, not a JS property', () => {
    render(<App />);
    const input = picker();
    // The engine reads these at parse time; an IDL assignment is ignored in
    // WebKit, which is what made the button look dead.
    expect(input.getAttribute('webkitdirectory')).not.toBeNull();
    expect(input.getAttribute('directory')).not.toBeNull();
    expect(input.multiple).toBe(true);
  });

  it('imports what the picker returns', async () => {
    render(<App />);
    pick(picker(), [
      folderFile('traj/v3_swerve.traj', '254/autos/L1.traj'),
      folderFile('ghostauto/straight_run.ghostauto', '254/autos/straight_run.ghostauto'),
    ]);
    // A folder import seeds one robot and keeps the rest in the library.
    await waitFor(() => expect(document.querySelectorAll('.robot-library-row')).toHaveLength(1));
    expect(document.querySelector('.import-banner')).toBeNull();
  });

  it('says so when the folder comes back empty', async () => {
    render(<App />);
    pick(picker(), []);
    expect(await bannerText()).toMatch(/No files came back from the folder picker/);
  });

  it('says so when the engine returns the folder without its files', async () => {
    render(<App />);
    // A plain file panel would hand back the folder entry alone — no
    // webkitRelativePath, nothing to parse.
    pick(picker(), [new File([''], '254', { type: '' })]);
    expect(await bannerText()).toMatch(/returned the folder itself but none of its files/);
  });

  it('says so when the folder holds no parseable routes', async () => {
    render(<App />);
    const readme = new File(['hello'], 'README.md', { type: 'text/markdown' });
    Object.defineProperty(readme, 'webkitRelativePath', { value: '254/README.md' });
    pick(picker(), [readme]);
    const text = await bannerText();
    expect(text).toMatch(/no parseable route files/);
    expect(text).toContain('254'); // named, not a bare count
  });

  it('keeps the welcome-screen folder button on the same input', async () => {
    render(<App />);
    const open = screen.getAllByRole('button', { name: /Import folder|导入文件夹/i })[0]!;
    const click = vi.spyOn(picker(), 'click').mockImplementation(() => undefined);
    fireEvent.click(open);
    expect(click).toHaveBeenCalledOnce();
    click.mockRestore();
  });
});
