#!/usr/bin/env python3
"""Generate .ghostauto sample files for the PathBlender regression suite.

Format facts confirmed from Team 103 Collaborative PathPlanner fork
lib/auto/ghost_auto.dart (MIT), toJson/fromJson methods, 2026-08-25.

The generated pair is deliberately collision-tuned:
- straight_run crosses x=7.5 around t=4.2..5.0 s while
- stop_and_score sits parked at (7.5, 2.0) from t=3.0..5.0 s  -> overlap
- side_lane runs a parallel lane 2 m away                      -> no overlap

Coordinates: WPILib blue-origin convention (meters, radians), +x toward the
red alliance wall, +y to the left when standing at the blue wall.
"""

import json
import math
import os

DT = 0.1  # 10 Hz, matching the fork's export sampling


def seg(p0, v, t):
    return [p0[0] + v[0] * t, p0[1] + v[1] * t]


def piecewise(phases, heading, name, team, duration):
    """phases: list of (t_start, t_end, from_point, velocity[x,y]) inclusive start."""
    states = []
    n = int(round(duration / DT))
    for i in range(n + 1):
        t = round(i * DT, 3)
        for (t0, t1, p0, v) in phases:
            if t0 <= t <= t1:
                x, y = seg(p0, v, t - t0)
                states.append({
                    "t": t,
                    "x": round(x, 4), "y": round(y, 4),
                    "rotation": heading,
                    "vx": round(v[0], 4), "vy": round(v[1], 4),
                    "omega": 0.0,
                    "moduleStates": [
                        {
                            "fieldAngle": round(math.atan2(v[1], v[0]), 6) if (v[0] or v[1]) else 0.0,
                            "fieldPosX": round(x, 4), "fieldPosY": round(y, 4),
                            "speed": round(math.hypot(v[0], v[1]), 4),
                            "angle": round(math.atan2(v[1], v[0]), 6) if (v[0] or v[1]) else 0.0,
                        }
                    ] * 0,  # module states omitted; optional per fromJson
                })
                break
    return {
        "version": "1.0",
        "name": name,
        "teamName": team,
        "bumperSize": {"width": 0.9, "height": 0.9},
        "bumperOffset": {"x": 0.0, "y": 0.0},
        "holonomic": True,
        "moduleLocations": [
            {"x": 0.3, "y": 0.3}, {"x": 0.3, "y": -0.3},
            {"x": -0.3, "y": 0.3}, {"x": -0.3, "y": -0.3},
        ],
        "states": states,
    }


def straight_run():
    # (2,2) -> (12,2) at 1.2 m/s: crosses x∈[7.05,7.95] at t∈[4.21,4.96]
    dur = 10 / 1.2
    return piecewise([(0, dur, (2, 2), (1.2, 0.0))], 0.0,
                     "Straight Run", "Team 0001", dur)


def stop_and_score():
    # (7.5,0.5) -> (7.5,2.0) at 0.5 m/s (3 s), park 3..5 s, continue to y=5
    return piecewise([
        (0.0, 3.0, (7.5, 0.5), (0.0, 0.5)),
        (3.0, 5.0, (7.5, 2.0), (0.0, 0.0)),
        (5.0, 9.0, (7.5, 2.0), (0.0, 0.5)),
    ], math.pi / 2, "Stop And Score", "Team 0002", 9.0)


def side_lane():
    # (13.5,4) -> (2,4) at 1.0 m/s: parallel lane, 2 m offset, never overlaps
    dur = 11.5
    return piecewise([(0, dur, (13.5, 4.0), (-1.0, 0.0))], math.pi,
                     "Side Lane", "Team 0003", dur)


def out_of_bounds():
    # (2,4) -> (16.2,4): runs past the 16.54 m wall edge at the very end
    # (bumper crosses the boundary for the last ~0.5 s).
    dur = 11.0
    return piecewise([(0, dur, (2, 4), (1.29, 0.0))], 0.0,
                     "Out Of Bounds", "Team 0004", dur)


def main():
    out = os.path.join(os.path.dirname(__file__), "..", "samples", "ghostauto")
    os.makedirs(out, exist_ok=True)
    for gen, fname in [
        (straight_run, "straight_run.ghostauto"),
        (stop_and_score, "stop_and_score.ghostauto"),
        (side_lane, "side_lane.ghostauto"),
        (out_of_bounds, "out_of_bounds.ghostauto"),
    ]:
        path = os.path.join(out, fname)
        with open(path, "w") as f:
            json.dump(gen(), f, indent=2)
            f.write("\n")
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
