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
 *
 * The referenced .path files are resolved by the caller-supplied lookup
 * (same import batch or previously imported paths).
 */

import type { Trajectory, TrajectorySample } from '../types';
import { teamNumberFromName, trajectoryDuration } from '../types';
import { makeRobotConfig, defaultConfigGeometry } from '../pathplanner/robot-config';
import { generateTrajectory } from '../pathplanner/generation';
import { parsePathJson } from '../pathplanner/path-model';
import { asArray, asRecord, num, parseJson, str } from './json';
import { ParseError } from './parse-error';

export type AutoSegment =
  | { kind: 'path'; pathName: string }
  | { kind: 'wait'; seconds: number }
  | { kind: 'named'; name: string };

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
    default:
      // Unknown command types (deadline, conditional, etc.) — ignore.
      ctx.warnings.push(`unsupported command type "${type}" ignored`);
  }
}

/**
 * Parse an .auto file and generate a unified trajectory.
 * resolvePath must return the raw .path JSON text for a referenced path
 * name, or undefined when unknown.
 */
export function parsePathPlannerAuto(
  text: string,
  fileName: string,
  resolvePath: (pathName: string) => string | undefined,
): Trajectory {
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

  const config = makeRobotConfig();
  const samples: TrajectorySample[] = [];
  const events: Trajectory['events'] = [];
  const warnings = [
    'generated with default robot config (Kraken X60 swerve) — timing is an estimate',
    ...ctx.warnings,
  ];

  let clock = 0;
  let lastPose: { x: number; y: number; heading: number } | undefined;
  let segmentIndex = 0;

  for (const seg of segments) {
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
      const pathText = resolvePath(seg.pathName);
      if (pathText === undefined) {
        throw new ParseError(
          'unrecognized-format',
          fileName,
          `routine references path "${seg.pathName}" — import the matching .path file too (drop it in the same batch)`,
        );
      }
      let path;
      try {
        path = parsePathJson(pathText, `${seg.pathName}.path`);
      } catch (e) {
        throw new ParseError(
          'unrecognized-format',
          fileName,
          `referenced path "${seg.pathName}" failed to parse: ${e instanceof Error ? e.message : e}`,
        );
      }
      const gen = generateTrajectory(path, config);
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

  if (samples.length < 2) {
    throw new ParseError('empty-trajectory', fileName, 'routine produced no motion');
  }

  return {
    id: crypto.randomUUID(),
    name: str(root.name, fileName.replace(/\.auto$/i, '')),
    teamName: '',
    teamNumber: teamNumberFromName(fileName),
    source: 'pathplanner-auto',
    alliance: 'blue',
    samples,
    durationS: trajectoryDuration(samples),
    geometry: defaultConfigGeometry(),
    geometrySource: 'default',
    moduleLocations: config.moduleLocations,
    events,
    warnings,
  };
}
