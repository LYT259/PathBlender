"""Golden generator for PathBlender's pinned PathPlanner v2025.2.7 acceptance fixtures.

Runs the official robotpy-pathplannerlib 2025.2.7 wheel (the upstream python
port published from repo tag v2025.2.7) on the upstream example project files
and dumps trajectory states to JSON. Run from the directory containing the
`deploy/` layout:

    python golden-runner.py

Requires: robotpy-pathplannerlib==2025.2.7 (see README in the reference dir).
"""

import json
import math

from wpimath.kinematics import ChassisSpeeds
from wpimath.geometry import Rotation2d
from pathplannerlib.path import PathPlannerPath
from pathplannerlib.config import RobotConfig


def main():
    config = RobotConfig.fromGUISettings()
    print(
        json.dumps(
            {
                'config': {
                    'holonomic': config.isHolonomic,
                    'massKG': config.massKG,
                    'MOI': config.MOI,
                    'numModules': config.numModules,
                    'moduleLocations': [[t.X(), t.Y()] for t in config.moduleLocations],
                    'wheelRadiusM': config.moduleConfig.wheelRadiusMeters,
                    'maxDriveVelocityMPS': config.moduleConfig.maxDriveVelocityMPS,
                    'wheelCOF': config.moduleConfig.wheelCOF,
                    'driveCurrentLimitA': config.moduleConfig.driveCurrentLimit,
                    'torqueLoss': config.moduleConfig.torqueLoss,
                }
            },
            indent=2,
        )
    )

    for name in ('Pickup', 'Score'):
        path = PathPlannerPath.fromPathFile(name)
        ideal = path.getIdealStartingState()
        # Ideal starting state, the GUI preview basis: velocity along the
        # robot's starting heading (field frame), rotation = ideal rotation.
        # Both example paths carry ideal velocity 0.
        v0 = ideal.velocity
        h0 = path.getStartingDifferentialPose().rotation()  # path heading at start
        speeds = ChassisSpeeds(
            v0 * h0.cos(),
            v0 * h0.sin(),
            0.0,
        )
        traj = path.generateTrajectory(speeds, ideal.rotation, config)
        states = traj.getStates()
        out = {
            'path': name,
            'numStates': len(states),
            'totalTimeS': states[-1].timeSeconds,
            'states': [
                {
                    't': s.timeSeconds,
                    'x': s.pose.X(),
                    'y': s.pose.Y(),
                    'holonomicRotDeg': s.pose.rotation().degrees(),
                    'headingDeg': s.heading.degrees(),
                    'vx': s.fieldSpeeds.vx,
                    'vy': s.fieldSpeeds.vy,
                    'omegaRadPS': s.fieldSpeeds.omega,
                    'linearVelocity': s.linearVelocity,
                }
                for s in states
            ],
        }
        with open(f'golden-{name.lower()}.json', 'w') as f:
            json.dump(out, f, indent=1)
        speeds_ = [s.linearVelocity for s in states]
        accels = []
        for a, b in zip(states, states[1:]):
            dt = b.timeSeconds - a.timeSeconds
            if dt > 1e-9:
                accels.append((b.linearVelocity - a.linearVelocity) / dt)
        print(
            f'{name}: states={len(states)} totalTime={states[-1].timeSeconds:.6f} '
            f'maxV={max(speeds_):.6f} minV={min(speeds_):.6f} '
            f'finiteDiffMaxA={max(accels):.6f} '
            f'end=({states[-1].pose.X():.6f},{states[-1].pose.Y():.6f},'
            f'{states[-1].pose.rotation().degrees():.4f})'
        )


if __name__ == '__main__':
    main()
