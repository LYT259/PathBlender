# Offline Windows Installer & Distribution Channels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a truly-install-offline Windows NSIS installer as a second release asset (the online installer and the updater feed stay exactly as they are), register the WebView2 redistribution license, add the zh/en security-prompt install guides, and add a Homebrew cask generator with tests — without creating any external repository.

**Architecture:** A Tauri config overlay (`tauri.windows-offline.conf.json`) flips only `webviewInstallMode` to `offlineInstaller`, so the same source tree produces a second, larger NSIS exe that embeds the WebView2 Evergreen Standalone Installer. The release workflow builds online first (updater artifacts), then offline, stages the offline exe under a distinct name (`PathBlender_<v>_x64-offline-setup.exe`) in its own CI artifact; `prepare-release-artifacts.mjs` hard-requires it, records its byte size in the manifest, and a 100 MiB floor at three gates (collect, beta gate, published-asset verify) proves "offline" builds really embed the runtime. Docs/legal/cask tasks are file-plus-contract-test changes with no pipeline impact.

**Tech Stack:** Tauri 2.12.5 (`--config` JSON merge, NSIS bundler), GitHub Actions workflows (release.yml / beta-verify.yml / release-verify.yml), Node ≥23 ESM scripts (`*.mjs`), vitest contract tests under `packages/web/test/`, Homebrew Cask DSL (generated, not executed).

**Spec:** `PathBlender_红皮书.md` §7.1 "分发与安装体验" and §7.1.1 "macOS / Linux Releases 下载格式" (the red book is a repo-external private file, not tracked in the repository). Key spec lines: Windows runtime = WebView2 with `webviewInstallMode` auto-guided install, "离线/弱网场景选 embedBootstrapper 或 offlineInstaller，**禁止 skip**"; release checklist requires "浏览器/终端/Homebrew 三渠道图文安装教程（含「仍要打开」与 SmartScreen 三步引导）" and "无浏览器裸机冒烟（三平台各在未装任何浏览器的干净系统里安装并过核心功能）"; Mac install = browser DMG download ("每台 Mac 首装一次性「仍要打开」+ 密码，约 30 秒") + terminal/Homebrew cask ("零弹窗"); verified fact: of the Tauri 2 modes only `offlineInstaller` is offline at install time (~+127 MB); `embedBootstrapper` still downloads during install.

## Global Constraints

- **Base branch:** `origin/beta` @ `7fed5404`. An in-flight task `task:acceptance-fixes-20261106` (PR #409, branch `fix/acceptance-beta-gate-deploy`) already modifies `packages/web/test/release-pipeline.test.ts`, `docs/releasing.md`, `scripts/release-notes-for.mjs` and `scripts/browser-walkthrough.mjs`. **Do not assume its changes**: before each task, re-read the current file content; if that PR lands first, rebase and re-resolve anchors by content, not line numbers.
- **The online update feed must not change:** `PB_WINDOWS_ARTIFACT` keeps pointing at the online `PathBlender_<v>_x64-setup.exe`; `scripts/gen-latest-json.mjs` gets no offline references; `bundle/nsis/` fed to the feed generator keeps only the online pair. Tests pin this.
- **Artifact contract (pinned names):** offline exe = `PathBlender_<version>_x64-offline-setup.exe`; CI artifact name = `windows-offline`; manifest fields = `windows.nsisOffline` (basename) and `windows.nsisOfflineBytes` (integer); offline size floor = `104857600` (100 MiB) — the same literal in `prepare-release-artifacts.mjs`, `beta-verify.yml`, `release-verify.yml`, and their tests.
- **No fabricated evidence:** SmartScreen/Gatekeeper prompt screenshots and the three-platform no-browser bare-metal smoke have no environment here. They are registered as **not verified** in Task 10 and must never be reported as done. CI screenshots (release-verify) are app-launch evidence, not OS-prompt evidence.
- **External boundary:** `LYT259/homebrew-tap` is NOT created, pushed, or published by any task here. The cask generator exists in-repo with tests only; publication is a separate user-authorized step documented in `docs/releasing.md`.
- **Workflow red lines (repo-standing, test-enforced):** step-level `if:` must not reference `secrets`; no escaped quotes in plain `run:` scalars; releases are gated by the `checks` job — never weaken it.
- **Repo conventions:** GitHub-visible text in English (commit messages, workflow comments, NOTICE, README additions); `docs/releasing.md` rows follow its existing bilingual style. Every task is one English commit message. This branch is **not** documentation-only (workflows/scripts/NOTICE change) → Task 11 bumps the version with a 40-language note (`NOTE_LANGS` in `packages/web/src/version-info.ts:19`).
- **Local verification reality:** Windows NSIS builds cannot run on this macOS machine. Local task cycles are the vitest contract tests; real build/install proof comes from CI (beta-verify on the PR, release + release-verify after merge). Never claim a local Windows build.
- Test commands: single file — `npm test -w @pathblender/web -- test/<name>.test.ts`; full — `npm test`; types — `npm run typecheck`; version sync — `npm run version:check`.

## Review Focus

Five input classes / failure modes the spec implies but no single task's happy path covers; each is pinned by the test named here:

1. **A release silently missing the offline asset** (workflow staged only the online exe, or the collector tolerated absence) — `prepare-release-artifacts.test.ts` "rejects missing windows-offline" (Task 2) and the count/name assertions on `release.yml` (Task 3).
2. **The updater feed pointing at the offline exe** (would ship the offline installer — ~127 MB larger than the online exe because it embeds the WebView2 Runtime, with the exact payload only known from the CI manifest — and desync the feed contract) — `prepare-release-artifacts.test.ts` feed guard: `platforms['windows-x86_64'].url` ends `_x64-setup.exe` and contains no `offline` (Task 2).
3. **An "offline" asset that is not offline** (overlay not applied, renamed online build) — the `104857600` floor asserted at collection (Task 2), at the beta gate (Task 4), and against the published asset (Task 5).
4. **Release notes rendering `undefined` for a locale** (a `windowsOffline` label missing in one of the 8 locales ships broken bodies in all of them) — Task 6's test asserts all 8 labels appear in the rendered notes.
5. **Guidance drifting from honesty** (guides claiming verified prompts, or the checklist read as "smoke passed") — Task 8's docs contract test pins the exact prompt vocabulary in both guides, and Task 10's test pins the "not verified" markers in `docs/releasing.md`.

---

### Task 1: Windows offline NSIS config overlay

**Files:**
- Create: `packages/desktop/src-tauri/tauri.windows-offline.conf.json`
- Test: `packages/web/test/release-pipeline.test.ts` (new `describe`, file exists)

**Interfaces:**
- Consumes: `packages/desktop/src-tauri/tauri.conf.json` (base config; its `bundle.windows.webviewInstallMode.type` is `downloadBootstrapper`, updater pubkey/endpoints and `createUpdaterArtifacts: true` live there).
- Produces: a Tauri `--config` overlay whose ONLY semantic key is `bundle.windows.webviewInstallMode.type = "offlineInstaller"`. Tasks 3 and 4 build it with `npx tauri build --config src-tauri/tauri.windows-offline.conf.json --bundles nsis` run from `packages/desktop` (same pattern as the Linux job's `--config src-tauri/tauri.linux.conf.json`).

- [ ] **Step 1: Write the failing test**

Append to `packages/web/test/release-pipeline.test.ts` a new block:

```ts
describe('Windows offline NSIS overlay config', () => {
  const read = (p: string) => JSON.parse(readFileSync(resolve(ROOT, p), 'utf8'));
  it('flips only webviewInstallMode to offlineInstaller', () => {
    const overlay = read('packages/desktop/src-tauri/tauri.windows-offline.conf.json');
    expect(overlay.bundle.windows.webviewInstallMode).toEqual({ type: 'offlineInstaller' });
    expect(Object.keys(overlay.bundle.windows)).toEqual(['webviewInstallMode']);
    expect(Object.keys(overlay.bundle)).toEqual(['windows']);
    expect(Object.keys(overlay).filter((k) => k !== '$schema')).toEqual(['bundle']);
  });
  it('keeps the base config on the online installer and updater untouched', () => {
    const base = read('packages/desktop/src-tauri/tauri.conf.json');
    expect(base.bundle.windows.webviewInstallMode).toEqual({ type: 'downloadBootstrapper' });
    expect(base.bundle.createUpdaterArtifacts).toBe(true);
    expect(base.plugins.updater.endpoints).toContain('https://github.com/LYT259/pathblender/releases/latest/download/latest.json');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @pathblender/web -- test/release-pipeline.test.ts`
Expected: FAIL — `tauri.windows-offline.conf.json` does not exist (`ENOENT`).

- [ ] **Step 3: Create `packages/desktop/src-tauri/tauri.windows-offline.conf.json`**

Exact content (mirror the `$schema` + single-purpose shape of `tauri.linux.conf.json`):

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "bundle": {
    "windows": {
      "webviewInstallMode": {
        "type": "offlineInstaller"
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @pathblender/web -- test/release-pipeline.test.ts`
Expected: PASS (whole file — pre-existing assertions must stay green).

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src-tauri/tauri.windows-offline.conf.json packages/web/test/release-pipeline.test.ts
git commit -m "feat: add Windows offline NSIS config overlay (embedded WebView2)"
```

### Task 2: Release collector takes the second Windows asset + size manifest

**Files:**
- Modify: `scripts/prepare-release-artifacts.mjs` (collection block, lines ~19–46 at `7fed5404`)
- Test: `packages/web/test/prepare-release-artifacts.test.ts`

**Interfaces:**
- Consumes: `actions/download-artifact` layout — a NEW input directory `artifacts/windows-offline/` containing exactly one `PathBlender_<v>_x64-offline-setup.exe` (Task 3 uploads it).
- Produces: manifest `windows` becomes `{ nsis, nsisOffline, nsisOfflineBytes }`; the offline exe is copied into the release dir (published as a GitHub Release asset) but NOT into `bundle/nsis/` (updater feed input unchanged). Throws on: missing dir, wrong basename, undersized file (< `104857600`), duplicate/empty files (existing rules).

- [ ] **Step 1: Write the failing tests**

In `prepare-release-artifacts.test.ts`: extend the `fixture()` `files` map with `windows-offline: ['PathBlender_0.2.0_x64-offline-setup.exe']`, written sparse (real ≥ floor size without 100 MB of disk): after `writeFileSync(join(input, 'windows-offline', name), name + '\n')`, open the file and `ftruncateSync(fd, 110 * 1024 * 1024)`. Then:

- In the success test: expect `result.manifest.windows.nsisOffline` to be `'PathBlender_0.2.0_x64-offline-setup.exe'`, `nsisOfflineBytes` to be `110 * 1024 * 1024`, `readdirSync(f.output)` length `10`, and `readdirSync(f.bundle, { recursive: true })` to contain the online pair under `nsis/` but no file whose name includes `offline`.
- Feed guard: after the existing `gen-latest-json.mjs` exec, assert `feed.platforms['windows-x86_64'].url` ends with `'_x64-setup.exe'` and `not.toContain('offline')`.
- Extend the `it.each` rejection list from `['rpm','signature','duplicate','staleVersion']` to `['rpm','signature','duplicate','staleVersion','offlineMissing','offlineUndersized','offlineWrongName']`: `offlineMissing` removes the `windows-offline` dir; `offlineUndersized` truncates the offline file to `1024 * 1024` bytes; `offlineWrongName` renames it to `PathBlender_0.1.9_x64-offline-setup.exe`. Each must throw and leave neither output dir created.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @pathblender/web -- test/prepare-release-artifacts.test.ts`
Expected: FAIL — success case sees only 9 files / manifest lacks `nsisOffline`; new rejections pass through without throwing.

- [ ] **Step 3: Implement in `scripts/prepare-release-artifacts.mjs`**

After `const win = one('windows', '-setup.exe');` add: `const winOffline = one('windows-offline', '-offline-setup.exe');`, assert `basename(winOffline) === \`PathBlender_${version}_x64-offline-setup.exe\``, compute `const winOfflineBytes = statSync(winOffline).size;` and throw `windows-offline: … is ${winOfflineBytes} bytes; an offline installer embeds the WebView2 Runtime (~127 MB) — this looks like an online build` when `< 104857600`. Append `winOffline` to `sources`. Manifest: `windows: { nsis: basename(win), nsisOffline: basename(winOffline), nsisOfflineBytes }`. Leave the `bundle/` copy loop (macos/nsis/appimage) untouched.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @pathblender/web -- test/prepare-release-artifacts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/prepare-release-artifacts.mjs packages/web/test/prepare-release-artifacts.test.ts
git commit -m "feat: require and record the offline Windows installer in the release manifest"
```

### Task 3: release.yml builds and stages both Windows installers

**Files:**
- Modify: `.github/workflows/release.yml` (`build-windows` job, lines ~106–134 at `7fed5404`; header comment lines 9–10)
- Modify: `docs/releasing.md` (line 13, "all five installer formats")
- Test: `packages/web/test/release-pipeline.test.ts`

**Interfaces:**
- Consumes: Task 1 overlay; existing `build-windows` job (online build → `Stage artifacts` copies `*-setup.exe(.sig)` into `release/` → upload artifact `windows`).
- Produces: CI artifact `windows-offline` containing `PathBlender_<v>_x64-offline-setup.exe` (consumed by Task 2's collector in the `publish` job; no `publish` job change needed — `download-artifact` brings all artifacts).

- [ ] **Step 1: Write the failing test**

Add to `release-pipeline.test.ts`:

```ts
describe('Windows offline installer pipeline', () => {
  it('release.yml builds the overlay, renames to the pinned offline name and uploads windows-offline', () => {
    expect(workflow).toContain('--config src-tauri/tauri.windows-offline.conf.json --bundles nsis');
    expect(workflow).toContain('release-offline/PathBlender_${V}_x64-offline-setup.exe');
    expect(workflow).toContain('name: windows-offline');
    // The online pair is staged BEFORE the offline build overwrites bundle/nsis.
    const stageOnline = workflow.indexOf('cp packages/desktop/src-tauri/target/release/bundle/nsis/*-setup.exe release/');
    const offlineBuild = workflow.indexOf('--config src-tauri/tauri.windows-offline.conf.json');
    expect(stageOnline).toBeGreaterThan(-1);
    expect(offlineBuild).toBeGreaterThan(stageOnline);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @pathblender/web -- test/release-pipeline.test.ts`
Expected: FAIL — no overlay build in `release.yml`.

- [ ] **Step 3: Implement**

In `build-windows`, after the existing `Stage artifacts` step and before the existing upload, add (keep the existing `windows` upload last; both uploads at job end):

1. Step `Build offline NSIS installer` (`shell: bash`, same `TAURI_SIGNING_PRIVATE_KEY`/`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` env as the online build): `cd packages/desktop && npx tauri build --config src-tauri/tauri.windows-offline.conf.json --bundles nsis`. Comment: second artifact embeds the WebView2 Evergreen Standalone Installer (~127 MB, downloads it from Microsoft at build time); it overwrites `bundle/nsis`, which is safe because the online pair is already staged in `release/`; the updater feed keeps pointing at the online exe.
2. Step `Stage offline installer` (`shell: bash`): `mkdir -p release-offline`, then copy `packages/desktop/src-tauri/target/release/bundle/nsis/PathBlender_${V}_x64-setup.exe` to `release-offline/PathBlender_${V}_x64-offline-setup.exe` where `V="${RELEASE_TAG#v}"` (no `|| true` — a release without the offline artifact must fail loudly).
3. `- uses: actions/upload-artifact@v4` with `name: windows-offline`, `path: release-offline/`.

Also update the workflow header comment (lines 9–10) and `docs/releasing.md` line 13 to "…Confirm the Release and all six installer assets exist (Universal DMG, Windows online + offline NSIS, DEB, AppImage, RPM) plus updater artifacts and feeds before reporting delivery."

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @pathblender/web -- test/release-pipeline.test.ts`
Expected: PASS (the pre-existing dmg `|| true` and needs-chain assertions untouched).

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/release.yml docs/releasing.md packages/web/test/release-pipeline.test.ts
git commit -m "ci: build and publish the offline Windows NSIS installer alongside the online one"
```

### Task 4: beta-verify.yml gates the offline installer (Beta gate)

**Files:**
- Modify: `.github/workflows/beta-verify.yml` (`windows` job, lines ~32–155 at `7fed5404`; insert after `Locate, launch and assert`, before `Screenshot`)
- Test: `packages/web/test/release-pipeline.test.ts`

**Interfaces:**
- Consumes: Task 1 overlay; the job's existing throwaway key at `$RUNNER_TEMP/smoke-updater.key` (a bash step's exports do not survive the step — the new build step must re-read the key file itself).
- Produces: every PR-to-beta now proves the offline exe builds, is ≥ floor, installs silently and launches — before merge, per the Beta delivery policy.

- [ ] **Step 1: Write the failing test**

Extend the Task 3 describe:

```ts
  it('beta-verify builds, size-checks, installs and launches the offline installer', () => {
    const beta = readFileSync(resolve(ROOT, '.github/workflows/beta-verify.yml'), 'utf-8');
    const windows = beta.slice(beta.indexOf('  windows:'), beta.indexOf('  macos:'));
    expect(windows).toContain('--config src-tauri/tauri.windows-offline.conf.json');
    expect(windows).toContain('104857600');
    expect(windows).toContain('_x64-offline-setup.exe');
    expect(windows).toContain('-ArgumentList "/S"');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @pathblender/web -- test/release-pipeline.test.ts`
Expected: FAIL — `beta-verify.yml` windows job has no offline steps.

- [ ] **Step 3: Implement**

Add four steps to the `windows` job, between `Locate, launch and assert` and `Screenshot`:

1. `Build offline NSIS installer` (bash): `export TAURI_SIGNING_PRIVATE_KEY="$(cat "$RUNNER_TEMP/smoke-updater.key")"`, `export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""`, then `cd packages/desktop && npx tauri build --config src-tauri/tauri.windows-offline.conf.json --bundles nsis`.
2. `Assert offline artifact size` (bash): `SIZE=$(stat -c %s packages/desktop/src-tauri/target/release/bundle/nsis/*-setup.exe)`; error-exit with `offline installer is ${SIZE} bytes (< 104857600) — overlay not applied?` when below floor.
3. `Silent install (offline)` (pwsh): `Start-Process` the `*-setup.exe` from that bundle dir with `-ArgumentList "/S" -Wait -PassThru`, assert exit code 0.
4. `Locate, launch and assert (offline)`: duplicate the existing locate/launch/version/window-title assertions verbatim (registry lookup → `$installDir.Trim(` → `Join-Path $installDir "pathblender-desktop.exe"` → version equals tree → launch → 15 s → process + `MainWindowTitle`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @pathblender/web -- test/release-pipeline.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/beta-verify.yml packages/web/test/release-pipeline.test.ts
git commit -m "ci: gate beta merges on the offline Windows installer building, size and launch"
```

### Task 5: release-verify.yml proves the published offline asset

**Files:**
- Modify: `.github/workflows/release-verify.yml` (`windows-installer` job, lines ~55–207 at `7fed5404`: after the existing download step, before `Screenshot the running app`)
- Test: `packages/web/test/release-pipeline.test.ts`

**Interfaces:**
- Consumes: the published Release assets from Task 3; the job's existing metadata + anonymous-download + server-side-digest chain (`GH_METADATA_TOKEN`, `browser_download_url`, `/^sha256:[0-9a-f]{64}$/`, `sha256 mismatch`, `size mismatch` literals — all test-pinned, keep them byte-identical).
- Produces: post-release proof that the real public offline asset downloads anonymously, matches GitHub's digest, is ≥ 100 MiB, installs silently and launches. This is the closest available substitute for the no-browser bare-metal smoke (which stays explicitly unverified — Task 10).

- [ ] **Step 1: Write the failing test**

Extend the Task 3 describe:

```ts
  it('release-verify downloads, digest-pins, size-floors, installs and launches the offline asset', () => {
    const verifyText2 = readFileSync(resolve(ROOT, '.github/workflows/release-verify.yml'), 'utf-8');
    const windows = verifyText2.slice(verifyText2.indexOf('  windows-installer:'), verifyText2.indexOf('  macos-intel-dmg:'));
    for (const s of [
      'PathBlender_${VER}_x64-offline-setup.exe',
      'sha256-offline.log',
      '104857600',
      'offline installer is smaller than 100 MiB',
    ]) expect(windows).toContain(s);
    expect((windows.match(/-ArgumentList "\/S"/g) ?? []).length).toBe(2);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @pathblender/web -- test/release-pipeline.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Duplicate, do not refactor, the existing per-asset chain (keeping every pinned literal of the current online path intact):

1. New step `Resolve and anonymously download the published offline installer` (bash): same structure as the online step but `WANT="PathBlender_${VER}_x64-offline-setup.exe"`, writing `sha256-offline.log`, and after the digest/size match add `if [ "$(wc -c < "dl/$WANT" | tr -d " ")" -lt 104857600 ]; then echo "::error::offline installer is smaller than 100 MiB — not an offlineInstaller build"; exit 1; fi`.
2. New step `Silently install the offline installer` (pwsh): same as the existing install step but targeting `dl/*_x64-offline-setup.exe` with `-ArgumentList "/S"`.
3. New step `Locate, launch and assert (offline)`: duplicate of the existing assert step (tag-derived version, launch, 15 s, process + `MainWindowTitle`), writing `launch-offline-result.txt`.
4. Add `sha256-offline.log` and `launch-offline-result.txt` to the job's upload-artifact `path:` list.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @pathblender/web -- test/release-pipeline.test.ts`
Expected: PASS — including the pre-existing `release-verify.yml` describe block (its pinned literals must be untouched).

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/release-verify.yml packages/web/test/release-pipeline.test.ts
git commit -m "ci: verify the published offline Windows asset anonymously and launch it"
```

### Task 6: Release notes list the offline installer (8 locales + size)

**Files:**
- Modify: `scripts/release-notes-locales.json` (8 locale blocks: `en`, `zh`, `zh-hk`, `es`, `fr`, `tr`, `pt-br`, `he`)
- Modify: `scripts/release-notes-for.mjs` (assets list ~lines 106–110; downloads line ~130)
- Test: `packages/web/test/prepare-release-artifacts.test.ts`

**Interfaces:**
- Consumes: Task 2 manifest (`manifest.windows.nsisOffline`, `nsisOfflineBytes`).
- Produces: new locale key `platforms.windowsOffline`; the rendered download bullet for it appends ` (≈ N MB)` where N = `Math.round(nsisOfflineBytes / 1048576)`. The no-manifest legacy path (used when `PB_RELEASE_ARTIFACTS` is unset) is unchanged.

- [ ] **Step 1: Write the failing tests**

In the success test of `prepare-release-artifacts.test.ts` (after the existing notes `toContain` loop): `expect(notes).toContain(result.manifest.windows.nsisOffline)`, `expect(notes).toMatch(/\(\d+ MB\)/)`, and for every one of the 8 labels below `expect(notes).toContain(label)`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @pathblender/web -- test/prepare-release-artifacts.test.ts`
Expected: FAIL — notes lack the offline filename and labels.

- [ ] **Step 3: Implement**

Add `"windowsOffline"` to `platforms` in all 8 locale blocks with exactly:

- en: `Windows x86_64 (NSIS, offline — embeds WebView2)`
- zh: `Windows x86_64（NSIS 离线版，内嵌 WebView2）`
- zh-hk: `Windows x86_64（NSIS 離線版，內嵌 WebView2）`
- es: `Windows x86_64 (NSIS sin conexión, con WebView2 integrado)`
- fr: `Windows x86_64 (NSIS hors ligne, WebView2 intégré)`
- tr: `Windows x86_64 (NSIS çevrimdışı, WebView2 gömülü)`
- pt-br: `Windows x86_64 (NSIS offline, com WebView2 integrado)`
- he: `Windows x86_64 (NSIS ללא חיבור לאינטרנט, כולל WebView2 מוטמע)`

In `release-notes-for.mjs`, extend the `assets` array (manifest branch) with `['windowsOffline', manifest.windows.nsisOffline]` and append the MB suffix only for that platform in the `downloads` mapping: `` `- **${t.platforms[platform]}** — \`${name}\`${platform === 'windowsOffline' ? ` (${Math.round(manifest.windows.nsisOfflineBytes / 1048576)} MB)` : ''}` ``.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @pathblender/web -- test/prepare-release-artifacts.test.ts && npm test -w @pathblender/web -- test/release-pipeline.test.ts`
Expected: PASS both.

- [ ] **Step 5: Commit**

```bash
git add scripts/release-notes-locales.json scripts/release-notes-for.mjs packages/web/test/prepare-release-artifacts.test.ts
git commit -m "feat: list the offline Windows installer with its size in release notes (8 locales)"
```

### Task 7: NOTICE registers the WebView2 redistribution license

**Files:**
- Modify: `NOTICE.md` (`## Bundled third-party libraries`, lines ~97–127)
- Modify: `docs/releasing.md` (`## 许可证与素材` checklist)
- Test: `packages/web/test/release-pipeline.test.ts` (`third-party legal notices` describe)

**Interfaces:**
- Consumes: verified Microsoft doc "Distribute WebView2 apps and the WebView2 Runtime" — https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution (offline deployment = include the Evergreen Standalone Installer; its Microsoft Software License Terms travel inside the installer; fetched 2026-11-07).
- Produces: the redistribution record every public release re-checks; no license text is copied out of the installer (do not fabricate it).

- [ ] **Step 1: Write the failing test**

In the `third-party legal notices` describe:

```ts
  it('registers the WebView2 Runtime redistribution in the notice', () => {
    const notice = readFileSync(resolve(ROOT, 'NOTICE.md'), 'utf8');
    expect(notice).toContain('**Microsoft Edge WebView2 Runtime** (Microsoft Software License Terms');
    expect(notice).toContain('https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution');
    expect(notice).toContain('Evergreen Standalone Installer');
    const releasing = readFileSync(resolve(ROOT, 'docs/releasing.md'), 'utf8');
    expect(releasing).toContain('WebView2');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @pathblender/web -- test/release-pipeline.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `NOTICE.md` under `Bundled third-party libraries`, after the `window-vibrancy` bullet:

```markdown
- **Microsoft Edge WebView2 Runtime** (Microsoft Software License Terms) —
  the offline Windows NSIS installer
  (`PathBlender_<version>_x64-offline-setup.exe`) redistributes the
  Evergreen Standalone Installer, which embeds the runtime and its license
  terms; redistribution terms per
  https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution.
  The default online installer downloads Microsoft's bootstrapper at
  install time and does not redistribute runtime binaries.
```

In `docs/releasing.md` `## 许可证与素材`, add a checklist row in the section's existing style: re-check before every public release that the WebView2 redistribution entry in NOTICE still matches Microsoft's distribution terms (link above), and that the offline asset actually embeds the runtime (size floor held in CI).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @pathblender/web -- test/release-pipeline.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add NOTICE.md docs/releasing.md packages/web/test/release-pipeline.test.ts
git commit -m "docs: register WebView2 Runtime redistribution in NOTICE and the release checklist"
```

### Task 8: zh/en install guides + README offline rows (Gatekeeper, SmartScreen)

**Files:**
- Modify: `docs/user-guide.en.md` (`## Installing the desktop app`, lines ~234–256)
- Modify: `docs/user-guide.zh.md` (`## 安装桌面版`, lines ~134–150)
- Modify: `README.md` (~line 87), `README.zh-CN.md` (~line 59), `README.zh-Hant.md`, `README.es.md`, `README.fr.md`, `README.tr.md`, `README.pt-BR.md`, `README.he.md` (~line 66 each: the Windows download line)
- Test: `packages/web/test/release-pipeline.test.ts`

**Interfaces:**
- Consumes: pinned artifact name `PathBlender_<version>_x64-offline-setup.exe`; spec §7.1 (macOS first-install "仍要打开" + password, ~30 s, once per Mac; SmartScreen three-step guide; three-channel tutorials). Linux terminal guidance already exists in both guides (DEB/AppImage/RPM commands) — no Linux change in this task.
- Produces: user-facing security-prompt guidance in the two maintained guide languages plus a one-line offline mention in all 8 READMEs. Text only — no screenshots, no claims that prompts were observed (Task 10 registers that gap).

- [ ] **Step 1: Write the failing test**

```ts
describe('install guidance (offline installer + OS security prompts)', () => {
  it('both user guides explain the offline installer and both OS prompts', () => {
    const en = readFileSync(resolve(ROOT, 'docs/user-guide.en.md'), 'utf8');
    const zh = readFileSync(resolve(ROOT, 'docs/user-guide.zh.md'), 'utf8');
    for (const s of ['_x64-offline-setup.exe', 'Open Anyway', 'More info', 'Run anyway']) expect(en).toContain(s);
    for (const s of ['_x64-offline-setup.exe', '仍要打开', '更多信息', '仍要运行']) expect(zh).toContain(s);
  });
  it('every README download section mentions the offline Windows installer', () => {
    for (const file of ['README.md', 'README.zh-CN.md', 'README.zh-Hant.md', 'README.es.md', 'README.fr.md', 'README.tr.md', 'README.pt-BR.md', 'README.he.md']) {
      expect(readFileSync(resolve(ROOT, file), 'utf8'), file).toContain('_x64-offline-setup.exe');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @pathblender/web -- test/release-pipeline.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`docs/user-guide.en.md`, inside `## Installing the desktop app`: extend the intro to name both Windows installers — `*_x64-setup.exe` (small; downloads WebView2 from Microsoft at install time) and `PathBlender_<version>_x64-offline-setup.exe` (larger — embedding WebView2 adds ≈130 MB over the online installer; the exact total size comes from the CI manifest, never a guess; for offline/event machines and clean Windows 10 without WebView2) — then add a `### First-launch security prompts` subsection: **macOS Gatekeeper** (the app is not Apple-developer-signed): first open is blocked; either right-click the app → **Open** → **Open**, or System Settings → Privacy & Security → scroll down → **Open Anyway**; macOS asks for your password once, ~30 seconds, once per Mac. **Windows SmartScreen** (unsigned installer): "Windows protected your PC" → **More info** → **Run anyway**. `docs/user-guide.zh.md`: mirror in Chinese — 「仍要打开」(系统设置 → 隐私与安全性)，SmartScreen「更多信息」→「仍要运行」，注明未购买开发者账号签名（与 PathPlanner/Choreo 社区工具相同的免费上限）。 Keep each guide's existing tone and length discipline (concise, factual).

READMEs: extend only the Windows download row/line with a short offline variant mention in that file's language, reusing the Task 6 locale phrasing (e.g. en: "`*_x64-setup.exe` (online) or `*_x64-offline-setup.exe` (offline, embeds WebView2)"). Do not touch anything else in the READMEs.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @pathblender/web -- test/release-pipeline.test.ts`
Expected: PASS (FIRST-disclaimer README test stays green — additive edits only).

- [ ] **Step 5: Commit**

```bash
git add docs/user-guide.en.md docs/user-guide.zh.md README.md README.zh-CN.md README.zh-Hant.md README.es.md README.fr.md README.tr.md README.pt-BR.md README.he.md packages/web/test/release-pipeline.test.ts
git commit -m "docs: offline Windows installer, Gatekeeper and SmartScreen guidance in zh/en"
```

### Task 9: Homebrew cask generator + tests (tap repo NOT created)

**Files:**
- Create: `scripts/gen-homebrew-cask.mjs`
- Create: `packages/web/test/gen-homebrew-cask.test.ts`
- Modify: `docs/releasing.md` (new operator subsection under `## GitHub（发布操作纪律）`)
- Test: the new test file

**Interfaces:**
- Consumes: a released version string and the sha256 of its published `PathBlender_<version>_universal.dmg` (computed by the operator with `shasum -a 256`); the pinned DMG basename pattern from `prepare-release-artifacts.mjs`.
- Produces: `node scripts/gen-homebrew-cask.mjs <version> <sha256>` printing a Homebrew Cask to stdout for `LYT259/homebrew-tap` → `Casks/pathblender.rb`. Writes no files, runs no git, contacts no network. Validates: version `^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$`, sha256 `^[0-9a-f]{64}$`, exactly 2 args.

- [ ] **Step 1: Write the failing tests**

`packages/web/test/gen-homebrew-cask.test.ts`, modeled on `prepare-release-artifacts.test.ts` (execFileSync against the script, `GITHUB_ENV: ''`): success case with `0.1.10` + a 64-hex fixture asserts the output contains `cask "pathblender" do`, `version "0.1.10"`, `sha256 "<the fixture hex>"`, `url "https://github.com/LYT259/pathblender/releases/download/v#{version}/PathBlender_#{version}_universal.dmg"`, `verified: "github.com/LYT259/pathblender/"`, `name "PathBlender"`, `desc "Free, open-source FRC autonomous path viewer"` (the README.md opening sentence), `homepage "https://github.com/LYT259/pathblender"`, `depends_on macos: ">= :ventura"` (macOS 13, matching `tauri.conf.json` `minimumSystemVersion`), `app "PathBlender.app"`, and a trailing `end`. Rejection cases (nonzero exit): uppercase/truncated sha256, `v0.1.10` (leading v), `0.1` (not semver), 1 arg, 3 args. Also assert the script never writes a file: run in a `mkdtempSync` cwd with `stdio` captured and expect the cwd to stay empty afterwards.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @pathblender/web -- test/gen-homebrew-cask.test.ts`
Expected: FAIL — script missing (`ENOENT`).

- [ ] **Step 3: Implement `scripts/gen-homebrew-cask.mjs`**

Header comment stating purpose (generate the cask body for the self-maintained `LYT259/homebrew-tap`; creating/pushing that repo is a separate user-authorized step — see `docs/releasing.md`), then argv validation exactly as the Interfaces block, then a single `console.log` of the template literal assembled from the validated inputs (all stanzas listed in Step 1, no interpolation of anything else).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @pathblender/web -- test/gen-homebrew-cask.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the operator procedure to `docs/releasing.md` and commit**

New subsection (bilingual, matching the file's style) under `## GitHub（发布操作纪律）`: after a stable release, the owner-authorized cask publication is — compute `shasum -a 256` of the published Universal DMG; run `node scripts/gen-homebrew-cask.mjs <version> <sha256>`; create/update `Casks/pathblender.rb` in `LYT259/homebrew-tap` with that output; users install with `brew install --cask LYT259/tap/pathblender`. Explicit red line in the text: task agents do NOT create, push or publish the tap repository without a user instruction; `brew audit`/`brew style` against the real tap have not been run (no local tap) — mark unverified.

```bash
git add scripts/gen-homebrew-cask.mjs packages/web/test/gen-homebrew-cask.test.ts docs/releasing.md
git commit -m "feat: add Homebrew cask generator for LYT259/homebrew-tap (tap repo not created)"
```

### Task 10: Unverified-environment registry in the release checklist

**Files:**
- Modify: `docs/releasing.md` (new subsection `## 未验环境清单 / Not-verified environment registry` after `## 隐私红线`)
- Test: `packages/web/test/release-pipeline.test.ts`

**Interfaces:**
- Consumes: spec §7.1 no-browser bare-metal smoke requirement; Task 5's published-asset verification (what CI CAN prove); Task 8's text-only guides; Task 9's un-run brew commands.
- Produces: three standing rows that no future session may read as "passed" without new evidence.

- [ ] **Step 1: Write the failing test**

```ts
describe('not-verified environment registry', () => {
  it('releasing.md pins the three unverified items with explicit markers', () => {
    const releasing = readFileSync(resolve(ROOT, 'docs/releasing.md'), 'utf8');
    for (const s of [
      '未验环境清单',
      '无浏览器裸机冒烟',
      'NOT performed — no clean Windows 10 (without WebView2), macOS or Linux machine is available',
      'SmartScreen / Gatekeeper prompt screenshots: NOT captured',
      'homebrew tap repo: not yet created',
    ]) expect(releasing).toContain(s);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @pathblender/web -- test/release-pipeline.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add the `## 未验环境清单 / Not-verified environment registry` section to `docs/releasing.md` with exactly these three rows (each also describing how to close it, so the row is actionable, not an excuse):

1. **无浏览器裸机冒烟 (spec §7.1)** — NOT performed — no clean Windows 10 (without WebView2), macOS or Linux machine is available. Close it by installing on a clean VM/machine with networking blocked: the offline installer must complete with zero network egress and the app must pass core import/playback/check flows. CI's release-verify proves anonymous download + install + launch on GitHub runners (which already have WebView2), not this.
2. **SmartScreen / Gatekeeper prompt screenshots: NOT captured** — no physical Windows machine; CI runners show no prompt. The zh/en guides describe the documented steps; do not attach or claim prompt screenshots until a real machine produces them.
3. **homebrew tap repo: not yet created** — the cask generator ships in-repo; `brew audit`/`brew style`/installation have not been run against `LYT259/homebrew-tap` because it does not exist yet (user-authorized external step, Task 9).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @pathblender/web -- test/release-pipeline.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/releasing.md packages/web/test/release-pipeline.test.ts
git commit -m "docs: register no-browser smoke, OS-prompt and homebrew gaps as not verified"
```

### Task 11: Version bump, full local verification, delivery

**Files:**
- Modify: version files via `scripts/bump-version.mjs` (8 copies + `packages/web/src/version-info.ts`)
- No new product code.

**Interfaces:**
- Consumes: all previous tasks merged on this branch.
- Produces: the branch's unique beta version with a complete 40-language note, ready for the standing PR/merge/release chain.

- [ ] **Step 1: Bump and translate**

Run: `node scripts/bump-version.mjs beta "Offline Windows installer (bundles WebView2), install guides and Homebrew cask generator"`
Then fill the newest entry's note for every language in `NOTE_LANGS` (`packages/web/src/version-info.ts:19`, 40 keys; `bump-version.mjs` writes `en` only; follow the phrasing of neighbouring entries; zh-hk style: write `zh-tw`, the alias resolves). Keep the note one short sentence per language.

- [ ] **Step 2: Run the full local gate**

Run: `npm run version:check && npm run typecheck && npm test`
Expected: all green — `version-notes.test.tsx` enforces the 40 languages; every file touched by this plan green. If the beta-verify/browser-walkthrough assertions moved because PR #409 landed, rebase onto `origin/beta` first and re-run.

- [ ] **Step 3: Commit**

```bash
git add package.json packages/core/package.json packages/web/package.json packages/desktop/package.json packages/desktop/src-tauri/tauri.conf.json packages/desktop/src-tauri/Cargo.toml packages/desktop/src-tauri/Cargo.lock package-lock.json packages/web/src/version-info.ts
git commit -m "chore: bump beta version for offline installer distribution"
```

- [ ] **Step 4: Delivery (standing AGENTS.md chain — summarized, not re-specified)**

Board claim for the implementation work, push branch, PR via `board.py op run` (`pr-create:lyt259/pathblender:<branch>:beta`), independent reviewer, delegated approval, `beta-merge` via `op run`. The beta-merge release then MUST be verified before reporting done: the Release contains `PathBlender_<version>_x64-offline-setup.exe` with size > 100 MiB, `latest-beta.json`'s `windows-x86_64` URL still ends `_x64-setup.exe`, and the release-verify windows job (dispatch with the new tag) is green including `sha256-offline.log`. Anything unverifiable from here is reported as unverified per the Task 10 registry — never as done.

## Self-Review (already applied)

- Spec coverage: §7.1 WebView2 offline requirement → Tasks 1–5; 三渠道教程（含仍要打开/SmartScreen）→ Task 8 (+existing Linux commands); Homebrew cask → Task 9; 无浏览器裸机冒烟 → Task 10 (registered unverified, per available environment); §7.1.1's four formats and no-plain-ZIP unchanged; updater feed unchanged (constraint + tests).
- Proportion: pipeline steps are given verbatim only where contract tests pin exact literals; everything else is signatures + pinned values.
- External/non-acceptable items (tap creation, bare-metal smoke, prompt screenshots, local Windows build) are explicitly out of scope and registered as such.
