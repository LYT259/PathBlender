# ADR-0004: Interface accent color as a third independent appearance axis

- Status: Accepted (2026-10-17)
- Scope: packages/web (theme system, CSS tokens, preferences, canvas rendering)

## Context

The UI has carried a single system-blue accent since the first palette
(ADR line: report v1.7 §7.4). The brand triad decided on 2026-09-26 (icon
red `#911D23`, black, silver `#B5B8BB`) never reached the interface: AGENTS.md
explicitly left "UI 若改用品牌红属独立视觉决策（走 ADR）". On 2026-10-17 the
user specified the feature: a Settings entry offering three accents — blue
(default), brand red, silver — affecting ONLY chrome (primary buttons,
selection, sliders, switch-ON, links, interactive icons, focus rings);
alliance/heatmap/bumper/path and success/warning/error/out-of-bounds colors
stay data or functional colors. No custom picker, no "follow system accent".

Two structural problems had to be solved first:

1. **Heatmap coupling.** The occupancy heatmap's blue tint read `--accent`
   (robot-identity.ts `heatmapColor(alliance, accent, danger)`), so the
   alliance data visualization would have followed the chrome color.
2. **One token, every role.** `--accent` served as button fill, text/icon
   color and selection tint simultaneously. Brand red `#911D23` is 1.95:1
   on the dark background and silver `#B5B8BB` is 1.8:1 on the light one —
   a single value cannot be both a fill and readable text in both modes.

## Decision

1. **Axis split** (theme.tsx): the accent joins dark/light mode and the app
   icon as a third independent preference — `pb.accent` ∈ {blue, red,
   silver}, missing/invalid → blue (blue stays keyless), broadcast over the
   pref bridge under key `accent` (no echo re-broadcast), written to
   `<html data-accent>` in a layout effect (no blue flash on restart).
   The settings picker stages like every shared setting: Save applies,
   Cancel/Escape/close discards.
2. **Role-split tokens** (app.css): `--accent` (fill), `--accent-fg` (text
   on fill), `--accent-text` (text/icons/borders on theme background),
   `--accent-hover`/`--accent-pressed` (fill states), `--accent-dim`
   (selection tint), `--focus-ring` (base in workspace.css, overridden per
   accent). Blue defines all of them with byte-identical former values and
   `[data-accent='blue']` matches no rule — existing users see zero change.
   CSS consumers were swept per usage: fills keep `--accent`; colors,
   strokes, borders and focus rings move to `--accent-text`. Switch-ON
   follows the accent (a control state, not success); the danger badge's
   former `--accent-fg` text became literal `#fff`.
3. **Heatmap decoupling** (robot-identity.ts): dedicated data tokens
   `--heatmap-blue`/`--heatmap-red` per theme (byte-identical to the
   accent-era values); `heatmapColor(alliance, blue, red)` no longer takes
   an accent parameter, so the coupling cannot be reintroduced silently.
4. **Canvas repaint** (FieldCanvas3D.tsx): ViewCube hover colors are baked
   into face textures — an accent switch triggers `retintCube()` + one
   dirty frame only: no scene rebuild, no camera change, no playback
   interruption; visible while paused because the rAF loop draws on need.
5. **Derived values are explicit and user-reviewable**: the two base colors
   are the user-fixed icon values; hover/pressed/text/focus/viewcube tints
   are documented with WCAG contrast figures (all text ≥4.5:1, rings
   ≥3:1) and flagged for confirmation in the PR.

Rejected: a custom color picker and a "follow system accent" option
(out of scope by user decision); retinting data colors with the accent
(analysis output must be alliance-true); rebuilding the 3D scene on accent
change (breaks camera/playback continuity).

## Consequences

- Adding a fourth accent is one CSS block + one swatch entry; the token
  contract is enforced by tests (token matrix, blue invariance, heatmap
  CSS isolation in ground-heatmap.test.ts) and the browser acceptance
  pass (scripts/accent-acceptance.mjs: 31 checks incl. full-canvas pixel
  identity of the 2D view across accents).
- The silver light-mode text variant (`--accent-text: #676c70`) and the red
  dark-mode text variant (`#e8606a`) are derived, not brand-fixed; they
  stay marked as pending-user-confirmation values.
