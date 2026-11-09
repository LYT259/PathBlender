import { fireEvent, screen, within } from '@testing-library/react';

/**
 * Folder imports stop at the per-team alliance dialog (red book #14, landed
 * 2026-11-09). Existing folder-import flows confirm the dialog with its
 * defaults, which reproduces the pre-dialog import exactly (every team
 * blue-frame, explicit blue flag on the slot).
 */
export async function confirmAllianceChoice(): Promise<void> {
  const dialog = await screen.findByRole('dialog', { name: 'Choose each team’s alliance' }, { timeout: 5000 });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }));
}
