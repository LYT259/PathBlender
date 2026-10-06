/**
 * The complete menu definition, shared by both hosts (2026-10-06):
 * - the web MenuBar component renders it as a DOM menubar, and
 * - the desktop shell rebuilds the native menu from it (`set_menu` command,
 *   JSON over the invoke bridge — labels live in the web i18n dictionaries,
 *   so every UI language gets a native menu for free; the old per-language
 *   Rust tables are gone).
 *
 * Item ids are the dispatch contract: a click lands in the app as a
 * `pb-menu-<id>` DOM CustomEvent (desktop) or an onCommand call (web).
 * ids are stable — the Rust shell special-cases two of them ("preferences"
 * opens the prefs window shell-side, "import" owns the native file dialog)
 * and every other id is forwarded verbatim.
 *
 * The wire format (what `set_menu` receives) is the same tree with
 * snake_case flags, serialized by `menuSpecPayload`.
 */

import { FIELDS } from '@pathblender/core';
import type { MessageKey } from './i18n/en';

export type MenuRole =
  | 'separator'
  | 'about'
  | 'hide'
  | 'hideOthers'
  | 'quit'
  | 'minimize'
  | 'zoom'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'selectAll';

export interface MenuEntry {
  /** Dispatch id (pb-menu-<id>); roles carry no id. */
  id?: string;
  role?: MenuRole;
  label?: string;
  /** muda accelerator syntax ("CmdOrCtrl+S"); desktop only. */
  accelerator?: string;
  kind?: 'item' | 'check' | 'submenu';
  checked?: boolean;
  enabled?: boolean;
  /** macOS-only entry or section (app + Window menus). */
  macOnly?: boolean;
  /** Native-only entry (the web menubar hides it). */
  desktopOnly?: boolean;
  /** Hidden in the native menu on macOS (web keeps it; avoids a duplicate About). */
  macHide?: boolean;
  items?: MenuEntry[];
}

export interface MenuSection {
  label: string;
  macOnly?: boolean;
  items: MenuEntry[];
}

/** State the menu reflects; the builder reads nothing global so tests stay pure. */
export interface MenuContext {
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
  robotsCount: number;
  hasSelection: boolean;
  selectedVisible: boolean;
  composerOpen: boolean;
  canUndo: boolean;
  canRedo: boolean;
  view3D: boolean;
  field3dAvailable: boolean;
  alliance: 'blue' | 'red';
  fieldId: string;
  fieldVariant: 'welded' | 'andymark';
  andymarkAvailable: boolean;
  hasRenderedArt: boolean;
  fieldStyle: 'schematic' | 'rendered';
  showHeatmap: boolean;
  playing: boolean;
  speed: number;
  playbackRange: 'full' | 'paths';
  hasIssues: boolean;
  /** Website-only build: no save/export/open-session (viewer.ts). */
  viewerOnly: boolean;
  isDesktop: boolean;
}

const sep = (): MenuEntry => ({ role: 'separator' });
const item = (id: string, label: string, extra: Partial<MenuEntry> = {}): MenuEntry => ({
  id, label, kind: 'item', enabled: true, ...extra,
});
const check = (id: string, label: string, checked: boolean, extra: Partial<MenuEntry> = {}): MenuEntry => ({
  id, label, kind: 'check', checked, enabled: true, ...extra,
});
const submenu = (label: string, items: MenuEntry[], extra: Partial<MenuEntry> = {}): MenuEntry => ({
  label, kind: 'submenu', enabled: true, items, ...extra,
});
const role = (r: MenuRole, label: string, extra: Partial<MenuEntry> = {}): MenuEntry => ({
  role: r, label, ...extra,
});

/** Playback speeds mirror PlaybackControls' SPEEDS (the only values offered). */
export const MENU_SPEEDS = [0.25, 0.5, 1] as const;

export function buildMenuSpec(ctx: MenuContext): MenuSection[] {
  const { t } = ctx;
  const hasRobots = ctx.robotsCount > 0;

  const appMenu: MenuSection = {
    label: 'PathBlender',
    macOnly: true,
    items: [
      role('about', t('menu.about')),
      sep(),
      item('preferences', t('prefs.title'), { accelerator: 'CmdOrCtrl+,' }),
      item('check-update', t('prefs.checkUpdates')),
      sep(),
      role('hide', t('menu.hide')),
      role('hideOthers', t('menu.hideOthers')),
      role('quit', t('menu.quit')),
    ],
  };

  const fileItems: MenuEntry[] = [
    item('import', t('actions.import'), { accelerator: 'CmdOrCtrl+O' }),
  ];
  if (!ctx.viewerOnly) {
    fileItems.push(item('import-folder', t('library.importFolder')));
    fileItems.push(item('open-session', t('welcome.openSession')));
    fileItems.push(sep());
    fileItems.push(item('save', t('actions.save'), { accelerator: 'CmdOrCtrl+S' }));
    fileItems.push(item('export-package', t('menu.exportPackage')));
    fileItems.push(item('export-gif', t('menu.exportGif')));
  }
  fileItems.push(sep());
  fileItems.push(item('clear', t('menu.clearSession')));

  const editItems: MenuEntry[] = [
    item('undo', t('workspace.undo'), { accelerator: 'CmdOrCtrl+Z', enabled: ctx.canUndo }),
    item('redo', t('workspace.redo'), { accelerator: 'Shift+CmdOrCtrl+Z', enabled: ctx.canRedo }),
    sep(),
    role('cut', t('menu.cut')),
    role('copy', t('menu.copy')),
    role('paste', t('menu.paste')),
    role('selectAll', t('menu.selectAll')),
  ];
  if (hasRobots) {
    editItems.push(
      sep(),
      item('rename-selected', t('menu.renameTeam'), { enabled: ctx.hasSelection }),
      item('mirror-selected', t('robots.mirror'), { enabled: ctx.hasSelection }),
      item('visibility-selected', t(ctx.selectedVisible ? 'menu.hideTeam' : 'menu.showTeam'), { enabled: ctx.hasSelection }),
      item('remove-selected', t('robots.removeFromSession'), { enabled: ctx.hasSelection }),
      sep(),
      item('apply-profile', t('robots.applyProfile'), { enabled: ctx.hasSelection }),
      item('arrange-selected', t('sequence.arrange'), { enabled: ctx.hasSelection }),
    );
    if (ctx.composerOpen) editItems.push(item('composer-back', t('sequence.back')));
  }

  const seasonItems: MenuEntry[] = FIELDS.map((f) =>
    check(`season-${f.id}`, `${f.name} ${f.year}`, ctx.fieldId === f.id));
  seasonItems.push(sep());
  seasonItems.push(check('season-custom', t('customField.title'), ctx.fieldId === 'custom'));

  const viewItems: MenuEntry[] = [item('fit', t('canvas.fit'), { accelerator: 'CmdOrCtrl+0' })];
  if (ctx.field3dAvailable) {
    viewItems.push(
      sep(),
      check('view-2d', '2D', !ctx.view3D),
      check('view-3d', '3D', ctx.view3D),
    );
  }
  viewItems.push(
    sep(),
    check('alliance-blue', t('robots.blue'), ctx.alliance === 'blue', { enabled: hasRobots }),
    check('alliance-red', t('robots.red'), ctx.alliance === 'red', { enabled: hasRobots }),
    sep(),
    submenu(t('workspace.season'), seasonItems, { enabled: hasRobots }),
    submenu(t('field.variant'), [
      check('construction-welded', 'Welded', ctx.fieldVariant === 'welded'),
      check('construction-andymark', 'AndyMark', ctx.fieldVariant === 'andymark'),
    ], { enabled: hasRobots && ctx.andymarkAvailable }),
  );
  if (ctx.hasRenderedArt) {
    viewItems.push(submenu(t('field.style'), [
      check('style-schematic', t('field.style.schematic'), ctx.fieldStyle === 'schematic'),
      check('style-rendered', t('field.style.rendered'), ctx.fieldStyle === 'rendered'),
    ], { enabled: hasRobots && !ctx.view3D }));
  }
  viewItems.push(
    sep(),
    // The heatmap renders in both 2D and 3D (2026-10-06) — no 3D gate.
    check('heatmap', t(ctx.showHeatmap ? 'actions.heatmapOff' : 'actions.heatmapOn'), ctx.showHeatmap, { enabled: hasRobots }),
    item('ab-compare', t('actions.abCompare'), { enabled: hasRobots }),
  );

  const playbackItems: MenuEntry[] = [
    item('play-pause', t(ctx.playing ? 'timeline.pause' : 'timeline.play'), { enabled: hasRobots }),
    item('rewind', t('timeline.rewind'), { enabled: hasRobots }),
    item('step-back', t('timeline.stepBack'), { enabled: hasRobots }),
    item('step-forward', t('timeline.stepForward'), { enabled: hasRobots }),
    sep(),
    submenu(t('timeline.playbackSpeed'), MENU_SPEEDS.map((s) =>
      check(`speed-${String(s).replace('.', '_')}`, t('timeline.speed', { n: s }), ctx.speed === s)), { enabled: hasRobots }),
    submenu(t('timeline.range'), [
      check('range-full', t('timeline.rangeFull'), ctx.playbackRange === 'full'),
      check('range-paths', t('timeline.rangePaths'), ctx.playbackRange === 'paths'),
    ], { enabled: hasRobots }),
    sep(),
    item('jump-first-issue', t('menu.jumpFirstIssue'), { enabled: hasRobots && ctx.hasIssues }),
  ];

  const windowMenu: MenuSection = {
    label: 'Window',
    macOnly: true,
    items: [
      role('minimize', t('menu.minimize')),
      role('zoom', t('menu.zoom')),
    ],
  };

  const helpItems: MenuEntry[] = [item('github', t('menu.githubProject'))];
  // macOS keeps About in the app menu; other platforms (and the web) get it here.
  helpItems.push(sep(), item('about', t('menu.about'), { macHide: true }));
  if (ctx.isDesktop) helpItems.push(item('check-update', t('prefs.checkUpdates')));

  return [
    appMenu,
    { label: t('menu.file'), items: fileItems },
    { label: t('menu.edit'), items: editItems },
    { label: t('menu.view'), items: viewItems },
    { label: t('menu.playback'), items: playbackItems },
    windowMenu,
    { label: t('menu.help'), items: helpItems },
  ];
}

/* Wire format for the Rust `set_menu` command: the same tree, snake_case. */
export interface MenuPayloadItem {
  id?: string;
  role?: string;
  label?: string;
  accelerator?: string;
  kind?: string;
  checked?: boolean;
  enabled?: boolean;
  mac_only?: boolean;
  mac_hide?: boolean;
  items?: MenuPayloadItem[];
}
export interface MenuPayloadSection {
  label: string;
  mac_only?: boolean;
  items: MenuPayloadItem[];
}

export function menuSpecPayload(sections: MenuSection[]): { menus: MenuPayloadSection[] } {
  const convItem = (e: MenuEntry): MenuPayloadItem => ({
    id: e.id,
    role: e.role,
    label: e.label,
    accelerator: e.accelerator,
    kind: e.kind,
    checked: e.checked,
    enabled: e.enabled,
    mac_only: e.macOnly,
    mac_hide: e.macHide,
    items: e.items?.map(convItem),
  });
  return {
    menus: sections.map((m) => ({
      label: m.label,
      mac_only: m.macOnly,
      items: m.items.map(convItem),
    })),
  };
}

/**
 * Every dispatchable id in the spec, in tree order. The app binds exactly
 * these to `pb-menu-*` events, so a new menu item without an entry here
 * (and in runMenuCommand) fails loudly in tests instead of silently.
 */
export function menuCommandIds(sections: MenuSection[]): string[] {
  const ids: string[] = [];
  const walk = (items: MenuEntry[]) => {
    for (const e of items) {
      if (e.id) ids.push(e.id);
      if (e.items) walk(e.items);
    }
  };
  for (const m of sections) walk(m.items);
  return ids;
}
