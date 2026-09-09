# PathBlender User Guide (for alliance strategy groups)

A pre-match coordination tool: put every team's exported autonomous path files
onto one field, replay them on a shared timeline, and automatically check for
collisions. **All files are parsed inside your browser — nothing is uploaded
anywhere.**

## Three steps

1. **Open the link** (see the README for the URL; Safari / Chrome / Edge all
   work), or launch the desktop app.
2. **Drag files onto the window** — multi-select and mixed formats are fine:
   Choreo `.traj`, PathPlanner `.path` / `.auto`, and Team 103 Collaborative
   fork `.ghostauto`. Broken files report why they failed without blocking the rest.
3. **Press play.** Collision risks show up as red rings on the field, red
   segments on the timeline, and entries in the conflict panel (who, when,
   where) — click one to jump the clock straight to that moment.

## How each team exports

| Team's tool | File(s) | How |
|---|---|---|
| Choreo | `.traj` | Export the trajectory from Choreo |
| PathPlanner | `.path` + `.auto` | Take the files from the project folder; **every `.path` referenced by an `.auto` must be dragged in the same batch** |
| 103 Collaborative fork | `.ghostauto` | Export a ghost from the fork — it carries the robot size and team name |

## Three ways to resolve a conflict

1. **Auto-resolve** (top of the conflict panel): finds the **smallest set of
   start delays** that clears every conflict (0.25 s steps, deferring the
   earlier starter). If some conflicts can't be cleared by delays alone (e.g.
   a path entered twice), it says so honestly and leaves them for you.
2. **Manual start delays (what-if)**: the delay input on a robot card, 1–3 s
   is usually enough; the conflict panel refreshes live. Delays live only in
   your session — **no source file is ever modified**.
3. **Path editing** (next section): when time can't be shifted, shift geometry.

## Path editor (its own page)

Press **edit path** on a robot card (`.path` / `.traj` only; `.ghostauto`
files carry no waypoints) — the whole window becomes an editing workspace:

- **Drag points** on the field; **double-click** a segment to insert,
  **right-click** a point to remove;
- the **waypoint panel** edits exact numbers: PathPlanner rows expand to
  anchor + prev/next control points, Choreo rows edit x/y (heading is
  read-only);
- every change regenerates the trajectory and recomputes collisions — when
  the red rings are gone, you're done. Edits are **derived copies** (the
  header shows "adjusted" with a one-click full revert);
- export **.path / .traj / .ghostauto** straight from the editor bar (file
  name gets an `-adjusted` suffix) and send it back to the owning team.
  PathPlanner paths regenerate their timing; Choreo paths keep the original
  timing with remapped geometry (warned on the badge).

## 3D view & fields

- The **3D** button in the header switches to the stereo view: **official
  field models for FRC 2022–2026** (welded and AndyMark constructions where
  they differ) with free orbit. The little cube in the corner (**ViewCube**)
  snaps the camera to standard views — click a face; the house button
  returns home; **Fit** frames the current content.
- The 2D view stays the fast tactical overlay with each season's official
  AprilTag layout. 2018–2020 have no official 3D models; the 3D view uses
  simplified structures there.
- The **Welded / AndyMark** selector appears next to the season picker only
  where the two constructions differ — pick whichever your event actually
  uses and the tag layout follows.

## AI assistant (off by default)

Open the panel with the **✦ button** in the canvas bar; the **gear** at the
top-right opens settings: pick a provider (Zhipu Z.ai / Claude (Anthropic) /
OpenAI / DeepSeek / local Ollama or custom), paste your API key, and manage
a **model list per provider** (call name + display name + context size; add
as many as you like, ● activates one, **Test** probes connectivity).

Settings also offer: **API protocol** (OpenAI-compatible by default; the
Anthropic preset automatically uses the native Messages API), **Fetch
models** (pull the endpoint's model list and tick what to add), a
**write-only key field** (saved keys show as `••••1234`), per-model
**vision** declaration, **custom effort levels** (comma separated, first =
off; a `T` toggle for thinks-by-default models sends
`thinking:disabled` at off), and the **web fetch** switch (default off;
when on the assistant may read one public page per call).

The chat composer (mature-harness style):

- type `/` for the **command menu** (the full whitelisted action set);
- type `$` for **skills** (resolve all conflicts / check bounds / export all);
- `+` attaches **path files or a whole folder** into the session;
- inline controls: **permission** (standard = high-risk actions confirm
  first; full access auto-approves — still whitelist-only), **context
  gauge**, model switch, effort, and **send / stop**;
- **history** (clock icon, top-right): conversations persist locally —
  reopen to continue, delete, hover any of your messages and press **⎇ to
  fork** a what-if line, or **⇪ carry a summary** into a new chat;
- **image attachments**: the `+` menu sends images to models that declare
  vision;
- **reminders**: ask "remind me in N seconds…" — `schedule_create/list/
  delete` set session-local reminders delivered as a follow-up message
  when the assistant is idle. No system notification.

Discipline: the key lives only on your machine and never enters session
files, share links, or exports; the assistant can only run whitelisted
commands, every action is undoable. Collision verdicts always come from the
deterministic detector, never the model. While enabled, conversation data
goes to the provider you configured — a local Ollama keeps it on your
machine.

## Other things you'll use

- **Red/blue alliance**: a partner's path drawn from the red perspective?
  Toggle Red on the robot card and it is mirrored into the unified frame;
- **Seasons & custom fields**: 2018–2026 in the header; custom field images
  can be imported (calibration + an AprilTag layout JSON);
- **Sharing**: Share packs the whole session into the URL (no server);
  Save session produces a `.ghpb.json` file; PNG export for the alliance
  chat. Desktop: everything lives in the PathBlender menu;
- **Appearance & languages**: light/dark/follow-system in Preferences
  (⌘, on desktop), 简体中文 / 繁體中文 / English;
- **Install as an app** (web): Safari "Add to Dock" / Chrome "Install";
  desktop builds download as a dmg with in-app update checks.

## FAQ

**Q: Importing a `.path` says "generated with default robot config — timing is an estimate"?**
`.path` files store waypoints only; the trajectory is regenerated in your
browser using generic robot parameters (mass/motors). The timeline is an
approximation (typically within a few hundred milliseconds) — treat collision
verdicts as advisory and double-check timing-critical calls with both teams.

**Q: An `.auto` import says "routine references path … — import the matching .path file too"?**
An `.auto` is a routine (path references + waits/commands). Drag the matching
`.path` files **in the same batch** as the `.auto`.

**Q: Auto-resolve left some conflicts behind?**
Delay-only resolution can't fix structural overlaps — most often the same
path imported twice. Check for duplicates, remove one, and run it again.

**Q: The auto period is 15 s but the timeline is longer/shorter?**
Timeline length = the longest trajectory including delays. Each robot's band
shows its own true start and end.

**Q: Is my data safe?**
Pure static page: no backend, no accounts, no telemetry. Parsing happens in
your browser's memory; share-link data only leaves the page when you copy it.

**Q: A file fails to import?**
Post the error (or the file) in the release thread — format-drift reports are
exactly the feedback we need.
