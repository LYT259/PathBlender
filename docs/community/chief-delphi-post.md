# Chief Delphi release post — DRAFT (do not post until the app is deployed)

> Local draft only. Fill in the app URL before posting. Keep the attribution
> and disclaimer sections intact (AGENTS.md red line §2, FIRST IP policy §IV).

---

**Title:** PathBlender — blend alliance partners' auto paths (Choreo AND
PathPlanner) into one field, with collision checking, a 3D view, and a path
editor

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
- **One clock for all robots**: play / pause / scrub / 0.25×–4× speed on the
  15-second autonomous period.
- **Collision & interference checking**: bumper-rectangle overlap checked
  across the whole timeline (not bounding circles), with a conflict report —
  who, when, and where on the field — plus out-of-bounds detection and a
  minimum-separation report. One-click **auto-resolve** proposes the smallest
  set of start delays that clears every conflict.
- **3D field view**: the official field models (2022–2026, from the
  AdvantageScope asset set) with free orbit and a view cube for snapping
  back to standard angles; welded vs AndyMark constructions where they
  differ. 2D stays as the fast tactical overlay.
- **A real path editor**: dedicated page, Choreo/PathPlanner style — drag
  waypoints or type exact coordinates, watch collisions recompute live, and
  export the adjusted path back to `.path` / `.traj` / `.ghostauto` for the
  owning team.
- **Optional AI assistant** (off by default, bring your own key): a
  harness-style composer (slash commands, skills, attachments, permission
  tiers) that drives the same whitelisted actions — collision verdicts
  always come from the deterministic checker, never the model.
- **Zero install, zero upload**: it's a static web page (plus a native macOS
  app with in-app updates). Files are parsed in your browser and never leave
  it — no backend, no accounts, no telemetry. Share a whole session via a
  link (the data lives in the URL itself).

[SCREENSHOT: 3D field view]
[SCREENSHOT: collision report]

Three-step usage: open the link → drag in everyone's path files → press play.
If something collides, click the conflict entry to jump straight to that
moment — or press Auto-resolve and take the proposed delays back to your
partners.

Current limits, so you know what you're getting: PathPlanner's rarer path
constraints are approximated (with a warning shown); robot geometry comes from
the `.ghostauto` file when present and is otherwise an editable default;
fields for 2018–2026 are bundled (official 3D models cover 2022–2026) and you
can import a custom field image with calibration + an AprilTag layout JSON.
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
