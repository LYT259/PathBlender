# PathBlender

**Multi-source autonomous path fusion viewer for FRC alliance strategy.**

(Formerly GHPathBlender — renamed PathBlender, report v1.6.)
把联盟伙伴各队导出的自动路径文件融合到同一场地上：统一时间轴回放 + 碰撞/干涉检查，供策略组赛前协调。

Blend autonomous path files exported from different toolchains onto one field:
unified-timeline playback and collision checking, built for **alliance strategy
groups** — not just the programming team.

![Collision report](docs/screenshots/collision-report.png)

## Why

In FRC qualification and playoff matches, all three robots in an alliance run
their autonomous programs on the same 26×54 ft field at the same time. Teams
plan paths in different tools (Choreo, PathPlanner), and nobody can see whether
the resulting autos will collide until they actually do — in a match.

PathBlender fills that gap:

- **Multi-toolchain import** — Choreo `.traj`, Team 103 Collaborative fork
  `.ghostauto`, and native PathPlanner `.path` / `.auto` (trajectory
  generation ported to TypeScript — no other browser tool does this);
- **Unified timeline playback** — every robot on one 15 s autonomous clock,
  play / pause / scrub / speed control (0.25×–4×);
- **Collision & interference checking** — bumper-rectangle OBB overlap along
  the whole timeline, with a conflict report (who, when, where), plus
  out-of-bounds detection and a minimum-separation report;
- **Conflict-mediation editing & export** — nudge waypoints (drag /
  double-click to insert / right-click to remove) and watch collisions
  recompute live; every edit is a derived copy (`-adjusted`) with reset to
  original, exportable back to `.path` / `.traj` / `.ghostauto`;
- **Optional AI assistant** — bring your own OpenAI-compatible endpoint
  (GLM / OpenAI / DeepSeek / local Ollama), default off; the assistant acts
  only through a whitelisted command set (undoable, exports/removals ask
  first) and your key never leaves the browser;
- **Zero install, zero upload** — a pure static web app. Files are parsed
  locally in your browser and never leave it (the AI calls above are the
  only network feature, strictly user-configured and off by default).
- **Also a desktop app** — the same build ships as a lightweight Tauri shell
  (no backend, no sidecars): `npm run tauri build -w packages/desktop`
  produces PathBlender.app + .dmg for offline / native-app workflows;

## Quick start

1. Open the app in any modern browser (link to be published at release).
2. Drag in path files from every alliance partner — `.traj`, `.ghostauto`,
   `.path`, `.auto`, mixed freely. Multi-select works; bad files are reported
   without stopping the good ones.
3. Press **play**. Collisions show up as red rings on the field and as entries
   in the conflict panel — click one to jump the clock to that moment.
4. Fine-tune with the **start delay** input on any robot card (what-if only,
   the source file is never modified) until the conflicts clear.
5. **Share** the result: save a session file, copy a share link (the whole
   session compressed into the URL — nothing is uploaded anywhere), or export
   a PNG for your alliance chat.

Full walkthrough with export instructions per tool and an FAQ:
[English](docs/user-guide.en.md) ·
[简体中文](docs/user-guide.zh.md).

Also included: red/blue alliance normalization per robot, per-robot geometry
editing and team-number annotations (drawn on every robot on the field),
eight season fields (2018–2020, 2022–2026 — 2021 has no public orthographic field asset) + custom field import with calibration
and AprilTag layout (WPILib/PhotonVision JSON), and English / 简体中文 /
繁體中文 UI.

![Multi-robot fusion](docs/screenshots/multi-robot-fusion.png)

## Supported formats

| Format | Source | Notes |
|---|---|---|
| `.traj` | Choreo (SleipnirGroup, BSD-3) | All known schema versions; time-sampled states |
| `.ghostauto` | Collaborative PathPlanner fork (FRC 103, MIT) | Includes bumper geometry & team name |
| `.path` | PathPlanner (MIT) | Trajectory generated locally — ported PathPlannerLib algorithm |
| `.auto` | PathPlanner (MIT) | Path sequences with wait/command semantics |
| `.ghpb.json` | This project | Session file: all robots + settings + field |

## Privacy

Path files are parsed **entirely in your browser**. There is no backend, no
account, no telemetry, and no analytics — the app ships zero network calls.
Share links contain only the compressed session data itself (in the URL hash,
which never leaves the page unless you copy it).

## Status

Working MVP: all four formats import, unified-timeline playback, OBB-SAT
collision checking, red/blue normalization, what-if start delays, session
save/restore, PNG export. Not yet deployed publicly. See
[`PathBlender_可行性研究报告.md`](./PathBlender_可行性研究报告.md)
(feasibility study, in Chinese) for the full plan: market research, file-format
analysis, roadmap, and risk register.

![Simplified Chinese UI](docs/screenshots/i18n-zh.png)

## License

MIT. See [LICENSE](./LICENSE) and [NOTICE.md](./NOTICE.md).

Field artwork and game names are owned by FIRST and used for non-commercial
team strategy purposes following FIRST's trademark & copyrighted-materials
policy, rechecked before each public release:

> FIRST®, FIRST® Robotics Competition, and FIRST® Tech Challenge, are
> registered trademarks of FIRST® (www.firstinspires.org) which is not
> overseeing, involved with, or responsible for this activity, product, or
> service.
