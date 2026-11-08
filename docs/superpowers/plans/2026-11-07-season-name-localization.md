# Season Name Localization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Localize the five built-in FRC season names in the two display surfaces (season picker and native/web menu), using only FIRST-official first-party translated names, while `core` keeps official English and all user data / export contents stay untranslated.

**Architecture:** `@pathblender/core` is untouched — `FieldPackage.name` stays the official English string (data). A new web module `packages/web/src/i18n/season-names.ts` holds an explicit `field id → MessageKey` map plus a `seasonLabel()` helper; `App.tsx` and `menu-spec.ts` render through it. Translations land as five new `MessageKey`s in `en.ts` and propagate to all 43 locale dictionaries (40 hand-maintained full dictionaries; `en-gb`/`zh-hk`/`zh-mo` inherit by spread). `zh-tw` is produced by `scripts/gen-zh-hant.mjs` from `zh.ts`. The untranslated-residue gate in `i18n.test.ts` is satisfied through per-language `KEEP_VERBATIM` whitelist entries wherever no official translation exists.

**Tech Stack:** TypeScript, React, Vitest, npm workspaces (`packages/web`, `@pathblender/core`), OpenCC-based generator `scripts/gen-zh-hant.mjs` (dev-time only).

**Spec:** Red book `PathBlender_红皮书.md` §7.2 (private file, main tree only — not in this worktree; the operative excerpt is inlined below so the spec travels with this plan). Item: v1.21 落地 section, "未做" paragraph, legacy item ⑤. Work-package assignment (2026-11-07, red-book-backlog coordinator): core `FieldPackage.name` keeps official English; add web `season-names.ts` explicit id→MessageKey mapping; App season selection and menu-spec display use `seasonLabel`; custom field/team/route/filename and solution-package official fields are never translated; only official first-party translated names are localized, everything else stays English + whitelist; `zh-tw` via the generator.

**Spec excerpt (verbatim, translated):**

> GHPaths v1.31 sync item ⑤ (table row, judged ✅ 适用/applicable): 「内置场地名本地化：控制台自定义名属**产品文案**，只在显示层本地化；用户导入名与写入导出文件的内容保持原文（**数据**）」／ Built-in field-name localization: console built-in names are **product copy** and localize only at the display layer; user-imported names and anything written into exported files stay verbatim (**data**). — 「本项目内置 2026 场名同样……；用户导入的路径/文件名/队号是数据，任何语言下都不翻」/ our built-in 2026 field name likewise; user-imported path/file names and team numbers are data and never translate in any language.
>
> v1.21 落地, "未做": 「第 ⑤ 条内置赛季名本地化（`packages/core/src/field.ts` 的 `name` 现仍为官方英文名，用户导入的路线名/队号/文件名一律按数据保持原文不翻）」/ legacy item ⑤: built-in season-name localization (`packages/core/src/field.ts`'s `name` remains the official English name; user-imported route names / team numbers / file names stay verbatim as data).

## Verified repo facts (planning-time, 2026-11-07, base `origin/beta@7fed5404`)

- `packages/web/src/i18n/` holds **43 locale dictionaries** + `language-names.ts` + `language-search.ts` = 45 `.ts` files (`index.tsx` is the provider, separate). Of the 43: **40 full `Record<MessageKey, string>` dictionaries** (`en.ts`, `zh-tw.ts` generated-but-hand-editable, and 38 others) and **3 spread-materialized composites** (`en-gb.ts` = `{...en, ...enGbOverrides}`, `zh-hk.ts` = `{...zhTw, ...zhHkOverrides}`, `zh-mo.ts` = `{...zhHk, ...zhMoOverrides}`) — composites need no edits for new keys.
- `MessageKey` is derived from `en.ts`; `DICTS: Record<Lang, Record<MessageKey, string>>` (`index.tsx:62`) makes a missing key a **compile error** in every full dictionary.
- Seasons (`packages/core/src/field.ts:435` `FIELDS`, order 2022→2026): `rapidreact-2022` 'Rapid React' · `chargedup-2023` 'Charged Up' · `crescendo-2024` 'Crescendo' · `reefscape-2025` 'Reefscape' · `rebuilt-2026` 'REBUILT' (`REBUILT_2026` at `field.ts:340`). Custom fields: `CUSTOM_FIELD_ID = 'custom'`, `makeCustomField()` (`field.ts:625-660`, `name: cal.name ?? 'Custom'`) — user data.
- Display consumers today: `packages/web/src/App.tsx:1590` (`{f.name} {f.year}` inside the `.field-select`; App-local `t` alias is `tr`, `useI18n()` at `App.tsx:151`) and `packages/web/src/menu-spec.ts:163` (`` `${f.name} ${f.year}` ``; `MenuContext.t` available; labels flow to the desktop native menu via `set_menu`, so no Rust changes ever). Custom entries already localize via `t('customField.title')` (`App.tsx:1591`, `menu-spec.ts:165`).
- Export consumer (must NOT change): `packages/web/src/solution-package.ts:497` `fieldName: \`${o.field.name} ${o.field.year}\`` → README line `Field 场地: …`.
- Test anchors: `packages/web/test/i18n.test.ts` (DICTS table ~:64; key parity ~:81; residue gate ~:203 skips `en`/`en-GB`; whitelist-staleness ~:211 forces dead entries out; `KEEP_VERBATIM` ~:114 typed `Record<Exclude<Lang,'en'>, readonly MessageKey[]>`); `packages/web/test/menu-spec.test.ts` (~:96 season items; `ctx()` builder ~:10); `packages/web/test/solution-package.test.ts` (~:195 README; `baseOptions()` ~:65 uses field name `'Rebuilt'`); `packages/web/test/workspace.test.tsx` (field-select; `beforeEach` clears localStorage) with `test/combobox.ts` helpers; `packages/web/test/accent-picker.test.tsx:68` is the precedent for `localStorage.setItem('pb.lang', 'zh')`.
- Generator: `scripts/gen-zh-hant.mjs` (run from repo root after editing `zh.ts`). Its header WARNING: `zh-tw.ts` carries hand-audited Taiwan wording the script would revert — for a **key addition**, hand-editing `zh-tw.ts` is explicitly blessed; if you regenerate, review `git diff` and revert every hunk that is not a season-key line.
- Glossary contract: `docs/i18n-glossary.md` §2 already reserves this work — 「内置场地/赛季名属**文案**，需要本地化时按本节补表（当前实现仍显示官方英文名，未本地化——待办）」/ built-in field/season names are copy; add the table in this section when localizing (currently still official English — TODO). Term-contract rule: 新术语先补表再写包 (glossary row before dictionary edit).
- FIRST official translated season materials exist in exactly six languages (red book 参考资料: French, Hebrew, Portuguese, Simplified Chinese, Spanish, Turkish) → app locales `fr`, `he`, `pt-BR`, `tr`, `zh`, `es`. FIRST ships **no** Traditional Chinese manuals — `zh-tw` derives from `zh` via the generator; `zh-hk`/`zh-mo` inherit.
- Official names verified during planning (authoritative FIRST-hosted translated game manuals; re-verify at execution):
  - zh 2026 REBUILT → 「发掘重建」— `2026GameManual-CS.pdf` (`firstfrc.blob.core.windows.net/frc2026/Manual/Translations/`), cover: 「"发掘重建"（REBUILT）赛季由Haas呈现」.
  - zh 2025 REEFSCAPE → 「珊瑚拯救」— `2025GameManual-CN.pdf` (`firstfrc.blob.core.windows.net/frc2025/Manual/TranslatedManuals/`), title: 「"珊瑚拯救"赛季比赛手册」.
  - The remaining 28 cells (6 languages × 5 seasons − 2 verified) are **unverified** and must be checked at execution; no value may be invented (see Global Constraints).

## Global Constraints

- **Pure-frontend red line** (AGENTS.md 红线 1): no backend, no telemetry; nothing here may add network calls at runtime. Fetching FIRST manuals happens at *development* time by the human/agent, not in app code.
- **core is frozen for this package**: `packages/core/**` gets zero changes. `FieldPackage.name` remains the official English name; no new core export is needed — `season-names.ts` maps by field id.
- **Data vs copy boundary**: custom field names, team numbers, route names, file names, the export README's `fieldName`, and `.pb` session contents are **data** — never localized, in any language. Only the five bundled season display labels are copy.
- **Only FIRST-official first-party translations** (translated game manuals hosted by FIRST / firstinspires.org season-material pages). Never invent, machine-translate, or community-source a season name. A cell without a verified official name keeps the English value **and** its `KEEP_VERBATIM` entry — that is the correct outcome, not a failure.
- **Key parity**: every new `MessageKey` must exist in all 43 dictionaries (compile error + `i18n.test.ts` parity otherwise). The three spread composites inherit automatically.
- **Residue gate discipline**: any value byte-identical to `en` outside the whitelist fails the suite; whitelisted entries that later get translated fail the staleness check — remove exactly the entries that gained translations, no more.
- **zh-tw via generator**: edit `zh.ts`, then either hand-add the same keys to `zh-tw.ts` in their generator-produced traditional form (blessed for key additions per the script header) or run `node scripts/gen-zh-hant.mjs` and curate the diff so only season-key lines change. Never convert by hand from scratch.
- **zh-hk / zh-mo / en-GB**: no season edits — inheritance is the mechanism (CLDR layering; official English name identical in both English rows).
- **Glossary first**: add the season-name table (values + per-name source) to `docs/i18n-glossary.md` §2 in the same change set as the translations; update its "未本地化——待办" note to done.
- **Label shape**: `"<name> <year>"` — dictionary value is the bare name; `seasonLabel()` appends ` ${year}` in code (no `{n}` placeholder; keeps dictionaries trivially parity-safe).
- **Key naming** follows the `sequence.startGroup<Id>` precedent (`field.ts:157`): dash stripped, segment capitalized → `season.rebuilt2026`, `season.rapidreact2022`, `season.chargedup2023`, `season.crescendo2024`, `season.reefscape2025`.
- **Process**: TDD; one English commit message per task's commit step; work on branch `feat/season-name-localization` (already checked out, base `origin/beta@7fed5404`); after any build, check `git diff` for generated `sw.js` noise and keep it out of commits (AGENTS.md). Version bump and PR/merge follow the AGENTS.md beta delivery flow (see Task 5 and External items).

## Review Focus

The five input classes / failure modes this change is most likely to meet, each pinned to the task whose tests own it:

1. **A future season lands in `FIELDS` without a dictionary key** → it would silently render the raw core name in all 43 locales. Pinned by Task 1: `FIELDS` ids ↔ `SEASON_NAME_KEYS` keys exact set equality.
2. **`en.ts` season value drifts from the core name** (two sources of truth, e.g. `'REBUILT'` vs `'Rebuilt'`) → label changes with no core change. Pinned by Task 1: `en[key] === field.name` byte-for-byte for every field.
3. **An invented translation lands in an official-language dictionary** — the residue gate only catches values *identical* to English, so a plausible-looking wrong name passes silently. Guarded by Task 3's protocol: a glossary row citing the official manual for every non-English value; the reviewer compares each value against its cited source; unverified cells stay English + whitelisted.
4. **Custom / unknown field names get routed through the translator** (user data mutated). Pinned by Task 1: `seasonLabel()` returns the raw name for unmapped ids; `CUSTOM_FIELD_ID` has no mapping; Task 2 pins the custom menu/select entry on `t('customField.title')`.
5. **A localized label leaks into the export package or session file.** Pinned by Task 4: README `Field 场地: Rebuilt 2026` comes from the raw `FieldPackage`; the existing suite already pins `.pb` sessions to `fieldId`.

(The generator-drift failure — `zh-tw.ts` regeneration reverting audited wording — is handled procedurally in Task 3's curated-diff step, enforced by the existing `i18n.test.ts` suites over `zh-tw` content.)

---

## File Structure

- **Create** `packages/web/src/i18n/season-names.ts` — the single id→key map + `seasonLabel()`; type-only import of `MessageKey` (no runtime cycle with `index.tsx`).
- **Create** `packages/web/test/season-names.test.ts` — mapping coverage, en↔core byte-equality, label routing, custom-field passthrough.
- **Modify** `packages/web/src/i18n/en.ts` + the 39 other full dictionaries — five new keys each.
- **Modify** `packages/web/test/i18n.test.ts` — `KEEP_VERBATIM` entries (add in Task 1, trim in Task 3).
- **Modify** `packages/web/src/App.tsx` (~:1590) and `packages/web/src/menu-spec.ts` (~:163) — render via `seasonLabel`.
- **Modify** `packages/web/test/menu-spec.test.ts`, `packages/web/test/workspace.test.tsx` — label-routing tests.
- **Modify** `packages/web/src/i18n/zh.ts`, `zh-tw.ts`, `es.ts`, `fr.ts`, `he.ts`, `pt-br.ts`, `tr.ts` — official translated values (Task 3).
- **Modify** `docs/i18n-glossary.md` — season-name table with sources (Task 3).
- **Modify** `packages/web/test/solution-package.test.ts` — export boundary pin (Task 4).
- **No changes**: `packages/core/**`, `solution-package.ts`, `session*.ts`, `packages/desktop/**`.

---

### Task 1: Season label module + key scaffold across all 43 dictionaries

**Files:**
- Create: `packages/web/src/i18n/season-names.ts`
- Create: `packages/web/test/season-names.test.ts`
- Modify: `packages/web/src/i18n/en.ts` (new `season.*` block after the `field.*` block, ~:154)
- Modify: the other 39 full dictionaries (`ar.ts` … `zh.ts`, `zh-tw.ts` — see Verified repo facts for the exact 40-file list; composites excluded)
- Modify: `packages/web/test/i18n.test.ts` (`KEEP_VERBATIM`, ~:114)

**Interfaces:**
- Consumes: `FIELDS`, `CUSTOM_FIELD_ID`, `makeCustomField` from `@pathblender/core`; `MessageKey` type from `./en`.
- Produces (later tasks rely on these exact names):
  - `export const SEASON_NAME_KEYS: Readonly<Record<string, MessageKey>>` — exactly the five `FIELDS` ids → keys listed in Global Constraints.
  - `export function seasonLabel(t: (key: MessageKey) => string, field: { id: string; name: string; year: number }): string` — mapped id → `` `${t(key)} ${field.year}` ``; unmapped id → `field.name` verbatim (no year, no translation).

- [ ] **Step 1: Write the failing test** — create `packages/web/test/season-names.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CUSTOM_FIELD_ID, FIELDS, makeCustomField } from '@pathblender/core';
import { en } from '../src/i18n/en';
import { SEASON_NAME_KEYS, seasonLabel } from '../src/i18n/season-names';

const keyEcho = (key: string) => `«${key}»`; // stub proves the label routes through t()

describe('season name keys', () => {
  it('maps exactly the bundled season ids, every key present in en', () => {
    expect(Object.keys(SEASON_NAME_KEYS).sort()).toEqual(FIELDS.map((f) => f.id).sort());
    for (const key of Object.values(SEASON_NAME_KEYS)) expect(en[key]).toBeDefined();
  });

  it('the English value of every season key is the official core name, byte-for-byte', () => {
    for (const f of FIELDS) expect(en[SEASON_NAME_KEYS[f.id]!], f.id).toBe(f.name);
  });

  it('renders a bundled season through t() with the year appended', () => {
    const f = FIELDS.find((x) => x.id === 'rebuilt-2026')!;
    expect(seasonLabel(keyEcho, f)).toBe(`«season.rebuilt2026» ${f.year}`);
  });

  it('never translates custom or unknown fields — the name is user data', () => {
    const custom = makeCustomField({
      name: '黑框測試場地', lengthM: 16, widthM: 8, ppm: 100,
      marginM: 0, pixelWidth: 1600, pixelHeight: 800,
    });
    expect(seasonLabel(keyEcho, custom)).toBe('黑框測試場地');
    expect(SEASON_NAME_KEYS[CUSTOM_FIELD_ID]).toBeUndefined();
    expect(seasonLabel(keyEcho, { id: 'future-2099', name: 'New Game', year: 2099 })).toBe('New Game');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w packages/web -- season-names`
Expected: FAIL — cannot resolve `../src/i18n/season-names` (module does not exist).

- [ ] **Step 3: Implement `season-names.ts`**

Create `packages/web/src/i18n/season-names.ts` with the two exports from the Interfaces block. The map is a literal object of the five pairs; `seasonLabel` is the two-branch function described there. Add a header comment: built-in season names are product copy localized here at the display layer; `FieldPackage.name` stays official English (data) and custom names are user data (red book §7.2 v1.21 ⑤).

- [ ] **Step 4: Add the five keys to `en.ts`**

Insert after the `field.style.*` block (~:154), matching the file's prevailing quote style:

```ts
  'season.rapidreact2022': 'Rapid React',
  'season.chargedup2023': 'Charged Up',
  'season.crescendo2024': 'Crescendo',
  'season.reefscape2025': 'Reefscape',
  'season.rebuilt2026': 'REBUILT',
```

- [ ] **Step 5: Add the same five keys, English values, to the other 39 full dictionaries**

Same key order, value = the English name (byte-identical to `en.ts`), placed near each file's `field.*`/`customField.*` block where one exists, matching each file's quote style. `zh-tw.ts` is hand-edited here (generator header blesses hand edits for key additions); the traditional forms arrive in Task 3 via the generator path. The three composites (`en-gb`, `zh-hk`, `zh-mo`) are not touched.

- [ ] **Step 6: Whitelist the scaffold in `i18n.test.ts`**

In `KEEP_VERBATIM`, append the five season keys to **every** entry except `'en-GB'` (the gate skips `en` and `en-GB`; the record is typed `Record<Exclude<Lang,'en'>, …>` so every entry exists — 41 of them get the keys). This is the deliberate temporary English-scaffold state; Task 3 trims it. Keep the entries' existing formatting style.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test -w packages/web -- season-names i18n`
Expected: PASS — new suite green; i18n parity/residue/whitelist-staleness all green with the scaffold whitelisted.

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck -w packages/web`
Expected: PASS (all 40 full dictionaries carry the keys; composites compile via spread).

- [ ] **Step 9: Commit**

```bash
git add packages/web/src/i18n/season-names.ts packages/web/test/season-names.test.ts packages/web/src/i18n/*.ts packages/web/test/i18n.test.ts
git commit -m "feat(i18n): scaffold season name keys across all dictionaries"
```

### Task 2: Render season labels through i18n (App picker + menu spec)

**Files:**
- Modify: `packages/web/src/menu-spec.ts:162-165`
- Modify: `packages/web/src/App.tsx:1590`
- Modify: `packages/web/test/menu-spec.test.ts` (new test in the existing `describe`)
- Modify: `packages/web/test/workspace.test.tsx` (new test)

**Interfaces:**
- Consumes: `seasonLabel`, `SEASON_NAME_KEYS` (Task 1); `MenuContext.t`; App's `tr` alias of `t`.
- Produces: season item labels in the menu spec and the `.field-select` options are `seasonLabel(t, f)` — identical strings in English, translatable afterwards with zero further code changes.

- [ ] **Step 1: Write the failing menu test** — add to `packages/web/test/menu-spec.test.ts`:

```ts
it('season items render through the i18n season keys, not the raw core name', () => {
  // Identity t exposes the key path: any label still reading the raw core
  // name would show 'REBUILT 2026' instead of the key. Section names
  // ('View') are literals; the season submenu label is t('workspace.season').
  const keyed = buildMenuSpec(ctx({ t: (key) => key }));
  const view = keyed.find((m) => m.label === 'View')!;
  const seasons = view.items.find((e) => e.kind === 'submenu' && e.label === 'workspace.season')!;
  const items = seasons.items ?? [];
  expect(items.find((e) => e.id === 'season-rebuilt-2026')?.label).toBe('season.rebuilt2026 2026');
  expect(items.find((e) => e.id === 'season-rapidreact-2022')?.label).toBe('season.rapidreact2022 2022');
  // The custom entry is product copy with its own key, never a season key.
  expect(items.find((e) => e.id === 'season-custom')?.label).toBe('customField.title');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w packages/web -- menu-spec`
Expected: FAIL — labels are `'REBUILT 2026'` / `'Rapid React 2022'`, not the keys.

- [ ] **Step 3: Wire `menu-spec.ts`**

Replace `` check(`season-${f.id}`, `${f.name} ${f.year}`, ctx.fieldId === f.id) `` (line ~:163) with `check(`season-${f.id}`, seasonLabel(t, f), ctx.fieldId === f.id)`, adding `import { seasonLabel } from './i18n/season-names';`.

- [ ] **Step 4: Run the menu test to verify it passes**

Run: `npm test -w packages/web -- menu-spec`
Expected: PASS (the pre-existing season test at ~:96 is unaffected — English labels are unchanged).

- [ ] **Step 5: Wire `App.tsx` and pin the English path end-to-end**

In `App.tsx:1590` change `{f.name} {f.year}` to `{seasonLabel(tr, f)}` (add the import). Then add to `packages/web/test/workspace.test.tsx`:

```ts
it('season picker labels come from the dictionaries (English pin)', async () => {
  render(<App />);
  await importSamples('ghostauto/straight_run.ghostauto');
  const control = document.querySelector<HTMLElement>('.field-select')!;
  const list = openCombobox(control);
  const option = within(list).getAllByRole('option')
    .find((o) => o.getAttribute('data-value') === 'rebuilt-2026')!;
  expect(option.textContent).toBe('REBUILT 2026');
  fireEvent.keyDown(control, { key: 'Escape' });
});
```

This pin passes immediately in English (the real provider renders the same string) — its job is to hold the wired path and the label shape; the translatable behavior is proven red-first in Task 3 Step 1 and by the Task 2 stub-t menu test. Add the `openCombobox` import from `./combobox` if not already imported in this file.

- [ ] **Step 6: Run the affected suites**

Run: `npm test -w packages/web -- workspace menu-spec season-names`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/menu-spec.ts packages/web/src/App.tsx packages/web/test/menu-spec.test.ts packages/web/test/workspace.test.tsx
git commit -m "feat(web): render season labels through i18n in picker and menu"
```

### Task 3: FIRST-official translations (zh + generator + es/fr/he/pt-BR/tr), whitelist trim, glossary

**Files:**
- Modify: `packages/web/src/i18n/zh.ts`, `es.ts`, `fr.ts`, `he.ts`, `pt-br.ts`, `tr.ts`, `zh-tw.ts`
- Modify: `packages/web/test/i18n.test.ts` (`KEEP_VERBATIM` trim)
- Modify: `packages/web/test/workspace.test.tsx` (zh label test)
- Modify: `docs/i18n-glossary.md` (§2 season-name table + retire the 待办 note)

**Interfaces:**
- Consumes: the five keys from Task 1; the residue gate and whitelist-staleness test in `i18n.test.ts`; `scripts/gen-zh-hant.mjs`.
- Produces: non-English values in exactly the six FIRST-official locales (plus derived `zh-tw` and inherited `zh-hk`/`zh-mo`), each backed by a glossary row citing its source.

- [ ] **Step 1: Write the failing zh test** — add to `packages/web/test/workspace.test.tsx` (inside the describe; relies on the file's `beforeEach` localStorage clear):

```ts
it('season picker shows the FIRST-official Chinese season name', async () => {
  localStorage.setItem('pb.lang', 'zh');
  render(<App />);
  await importSamples('ghostauto/straight_run.ghostauto');
  const control = document.querySelector<HTMLElement>('.field-select')!;
  const list = openCombobox(control);
  const option = within(list).getAllByRole('option')
    .find((o) => o.getAttribute('data-value') === 'rebuilt-2026')!;
  expect(option.textContent).toBe('发掘重建 2026');
  fireEvent.keyDown(control, { key: 'Escape' });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w packages/web -- workspace`
Expected: FAIL — option text is `'REBUILT 2026'` (zh dictionary still carries the English scaffold).

- [ ] **Step 3: Verify official names (development-time evidence gathering; no runtime fetch)**

For each of the six locales × five seasons, consult FIRST's translated game manual for that season (entry point: the season-materials / translated-manuals pages on firstinspires.org; manuals are hosted under `firstfrc.blob.core.windows.net/frcYYYY/Manual/…Translations…`, file-name pattern varies by year — 2026 uses `Manual/Translations/2026GameManual-CS.pdf`, 2025 uses `Manual/TranslatedManuals/2025GameManual-CN.pdf`). Read the season name from the manual's cover/title (the parenthesized Latin name confirms the match). Already verified in planning — re-confirm the PDF still says so: zh 2026 「发掘重建」, zh 2025 「珊瑚拯救」. Record every value you adopt, with its manual URL, in the glossary table (Step 7). If a season has no translated manual, or the manual does not translate the game name, that cell keeps English + its whitelist entry — do not substitute anything.

- [ ] **Step 4: Fill `zh.ts` and regenerate `zh-tw.ts`**

Set the verified values in `zh.ts` (unverified seasons keep English). Then run `node scripts/gen-zh-hant.mjs` and inspect `git diff packages/web/src/i18n/zh-tw.ts`: **revert every hunk that is not a season-key line** (the script's own WARNING — regeneration reverts hand-audited Taiwan wording). The season lines that remain must be the generator's output (e.g. 「發掘重建」/「珊瑚拯救」); if reverting hunks is error-prone, instead hand-apply exactly those generated season lines and discard the regeneration. `zh-hk`/`zh-mo` need nothing — they inherit.

- [ ] **Step 5: Fill `es.ts`, `fr.ts`, `he.ts`, `pt-br.ts`, `tr.ts`**

Same rule: only glossary-cited official values; unverified cells keep English.

- [ ] **Step 6: Trim `KEEP_VERBATIM` and run the gates**

Remove a season key from a language's entry exactly when that language's dictionary now differs from English (the six official locales where translated; `zh-tw`, `zh-hk`, `zh-mo` now differ via conversion/inheritance). Keys that stayed English keep their entries — the whitelist-staleness test fails both directions, so it does the audit for you.

Run: `npm test -w packages/web -- i18n workspace`
Expected: PASS — the Step 1 zh test green, residue gate green with the trimmed whitelist.

- [ ] **Step 7: Glossary table (term contract: 新术语先补表)**

In `docs/i18n-glossary.md` §2, add a "赛季名 / Season names" table: one row per season × official locale that carries a translation — columns: field id, en value, locale, value, source (manual URL or page + date checked); plus one line stating the rule (official first-party names only; every other locale and every unverified cell shows the English name by design). Rewrite the section's 「当前实现仍显示官方英文名，未本地化——待办」 sentence to record that this landed (2026-11).

- [ ] **Step 8: Typecheck and commit**

Run: `npm run typecheck -w packages/web`
Expected: PASS.

```bash
git add packages/web/src/i18n/zh.ts packages/web/src/i18n/zh-tw.ts packages/web/src/i18n/es.ts packages/web/src/i18n/fr.ts packages/web/src/i18n/he.ts packages/web/src/i18n/pt-br.ts packages/web/src/i18n/tr.ts packages/web/test/i18n.test.ts packages/web/test/workspace.test.tsx docs/i18n-glossary.md
git commit -m "feat(i18n): localize season names with FIRST-official translations"
```

(If the six locales land in separate sittings, one commit per language group is acceptable — each commit must keep the suite green, including its own whitelist trim.)

### Task 4: Export boundary pin (solution package)

**Files:**
- Modify: `packages/web/test/solution-package.test.ts` (new test inside `describe('buildSolutionPackage', …)`)

**Interfaces:**
- Consumes: existing `baseOptions()` (its `field` is `{ id: 'rebuilt-2026', name: 'Rebuilt', year: 2026, … }`), `readZipDirectory`, `inflateEntry` already used in the file.
- Produces: nothing — this is a regression pin; `solution-package.ts` itself must not change.

- [ ] **Step 1: Add the pin test**

```ts
it('README keeps the official English field name — exports are data, never localized', async () => {
  const o = baseOptions();
  const result = await buildSolutionPackage({ ...o, capture: { ...o.capture } });
  const dir = readZipDirectory(result.zip);
  const readme = new TextDecoder().decode(await inflateEntry(dir[0]!));
  expect(readme).toContain('Field 场地: Rebuilt 2026'); // raw o.field.name + year
});
```

- [ ] **Step 2: Run it — expected PASS immediately**

Run: `npm test -w packages/web -- solution-package`
Expected: PASS. This is a characterization pin, not TDD-red: it documents the boundary this package must hold (the export path never receives `t`/`seasonLabel`), and turns red if anyone wires localization into exports later. If it fails, the leak already exists — stop and fix the leak, not the test.

- [ ] **Step 3: Commit**

```bash
git add packages/web/test/solution-package.test.ts
git commit -m "test(web): pin export README to official English field names"
```

### Task 5: Acceptance sweep

**Files:**
- Modify: version file via `node scripts/bump-version.mjs` (per AGENTS.md flow — this task's own commit)

**Interfaces:**
- Consumes: everything above; the repo's root scripts.
- Produces: a green full-suite run, a version bump with a 40-language note, and an explicit list of what was *not* verified here.

- [ ] **Step 1: Full workspace validation**

Run: `npm run typecheck` then `npm test` (repo root — both fan out to all workspaces)
Expected: PASS with zero failures. Do not quote expected counts — read the actual summary.

- [ ] **Step 2: Hygiene checks**

Run: `git diff --check` (whitespace) and `git status`
Expected: clean of whitespace errors; no stray files. If any build step ran, restore generated `sw.js` noise per AGENTS.md rather than committing it.

- [ ] **Step 3: Version bump + multilingual note**

Run: `node scripts/bump-version.mjs beta "Show built-in season names in the FIRST-official languages"` (or a clearer one-liner), then complete the note's translations for all 40 note languages in the same commit — `version-notes.test.ts` fails the suite otherwise (AGENTS.md 更新说明多语言纪律).

- [ ] **Step 4: Re-run the full suite after the bump**

Run: `npm test`
Expected: PASS (AGENTS.md: testing before the bump counts as not tested).

- [ ] **Step 5: Commit**

```bash
git add <version + note files as printed by the script>
git commit -m "chore(release): bump version for season name localization"
```

If another merge landed meanwhile, rebase onto `origin/beta` and re-run the bump + full suite before the PR (AGENTS.md version discipline).

## External / non-verifiable in this plan (do not fabricate)

- **Tri-platform full validation, Pre-release publishing, dual-site deploy verification** — owned by the AGENTS.md beta delivery process at PR/merge time (Mac local + CI Windows/Linux). This plan's executor must not claim those results; they are recorded by the merge/release flow.
- **Mac desktop native-menu smoke** — the menu flows from `menu-spec` via `set_menu`, so it is covered by the standard post-merge install flow; not part of this plan's local acceptance.
- **Native-speaker review** — not obtainable here. Per AGENTS.md 语言审核 (2026-10-07), AI review grounded in FIRST's official translated manuals is the recorded method; state it as such, never as native certification.
- **The 28 unverified official-name cells** — verified only at Task 3 execution time against FIRST-hosted manuals; this plan pins exactly the two values verified during planning and forbids inventing the rest. Cells without official names legitimately ship English + whitelist.
- **Red book §7.2 legacy-⑤ retirement and engineering-log entries** — project-level records outside this plan's commits (the plan-writing assignment explicitly leaves them untouched); the coordinating session owns them.
