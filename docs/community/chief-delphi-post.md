# Chief Delphi release post — DRAFT (do not post until the app is deployed)

> Local draft only. Fill in the app URL before posting. Keep the attribution
> and disclaimer sections intact (AGENTS.md red line §2, FIRST IP policy §IV).

---

**Title:** PathBlender — blend alliance partners' auto paths (Choreo AND
PathPlanner) into one field with collision checking

Hi CD,

Coordinating autonomous programs with your alliance partners usually means
trading screenshots and guessing "I think we're fine, you're on the other side
by then." We built a small web tool to replace the guessing:

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
  minimum-separation report.
- **What-if start delays**: nudge any robot's start by a few seconds and watch
  conflicts clear, without touching the original file.
- **Zero install, zero upload**: it's a static web page. Files are parsed in
  your browser and never leave it — no backend, no accounts, no telemetry.
  Share a whole session via a link (the data lives in the URL itself).

[SCREENSHOT: collision report]

Three-step usage: open the link → drag in everyone's path files → press play.
If something collides, click the conflict entry to jump straight to that
moment.

Current limits, so you know what you're getting: PathPlanner's rarer path
constraints are approximated (with a warning shown); robot geometry comes from
the `.ghostauto` file when present and is otherwise an editable default;
fields for 2022–2026 are bundled and you can import a custom field image with
two-point calibration + an AprilTag layout JSON.

**Credits & licenses**: trajectory generation is a TypeScript port of
PathPlannerLib (MIT, mjansen4857) with the port noted in code and release
notes; Choreo (BSD-3) interop via its `.traj` format; the `.ghostauto` format
facts come from FRC 103 Cybersonics' Collaborative fork (MIT). Red/blue
normalization follows WPILib conventions.

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
