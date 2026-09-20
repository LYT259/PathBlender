/**
 * AI retreat acceptance (2026-09-20): while AI_ENABLED is false no assistant
 * entry point is reachable — toolbar, inspector tab, preferences section.
 * The assistant code itself stays intact for its return.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { AI_ENABLED } from '../src/ai/availability';

beforeEach(() => localStorage.clear());

describe('AI availability gate', () => {
  it.skipIf(AI_ENABLED)('exposes no assistant entry points anywhere in the app', () => {
    render(<App />);

    // Toolbar sparkle + inspector tab.
    expect(screen.queryByRole('button', { name: 'Assistant' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ai assistant/i })).not.toBeInTheDocument();

    // Preferences: the AI settings section is gone too.
    fireEvent.click(screen.getByRole('button', { name: /preferences/i }));
    expect(screen.queryByText('AI Assistant')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/api key/i)).not.toBeInTheDocument();
  });
});
