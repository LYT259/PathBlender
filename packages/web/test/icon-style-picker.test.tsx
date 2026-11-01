import { useState, type ReactNode } from 'react';
import { cleanup, fireEvent, render as renderComponent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { IconAppearancePicker } from '../src/components/IconAppearancePicker';
import { ICON_STYLE_ARTWORK, type IconStyle } from '../src/app-icon';
import type { IconAppearanceMode } from '../src/app-icon';
import { I18nProvider } from '../src/i18n';

function render(node: ReactNode, lang = 'en') {
  localStorage.setItem('pb.lang', lang);
  return renderComponent(<I18nProvider>{node}</I18nProvider>);
}

afterEach(cleanup);
function DraftPicker({ initialMode = 'system', initialStyle = 'classic' }: {
  initialMode?: IconAppearanceMode;
  initialStyle?: IconStyle;
}) {
  const [style, setStyle] = useState<IconStyle>(initialStyle);
  const [mode, setMode] = useState<IconAppearanceMode>(initialMode);
  return <IconAppearancePicker value={mode} onChange={setMode} style={style} onStyleChange={setStyle} />;
}

describe('two-level icon settings UI', () => {
  it('starts with classic and follow system in separately named groups', () => {
    render(<DraftPicker />);
    expect(within(screen.getByRole('group', { name: 'App icon' })).getByRole('group', { name: 'Icon style' })).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Icon style' })).getByRole('radio', { name: 'Classic' })).toBeChecked();
    expect(within(screen.getByRole('group', { name: 'Icon appearance' })).getByRole('radio', { name: 'Follow system' })).toBeChecked();
  });
  it('switches all appearance previews to the selected family without changing a fixed appearance', () => {
    render(<DraftPicker initialMode="dark" />);
    fireEvent.click(screen.getByRole('radio', { name: 'Monochrome' }));
    const group = screen.getByRole('group', { name: 'Icon appearance' });
    expect(within(group).getByRole('radio', { name: 'Dark' })).toBeChecked();
    expect([...group.querySelectorAll('img')].map(img => img.getAttribute('src'))).toEqual([
      ICON_STYLE_ARTWORK.monochrome.light, ICON_STYLE_ARTWORK.monochrome.dark,
      ICON_STYLE_ARTWORK.monochrome.light, ICON_STYLE_ARTWORK.monochrome.dark,
    ]);
    fireEvent.click(screen.getByRole('radio', { name: 'Classic' }));
    expect(within(group).getByRole('radio', { name: 'Dark' })).toBeChecked();
  });
  it('keeps the family selected while changing appearance', () => {
    render(<DraftPicker />);
    fireEvent.click(screen.getByRole('radio', { name: 'Monochrome' }));
    for (const name of ['Light', 'Dark', 'Follow system']) {
      fireEvent.click(screen.getByRole('radio', { name }));
      expect(screen.getByRole('radio', { name: 'Monochrome' })).toBeChecked();
      expect(screen.getByRole('radio', { name })).toBeChecked();
    }
  });
  it('restores a saved monochrome choice with its fixed appearance', () => {
    render(<DraftPicker initialMode="light" initialStyle="monochrome" />);
    expect(screen.getByRole('radio', { name: 'Monochrome' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Light' })).toBeChecked();
    expect([...screen.getByRole('group', { name: 'Icon appearance' }).querySelectorAll('img')][2])
      .toHaveAttribute('src', ICON_STYLE_ARTWORK.monochrome.light);
  });
  it('supports native radio keyboard navigation without moving between groups', async () => {
    const user = userEvent.setup();
    render(<DraftPicker />);
    screen.getByRole('radio', { name: 'Classic' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Monochrome' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Follow system' })).toBeChecked();
    await user.tab();
    expect(screen.getByRole('radio', { name: 'Follow system' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Light' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Monochrome' })).toBeChecked();
  });
  it('labels the two levels with the localized dictionaries, not preview copy', () => {
    render(<DraftPicker />, 'zh');
    expect(screen.getByRole('group', { name: '图标样式' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: '图标外观' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '经典' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '黑白' })).toBeInTheDocument();
  });
});
