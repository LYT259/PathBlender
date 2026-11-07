# Onboarding Demo Video Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a ~90-second onboarding demo video (English and Chinese versions, MP4 + WebVTT captions) recorded from the real PathBlender UI with in-recording assertions, plus no-telemetry external user observation materials for spec §六 — without fabricating any sample, dialog, participant, or result.

**Architecture:** A Playwright headed-Chrome driver (`scripts/capture-demo-video.mjs`) runs the real production build against the local preview server, walks a fixed scene storyboard (import → simultaneous playback → locate check result → compare routes → mirror → alliance switch), records with `context.recordVideo`, and asserts live state at every step — conflict count transitions `1→0` on mirror, zero outbound network requests, zero console errors. A pure-data storyboard/captions module (`scripts/demo-video-captions.mjs`) is the single source of truth for scene durations and EN/zh caption text, and generates the sidecar VTT files. Local ffmpeg re-encodes the raw WebM to H.264 MP4; ffprobe and frame-extraction read back the result before anything is committed. Observation materials are prepared but §六 stays explicitly unexecuted until real participants exist.

**Tech Stack:** Node ≥23.6, `playwright-core` 1.62.1 (already a devDependency at root and in `packages/web`), system Chrome via `channel: 'chrome'`, Homebrew ffmpeg/ffprobe 9.x (expected at `/opt/homebrew/bin`, verified present 2026-11-07), vitest 4 (packages/web test runner).

**Spec:** `PathBlender_新用户入门与功能发现方案.md` (repo root, gitignored private file — §四.6 demo video scope: 导入、同时回放、定位问题、比较路线、左右镜像, reusing the verified teaching scenarios; §六 acceptance-by-observation: no telemetry, manual observation only). Verified teaching facts recorded in spec §八 (from PR #287/#288 acceptance): mirroring robot 8814 in the built-in example takes the conflict count 1→0; swapping in another route via the arranger takes it 1→0; the red/blue alliance switch changes no verdicts. Prior art reference only (do not resume): paused task `task:mac-fullscreen-promo-demo`, materials at `engineering-log/attachments/mac-demo-20261031/` in the main tree — CGEvent posting + native screen capture; this plan instead drives the app's own UI with assertions, which that approach cannot do.

## Global Constraints

- **Pure-frontend / zero telemetry (red line 1):** the recording session must make **zero non-localhost network requests** — asserted live by the recorder; observation materials must promise and use no telemetry, no accounts, no upload.
- **No fabrication:** drive only the real UI with real, already-verified inputs — repo sample files `samples/ghostauto/straight_run.ghostauto` + `samples/ghostauto/stop_and_score.ghostauto` (verified 1-conflict pair, used by `scripts/browser-walkthrough.mjs` and `scripts/capture-readme-shots.mjs`) and the bundled welcome example (11019 / 8814 / 11019 Champs real 2026 Choreo routes, `packages/web/src/welcome-example.ts`). Never fabricate route files, never draw fake UI overlays, never fake an OS file dialog — the import scene uses the app's real whole-window drag-and-drop path (`packages/web/src/App.tsx:702`), not the native picker.
- **Live assertions during recording:** mirror scene must observe `.conflict-count` text go `'1'` → `'0'`; alliance scene must observe the count stay unchanged across a red/blue round trip; any drift in the example data or UI must fail the capture loudly instead of shipping a video that contradicts the app.
- **Duration budget:** each language cut must be 75–105 s after encoding (spec says ~90 s); asserted by ffprobe, not by trust.
- **Output artifacts (tracked in git, following the `docs/screenshots/` media convention — `first-check.gif` precedent; `docs/media/` is untracked, do not use):** `docs/screenshots/demo-video.en.mp4`, `demo-video.zh.mp4`, `demo-video.en.vtt`, `demo-video.zh.vtt`. Each MP4 ≤ 25 MB. No audio track is expected (Playwright `recordVideo` records video only); do not synthesize one.
- **Caption copy discipline:** captions must name buttons exactly as the shipped UI dictionary renders them (`timeline.play`, `robots.mirror`, `sequence.arrange`, `welcome.tryExample` in both `packages/web/src/i18n/en.ts` and `zh.ts`) — enforced by test, per the PR #287 "button names match the screen" quality gate. Copy states only what was measured (spec §八); it must not claim mirroring "solves" conflicts in general, and must say the analysis view never rewrites imported files or real robot programs (spec §二).
- **Privacy & public copy:** GitHub-visible content is English-first with the zh pair provided (repo rule); public copy stays concise (2026-11-06 rule). Team numbers 11019/8814 are product example data (allowed); no personal names, personal paths, or personal emails anywhere in artifacts or captions.
- **Branch/merge discipline (AGENTS.md):** all work on `feat/onboarding-demo-video` (exists, based on `origin/beta` @ 7fed5404); never commit directly to beta/stable. This changes `scripts/` + docs + tracked media → **not** a pure-docs change: it requires `node scripts/bump-version.mjs beta "<EN note>"` plus all NOTE_LANGS translations in the same commit, full typecheck + tests, PR via `board.py op run` (`pr-create:lyt259/pathblender:<head>:beta`), independent review, `beta-merge` via op run, and the standard post-merge verification chain (CI green, Pre-release assets real) per the Beta delivery process. FIRST field artwork shown in the video rides the existing bundled-asset precedent — re-check the season asset terms in the release checklist as usual (red line 2).
- **Out of scope / must not do:** no product-code changes to the app itself; no resumption of the paused promo-demo task or touching its artifacts; no claim that §六 observation happened.

## Review Focus

1. **Example-data drift** — the bundled example's routes change and the "1 conflict baseline / mirror clears it" story silently stops being true; a video that contradicts the app is worse than no video. Pinned by the recorder's live `conflict-count` assertions (Task 2 implementation, exercised in Task 3 Step 3) and the calibration probe gate (Task 3 Step 2).
2. **Button-name drift** — captions say "Mirror" while the button now reads differently, breaking the "captions match the screen" gate. Pinned by `packages/web/test/demo-video-captions.test.ts` cross-checking caption text against the real i18n dictionaries (Task 1).
3. **Leaked external request** — a field model, font, or update feed fetched from a CDN during recording would put third-party traffic in the "runs locally" demo. Pinned by the recorder's zero-outbound assertion plus the `isLocalRequest` unit test (Task 2).
4. **Frozen or black footage** — WebM conversion or GPU compositing silently yields still/black frames that "pass" a duration check. Pinned by ffprobe codec/duration checks + `blackdetect` (no black interval ≥ 0.5 s) + pairwise-distinct frame MD5s at scene midpoints (Task 2 implementation, run in Task 3 Step 4).
5. **Premature §六 completion** — someone flips the observation materials to "done" without real participants, fabricating acceptance. Pinned by `packages/web/test/user-research-materials.test.ts` requiring the `NOT EXECUTED` status marker (Task 5); only real, evidenced sessions may replace it.

---

### Task 1: Storyboard and captions module

**Files:**
- Create: `scripts/demo-video-captions.mjs`
- Test: `packages/web/test/demo-video-captions.test.ts`

**Interfaces:**
- Consumes: nothing (pure data + one generator).
- Produces: `SCENES` (array of `{ id: string, targetSeconds: number }` in playback order), `CAPTIONS` (`{ en: Cue[], zh: Cue[] }` where `Cue = { scene: string, startMs: number, endMs: number, text: string }`), `totalMs(): number` (sum of `targetSeconds`), `toVtt(lang: 'en' | 'zh'): string` (WEBVTT output with `HH:MM:SS.mmm` timestamps). Task 2's recorder reads `SCENES`/`CAPTIONS` and writes `toVtt(lang)` to disk unchanged.

Scene order (ids fixed; the recorder in Task 2 maps each to real UI actions):

| id | targetSeconds | on screen (all real UI) |
|---|---|---|
| `welcome` | 6 | welcome screen, no files |
| `import` | 10 | drag-and-drop of the two verified sample files, robots appear, conflict count 1 |
| `playback` | 10 | Play pressed, both robots move on the shared clock, pause |
| `locate` | 10 | checks panel entry clicked, clock jumps to the conflict moment |
| `to-example` | 8 | Home → welcome → "Try an example", three example robots load |
| `compare` | 14 | Arrange timeline opened, route swapped (conflict 1→0), swapped back (1) |
| `mirror` | 10 | "Mirror left/right" on 8814's row, conflict 1→0 |
| `alliance` | 8 | red/blue switch round trip, verdicts unchanged |
| `closing` | 6 | final state settles; end caption states files/programs unchanged |

Sum = 82 s (inside the 75–105 s budget with slack for real pacing).

- [ ] **Step 1: Write the failing test**

`packages/web/test/demo-video-captions.test.ts` (vitest, mirrors the import style of `packages/web/test/beta-change-policy.test.ts`):

```ts
import { describe, expect, it } from 'vitest';
import { SCENES, CAPTIONS, totalMs, toVtt } from '../../../scripts/demo-video-captions.mjs';
import { en } from '../src/i18n/en';   // dictionaries are plain maps: { 'robots.mirror': 'Mirror left/right', … }
import { zh } from '../src/i18n/zh';   // zh covers all four keys directly (verified: zh.ts:143 'timeline.play': '播放')

describe('demo video storyboard and captions', () => {
  it('fits the 75–105 s budget', () => {
    expect(totalMs()).toBeGreaterThanOrEqual(75_000);
    expect(totalMs()).toBeLessThanOrEqual(105_000);
  });
  it('covers every scene in both languages with valid, non-overlapping cues', () => {
    for (const lang of ['en', 'zh'] as const) {
      const cues = [...CAPTIONS[lang]].sort((a, b) => a.startMs - b.startMs);
      expect(cues.length).toBeGreaterThanOrEqual(SCENES.length);
      for (const scene of SCENES) expect(cues.some((c) => c.scene === scene.id), `${lang} ${scene.id}`).toBe(true);
      for (let i = 1; i < cues.length; i++) expect(cues[i].startMs).toBeGreaterThanOrEqual(cues[i - 1].endMs);
      for (const c of cues) { expect(c.endMs).toBeGreaterThan(c.startMs); expect(c.text.trim().length).toBeGreaterThan(0); }
      expect(Math.max(...cues.map((c) => c.endMs))).toBeLessThanOrEqual(totalMs());
    }
  });
  it('names buttons exactly as the shipped UI dictionary renders them', () => {
    // real button labels, not paraphrases (PR #287 quality gate)
    expect(CAPTIONS.en.find((c) => c.scene === 'mirror')!.text).toContain(en['robots.mirror']);
    expect(CAPTIONS.zh.find((c) => c.scene === 'mirror')!.text).toContain(zh['robots.mirror']);
    expect(CAPTIONS.en.find((c) => c.scene === 'compare')!.text).toContain(en['sequence.arrange']);
    expect(CAPTIONS.zh.find((c) => c.scene === 'compare')!.text).toContain(zh['sequence.arrange']);
    expect(CAPTIONS.en.find((c) => c.scene === 'playback')!.text).toContain(en['timeline.play']);
    expect(CAPTIONS.zh.find((c) => c.scene === 'playback')!.text).toContain(zh['timeline.play']);
  });
  it('states the measured facts and the no-rewrite boundary, not promises', () => {
    const enClosing = CAPTIONS.en.find((c) => c.scene === 'closing')!.text;
    expect(/original (files|route files)|not (rewrite|modify)/i.test(enClosing)).toBe(true);
    expect(CAPTIONS.en.every((c) => !/guarantee|will (fix|solve)/i.test(c.text))).toBe(true);
  });
  it('renders valid WEBVTT with monotone timestamps', () => {
    for (const lang of ['en', 'zh'] as const) {
      const vtt = toVtt(lang);
      expect(vtt.startsWith('WEBVTT')).toBe(true);
      const stamps = [...vtt.matchAll(/(\d{2}):(\d{2}):(\d{2})\.(\d{3}) --> /g)];
      expect(stamps.length).toBe(CAPTIONS[lang].length);
    }
  });
});
```

(The dictionaries are plain exported maps — `import { en } from '../src/i18n/en'` — exactly as `packages/web/src/i18n/en.ts:2` declares; the assertion intent is "caption text ⊇ the dictionary value for that key", and those values are the rendered button labels.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @pathblender/web -- demo-video-captions`
Expected: FAIL — cannot resolve `../../../scripts/demo-video-captions.mjs` (module does not exist).

- [ ] **Step 3: Implement `scripts/demo-video-captions.mjs`**

Plain `.mjs`, no imports (keeps it loadable by both the recorder and vitest). Export `SCENES` (the nine ids and `targetSeconds` from the table above), `CAPTIONS` (EN primary; zh is a faithful translation, not machine-dumped — write both by hand), `totalMs()`, and `toVtt(lang)` (zero-pad to `HH:MM:SS.mmm`, blank line between cues). Caption content rules: one short sentence per cue (~≤12 words EN); the `import` cue says teams' exported files are processed locally in the browser; `compare`/`mirror` cues report the measured count change ("the check goes from 1 to 0"), never "this fixes your conflict"; `alliance` cue says the whole session moves side and verdicts stay the same; `closing` cue says the analysis view never rewrites the imported files or the real robot program, and points to Help → Quick guide.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w @pathblender/web -- demo-video-captions`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/demo-video-captions.mjs packages/web/test/demo-video-captions.test.ts
git commit -m "feat: add demo video storyboard and bilingual captions module"
```

### Task 2: Recorder script `scripts/capture-demo-video.mjs`

**Files:**
- Create: `scripts/capture-demo-video.mjs`
- Test: `packages/web/test/capture-demo-video.test.ts`

**Interfaces:**
- Consumes: `SCENES`, `CAPTIONS`, `toVtt` from `scripts/demo-video-captions.mjs` (Task 1).
- Produces: CLI `node scripts/capture-demo-video.mjs [--langs en,zh]` with env `WALK_BASE` (default `http://localhost:4173/`), `DEMO_OUT` (default `docs/screenshots`), `DEMO_PROBE=1` (calibration probe: drives scenes, prints route-swap findings, writes no video). Named exports for tests: `isLocalRequest(url: string, base: string): boolean` and `outputPaths(lang: 'en'|'zh', outDir: string): { webm: string, mp4: string, vtt: string }`. Writes `demo-video.<lang>.mp4` + `demo-video.<lang>.vtt` per language.

Structure follows `scripts/capture-readme-shots.mjs` (same `WALK_BASE` convention, system Chrome via `channel: 'chrome'` with bundled fallback, console/page error collection that exits 1) and `scripts/browser-walkthrough.mjs` (same `check()` PASS/FAIL accumulator, same selectors). Key differences the implementer must respect:

- **Headed:** `chromium.launch({ channel: 'chrome', headless: false })` — `recordVideo` on a visible real-Chrome window is the assignment's recording basis. Context: `viewport: { width: 1440, height: 900 }`, `locale: 'en-US'` for the EN pass / `'zh-CN'` for the zh pass (the app follows system language; the walkthrough verified zh UI renders, assert via `.robot-library-heading h2` matching /机器人/ after robots load), `recordVideo: { dir: <tmp dir>, size: { width: 1440, height: 900 } }`.
- **Import scene without any OS dialog:** dispatch a real `drop` event on `body` with a `DataTransfer` holding actual `File` objects built from the two sample files' bytes (create the `DataTransfer` + `File`s inside `page.evaluate`, then `page.dispatchEvent('body', 'drop', { dataTransfer })` — the app's whole-window handler at `App.tsx:702` consumes it; this is the real drag-and-drop import path, no native picker is ever shown or faked).
- **Scene assertions (each a `check()` that fails the run):** after drop — 2 `.robot-library-row`, `.field-canvas` visible, `.conflict-count` text `'1'`; playback — `.timeline-play` click then clock advances (reuse the walkthrough's clock-read pattern) then pause; locate — `.conflict-jump` click, clock text changes; example — `.welcome-try-example` click, 3 rows, `.conflict-count` `'1'`; compare — `.robot-arrange-button` on 11019's row opens `.sequence-composer`, click the `.sequence-route-source` named by the probe (see Task 3 Step 2) → count `'0'`, click the original route source back → `'1'`; mirror — row button `getByRole('button', { name: /mirror|镜像/ })` on 8814's row → count `'0'`; alliance — `.alliance-red` click → count unchanged, `.alliance-blue` click → count unchanged; recording-wide — every `page.on('request')` URL satisfies `isLocalRequest(url, BASE)` and zero collected page/console errors.
- **Post-processing per language:** close context (finalizes the WebM) → `ffmpeg -y -i <webm> -an -c:v libx264 -crf 23 -pix_fmt yuv420p -movflags +faststart <mp4>` → write `toVtt(lang)` to the `.vtt` path → `ffprobe -v error -show_entries format=duration -select_streams v:0 -show_entries stream=codec_name,width,height -of json <mp4>` and assert duration ∈ [75, 105] s, `h264`, 1440×900 → readback: `ffmpeg -i <mp4> -vf blackdetect=d=0.5 -an -f null -` must report no black intervals, and extract one PNG at each scene midpoint (`-ss <t> -frames:v 1`) asserting all nine MD5s pairwise distinct (scene transitions really happened on tape).

- [ ] **Step 1: Write the failing test**

`packages/web/test/capture-demo-video.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isLocalRequest, outputPaths } from '../../../scripts/capture-demo-video.mjs';

describe('capture-demo-video helpers', () => {
  it('classifies only same-origin, data and blob requests as local', () => {
    const base = 'http://localhost:4173/';
    for (const ok of ['http://localhost:4173/', 'http://localhost:4173/assets/field.glb',
                      'http://127.0.0.1:4173/sw.js', 'data:text/css,.', 'blob:http://localhost:4173/x'])
      expect(isLocalRequest(ok, base), ok).toBe(true);
    for (const bad of ['https://cdn.example.com/font.woff2', 'http://localhost:9999/other',
                       'https://lyt259.github.io/PathBlender/feed.json', 'file:///etc/passwd'])
      expect(isLocalRequest(bad, base), bad).toBe(false);
  });
  it('pairs mp4 and vtt outputs per language in the shared screenshots dir', () => {
    const p = outputPaths('en', 'docs/screenshots');
    expect(p.mp4).toBe('docs/screenshots/demo-video.en.mp4');
    expect(p.vtt).toBe('docs/screenshots/demo-video.en.vtt');
    expect(outputPaths('zh', 'docs/screenshots').mp4).toBe('docs/screenshots/demo-video.zh.mp4');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @pathblender/web -- capture-demo-video`
Expected: FAIL — cannot resolve `../../../scripts/capture-demo-video.mjs`.

- [ ] **Step 3: Implement `scripts/capture-demo-video.mjs`**

Per the Interfaces block and the structural notes above. Probe mode (`DEMO_PROBE=1`): skip recording, open the example, and for each example robot open its arrange track and enumerate the composer's `.sequence-route-source` labels with the baseline conflict count, swapping each route one at a time, printing `probe: <robot> route <name> -> conflict <n>` per candidate plus which combination yields 0 — this is how Task 3 locks the compare scene without anyone guessing (spec §八 measured route `L2` on 11019's library). The recorded take reads the choices from CLI args `--compare-robot <robotId|team>` and `--compare-route <name>` (no hard-coded guess in the script).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w @pathblender/web -- capture-demo-video`
Expected: PASS (both tests). Also `node --check scripts/capture-demo-video.mjs`.

- [ ] **Step 5: Commit**

```bash
git add scripts/capture-demo-video.mjs packages/web/test/capture-demo-video.test.ts
git commit -m "feat: add Playwright recorder for the onboarding demo video"
```

### Task 3: Produce and commit the video artifacts

**Files:**
- Create (generated, then tracked): `docs/screenshots/demo-video.en.mp4`, `docs/screenshots/demo-video.zh.mp4`, `docs/screenshots/demo-video.en.vtt`, `docs/screenshots/demo-video.zh.vtt`
- No product code changes.

**Interfaces:**
- Consumes: the recorder from Task 2; the storyboard/VTT from Task 1.
- Produces: the four artifacts that Task 4's guide links and its test point at.

- [ ] **Step 1: Build and serve the real app**

Run: `npm run build -w @pathblender/web` then `npm run preview -w @pathblender/web` (background; serves `:4173`).
Expected: build succeeds; preview prints the local URL. (If `sw.js` gets rewritten by the build — known generated noise — leave it out of every commit below.)

- [ ] **Step 2: Calibration probe (locks the compare-scene route)**

Run: `DEMO_PROBE=1 node scripts/capture-demo-video.mjs`
Expected: prints per-route conflict outcomes for 11019's library routes. If the probe shows the baseline example conflict is not exactly 1, or **no** route swap clears it, STOP: the example data has drifted from spec §八 — report it and update `scripts/demo-video-captions.mjs` copy (and this storyboard) to the re-measured facts; never record a take whose assertions you relaxed. Otherwise note the clearing route (spec §八 measured route `L2`) and proceed with `--compare-route` set to it.

- [ ] **Step 3: Record both languages**

Run: `node scripts/capture-demo-video.mjs --langs en,zh --compare-robot 11019 --compare-route <probed-route>`
Expected: every `check()` line prints PASS (including `conflict 1→0` on mirror, unchanged count across the alliance round trip, zero outbound requests, zero console errors); ffprobe summary shows both MP4s as h264 1440×900 within 75–105 s; blackdetect reports nothing; the nine per-scene frame MD5s are pairwise distinct in each cut. Any FAIL = fix and re-record; do not hand-edit footage.

- [ ] **Step 4: Size guard**

Run: `du -h docs/screenshots/demo-video.*.mp4`
Expected: each ≤ 25 MB. If over: re-encode with `-crf 28` from the retained WebM and re-run the ffprobe/blackdetect/frame checks; still over 25 MB → stop and report (do not silently drop resolution or trim scenes).

- [ ] **Step 5: Commit the artifacts**

```bash
git add docs/screenshots/demo-video.en.mp4 docs/screenshots/demo-video.zh.mp4 docs/screenshots/demo-video.en.vtt docs/screenshots/demo-video.zh.vtt
git commit -m "docs: add 90-second onboarding demo videos with EN/zh captions"
```

### Task 4: Link the videos from the user guides

**Files:**
- Modify: `docs/user-guide.en.md` (end of the "Try it without files" section), `docs/user-guide.zh.md` (same section, `无需文件先试一试`)
- Test: `packages/web/test/demo-video-docs.test.ts`

**Interfaces:**
- Consumes: the four artifacts from Task 3.
- Produces: guide paragraphs linking MP4 + VTT per language (Task 6's release notes may reuse the wording).

- [ ] **Step 1: Write the failing test**

`packages/web/test/demo-video-docs.test.ts`:

```ts
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../../..'); // repo root
describe('demo video guide links', () => {
  it('both guides link their language pair of mp4 + vtt with existing files', () => {
    for (const [guide, lang] of [['docs/user-guide.en.md', 'en'], ['docs/user-guide.zh.md', 'zh']] as const) {
      const md = readFileSync(resolve(root, guide), 'utf8');
      expect(md, `${guide} mp4`).toContain(`(screenshots/demo-video.${lang}.mp4)`);
      expect(md, `${guide} vtt`).toContain(`(screenshots/demo-video.${lang}.vtt)`);
      for (const f of [`docs/screenshots/demo-video.${lang}.mp4`, `docs/screenshots/demo-video.${lang}.vtt`])
        expect(existsSync(resolve(root, f)), f).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @pathblender/web -- demo-video-docs`
Expected: FAIL — guides do not yet contain the links (files exist from Task 3, so the link assertions are what break).

- [ ] **Step 3: Add one short paragraph to each guide**

At the end of "Try it without files" (EN) / the matching zh section, one concise sentence + two links, e.g. EN: `Prefer watching first? A 90-second demo covers import, shared-clock replay, locating a check result, comparing routes, and mirroring: [demo video (MP4)](screenshots/demo-video.en.mp4), [captions (WebVTT)](screenshots/demo-video.en.vtt).` The zh guide gets the zh pair with equivalent copy (concise, factual, no dev history). Do not paste the video inline into README (out of scope here).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w @pathblender/web -- demo-video-docs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/user-guide.en.md docs/user-guide.zh.md packages/web/test/demo-video-docs.test.ts
git commit -m "docs: link the onboarding demo video from both user guides"
```

### Task 5: External user observation materials (§六 prepared, NOT executed)

**Files:**
- Create: `docs/user-research/onboarding-observation-protocol.md`
- Test: `packages/web/test/user-research-materials.test.ts`

**Interfaces:**
- Consumes: spec §六 acceptance criteria (six bullets) — copied faithfully, not paraphrased into weaker claims.
- Produces: a bilingual (EN primary, zh alongside) protocol document with four parts: observation protocol, participant task list, observation record sheet template, informed-consent text. Carries a status header that stays `NOT EXECUTED` until real sessions happen.

Content the document must contain (the test pins each): recruiting criteria (FRC members who have never used PathBlender); two entry cohorts per §六 (start from the README/download page vs. open the app directly); the observer rule — watch silently, never explain the UI verbally during the task; the task list mirrors the video scenes (get started via example or own files, replay together, locate a check result, compare a route, find and use the mirror, distinguish session alliance switch from per-robot mirror, find in-app help); the record sheet (per participant: where they stalled, misread buttons, whether they completed, verbatim-purpose answer, all anonymized — no names, no team rosters, no recordings without separate consent); the six §六 success criteria verbatim; informed consent covering voluntary participation, zero telemetry (manual observation only), anonymized notes, right to stop; and the status line `Status: NOT EXECUTED — no participants recruited, no sessions run` which may only change when real session evidence exists (engineering-log entry + record sheets), never to satisfy a deadline.

- [ ] **Step 1: Write the failing test**

`packages/web/test/user-research-materials.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const doc = readFileSync(resolve(__dirname, '../../../docs/user-research/onboarding-observation-protocol.md'), 'utf8');
describe('§六 observation materials', () => {
  it('is prepared but explicitly not executed', () => {
    expect(doc).toContain('Status: NOT EXECUTED');
  });
  it('promises no telemetry and voluntary anonymized participation', () => {
    expect(/no telemetry/i.test(doc)).toBe(true);
    expect(/voluntar/i.test(doc)).toBe(true);
    expect(/anonymi[sz]ed/i.test(doc)).toBe(true);
  });
  it('carries all six §六 success criteria and both entry cohorts', () => {
    for (const marker of ['own words', 'import', 'replay', 'mirror', 'alliance', 'help', 'README/download', 'directly'])
      expect(doc.includes(marker) || doc.includes(marker.toLowerCase()), marker).toBe(true);
  });
  it('is bilingual', () => {
    expect(doc).toMatch(/# .*[Oo]bservation/);
    expect(doc).toMatch(/观察|知情同意/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @pathblender/web -- user-research-materials`
Expected: FAIL — cannot read the document (file does not exist).

- [ ] **Step 3: Write the protocol document**

Follow the content list in this task's Interfaces/produce block. Keep it usable by a real moderator with zero prep; keep all six criteria in both languages; date it `2026.11.07`; reference the spec file name for provenance.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w @pathblender/web -- user-research-materials`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/user-research/onboarding-observation-protocol.md packages/web/test/user-research-materials.test.ts
git commit -m "docs: prepare no-telemetry usability observation protocol (not executed)"
```

### Task 6: Repo-wide verification, version bump, PR and merge

**Files:**
- Modify: `package.json` + the nine per-package version files + `packages/web/src/version-info.ts` (all via `scripts/bump-version.mjs`, never by hand)
- No other files.

**Interfaces:**
- Consumes: Tasks 1–5 commits on `feat/onboarding-demo-video`.
- Produces: branch merged into `beta` through the standard PR pipeline, Pre-release verified.

- [ ] **Step 1: Full repo checks**

Run: `npm run typecheck` then `npm test`
Expected: both green across workspaces (includes the four new test files and the 40-language version-notes gate, which will fail until Step 2 supplies the note).

- [ ] **Step 2: Bump the beta version with the required note**

Run: `node scripts/bump-version.mjs beta "Add a 90-second onboarding demo video with EN/zh captions and guide links"` plus the same note translated for every NOTE_LANGS language in the same invocation/commit (check the script's args; `version-notes.test.ts` enforces completeness — a missing language is a red build, not a nit).
Expected: version bump lands in exactly the version files; `git status` shows nothing else.

- [ ] **Step 3: Commit the bump**

```bash
git add -u
git commit -m "chore: bump beta version for the onboarding demo video"
```

- [ ] **Step 4: Push branch and create the PR via the shared-operation wrapper**

Run: single `git push -u origin feat/onboarding-demo-video`, then the PR via the board wrapper (never bare): `python3 .agent-board/board.py op run --key pr-create:lyt259/pathblender:feat/onboarding-demo-video:beta --owner '<this session's board id>' -- node scripts/create-pr-as-app.mjs --create --base beta --head feat/onboarding-demo-video --title '...'` (English title/body, concise; body summarizes recorder + artifacts + guides + observation prep and states §六 is not executed).
Expected: PR created and registered; if the result is ambiguous, follow the board's verify-then-retry rule — never blind-resend.

- [ ] **Step 5: Independent review, then merge via the wrapper**

Reviewer agent reviews the diff (video binaries: verify by downloading the PR artifacts / checking out the branch and running the Task 3 readback commands, not by trusting filenames). Then merge through `op run` with `beta-merge:<PR>`; the wrapper handles candidate verification and version-collision checks.
Expected: merge commit lands on beta; register the outcome.

- [ ] **Step 6: Post-merge verification per the Beta delivery process**

Confirm CI is green on the beta merge and the Pre-release for this merge actually exists with its assets (check the release run and the release page; a missing Release means the delivery is incomplete — report it). Append the day's engineering-log entry (private, never `git add`-ed) with what was recorded, the probe finding, ffprobe numbers, and what was deliberately left unexecuted (§六). Clean up per the merge-cleanup chain (local + remote branch delete, worktree prune).

## External / non-acceptable items (explicitly not claimable from this plan)

- **§六 usability results** require real FRC participants observed in person; this plan ships materials only. Until real sessions with record sheets exist, the protocol stays `NOT EXECUTED` and no report may cite participant outcomes.
- **Real "download-page entry" cohort evidence** depends on the public site state at observation time; the materials describe it but this plan cannot validate it.
- **Three-platform release verification** (Mac/Linux/Windows full builds + Pre-release assets) is part of Task 6's delivery chain per AGENTS.md and is reported from real CI/Release reads only — never assumed from a green local run.
- **Sample and footage authenticity:** all on-screen data comes from the repo's verified samples and the bundled example; the plan nowhere fabricates route files, re-timed footage, screenshots standing in for video, or system dialogs.
