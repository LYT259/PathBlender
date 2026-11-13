/**
 * Bidirectional CSS contract tests (2026-11-09 RTL/LTR audit, red book item
 * ② second half). The RTL infrastructure pins the direction-sensitive data
 * surfaces (timeline axis, conflict rows, number inputs) to ltr; everything
 * else in reading flow must use logical properties so Hebrew mirrors
 * correctly. These tests keep that boundary reviewable: every physical
 * direction declaration in the product CSS must either have been converted
 * to a logical property or appear on the PHYSICAL_ALLOWLIST below with a
 * reason — the list is the audit's deliverable, and it stays finite. A new
 * physical margin-left in a dialog fails here until it is either converted
 * or consciously added to the list with justification.
 *
 * Behavioral verification (layout mirroring, menu overflow, switch knob)
 * runs in a real browser via scripts/bidi-acceptance.mjs; this file pins
 * the source-level contract.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(__dirname, '../src');

type Decl = { file: string; line: number; prop: string; value: string; selector: string };

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...cssFiles(p));
    else if (e.endsWith('.css')) out.push(p);
  }
  return out;
}

/**
 * Lightweight declaration extractor for the subset these stylesheets use:
 * one selector (possibly multiline) per rule, declarations inline. Like the
 * workflow parser in release-pipeline.test.ts this is deliberately
 * dependency-free and doubles as a style constraint — @media blocks are
 * flattened by tracking the nearest preceding `{` selector text.
 */
function extractDeclarations(): Decl[] {
  const decls: Decl[] = [];
  const physical = /^(margin|padding)-(left|right)$|^border(-(top|bottom))?(-(left|right))(-[a-z-]+)?$|^(left|right)$|^(float|clear)$|^(direction|unicode-bidi)$|^translate$|^transform$|^inset$/;
  for (const path of cssFiles(SRC)) {
    // Forward-slash keys keep PHYSICAL_ALLOWLIST matching identical on every
    // platform (Windows readdir yields backslash-separated paths).
    const file = relative(SRC, path).split(sep).join('/');
    const lines = readFileSync(path, 'utf-8').split('\n');
    let selector = '';
    for (let i = 0; i < lines.length; i++) {
      const text = lines[i];
      const brace = text.indexOf('{');
      if (brace !== -1) selector = text.slice(0, brace).trim();
      for (const m of text.matchAll(/([-a-zA-Z]+)\s*:\s*([^;{}]+)/g)) {
        const prop = m[1].toLowerCase();
        const value = m[2].trim();
        // 4-value shorthands only matter when left/right differ (symmetry
        // cannot break RTL); 1–3 value forms have no separate left/right.
        if (/^(margin|padding)$/.test(prop)) {
          const parts = value.split(/\s+/);
          if (parts.length === 4 && parts[1] !== parts[3]) {
            decls.push({ file, line: i + 1, prop, value, selector });
          }
          continue;
        }
        const physicalProp = physical.test(prop);
        const physicalAlign = prop === 'text-align' && /^(left|right)$/.test(value);
        if (!physicalProp && !physicalAlign) continue;
        if (prop === 'inset') {
          const parts = value.split(/\s+/);
          // `inset: 0` (all sides equal) is symmetric; anything else can
          // dock a panel on one physical edge.
          if (parts.length === 4 && !(parts[0] === parts[1] && parts[1] === parts[2] && parts[2] === parts[3])) {
            decls.push({ file, line: i + 1, prop, value, selector });
          }
          continue;
        }
        if (prop === 'text-align' && !physicalAlign) continue;
        if (prop === 'transform' || prop === 'translate') {
          // Vertical/scale-free motion (translateY, uniform centering) is
          // direction-neutral; horizontal translation and rotation are not.
          if (!/x|rotate/i.test(value.replace(/translateY/g, ''))) continue;
        }
        decls.push({ file, line: i + 1, prop, value, selector });
      }
    }
  }
  return decls;
}

/**
 * Physical exceptions — the reviewable deliverable. Each entry must match at
 * least one live declaration (checked below, KEEP_VERBATIM discipline) and
 * carries the reason it must NOT flip with the reading direction.
 */
const PHYSICAL_ALLOWLIST: { file: string; selector: string; prop: string; why: string }[] = [
  // --- Pinned-ltr surfaces: the time axis is physical, not reading order ---
  { file: 'components/Timeline.css', selector: '.timeline', prop: '*', why: 'timeline-workspace pins direction:ltr — the time axis is physical' },
  { file: 'components/SequenceTimelineComposer.css', selector: '.sequence-axis', prop: '*', why: 'inside the dir="ltr" sequence-timeline-scroll surface' },
  { file: 'components/SequenceTimelineComposer.css', selector: '.sequence-track', prop: '*', why: 'inside the dir="ltr" sequence-timeline-scroll surface' },
  { file: 'components/SequenceTimelineComposer.css', selector: '.sequence-clip', prop: '*', why: 'clips are placed by physical seconds-to-px left offsets' },
  { file: 'components/SequenceTimelineComposer.css', selector: '.sequence-auto-end', prop: '*', why: 'inside the dir="ltr" timeline surface' },
  { file: 'components/SequenceTimelineComposer.css', selector: '.sequence-seam', prop: '*', why: 'seam marker on the physical time axis' },
  { file: 'components/SequenceTimelineComposer.css', selector: '.sequence-gap-guide', prop: '*', why: 'arrowheads on the physical time axis' },
  { file: 'components/SequenceTimelineComposer.css', selector: '.sequence-timeline-surface', prop: '*', why: 'right gutter under the pinned ltr scroller scrollbar' },
  { file: 'components/SequenceTimelineComposer.css', selector: '.sequence-drag-badge', prop: '*', why: 'fixed badge rides the physical pointer position' },
  { file: 'app.css', selector: '.tick', prop: '*', why: 'inside pinned-ltr timeline-workspace' },
  { file: 'app.css', selector: '.ticks', prop: '*', why: 'symmetric left:0;right:0 stretch of the pinned-ltr tick strip' },
  { file: 'app.css', selector: '.conflict-jump', prop: '*', why: 'inside .conflict-list, pinned ltr for order-sensitive data rows' },
  { file: 'workspace.css', selector: '.conflict-jump', prop: '*', why: 'border-left-width pairs with the pinned-ltr conflict-jump stripe' },
  { file: 'components/TeamOrderUI.css', selector: '.team-order-ghost', prop: '*', why: 'fixed drag ghost rides the physical pointer position' },

  // --- Canvas overlays: field geometry and pointer position are physical ---
  { file: 'app.css', selector: '.viewcube', prop: 'right', why: '3D orientation gizmo overlays the physical canvas viewport' },
  { file: 'components/RobotLabels3D.css', selector: '.robot-label-3d', prop: 'left', why: 'labels are placed by projected field coordinates' },

  // --- Hardware / illustration: pictures of physical things ---
  { file: 'components/PreferencesPanel.css', selector: '.mouse-callout', prop: '*', why: 'a mouse diagram — left/middle/right buttons are physical hardware' },
  { file: 'components/PreferencesPanel.css', selector: '.preferences-theme-preview', prop: '*', why: 'theme thumbnails are a fixed schematic, not reading flow' },

  // --- Recorded design decisions (comments in the source) ---
  { file: 'components/LanguagePicker.css', selector: '.language-picker-mark', prop: 'text-align', why: 'mark column deliberately stays on the physical right (see :dir(rtl) grid there)' },
  { file: 'components/MenuBar.css', selector: '.menu-sub-arrow', prop: 'transform', why: 'deliberate :dir(rtl) scaleX mirror of the submenu arrow' },

  // --- Inputs pinned ltr by the RTL infrastructure ---
  { file: 'components/RobotList.css', selector: '.robot-inspector-row input', prop: 'text-align', why: 'numeric fields are ltr-pinned; right edge is the numeric convention' },

  // --- Direction-neutral motion / symmetric centering ---
  { file: 'components/OnboardingTasks.css', selector: '.tour-toggle', prop: 'transform', why: 'rotate(±90deg) yields vertical (up/down) arrows — direction-neutral' },
  { file: 'components/WelcomeScreen.css', selector: '.start-secondary::before', prop: '*', why: 'left:50% + translate(-50%,-50%) is symmetric centering' },
  { file: 'app.css', selector: '.toast', prop: '*', why: 'symmetric centering (left:0;right:0;margin:auto)' },

  // --- The RTL infrastructure itself ---
  { file: 'app.css', selector: "html[dir='rtl']", prop: '*', why: 'the deliberate ltr pins for timeline/conflict-list/number inputs' },
  { file: 'components/LanguagePicker.css', selector: '.language-picker-mark', prop: 'unicode-bidi', why: 'bidi isolation of the mark column — correct in both directions' },

  // --- Dead styles: selectors with no live DOM (verified 2026-11-09, rg over
  //     all .tsx/.ts). Left in place; removal is a separate cleanup, and the
  //     entries below keep them from masking new live regressions. ---
  { file: 'app.css', selector: '.ai-', prop: '*', why: 'dead: AI feature removed 2026-09-30, no TSX references' },
  { file: 'app.css', selector: '.editor-actions', prop: '*', why: 'dead selector, no TSX references' },
  { file: 'app.css', selector: '.waypoint-panel', prop: '*', why: 'dead selector, no TSX references' },
  { file: 'app.css', selector: '.wp-', prop: '*', why: 'dead waypoint editor styles, no TSX references' },
  { file: 'app.css', selector: '.band-', prop: '*', why: 'dead per-robot band styles, no TSX references' },
  { file: 'app.css', selector: '.canvas-tools', prop: '*', why: 'dead selector, no TSX references' },
  { file: 'app.css', selector: '.geom-', prop: '*', why: 'dead selector, no TSX references' },
  { file: 'app.css', selector: '.chev', prop: '*', why: 'dead selector, no TSX references' },
  { file: 'app.css', selector: '.sw-track', prop: '*', why: 'dead switch styles, no TSX references' },
  { file: 'app.css', selector: '.clock', prop: 'margin-left', why: 'margin-left:auto inside the pinned-ltr timeline transport pushes the clock to the physical time-axis end' },
  { file: 'app.css', selector: '.auto-resolve', prop: '*', why: 'dead selector, no TSX references' },
  { file: 'workspace.css', selector: '.switch', prop: '*', why: 'dead switch styles, no TSX references' },
  { file: 'workspace.css', selector: '.ai-', prop: '*', why: 'dead: AI feature removed 2026-09-30, no TSX references' },
  { file: 'workspace.css', selector: '.history-controls', prop: '*', why: 'margin-left:0 is a no-op in both directions (keeps flex default)' },
  { file: 'workspace.css', selector: '.wp-head', prop: '*', why: 'dead waypoint styles, no TSX references' },
  { file: 'workspace.css', selector: '.wp-toggle', prop: '*', why: 'dead waypoint styles, no TSX references' },
];

function matchesEntry(d: Decl, a: (typeof PHYSICAL_ALLOWLIST)[number]): boolean {
  return a.file === d.file && (a.prop === '*' || a.prop === d.prop)
    && (d.selector.includes(a.selector) || a.selector.includes(d.selector));
}

function allowlistMatch(d: Decl): (typeof PHYSICAL_ALLOWLIST)[number] | undefined {
  return PHYSICAL_ALLOWLIST.find((a) => matchesEntry(d, a));
}

describe('bidirectional CSS physical-direction contract', () => {
  const decls = extractDeclarations();

  it('enumerates a non-trivial inventory', () => {
    expect(decls.length).toBeGreaterThan(80);
  });

  it('every physical declaration is converted or on the reviewable allowlist', () => {
    const offenders = decls.filter((d) => !allowlistMatch(d));
    const report = offenders.map((d) => `${d.file}:${d.line} ${d.selector}{${d.prop}:${d.value}}`).join('\n');
    expect(report, `physical direction declarations missing from PHYSICAL_ALLOWLIST (convert to logical properties or add a reviewed entry):\n${report}`).toBe('');
  });

  it('no allowlist entry is stale (each must still match a live declaration)', () => {
    const stale = PHYSICAL_ALLOWLIST.filter((a) => !decls.some((d) => matchesEntry(d, a)));
    expect(stale.map((a) => `${a.file} ${a.selector} ${a.prop}`).join('; '), 'stale allowlist entries — remove them').toBe('');
  });

  // Positive pins: the reading-flow surfaces the real-browser baseline proved
  // broken in Hebrew must now use logical properties. Returns each matching
  // declaration together with its rule's selector line for containment checks.
  const rule = (file: string, prop: string) => {
    const lines = readFileSync(join(SRC, file), 'utf-8').split('\n');
    const hits: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].includes(prop)) continue;
      let sel = '';
      for (let j = i; j >= 0 && j > i - 30; j--) {
        if (lines[j].includes('{')) { sel = lines[j]; break; }
      }
      hits.push(sel, lines[i]);
    }
    return hits.join('\n');
  };

  it('panel separators face the content on both sides (inspector, library, conflict, prefs sidebar)', () => {
    expect(rule('workspace.css', 'border-inline-start: 1px')).toContain('.workspace-inspector');
    expect(rule('app.css', 'border-inline-end')).toContain('.robot-list');
    expect(rule('app.css', 'border-inline-start: 1px')).toContain('.conflict-panel');
    expect(rule('components/PreferencesPanel.css', 'border-inline-end: 1px')).toContain('.preferences-sidebar');
  });

  it('menus anchor and fly out on the reading side', () => {
    expect(rule('components/MenuBar.css', 'inset-inline-start: 0')).toContain('.menu-panel');
    expect(rule('components/MenuBar.css', 'inset-inline-start: calc(100% - 2px)')).toContain('.menu-sub-panel');
    expect(rule('components/MenuBar.css', 'scaleX(-1)')).not.toBe('');
  });

  it('the calibration panel offsets from the reading start edge', () => {
    expect(rule('app.css', 'inset-inline-start: 280px')).toContain('.cf-panel');
  });

  it('the preferences switch knob mirrors with the reading direction', () => {
    expect(rule('components/PreferencesPanel.css', 'inset-inline-start: 2px')).not.toBe('');
    expect(rule('components/PreferencesPanel.css', 'inset-inline-start: 13px')).not.toBe('');
  });

  it('reading-flow lists indent from the inline start', () => {
    const guide = rule('components/GuideDialog.css', 'padding-inline-start: 18px');
    expect(guide).toContain('.guide-topic ul');
    expect(rule('wpilog/WpilogImportDialog.css', 'padding-inline-start: 18px')).toContain('.wpilog-logwarnings ul');
    expect(rule('app.css', 'padding-inline-start: 18px')).toContain('.import-banner ul');
  });

  it('push-to-end margins are inline-relative', () => {
    expect(rule('components/OnboardingTasks.css', 'margin-inline-start: auto')).toContain('.tour-progress');
    expect(rule('components/UsageTip.css', 'margin-inline-start: auto')).toContain('.example-notice .btn');
    expect(rule('components/PreferencesPanel.css', 'margin-inline-start: auto')).toContain('.preferences-footer > div');
  });
});
