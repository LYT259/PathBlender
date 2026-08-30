/**
 * PathPlanner trajectory generation, ported 1:1 from PathPlannerLib (MIT)
 * pathplannerlib/.../trajectory/PathPlannerTrajectory.java:
 * generateStates (poses + cosine-interpolated holonomic rotation + module
 * field positions), forwardAccelPass, reverseAccelPass (DC-motor force
 * model, curve-limited by wheel friction, module-dt alignment, chassis
 * desaturation), and time integration dt = 2Δd / (v0 + v1).
 *
 * This is the "one hard bone" of the project (study §5.2) — attribution and
 * license notes live in NOTICE.md.
 */

import { cosineInterpolateAngle } from './geometry';
import {
  desaturateWheelSpeeds,
  fieldToRobot,
  robotToField,
  toChassisSpeeds,
  toModuleStates,
  type ChassisSpeeds,
  type ModuleState,
} from './kinematics';
import type { RobotConfig } from './robot-config';
import type { PathConstraints, ParsedPath } from './path-model';
import { generatePathPoints, type PathPoint } from './path-points';
import type { TrajectorySample } from '../types';

interface GenState {
  /** Field position. */
  x: number;
  y: number;
  /** Holonomic rotation (pose rotation). */
  poseRot: number;
  /** Direction of travel. */
  heading: number;
  constraints: PathConstraints;
  waypointPos: number;
  deltaPos: number;
  moduleFieldX: number[];
  moduleFieldY: number[];
  moduleDeltaPos: number[];
  moduleFieldAngle: number[];
  moduleAngle: number[];
  moduleSpeeds: number[];
  fieldSpeeds: ChassisSpeeds;
  linearVelocity: number;
  timeSeconds: number;
}

export interface GeneratedTrajectory {
  samples: TrajectorySample[];
  /** Event marker timestamps resolved onto the generated timeline. */
  events: { name: string; t: number }[];
  totalTimeS: number;
}

export function generateTrajectory(
  path: ParsedPath,
  config: RobotConfig,
  opts?: {
    startingSpeeds?: ChassisSpeeds;
    startingRotationRad?: number;
  },
): GeneratedTrajectory {
  const pathPoints = generatePathPoints(path);

  const h0 = initialHeading(pathPoints);
  const startingSpeeds: ChassisSpeeds = opts?.startingSpeeds ?? {
    vx: Math.cos(h0) * path.idealStartingState.velocityMPS,
    vy: Math.sin(h0) * path.idealStartingState.velocityMPS,
    omega: 0,
  };
  const startingRotation = opts?.startingRotationRad ?? path.idealStartingState.rotationRad;

  const states = generateStates(pathPoints, path, startingRotation, config);

  // Initial module velocities from the starting speeds.
  const fieldStart = startingSpeeds;
  const initStates = toModuleStates(
    fieldToRobot(fieldStart, states[0]!.poseRot),
    config.moduleLocations,
  );
  for (let m = 0; m < config.moduleLocations.length; m++) {
    states[0]!.moduleSpeeds[m] = (initStates[m] as ModuleState).speedMPS;
  }
  states[0]!.timeSeconds = 0;
  states[0]!.fieldSpeeds = { ...fieldStart };
  states[0]!.linearVelocity = Math.hypot(fieldStart.vx, fieldStart.vy);

  forwardAccelPass(states, config);

  // End module velocities from the goal end state.
  const last = states[states.length - 1]!;
  const endField: ChassisSpeeds = {
    vx: Math.cos(last.heading) * path.goalEndState.velocityMPS,
    vy: Math.sin(last.heading) * path.goalEndState.velocityMPS,
    omega: 0,
  };
  const endStates = toModuleStates(fieldToRobot(endField, last.poseRot), config.moduleLocations);
  for (let m = 0; m < config.moduleLocations.length; m++) {
    last.moduleSpeeds[m] = (endStates[m] as ModuleState).speedMPS;
  }
  last.fieldSpeeds = endField;
  last.linearVelocity = path.goalEndState.velocityMPS;

  reverseAccelPass(states, config);

  // Time integration + event timestamps.
  const events: { name: string; t: number; pos: number }[] = [];
  for (const marker of path.eventMarkers) {
    events.push({ name: marker.name, t: 0, pos: marker.waypointRelativePos });
  }
  let eventCursor = 0;

  for (let i = 1; i < states.length; i++) {
    const prev = states[i - 1]!;
    const state = states[i]!;
    const v0 = prev.linearVelocity;
    const v = state.linearVelocity;
    const sumV = v + v0;
    if (Math.abs(sumV) < 1e-6 || Math.abs(state.deltaPos) < 1e-6) {
      state.timeSeconds = prev.timeSeconds;
    } else {
      state.timeSeconds = prev.timeSeconds + (2 * state.deltaPos) / sumV;
    }
    while (
      eventCursor < events.length &&
      Math.abs((events[eventCursor] as { pos: number }).pos - prev.waypointPos) <=
        Math.abs((events[eventCursor] as { pos: number }).pos - state.waypointPos)
    ) {
      const e = events[eventCursor] as { name: string; t: number };
      e.t = prev.timeSeconds;
      eventCursor++;
    }
  }
  while (eventCursor < events.length) {
    (events[eventCursor] as { t: number }).t = last.timeSeconds;
    eventCursor++;
  }

  const samples: TrajectorySample[] = states.map((s) => ({
    t: s.timeSeconds,
    x: s.x,
    y: s.y,
    heading: s.poseRot,
    vx: s.fieldSpeeds.vx,
    vy: s.fieldSpeeds.vy,
    omega: s.fieldSpeeds.omega,
  }));

  return {
    samples,
    events: events.map(({ name, t }) => ({ name, t })),
    totalTimeS: last.timeSeconds,
  };
}

function initialHeading(points: PathPoint[]): number {
  const a = points[0]!;
  const b = points[1]!;
  return Math.atan2(b.position.y - a.position.y, b.position.x - a.position.x);
}

function getNextRotationTargetIdx(points: PathPoint[], startingIndex: number): number {
  for (let i = startingIndex; i < points.length - 1; i++) {
    if ((points[i] as PathPoint).rotationTarget !== null) return i;
  }
  return points.length - 1;
}

function generateStates(
  points: PathPoint[],
  path: ParsedPath,
  startingRotation: number,
  config: RobotConfig,
): GenState[] {
  const states: GenState[] = [];
  let prevRotationTargetIdx = 0;
  let prevRotationTargetRot = startingRotation;
  let nextRotationTargetIdx = getNextRotationTargetIdx(points, 0);
  let nextRotationTargetRot = rotationOf(points, nextRotationTargetIdx);

  const numModules = config.moduleLocations.length;

  for (let i = 0; i < points.length; i++) {
    const p = points[i] as PathPoint;
    if (i > nextRotationTargetIdx) {
      prevRotationTargetIdx = nextRotationTargetIdx;
      prevRotationTargetRot = nextRotationTargetRot;
      nextRotationTargetIdx = getNextRotationTargetIdx(points, i);
      nextRotationTargetRot = rotationOf(points, nextRotationTargetIdx);
    }

    const prevTargetPoint = points[prevRotationTargetIdx] as PathPoint;
    const nextTargetPoint = points[nextRotationTargetIdx] as PathPoint;
    const span = nextTargetPoint.distanceAlongPath - prevTargetPoint.distanceAlongPath;
    const t = span > 1e-9
      ? (p.distanceAlongPath - prevTargetPoint.distanceAlongPath) / span
      : 1;
    const poseRot = cosineInterpolateAngle(prevRotationTargetRot, nextRotationTargetRot, t);

    const state: GenState = {
      x: p.position.x,
      y: p.position.y,
      poseRot,
      heading: 0,
      constraints: p.constraints,
      waypointPos: p.waypointPos,
      deltaPos: 0,
      moduleFieldX: [],
      moduleFieldY: [],
      moduleDeltaPos: new Array(numModules).fill(0),
      moduleFieldAngle: new Array(numModules).fill(0),
      moduleAngle: new Array(numModules).fill(0),
      moduleSpeeds: new Array(numModules).fill(0),
      fieldSpeeds: { vx: 0, vy: 0, omega: 0 },
      linearVelocity: 0,
      timeSeconds: 0,
    };

    if (i !== points.length - 1) {
      const q = points[i + 1] as PathPoint;
      const dx = q.position.x - state.x;
      const dy = q.position.y - state.y;
      state.heading = Math.hypot(dx, dy) <= 1e-6 ? 0 : Math.atan2(dy, dx);
    } else {
      state.heading = (states[i - 1] as GenState).heading;
    }

    if (!config.holonomic) {
      state.poseRot = path.reversed ? state.heading + Math.PI : state.heading;
    }

    if (i !== 0) {
      const prev = states[i - 1] as GenState;
      state.deltaPos = Math.hypot(state.x - prev.x, state.y - prev.y);
    }

    const c = Math.cos(state.poseRot);
    const s = Math.sin(state.poseRot);
    for (let m = 0; m < numModules; m++) {
      const loc = config.moduleLocations[m] as { x: number; y: number };
      const fx = state.x + c * loc.x - s * loc.y;
      const fy = state.y + s * loc.x + c * loc.y;
      state.moduleFieldX.push(fx);
      state.moduleFieldY.push(fy);
      if (i !== 0) {
        const prev = states[i - 1] as GenState;
        state.moduleDeltaPos[m] = Math.hypot(
          fx - (prev.moduleFieldX[m] as number),
          fy - (prev.moduleFieldY[m] as number),
        );
      }
    }
    states.push(state);
  }

  // Module headings.
  for (let i = 0; i < states.length; i++) {
    for (let m = 0; m < numModules; m++) {
      const s = states[i] as GenState;
      if (i !== states.length - 1) {
        const n = states[i + 1] as GenState;
        const dx = (n.moduleFieldX[m] as number) - (s.moduleFieldX[m] as number);
        const dy = (n.moduleFieldY[m] as number) - (s.moduleFieldY[m] as number);
        const angle = Math.hypot(dx, dy) <= 1e-6 ? 0 : Math.atan2(dy, dx);
        s.moduleFieldAngle[m] = angle;
        s.moduleAngle[m] = angle - s.poseRot;
      } else {
        const p = states[i - 1] as GenState;
        s.moduleFieldAngle[m] = p.moduleFieldAngle[m] as number;
        s.moduleAngle[m] = (s.moduleFieldAngle[m] as number) - s.poseRot;
      }
    }
  }
  return states;
}

function rotationOf(points: PathPoint[], idx: number): number {
  const t = (points[idx] as PathPoint).rotationTarget;
  return t ? t.rotationRad : 0;
}

/** Torque available at a module given the last velocity (N·m at the wheel). */
function moduleAvailableTorque(
  lastVel: number,
  constraints: PathConstraints,
  config: RobotConfig,
  deceleration: boolean,
): number {
  const mc = config.moduleConfig;
  const lastVelRadPerSec = lastVel / mc.wheelRadiusM;
  const currentDraw = Math.min(
    mc.driveMotor.current(lastVelRadPerSec, constraints.nominalVoltage),
    mc.driveCurrentLimitA,
  );
  let availableTorque = mc.driveMotor.torque(currentDraw);
  if (!deceleration) {
    // Acceleration fights motor losses (torqueLoss ≈ friction current torque).
    const maxVelCurrent = Math.min(
      mc.driveMotor.current(mc.maxDriveVelocityMPS / mc.wheelRadiusM, 12),
      mc.driveCurrentLimitA,
    );
    const torqueLoss = Math.max(mc.driveMotor.torque(maxVelCurrent), 0);
    availableTorque -= torqueLoss;
  }
  return Math.min(availableTorque, config.maxTorqueFriction);
}

function accelPass(
  states: GenState[],
  config: RobotConfig,
  forward: boolean,
): void {
  const numModules = config.moduleLocations.length;
  const modulePivotDist = config.moduleLocations.map((m) => Math.hypot(m.x, m.y));

  const range = forward
    ? { from: 1, to: states.length - 1, step: 1 }
    : { from: states.length - 2, to: 0, step: -1 };

  for (let i = range.from; forward ? i < range.to : i > range.to; i += range.step) {
    const state = states[i] as GenState;
    const prev = states[i - 1] as GenState;
    const next = states[i + 1] as GenState;
    const refPrev = forward ? prev : next; // velocity reference state

    let forceX = 0;
    let forceY = 0;
    let totalTorque = 0;

    for (let m = 0; m < numModules; m++) {
      const lastVel = (refPrev.moduleSpeeds[m] as number);
      const availableTorque = moduleAvailableTorque(lastVel, state.constraints, config, !forward);
      const forceAtCarpet = availableTorque / config.moduleConfig.wheelRadiusM;

      const fieldAngle = state.moduleFieldAngle[m] as number;
      const fx = forward
        ? forceAtCarpet * Math.cos(fieldAngle)
        : forceAtCarpet * Math.cos(fieldAngle + Math.PI);
      const fy = forward
        ? forceAtCarpet * Math.sin(fieldAngle)
        : forceAtCarpet * Math.sin(fieldAngle + Math.PI);
      forceX += fx;
      forceY += fy;

      // Torque about the robot center from this module's force.
      const rmx = (state.moduleFieldX[m] as number) - state.x;
      const rmy = (state.moduleFieldY[m] as number) - state.y;
      const angleToModule = Math.atan2(rmy, rmx);
      const forceAngle = Math.atan2(fy, fx);
      let theta = forceAngle - angleToModule;
      if (forceX === 0 && forceY === 0) theta = -angleToModule;
      totalTorque += forceAtCarpet * (modulePivotDist[m] as number) * Math.sin(theta);
    }

    const maxAngAccel = state.constraints.maxAngularAccelerationRadPSSq;
    const angularAccel = Math.max(
      -maxAngAccel,
      Math.min(maxAngAccel, totalTorque / config.moi),
    );

    let ax = forceX / config.massKG;
    let ay = forceY / config.massKG;
    const maxAccel = state.constraints.maxAccelerationMPSSq;
    const accel = Math.hypot(ax, ay);
    if (accel > maxAccel) {
      ax *= maxAccel / accel;
      ay *= maxAccel / accel;
    }

    const chassisAccel = fieldToRobot({ vx: ax, vy: ay, omega: angularAccel }, state.poseRot);
    const accelStates = toModuleStates(chassisAccel, config.moduleLocations);
    for (let m = 0; m < numModules; m++) {
      const moduleAcceleration = Math.abs((accelStates[m] as ModuleState).speedMPS);

      if (forward) {
        // vf² = v0² + 2ad
        const v0 = (prev.moduleSpeeds[m] as number);
        const d = state.moduleDeltaPos[m] as number;
        let v = Math.sqrt(Math.abs(v0 * v0 + 2 * moduleAcceleration * d));

        // Curve limit by wheel friction: v = sqrt(μ·m·g·R / n) ... per-module share.
        const p0 = { x: prev.moduleFieldX[m] as number, y: prev.moduleFieldY[m] as number };
        const p1 = { x: state.moduleFieldX[m] as number, y: state.moduleFieldY[m] as number };
        const p2 = { x: next.moduleFieldX[m] as number, y: next.moduleFieldY[m] as number };
        const radius = circumradius(p0, p1, p2);
        if (Number.isFinite(radius)) {
          const maxSafeVel = Math.sqrt(
            (config.wheelFrictionForce * Math.abs(radius)) /
              (config.massKG / numModules),
          );
          v = Math.min(v, maxSafeVel);
        }
        state.moduleSpeeds[m] = v;
      } else {
        // Reverse pass: cap by the next state's velocity budget.
        const v1 = (next.moduleSpeeds[m] as number);
        const d = (next.moduleDeltaPos[m] as number);
        const maxVel = Math.sqrt(Math.abs(v1 * v1 + 2 * moduleAcceleration * d));
        state.moduleSpeeds[m] = Math.min(maxVel, state.moduleSpeeds[m] as number);
      }
    }

    // Align module dts so every module takes the same time to the next point
    // (both passes reference states[i-1] angles and next-state distances,
    // matching the Java original).
    let maxDT = 0;
    let realMaxDT = 0;
    for (let m = 0; m < numModules; m++) {
      const prevAngleDelta =
        (state.moduleAngle[m] as number) -
        ((states[i - 1] as GenState).moduleAngle[m] as number);
      const modVel = state.moduleSpeeds[m] as number;
      const dt = (next.moduleDeltaPos[m] as number) / modVel;
      if (Number.isFinite(dt)) {
        realMaxDT = Math.max(dt, realMaxDT);
        if (Math.abs((prevAngleDelta * 180) / Math.PI) < 60) {
          maxDT = Math.max(dt, maxDT);
        }
      }
    }
    if (maxDT === 0) maxDT = realMaxDT;
    if (maxDT > 0) {
      for (let m = 0; m < numModules; m++) {
        const prevAngleDelta =
          (state.moduleAngle[m] as number) -
          ((states[i - 1] as GenState).moduleAngle[m] as number);
        if (Math.abs((prevAngleDelta * 180) / Math.PI) >= 60) continue;
        state.moduleSpeeds[m] = (next.moduleDeltaPos[m] as number) / maxDT;
      }
    }

    // Chassis speeds + desaturation.
    const moduleStates: ModuleState[] = [];
    for (let m = 0; m < numModules; m++) {
      moduleStates.push({
        speedMPS: state.moduleSpeeds[m] as number,
        angleRad: state.moduleAngle[m] as number,
      });
    }
    const desired = toChassisSpeeds(moduleStates, config.moduleLocations);
    let maxChassisVel = state.constraints.maxVelocityMPS;
    let maxChassisAngVel = state.constraints.maxAngularVelocityRadPS;
    if (!forward) {
      maxChassisVel = Math.min(maxChassisVel, state.linearVelocity);
      maxChassisAngVel = Math.min(maxChassisAngVel, Math.abs(state.fieldSpeeds.omega));
    }
    desaturateWheelSpeeds(
      moduleStates,
      desired,
      config.moduleConfig.maxDriveVelocityMPS,
      maxChassisVel,
      maxChassisAngVel,
    );
    for (let m = 0; m < numModules; m++) {
      state.moduleSpeeds[m] = (moduleStates[m] as ModuleState).speedMPS;
    }
    state.fieldSpeeds = robotToField(
      toChassisSpeeds(moduleStates, config.moduleLocations),
      state.poseRot,
    );
    state.linearVelocity = Math.hypot(state.fieldSpeeds.vx, state.fieldSpeeds.vy);
  }
}

function circumradius(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
): number {
  const ab = Math.hypot(a.x - b.x, a.y - b.y);
  const bc = Math.hypot(b.x - c.x, b.y - c.y);
  const ac = Math.hypot(a.x - c.x, a.y - c.y);
  const p = (ab + bc + ac) / 2;
  const area2 = p * (p - ab) * (p - bc) * (p - ac);
  if (area2 <= 1e-12) return Number.POSITIVE_INFINITY;
  return (ab * bc * ac) / (4 * Math.sqrt(area2));
}

function forwardAccelPass(states: GenState[], config: RobotConfig): void {
  accelPass(states, config, true);
}

function reverseAccelPass(states: GenState[], config: RobotConfig): void {
  accelPass(states, config, false);
}
