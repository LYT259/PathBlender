"""Composite golden generator for the .auto acceptance fixture.

Extends golden-runner.py from per-path goldens to a whole-routine composite:
the input .auto and every referenced .path are real upstream v2025.2.7 files,
each segment's states come from the official wheel (ideal starting states,
same formula as golden-runner.py), and the chaining is a DECLARED model —
never presented as a library API output, because none exists at this tag
(commands.py FollowPathCommand.initialize generates from live robot state).

Declared chaining model (documented in this directory's README):
- sequential depth-first order, asserted equal to the official
  PathPlannerAuto.getPathGroupFromAutoFile path group before anything is
  emitted;
- wait commands hold the previous end pose at 10 Hz for the declared time;
- named commands are zero-duration markers (user-code duration is unknowable
  from the file).

Run from the directory containing the `deploy/` layout:

    python auto-golden-runner.py

Requires: robotpy-pathplannerlib==2025.2.7 (see README in the reference dir).
"""

import json
import os

from wpilib import getDeployDirectory
from wpimath.kinematics import ChassisSpeeds
from pathplannerlib.path import PathPlannerPath
from pathplannerlib.config import RobotConfig
from pathplannerlib.auto import PathPlannerAuto

AUTO_NAME = 'Example Auto'
HOLD_DT = 0.1


def walk(node, out):
    """Depth-first walk of the command tree in official CommandUtil order."""
    if not isinstance(node, dict):
        return
    cmd_type = node.get('type')
    data = node.get('data') or {}
    if cmd_type == 'sequential' or cmd_type in ('parallel', 'race', 'group', 'deadline'):
        for child in data.get('commands') or []:
            walk(child, out)
    elif cmd_type == 'path':
        out.append(('path', str(data['pathName'])))
    elif cmd_type == 'wait':
        wait_json = data['waitTime']
        seconds = float(wait_json['val'] if isinstance(wait_json, dict) else wait_json)
        out.append(('wait', seconds))
    elif cmd_type == 'named':
        out.append(('named', str(data['name'])))


def main():
    config = RobotConfig.fromGUISettings()

    auto_path = os.path.join(
        getDeployDirectory(), 'pathplanner', 'autos', AUTO_NAME + '.auto'
    )
    with open(auto_path, 'r') as f:
        auto_json = json.load(f)

    segments = []
    walk(auto_json['command'], segments)

    # Honesty guard: the walked path order must equal the official API's path
    # group for the same file — otherwise this runner's walk is not the
    # official structure and must not emit a fixture. fromPathFile does not
    # populate .name, so paths are identified by their first path point
    # position (loaded through the official API on both sides).
    official_group = PathPlannerAuto.getPathGroupFromAutoFile(AUTO_NAME)
    walked_paths = [name for kind, name in segments if kind == 'path']
    official_first_points = [
        (p.getPoint(0).position.X(), p.getPoint(0).position.Y()) for p in official_group
    ]
    walked_first_points = [
        (p.getPoint(0).position.X(), p.getPoint(0).position.Y())
        for p in (PathPlannerPath.fromPathFile(n) for n in walked_paths)
    ]
    assert len(walked_paths) == len(official_group), (walked_paths, len(official_group))
    assert walked_first_points == official_first_points, (walked_first_points, official_first_points)

    states = []
    named_markers = []
    clock = 0.0
    last = None
    for kind, value in segments:
        if kind == 'wait':
            steps = max(1, round(value / HOLD_DT))
            for i in range(steps):
                states.append(
                    {
                        't': clock + value * (i + 1) / steps,
                        'x': last['x'],
                        'y': last['y'],
                        'holonomicRotDeg': last['holonomicRotDeg'],
                        'headingDeg': last['headingDeg'],
                        'vx': 0.0,
                        'vy': 0.0,
                        'omegaRadPS': 0.0,
                        'linearVelocity': 0.0,
                    }
                )
            clock += value
        elif kind == 'named':
            named_markers.append({'name': value, 't': clock})
        else:
            path = PathPlannerPath.fromPathFile(value)
            ideal = path.getIdealStartingState()
            h0 = path.getStartingDifferentialPose().rotation()
            speeds = ChassisSpeeds(
                ideal.velocity * h0.cos(),
                ideal.velocity * h0.sin(),
                0.0,
            )
            traj = path.generateTrajectory(speeds, ideal.rotation, config)
            for s in traj.getStates():
                states.append(
                    {
                        't': clock + s.timeSeconds,
                        'x': s.pose.X(),
                        'y': s.pose.Y(),
                        'holonomicRotDeg': s.pose.rotation().degrees(),
                        'headingDeg': s.heading.degrees(),
                        'vx': s.fieldSpeeds.vx,
                        'vy': s.fieldSpeeds.vy,
                        'omegaRadPS': s.fieldSpeeds.omega,
                        'linearVelocity': s.linearVelocity,
                    }
                )
                last = states[-1]
            clock = states[-1]['t']

    out = {
        'auto': AUTO_NAME,
        'pathGroup': walked_paths,
        'namedMarkers': named_markers,
        'numStates': len(states),
        'totalTimeS': states[-1]['t'],
        'states': states,
    }
    with open('golden-example-auto.json', 'w') as f:
        json.dump(out, f, indent=1)

    speeds_ = [s['linearVelocity'] for s in states]
    accels = []
    for a, b in zip(states, states[1:]):
        dt = b['t'] - a['t']
        if dt > 1e-9:
            accels.append((b['linearVelocity'] - a['linearVelocity']) / dt)
    print(
        f'{AUTO_NAME}: states={len(states)} totalTime={states[-1]["t"]:.6f} '
        f'maxV={max(speeds_):.6f} finiteDiffMaxA={max(accels):.6f} '
        f'end=({states[-1]["x"]:.6f},{states[-1]["y"]:.6f},'
        f'{states[-1]["holonomicRotDeg"]:.4f}) '
        f'pathGroup={walked_paths} named={named_markers}'
    )


if __name__ == '__main__':
    main()
