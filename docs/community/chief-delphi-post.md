# Chief Delphi release post — DRAFT (do not post until the app is deployed)

> Local draft only. Fill in the app URL before posting. Keep the attribution
> and disclaimer sections intact (AGENTS.md red line §2, FIRST IP policy §IV).

---

**Title:** PathBlender — blend alliance partners' auto paths (Choreo AND
PathPlanner) into one field, with collision checking and a 3D view

Hi CD,

Coordinating autonomous programs with your alliance partners usually means
trading screenshots and guessing "I think we're fine, you're on the other side
by then." We built a small tool to replace the guessing:

**PathBlender** fuses the autonomous path files every team already exports
into a single field view with one shared timeline:

- **Imports all three ecosystems**: Choreo `.traj`, PathPlanner `.path` /
  `.auto` (trajectory generation ported to TypeScript — the generation runs
  in your browser, not on the robot), and the Collaborative PathPlanner fork
  `.ghostauto` files (Team 103's fork — credit where due, their ghost overlay
  inspired part of this).
- **One clock for all robots**: play / pause / scrub / 0.25×–1× speed on the
  autonomous period — 15 s for 2022–2025, 20 s on the 2026 REBUILT field.
- **Collision & interference checking**: bumper-rectangle overlap checked
  across the whole timeline (not bounding circles), with a conflict report —
  who, when, and where on the field — plus out-of-bounds markers on the
  timeline.
- **3D field view**: the official field models (2022–2026, from the
  AdvantageScope asset set) with free orbit and a view cube for snapping
  back to standard angles; welded vs AndyMark constructions where they
  differ. 2D stays as the fast tactical overlay.
- **Built for the pre-match huddle, not for drawing paths**: it's a viewer and
  an analyzer. When a conflict is real, the owning team fixes it in Choreo or
  PathPlanner, re-exports, and drops the new file into the still-open session
  — the session updates in place.
- **Route library** (desktop app): import a whole deploy folder per team —
  bystander files are skipped, every route lands in the library, and a picker
  beside each robot switches its active auto live. Multi-segment autos can be
  arranged on the timeline, and one team's paths can be mirrored left/right.
- **Zero install, zero upload**: it's a static web page (plus a native macOS
  app with in-app updates). Files are parsed in your browser and never leave
  it — no backend, no accounts, no telemetry. The desktop app saves the whole
  session into one `.pb` file you can hand to the next meeting, and exports a
  PNG of the field for the alliance chat.

[SCREENSHOT: 3D field view]
[SCREENSHOT: collision report]

Three-step usage: open the link → drag in everyone's path files → press play.
If something collides, click the conflict entry to jump straight to that
moment, switch that robot's route from the library if it has alternates, and
take the timestamp back to the team that owns the path.

Current limits, so you know what you're getting: PathPlanner's rarer path
constraints are approximated (with a warning shown); robot geometry comes from
the `.ghostauto` file or the team's PathPlanner `settings.json` when present
and is otherwise an editable default; fields for 2022–2026 are bundled (all
five seasons have official 3D models) and you can import a custom field image
with calibration + an AprilTag layout JSON for anything else.
Windows/Linux desktop builds are staged for a follow-up release.

**Credits & licenses**: trajectory generation is a TypeScript port of
PathPlannerLib (MIT, mjansen4857) with the port noted in code and release
notes; Choreo (BSD-3) interop via its `.traj` format; the `.ghostauto` format
facts come from FRC 103 Cybersonics' Collaborative fork (MIT); 3D field
models and field images come from the AdvantageScopeAssets repository
(BSD-3). Red/blue normalization and AprilTag layouts follow WPILib
conventions and resources.

> FIRST®, FIRST® Robotics Competition, and FIRST® Tech Challenge, are
> registered trademarks of FIRST® (www.firstinspires.org) which is not
> overseeing, involved with, or responsible for this activity, product, or
> service.

If a file from your toolchain fails to import, please attach it (or paste the
error) — format drift reports are exactly what we need before kickoff season.

**Link:** [TO BE FILLED AFTER DEPLOYMENT]

---

## Posting checklist (when the time comes)

- [ ] App deployed; link tested in a clean browser profile
- [ ] Fill link + verify screenshots render on CD
- [ ] Post in an appropriate channel at a reasonable hour (US audience)
- [ ] Monitor thread for format-drift reports → add samples to the regression
      suite (`samples/`) as they arrive
