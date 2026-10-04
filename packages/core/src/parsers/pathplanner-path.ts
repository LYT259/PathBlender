/**
 * PathPlanner native .path import: parse → generate trajectory (Phase 2
 * port of PathPlannerLib generation, see ../pathplanner/) → unified model.
 * Generation runs against default robot config since .path files carry no
 * robot configuration; the import surfaces a warning about that.
 */

import type { Trajectory } from '../types';
import { teamNumberFromName, trajectoryDuration } from '../types';
import { makeRobotConfig, defaultConfigGeometry } from '../pathplanner/robot-config';
import { generateTrajectory } from '../pathplanner/generation';
import { parsePathJson } from '../pathplanner/path-model';
import { ParseError } from './parse-error';

export function parsePathPlannerPath(text: string, fileName: string): Trajectory {
  const path = parsePathJson(text, fileName);
  const config = makeRobotConfig();
  const generated = generateTrajectory(path, config);
  if (generated.samples.length < 2) {
    throw new ParseError('empty-trajectory', fileName, 'generation produced no samples');
  }

  const warnings = [
    'generated with default robot config (Kraken X60 swerve) — timing is an estimate; attach a PathPlanner settings.json profile for real geometry and timing',
    ...path.parseWarnings,
  ];
  if (!Number.isFinite(path.globalConstraints.maxVelocityMPS)) {
    warnings.push('path has unlimited global constraints; results may be unrealistic');
  }

  return {
    id: crypto.randomUUID(),
    name: path.name,
    teamName: '',
    teamNumber: teamNumberFromName(fileName),
    source: 'pathplanner-path',
    alliance: 'blue',
    samples: generated.samples,
    durationS: trajectoryDuration(generated.samples),
    geometry: defaultConfigGeometry(),
    geometrySource: 'default',
    moduleLocations: config.moduleLocations,
    events: generated.events,
    warnings,
    editable: { kind: 'pathplanner', path },
  };
}
