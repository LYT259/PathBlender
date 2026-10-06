import { describe, expect, it } from 'vitest';
import { en } from '../src/i18n/en';
import { buildMenuSpec, menuCommandIds, menuSpecPayload, type MenuContext } from '../src/menu-spec';
import { FIELDS } from '@pathblender/core';

/** English-menu context with a populated session. */
function ctx(overrides: Partial<MenuContext> = {}): MenuContext {
  return {
    t: (key, params) => {
      let text: string = en[key];
      for (const [k, v] of Object.entries(params ?? {})) text = text.replaceAll(`{${k}}`, String(v));
      return text;
    },
    robotsCount: 2,
    hasSelection: true,
    selectedVisible: true,
    composerOpen: false,
    canUndo: true,
    canRedo: false,
    view3D: false,
    field3dAvailable: true,
    alliance: 'blue',
    fieldId: 'rebuilt-2026',
    fieldVariant: 'welded',
    andymarkAvailable: true,
    hasRenderedArt: true,
    fieldStyle: 'schematic',
    showHeatmap: false,
    playing: false,
    speed: 1,
    playbackRange: 'full',
    hasIssues: true,
    viewerOnly: false,
    isDesktop: false,
    ...overrides,
  };
};

const idsOf = (items: { id?: string }[]) => items.map((e) => e.id ?? `role:${e.role}`);
const find = (sections: ReturnType<typeof buildMenuSpec>, label: string) =>
  sections.find((m) => m.label === label);

describe('menu spec', () => {
  it('exposes File | Edit | View | Playback | Help on the web (macOS-only sections dropped)', () => {
    const spec = buildMenuSpec(ctx());
    const web = spec.filter((m) => !m.macOnly);
    expect(web.map((m) => m.label)).toEqual(['File', 'Edit', 'View', 'Playback', 'Help']);
    // The full native tree carries the two macOS-only menus as well.
    expect(spec.map((m) => m.label)).toEqual(['PathBlender', 'File', 'Edit', 'View', 'Playback', 'Window', 'Help']);
  });

  it('File menu carries every import/save/export entry point', () => {
    const file = find(buildMenuSpec(ctx()), 'File')!;
    expect(idsOf(file.items)).toEqual([
      'import', 'import-folder', 'open-session', 'role:separator',
      'save', 'export-package', 'export-gif', 'role:separator', 'clear',
    ]);
    expect(file.items.find((e) => e.id === 'save')?.accelerator).toBe('CmdOrCtrl+S');
    expect(file.items.find((e) => e.id === 'import')?.accelerator).toBe('CmdOrCtrl+O');
  });

  it('viewer-only websites drop save/export/open-session but keep import and clear', () => {
    const file = find(buildMenuSpec(ctx({ viewerOnly: true })), 'File')!;
    const ids = idsOf(file.items);
    expect(ids).not.toContain('save');
    expect(ids).not.toContain('export-package');
    expect(ids).not.toContain('export-gif');
    expect(ids).not.toContain('open-session');
    expect(ids).not.toContain('import-folder');
    expect(ids).toContain('import');
    expect(ids).toContain('clear');
  });

  it('Edit menu maps the per-team context-menu actions to the selected robot', () => {
    const edit = find(buildMenuSpec(ctx()), 'Edit')!;
    const ids = idsOf(edit.items);
    for (const id of ['undo', 'redo', 'rename-selected', 'mirror-selected', 'visibility-selected', 'remove-selected', 'apply-profile', 'arrange-selected']) {
      expect(ids, id).toContain(id);
    }
    expect(ids).not.toContain('composer-back');
    const composerOpen = find(buildMenuSpec(ctx({ composerOpen: true })), 'Edit')!;
    expect(idsOf(composerOpen.items)).toContain('composer-back');
  });

  it('undo/redo disable without history; per-team items disable without selection', () => {
    const edit = find(buildMenuSpec(ctx({ canUndo: false, canRedo: false, hasSelection: false })), 'Edit')!;
    expect(edit.items.find((e) => e.id === 'undo')?.enabled).toBe(false);
    expect(edit.items.find((e) => e.id === 'redo')?.enabled).toBe(false);
    expect(edit.items.find((e) => e.id === 'remove-selected')?.enabled).toBe(false);
  });

  it('View menu covers fit, 2D/3D, alliance, season list (all fields + custom), construction, artwork, heatmap and A-B compare', () => {
    const view = find(buildMenuSpec(ctx()), 'View')!;
    const ids = idsOf(view.items);
    for (const id of ['fit', 'view-2d', 'view-3d', 'alliance-blue', 'alliance-red', 'heatmap', 'ab-compare']) {
      expect(ids, id).toContain(id);
    }
    const seasons = view.items.find((e) => e.id === undefined && e.kind === 'submenu' && e.label === 'Game season')!;
    const seasonIds = idsOf(seasons.items ?? []);
    for (const f of FIELDS) expect(seasonIds, f.id).toContain(`season-${f.id}`);
    expect(seasonIds).toContain('season-custom');
    expect(seasons.items?.find((e) => e.id === 'season-rebuilt-2026')?.checked).toBe(true);
  });

  it('Playback menu maps the transport, speeds, range and first-issue jump', () => {
    const playback = find(buildMenuSpec(ctx({ speed: 0.5 })), 'Playback')!;
    const ids = idsOf(playback.items);
    for (const id of ['play-pause', 'rewind', 'step-back', 'step-forward', 'jump-first-issue']) {
      expect(ids, id).toContain(id);
    }
    const speeds = playback.items.find((e) => e.label === 'Playback speed')!;
    expect(idsOf(speeds.items ?? [])).toEqual(['speed-0_25', 'speed-0_5', 'speed-1']);
    expect(speeds.items?.find((e) => e.id === 'speed-0_5')?.checked).toBe(true);
    const ranges = playback.items.find((e) => e.label === 'Playback range')!;
    expect(ranges.items?.find((e) => e.id === 'range-full')?.checked).toBe(true);
  });

  it('labels follow the state: Play/Pause, Show/Hide team, heatmap', () => {
    const spec = buildMenuSpec(ctx({ playing: false, showHeatmap: true }));
    expect(find(spec, 'Playback')!.items[0]?.label).toBe('Play');
    expect(find(spec, 'View')!.items.find((e) => e.id === 'heatmap')?.label).toBe('Hide heatmap');
    const hidden = buildMenuSpec(ctx({ selectedVisible: false }));
    expect(find(hidden, 'Edit')!.items.find((e) => e.id === 'visibility-selected')?.label).toBe('Show Selected Team');
  });

  it('heatmap stays enabled in the 3D view (it renders on the ground there too)', () => {
    const heatmapOf = (c: MenuContext) => find(buildMenuSpec(c), 'View')!.items.find((e) => e.id === 'heatmap');
    expect(heatmapOf(ctx({ view3D: true }))?.enabled).toBe(true);
    expect(heatmapOf(ctx({ view3D: false }))?.enabled).toBe(true);
    expect(heatmapOf(ctx({ view3D: true, robotsCount: 0 }))?.enabled).toBe(false);
  });

  it('every dispatchable id is unique across the whole tree', () => {
    const ids = menuCommandIds(buildMenuSpec(ctx()));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('serializes to the Rust wire format with snake_case flags', () => {
    const payload = menuSpecPayload(buildMenuSpec(ctx()));
    expect(payload.menus).toHaveLength(7);
    expect(payload.menus[0]).toMatchObject({ label: 'PathBlender', mac_only: true });
    const file = payload.menus[1]!;
    const save = file.items.find((e) => e.id === 'save')!;
    expect(save).toMatchObject({ accelerator: 'CmdOrCtrl+S', kind: 'item', enabled: true });
    expect(save.mac_only).toBeUndefined();
  });
});
