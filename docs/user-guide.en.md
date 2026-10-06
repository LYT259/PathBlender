# PathBlender User Guide (for alliance strategy groups)

A pre-match coordination tool: put every team's exported autonomous path
files onto one field, replay them on a shared timeline, and automatically
check for collisions. **All files are parsed on your machine — nothing is
uploaded anywhere.** PathBlender is a viewer: it shows you the problem;
the fix happens in the tool that owns the path.

## Three steps

1. **Open the app** — the desktop app, or the web app at
   [pathblender.pages.dev](https://pathblender.pages.dev) (Safari /
   Chrome / Edge all work). No files yet? Press **Try the example** on
   the welcome screen first.
2. **Import path files** — multi-select and mixed formats are fine:
   Choreo `.traj`, PathPlanner `.path` / `.auto`, and Team 103
   Collaborative fork `.ghostauto`. Broken files report why they failed
   without blocking the rest. On the desktop app you can also import a
   whole folder (see the route library below).
3. **Press play.** Collision risks show up as red rings on the field, red
   segments on the timeline, and entries in the conflict panel (who,
   when, where) — click one to jump the clock straight to that moment.

## How each team exports

| Team's tool | File(s) | How |
|---|---|---|
| Choreo | `.traj` | Export the trajectory from Choreo |
| PathPlanner | `.path` + `.auto` | Take the files from the project folder; **every `.path` referenced by an `.auto` must be imported in the same batch** |
| PathPlanner (bonus) | `settings.json` | Import it too and every robot gets the project's real bumper size |
| 103 Collaborative fork | `.ghostauto` | Export a ghost from the fork — it carries the robot size and team name |

## What to do when a conflict appears

1. **Read the report**: the conflict panel says which two robots, at what
   time, and where on the field; out-of-bounds moments are marked on the
   timeline.
2. **Inspect**: click a conflict to jump the clock to it; scrub the
   timeline; flip the red/blue alliance view to watch the same blend from
   the side of the field those robots actually start on; switch a robot's
   route from the library to compare alternatives.
3. **Fix in the source tool**: PathBlender deliberately does not edit
   paths — the team that owns the path changes it in Choreo /
   PathPlanner, re-exports, and you drop the new file into the open
   session. Re-check. Repeat until the timeline is clean.

## Route library (desktop app)

**Import folder** ingests a team's whole deploy directory: bystander
files are skipped and every route lands in a library. A picker beside
each robot switches its active auto live (undo restores the previous
one) — the fastest way to compare "their plan A vs plan B" against the
rest of the alliance.

## 3D view & fields

- The **2D / 3D** toggle in the header appears for every built-in season —
  **FRC 2022–2026** all ship an official 3D model (welded and AndyMark
  constructions where they differ; 2025 has both). Imported custom
  fields are 2D-only.
- The 3D view has free orbit, one-click **Fit** to frame the content,
  and a default-view button to snap the camera home.
- The 2D view offers a **schematic** and a **rendered** artwork style
  per season, with the official AprilTag layout overlaid.
- Seasons: 2022–2026 built in. Any other season or a practice field goes
  through custom field import (image + calibration + an AprilTag layout
  JSON).

## Other things you'll use

- **Alliance view**: one red/blue toggle for the whole session. Every file
  is normalised to the blue-origin convention on import (which is what
  Choreo and PathPlanner export), so choosing **red** mirrors the whole set
  onto the red half of the field — where those robots actually start in a
  match. The flip is a derived view: imported paths are never rewritten, and
  collision checking runs on exactly what you see;
- **Session file & PNG** (desktop): save/open a `.pb` session (sessions saved
  before the rename as `.ghpb.json` still open) to hand the exact field to
  the next strategy meeting; export a PNG of the
  current 2D view for the alliance chat. Everything also lives in the
  PathBlender menu;
- **Appearance & languages**: light/dark/follow-system in Preferences
  (⌘, on desktop); the UI ships in 41 languages — English, 简体中文,
  繁體中文（中國台灣）, 繁體中文（中國香港）, Français, Español, Deutsch,
  Italiano, Português (Brasil), Nederlands, Polski, Čeština, Türkçe,
  Ελληνικά, עברית, العربية, हिन्दी, 日本語, 한국어 among them — the full
  list is in the language menu, and the app follows your system language
  until you pick one;
- **Updates** (desktop): menu **PathBlender → Check for Updates…**;
  Preferences → Updates switches between the stable and beta channels.

## Web app vs desktop app

| | Web | Desktop (macOS) |
|---|---|---|
| Import / playback / collision checking | ✓ | ✓ |
| Save & open session files | open only | ✓ |
| PNG export | — | ✓ |
| Folder import / route library | — | ✓ |
| In-app updates | — | ✓ |

## FAQ

**Q: Importing a `.path` says "generated with default robot config —
timing is an estimate"?**
`.path` files store waypoints only; the trajectory is regenerated
locally using a generic robot profile unless the project's
`settings.json` is imported. The timeline is an approximation (typically
within a few hundred milliseconds) — treat near-miss collision verdicts
as advisory and double-check timing-critical calls with both teams.

**Q: An `.auto` import says "routine references path … — import the
matching .path file too"?**
An `.auto` is a routine (path references + waits/commands). Import the
matching `.path` files **in the same batch** as the `.auto`.

**Q: The auto period is 15 s but the timeline is longer/shorter?**
The 2026 season runs a 20 s autonomous; earlier seasons 15 s. Timeline
length = the longest trajectory including imported start delays. Each
robot's band shows its own true start and end.

**Q: Is my data safe?**
Yes: no backend, no accounts, no telemetry. Web builds make no network
requests at all; the desktop app only contacts GitHub Releases when you
ask it to check for updates. Parsing happens in local memory; session
data leaves the app only when you save or export it yourself.

**Q: A file fails to import?**
[Open an issue](https://github.com/LYT259/pathblender/issues) following
[the feedback template](community/feedback-template.md) — format drift
reports (tool + version + the error text) are exactly what we need. You
are never required to post your path files.
