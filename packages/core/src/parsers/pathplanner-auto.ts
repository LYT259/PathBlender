/**
 * PathPlanner .auto import (Phase 2): routine = command tree referencing
 * paths by name. Sequence semantics:
 * - sequential: segments run one after another (full support)
 * - path: generate with ideal starting state, time-shift into place
 * - wait: robot holds the previous end pose for the wait time
 * - named: duration unknowable from the file → recorded as an event with a
 *   warning (strategy timelines should treat these as estimates)
 * - parallel/race/group: approximated by sequentializing with a warning
 *   (degraded-approximation policy, study §5.2)
 * - deadline: approximated by sequentializing with its own warning — the
 *   group really ends when its FIRST command finishes, so the sequential
 *   sum is an upper-bound estimate
 *
 * Split since the profile-timing work: parseAutoStructure captures the
 * routine structure (segments, resolved paths, command-tree findings) at
 * import time through the caller-supplied team-scoped lookup (same import
 * batch or previously imported paths); generateAutoTrajectory replays that
 * structure against any RobotConfig. parsePathPlannerAuto remains the
 * one-call default-config import and additionally attaches the parsed
 * structure as `editable` so profiles can re-time the routine.
 */

import type { Trajectory, TrajectoryEvent, TrajectorySample } from '../types';
import { teamNumberFromName, trajectoryDuration } from '../types';
import { makeRobotConfig, defaultConfigGeometry } from '../pathplanner/robot-config';
import type { RobotConfig } from '../pathplanner/robot-config';
import { generateTrajectory } from '../pathplanner/generation';
import { parsePathJson } from '../pathplanner/path-model';
import type { ParsedPath } from '../pathplanner/path-model';
import { asArray, asRecord, num, parseJson, str } from './json';
import { ParseError } from './parse-error';

export type AutoSegment =
  | { kind: 'path'; pathName: string }
  | { kind: 'wait'; seconds: number }
  | { kind: 'named'; name: string };

/** Parsed .auto structure: segments, resolved paths, command-tree findings. */
export interface ParsedAuto {
  name: string;
  segments: AutoSegment[];
  /** Parsed .path source per referenced pathName (team-scoped at import). */
  paths: Record<string, ParsedPath>;
  /** Non-fatal command-tree findings (parallel/race/group/deadline/unknown). */
  commandWarnings: string[];
}

interface ParseCtx {
  warnings: string[];
}

function flattenCommand(
  node: unknown,
  out: AutoSegment[],
  ctx: ParseCtx,
  depth = 0,
): void {
  if (depth > 12) return;
  const rec = asRecord(node);
  if (!rec) return;
  const type = str(rec.type, '');
  const data = asRecord(rec.data) ?? {};

  switch (type) {
    case 'sequential': {
      for (const child of asArray(data.commands) ?? []) flattenCommand(child, out, ctx, depth + 1);
      return;
    }
    case 'path': {
      const pathName = str(data.pathName, '');
      if (pathName) out.push({ kind: 'path', pathName });
      return;
    }
    case 'wait': {
      out.push({ kind: 'wait', seconds: num(data.waitTime, 0) });
      return;
    }
    case 'named': {
      out.push({ kind: 'named', name: str(data.name, '') });
      return;
    }
    case 'parallel':
    case 'race':
    case 'group': {
      ctx.warnings.push(
        `"${type}" command group approximated as sequential — timing is an estimate`,
      );
      for (const child of asArray(data.commands) ?? []) flattenCommand(child, out, ctx, depth + 1);
      return;
    }
    case 'deadline': {
      // A deadline group ends when its first command finishes; the
      // sequential sum is therefore an upper-bound estimate.
      ctx.warnings.push(
        '"deadline" command group approximated as sequential — the group ends when its first command finishes, so the summed duration is an upper-bound estimate',
      );
      for (const child of asArray(data.commands) ?? []) flattenCommand(child, out, ctx, depth + 1);
      return;
    }
    default:
      // Unknown command types (conditional, etc.) — ignore.
      ctx.warnings.push(`unsupported command type "${type}" ignored`);
  }
}

/**
 * Parse an .auto file into its routine structure, resolving every referenced
 * path through resolvePath (must return the raw .path JSON text for a path
 * name, or undefined when unknown; same import batch or previously imported
 * paths). Throws the same ParseErrors as the historical one-call import:
 * missing command tree, no path/wait segments, unresolved path,
 * referenced-path parse failure, and no motion (pathless routines cannot
 * produce samples under any config).
 */
export function parseAutoStructure(
  text: string,
  fileName: string,
  resolvePath: (pathName: string) => string | undefined,
): ParsedAuto {
  const root = asRecord(parseJson(text, fileName));
  if (!root || !asRecord(root.command)) {
    throw new ParseError('unrecognized-format', fileName, 'missing command tree');
  }

  const ctx: ParseCtx = { warnings: [] };
  const segments: AutoSegment[] = [];
  flattenCommand(root.command, segments, ctx);
  if (segments.length === 0) {
    throw new ParseError('empty-trajectory', fileName, 'routine has no path/wait segments');
  }
  if (!segments.some((s) => s.kind === 'path')) {
    throw new ParseError('empty-trajectory', fileName, 'routine produced no motion');
  }

  const paths: Record<string, ParsedPath> = {};
  for (const seg of segments) {
    if (seg.kind !== 'path' || paths[seg.pathName] !== undefined) continue;
    const pathText = resolvePath(seg.pathName);
    if (pathText === undefined) {
      throw new ParseError(
        'unrecognized-format',
        fileName,
        `routine references path "${seg.pathName}" — import the matching .path file too (drop it in the same batch)`,
      );
    }
    try {
      paths[seg.pathName] = parsePathJson(pathText, `${seg.pathName}.path`);
    } catch (e) {
      throw new ParseError(
        'unrecognized-format',
        fileName,
        `referenced path "${seg.pathName}" failed to parse: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  return {
    name: str(root.name, fileName.replace(/\.auto$/i, '')),
    segments,
    paths,
    commandWarnings: ctx.warnings,
  };
}

/**
 * Generate a unified timeline from a parsed routine against a robot config:
 * paths are regenerated and time-shifted into place, waits hold the previous
 * end pose (sampled at 10 Hz), named commands become zero-duration events.
 * Warnings cover command-tree findings, per-path parse warnings,
 * segment-chaining discontinuities, and degenerate zero-duration motion
 * segments — this function never claims a config; the caller that chose one
 * does.
 */
export function generateAutoTrajectory(
  auto: ParsedAuto,
  config: RobotConfig,
): { samples: TrajectorySample[]; events: TrajectoryEvent[]; warnings: string[] } {
  const samples: TrajectorySample[] = [];
  const events: TrajectoryEvent[] = [];
  const warnings = [...auto.commandWarnings];

  let clock = 0;
  let lastPose: { x: number; y: number; heading: number } | undefined;
  let segmentIndex = 0;

  for (const seg of auto.segments) {
    if (seg.kind === 'wait') {
      // Hold the previous pose for the wait duration (sampled at 10 Hz).
      if (lastPose) {
        const steps = Math.max(1, Math.round(seg.seconds * 10));
        for (let i = 0; i < steps; i++) {
          const t = clock + (seg.seconds * (i + 1)) / steps;
          samples.push({ t, x: lastPose.x, y: lastPose.y, heading: lastPose.heading, vx: 0, vy: 0, omega: 0 });
        }
      }
      clock += seg.seconds;
    } else if (seg.kind === 'named') {
      if (seg.name) events.push({ name: seg.name, t: clock });
      // Duration unknowable from the file; count as zero but warn once.
      if (seg.name && !warnings.some((w) => w.includes('named commands'))) {
        warnings.push('named commands run in unknown time — not counted in the timeline');
      }
    } else {
      // Hand-built or corrupted structures may reference paths with no
      // parsed source: skip the segment (never crash) but say which one —
      // import-time parsing throws for unresolved paths instead.
      const path = auto.paths[seg.pathName];
      if (!path) {
        warnings.push(
          `segment references path "${seg.pathName}" with no parsed source — segment skipped`,
        );
        segmentIndex++;
        continue;
      }
      const gen = generateTrajectory(path, config);
      // Upstream-identical physics can degenerate (e.g. ≤~30 A per motor
      // cancels acceleration through the torque-loss term, trajectory.dart
      // at v2025.2.7): the segment emits samples that never leave t=0. Warn
      // per motion segment — a wait elsewhere in the routine would mask a
      // total-duration check, while a legitimate wait-only pause (zero
      // velocity by design) must never read as degenerate.
      if (trajectoryDuration(gen.samples) === 0) {
        warnings.push(
          `segment ${segmentIndex + 1} ("${seg.pathName}") generated zero-duration motion — the robot cannot move under this config; not a valid motion plan`,
        );
      }
      for (const w of path.parseWarnings) {
        if (!warnings.some((x) => x === w)) warnings.push(w);
      }
      const shifted = gen.samples.map((s) => ({ ...s, t: s.t + clock }));
      // Chain from the previous segment's end pose when the routine resets
      // odom at segment starts; warn on large discontinuities.
      const first = shifted[0]!;
      if (lastPose) {
        const gap = Math.hypot(first.x - lastPose.x, first.y - lastPose.y);
        if (gap > 0.3) {
          warnings.push(
            `segment ${segmentIndex + 1} ("${seg.pathName}") starts ${gap.toFixed(2)} m from the previous segment's end — path may include repositioning not captured in the file`,
          );
        }
      }
      samples.push(...shifted);
      for (const e of gen.events) events.push({ name: e.name, t: e.t + clock });
      clock = trajectoryDuration(shifted);
      const last = shifted[shifted.length - 1]!;
      lastPose = { x: last.x, y: last.y, heading: last.heading };
    }
    segmentIndex++;
  }

  return { samples, events, warnings };
}

/**
 * Parse an .auto file and generate a unified trajectory with the default
 * robot config. resolvePath must return the raw .path JSON text for a
 * referenced path name, or undefined when unknown. The parsed structure is
 * attached as `editable` so a robot profile can regenerate the timeline.
 */
export function parsePathPlannerAuto(
  text: string,
  fileName: string,
  resolvePath: (pathName: string) => string | undefined,
): Trajectory {
  const auto = parseAutoStructure(text, fileName, resolvePath);
  const config = makeRobotConfig();
  const generated = generateAutoTrajectory(auto, config);
  if (generated.samples.length < 2) {
    throw new ParseError('empty-trajectory', fileName, 'routine produced no motion');
  }
  // Same unlimited-constraints caveat the single-path import emits — one
  // entry per applicable referenced path, naming it: a routine references
  // several paths and the caveat must say which one is unlimited.
  const unlimitedCaveats = Object.entries(auto.paths)
    .filter(([, path]) => !Number.isFinite(path.globalConstraints.maxVelocityMPS))
    .map(([name]) => `referenced path "${name}" has unlimited global constraints; results may be unrealistic`);

  return {
    id: crypto.randomUUID(),
    name: auto.name,
    teamName: '',
    teamNumber: teamNumberFromName(fileName),
    source: 'pathplanner-auto',
    alliance: 'blue',
    samples: generated.samples,
    durationS: trajectoryDuration(generated.samples),
    geometry: defaultConfigGeometry(),
    geometrySource: 'default',
    moduleLocations: config.moduleLocations,
    events: generated.events,
    warnings: [
      'generated with default robot config (Kraken X60 swerve) — timing is an estimate',
      ...generated.warnings,
      ...unlimitedCaveats,
    ],
    timingSource: 'default-config',
    editable: { kind: 'pathplanner-auto', auto },
  };
}
