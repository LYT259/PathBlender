/**
 * Web menu bar (2026-10-06): the browser has no native menu, so the shared
 * menu spec (menu-spec.ts) renders as a DOM menubar — File | Edit | View |
 * Playback | Help (the macOS-only app/Window sections are dropped upstream).
 * The desktop build keeps its native menu and never mounts this component.
 *
 * One level of submenus (season / construction / artwork / speed / range)
 * matches the spec tree; ids dispatch through the same onCommand the native
 * `pb-menu-*` events use, so both hosts share the exact action table.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { MenuEntry, MenuSection } from '../menu-spec';
import './MenuBar.css';

interface MenuBarProps {
  menus: MenuSection[];
  onCommand: (id: string) => void;
}

/** Focusable menu-item buttons inside the open panel, in render order. */
function itemButtons(root: ParentNode): HTMLButtonElement[] {
  return Array.from(root.querySelectorAll<HTMLButtonElement>('.menu-item:not(:disabled)'));
}

export function MenuBar({ menus, onCommand }: MenuBarProps) {
  const visible = menus.filter((m) => !m.macOnly);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [openSubId, setOpenSubId] = useState<string | null>(null);
  const barRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenIndex(null);
        setOpenSubId(null);
      }
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openIndex !== null) {
        setOpenIndex(null);
        setOpenSubId(null);
        barRef.current?.querySelector<HTMLButtonElement>(`[data-menu-index="${openIndex}"]`)?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [openIndex]);

  const closeAll = () => { setOpenIndex(null); setOpenSubId(null); };

  const runItem = (entry: MenuEntry) => {
    if (entry.enabled === false || !entry.id) return;
    onCommand(entry.id);
    closeAll();
  };

  const topKey = (e: React.KeyboardEvent, index: number) => {
    const buttons = Array.from(barRef.current?.querySelectorAll<HTMLButtonElement>('.menu-top') ?? []);
    const at = buttons.indexOf(e.currentTarget as HTMLButtonElement);
    if (e.key === 'ArrowRight' && at >= 0) {
      e.preventDefault();
      buttons[(at + 1) % buttons.length]?.focus();
    } else if (e.key === 'ArrowLeft' && at >= 0) {
      e.preventDefault();
      buttons[(at - 1 + buttons.length) % buttons.length]?.focus();
    } else if ((e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') && openIndex === index) {
      // Menu already open via keyboard: land on its first item.
      e.preventDefault();
      itemButtons(barRef.current?.querySelector('.menu-panel') ?? document)[0]?.focus();
    }
  };

  const panelKey = (e: React.KeyboardEvent) => {
    const items = itemButtons(e.currentTarget as HTMLElement);
    const at = items.indexOf(e.target as HTMLButtonElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      items[(at + step + items.length) % items.length]?.focus();
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const buttons = Array.from(barRef.current?.querySelectorAll<HTMLButtonElement>('.menu-top') ?? []);
      const current = buttons.findIndex((b) => b.getAttribute('aria-expanded') === 'true');
      const next = (Math.max(current, 0) + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.click();
      buttons[next]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1]?.focus();
    }
  };

  return (
    <nav className="menu-bar" ref={barRef} role="menubar" aria-label={visible.map((menu) => menu.label).join(' · ')}>
      {visible.map((menu, index) => (
        <div className="menu-section" key={menu.label}>
          <button
            type="button"
            className="menu-top"
            data-menu-index={index}
            aria-haspopup="menu"
            aria-expanded={openIndex === index}
            onClick={() => { setOpenIndex(openIndex === index ? null : index); setOpenSubId(null); }}
            onMouseEnter={() => { if (openIndex !== null && openIndex !== index) { setOpenIndex(index); setOpenSubId(null); } }}
            onKeyDown={(e) => topKey(e, index)}
          >
            {menu.label}
          </button>
          {openIndex === index && (
            <div className="menu-panel" role="menu" aria-label={menu.label} onKeyDown={panelKey}>
              <MenuItems items={menu.items} openSubId={openSubId} setOpenSubId={setOpenSubId} runItem={runItem} />
            </div>
          )}
        </div>
      ))}
    </nav>
  );
}

interface ItemsProps {
  items: MenuEntry[];
  openSubId: string | null;
  setOpenSubId: (id: string | null) => void;
  runItem: (entry: MenuEntry) => void;
}

function MenuItems({ items, openSubId, setOpenSubId, runItem }: ItemsProps): ReactNode {
  return (
    <>
      {items.map((entry, index) => {
        if (entry.role === 'separator') return <div className="menu-separator" role="separator" key={`sep-${index}`} />;
        if (entry.desktopOnly) return null;
        if (entry.kind === 'submenu') {
          // Unlabelled submenus key their open state on the label.
          const subKey = entry.id ?? `sub:${entry.label ?? index}`;
          const isOpen = openSubId === subKey;
          return (
            <div className="menu-sub-wrap" key={subKey}>
              <button
                type="button"
                className="menu-item menu-sub"
                disabled={entry.enabled === false}
                aria-haspopup="menu"
                aria-expanded={isOpen}
                onClick={() => setOpenSubId(isOpen ? null : subKey)}
                onMouseEnter={() => setOpenSubId(subKey)}
              >
                <span className="menu-item-label">{entry.label}</span>
                <span className="menu-sub-arrow" aria-hidden="true">›</span>
              </button>
              {isOpen && (
                <div className="menu-panel menu-sub-panel" role="menu" aria-label={entry.label}>
                  <MenuItems items={entry.items ?? []} openSubId={openSubId} setOpenSubId={setOpenSubId} runItem={runItem} />
                </div>
              )}
            </div>
          );
        }
        if (entry.role) {
          return (
            <button type="button" className="menu-item" disabled key={`${entry.role}-${index}`}>
              <span className="menu-item-label">{entry.label}</span>
            </button>
          );
        }
        const isCheck = entry.kind === 'check';
        return (
          <button
            type="button"
            className="menu-item"
            key={entry.id}
            disabled={entry.enabled === false}
            role={isCheck ? 'menuitemcheckbox' : 'menuitem'}
            aria-checked={isCheck ? !!entry.checked : undefined}
            onClick={() => runItem(entry)}
          >
            {isCheck && <span className={`menu-check${entry.checked ? ' on' : ''}`} aria-hidden="true">✓</span>}
            <span className="menu-item-label">{entry.label}</span>
          </button>
        );
      })}
    </>
  );
}
