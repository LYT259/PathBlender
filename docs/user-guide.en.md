# PathBlender User Guide (for alliance strategy groups)

A pre-match coordination tool: put every team's exported autonomous path files
onto one field, replay them on a shared timeline, and automatically check for
collisions. **All files are parsed inside your browser — nothing is uploaded
anywhere.**

## Three steps

1. **Open the link** (see the README for the URL; Safari / Chrome / Edge all work).
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

## Resolving conflicts with start delays (what-if)

Two robots collide around t = 4–5 s? Don't ask anyone to redraw a path — try
offsetting in time first:

1. Find the **delay** input on a robot card (left panel);
2. Give one robot a 1–3 s start delay;
3. The conflict panel refreshes live. If the collision clears, "leave X
   seconds later" is the answer — take it back to the other team.

Delays live only in your session — **no source file is ever modified**. The
same goes for the geometry inputs (length/width) if you want the check to
match real bumpers.

## Other things you'll use

- **Red/blue alliance**: a partner's path drawn from the red perspective? Toggle Red on the robot card and it is mirrored into the unified frame automatically;
- **Season fields**: switch 2022–2026 in the header; custom field images can be imported too (two-point calibration + an AprilTag layout JSON);
- **Sharing**: Share link packs the whole session into the URL (no server involved); Save session produces a `.ghpb.json` file; PNG export for the alliance chat;
- **Languages**: 简体中文 / 繁體中文 / English from the header;
- **Install as an app**: Safari "Add to Dock" / Chrome "Install" — standalone window + icon, and it still opens with no network (static assets are cached).

## Mediation editing & export (new in v1.4)

Beyond delays, you can nudge path geometry directly:

1. Press **edit path** on a robot card (`.path` / `.traj` only; `.ghostauto` files carry no waypoints);
2. **Drag the white points** on the field (PathPlanner paths also expose bezier control points on dashed arms); **double-click** a segment to insert a point, **right-click** a point to remove it;
3. Collisions recompute on every change — when the red rings are gone, you're done. Edits are **derived copies** (the card shows "adjusted" with a one-click **reset**); PathPlanner paths regenerate their timing, Choreo paths keep the original timing with remapped geometry (warned on the card);
4. Use the card's **.path / .traj / .ghostauto** buttons to export the adjusted copy (file name gets an `-adjusted` suffix) and send it back to the team that owns the path.

## AI assistant (new in v1.4, off by default)

Open the **AI** panel from the header: pick a provider (Zhipu Z.ai / OpenAI / DeepSeek / local Ollama or custom), fill in the base URL, model, and your API key, then connect. You can then give plain-language instructions like "delay the second robot half a second to clear the collision, then export all paths".

Discipline: the key lives only in this browser and never enters session files, share links, or exports; the assistant can only run whitelisted commands (delays / alliance / team number / waypoints, collision queries…), every action is undoable, and **exports and robot removal ask for confirmation first**. Collision verdicts always come from the deterministic detector, never the model. Disconnect any time. While enabled, path data goes to the provider you configured — a local Ollama keeps it on your machine.

## FAQ

**Q: Importing a `.path` says "generated with default robot config — timing is an estimate"?**
`.path` files store waypoints only; the trajectory is regenerated in your
browser using generic robot parameters (mass/motors). The timeline is an
approximation (typically within a few hundred milliseconds) — treat collision
verdicts as advisory and double-check timing-critical calls with both teams.

**Q: An `.auto` import says "routine references path … — import the matching .path file too"?**
An `.auto` is a routine (path references + waits/commands). Drag the matching
`.path` files **in the same batch** as the `.auto`.

**Q: The auto period is 15 s but the timeline is longer/shorter?**
Timeline length = the longest trajectory including delays. Each robot's band
shows its own true start and end.

**Q: Is my data safe?**
Pure static page: no backend, no accounts, no telemetry. Parsing happens in
your browser's memory; share-link data only leaves the page when you copy it.

**Q: A file fails to import?**
Post the error (or the file) in the release thread — format-drift reports are
exactly the feedback we need.
