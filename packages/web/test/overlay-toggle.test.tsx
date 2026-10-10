/**
 * The canvas-bar overlay pair (user request 2026-10-07): a segmented control
 * styled after the 2D/3D switch, sitting LEFT of it, whose two sides — the
 * trail tape and the occupancy heatmap — toggle independently. Both-on,
 * both-off and either mix are valid states, and both default to ON. The
 * state must reach BOTH canvases (2D tape and 3D meshes alike).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';

// Prop-capturing canvas stubs: the wiring under test is what the App hands
// to the canvases, so the mocks record every render's props.
let canvas2dProps: Record<string, unknown> = {};
let canvas3dProps: Record<string, unknown> = {};
vi.mock('../src/components/FieldCanvas', async () => {
  const { forwardRef } = await import('react');
  return { FieldCanvas: forwardRef((props: Record<string, unknown>, _ref) => {
    canvas2dProps = props;
    return <div data-testid="field-2d" />;
  }) };
});
vi.mock('../src/components/FieldCanvas3D', async () => {
  const { forwardRef } = await import('react');
  return { FieldCanvas3D: forwardRef((props: Record<string, unknown>, _ref) => {
    canvas3dProps = props;
    return <div data-testid="field-3d" />;
  }) };
});

const raw = readFileSync(resolve(__dirname, '../../../samples/ghostauto/straight_run.ghostauto'), 'utf8');

const overlayButtons = () => {
  const group = screen.getByRole('group', { name: 'Overlays' });
  return {
    trail: within(group).getByRole('button', { name: 'Routes' }),
    heatmap: within(group).getByRole('button', { name: 'Occupancy zones' }),
  };
};

beforeEach(() => {
  localStorage.clear();
  canvas2dProps = {};
  canvas3dProps = {};
});

describe('the canvas-bar overlay pair', () => {
  it('defaults both sides on and feeds the 2D canvas', async () => {
    render(<App />);
    fireEvent.drop(window, { dataTransfer: { files: [new File([raw], 'A.ghostauto')] } });
    await waitFor(() => expect(screen.getByTestId('field-2d')).toBeInTheDocument());
    const { trail, heatmap } = overlayButtons();
    expect(trail).toHaveAttribute('aria-pressed', 'true');
    expect(heatmap).toHaveAttribute('aria-pressed', 'true');
    expect(canvas2dProps.showTrail).toBe(true);
    expect(canvas2dProps.showHeatmap).toBe(true);
  });

  it('toggles each side independently — both-off and either mix included', async () => {
    render(<App />);
    fireEvent.drop(window, { dataTransfer: { files: [new File([raw], 'A.ghostauto')] } });
    await waitFor(() => expect(screen.getByTestId('field-2d')).toBeInTheDocument());
    const { trail, heatmap } = overlayButtons();

    // Trail off alone: heatmap stays on.
    fireEvent.click(trail);
    expect(trail).toHaveAttribute('aria-pressed', 'false');
    expect(heatmap).toHaveAttribute('aria-pressed', 'true');
    expect(canvas2dProps.showTrail).toBe(false);
    expect(canvas2dProps.showHeatmap).toBe(true);

    // Both off.
    fireEvent.click(heatmap);
    expect(canvas2dProps.showTrail).toBe(false);
    expect(canvas2dProps.showHeatmap).toBe(false);

    // Heatmap on alone.
    fireEvent.click(heatmap);
    expect(canvas2dProps.showTrail).toBe(false);
    expect(canvas2dProps.showHeatmap).toBe(true);

    // Back to both on.
    fireEvent.click(trail);
    expect(canvas2dProps.showTrail).toBe(true);
    expect(canvas2dProps.showHeatmap).toBe(true);
  });

  it('sits left of the 2D/3D switch and outside its group', async () => {
    render(<App />);
    fireEvent.drop(window, { dataTransfer: { files: [new File([raw], 'A.ghostauto')] } });
    await waitFor(() => expect(screen.getByTestId('field-2d')).toBeInTheDocument());

    const overlays = document.querySelector('.overlay-toggle') as HTMLElement;
    const view = document.querySelector('.view-toggle') as HTMLElement;
    expect(overlays).toBeTruthy();
    expect(view).toBeTruthy();
    // DOM order: the overlay pair comes before (left of) the 2D/3D group.
    expect(overlays.compareDocumentPosition(view) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The pair owns exactly its two buttons — it is not part of 2D/3D.
    expect(within(overlays).getAllByRole('button')).toHaveLength(2);
    expect(within(view).getAllByRole('button').map((b) => b.textContent)).toEqual(['2D', '3D']);
  });

  it('feeds the 3D canvas the same pair of toggles', async () => {
    render(<App />);
    fireEvent.drop(window, { dataTransfer: { files: [new File([raw], 'A.ghostauto')] } });
    await waitFor(() => expect(screen.getByTestId('field-2d')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '3D', exact: true }));
    await waitFor(() => expect(screen.getByTestId('field-3d')).toBeInTheDocument());
    expect(canvas3dProps.showTrail).toBe(true);
    expect(canvas3dProps.showHeatmap).toBe(true);

    const { trail, heatmap } = overlayButtons();
    fireEvent.click(trail);
    fireEvent.click(heatmap);
    expect(canvas3dProps.showTrail).toBe(false);
    expect(canvas3dProps.showHeatmap).toBe(false);
  });

  it('stays in sync with the View menu heatmap command', async () => {
    render(<App />);
    fireEvent.drop(window, { dataTransfer: { files: [new File([raw], 'A.ghostauto')] } });
    await waitFor(() => expect(screen.getByTestId('field-2d')).toBeInTheDocument());
    // Default-on means the menu offers to hide it; the menu command and the
    // segmented button toggle the SAME state in both directions.
    fireEvent.click(screen.getByText('View', { selector: '.menu-top' }));
    fireEvent.click(screen.getByText('Hide occupancy zones'));
    await waitFor(() => expect(overlayButtons().heatmap).toHaveAttribute('aria-pressed', 'false'));
    fireEvent.click(overlayButtons().heatmap);
    await waitFor(() => expect(overlayButtons().heatmap).toHaveAttribute('aria-pressed', 'true'));
  });
});
