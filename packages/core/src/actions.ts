/**
 * Action API registry (report v1.5 §6.4 harness disciplines 1 & 5).
 *
 * Every action is a self-describing registration — { name, description,
 * parameter JSON schema, risk level, handler } — consumed identically by
 * the UI, the AI assistant (tool schemas generated from the registry), and
 * tests. Changing one registration updates all three consumers.
 *
 * Lives in core so the command set ships with the package's semver surface
 * (it is the dependency face of AI prompts; breaking changes go through
 * ADR + GHPaths notification per the §九 core discipline).
 */

import type { CollisionInterval } from './collision/detect';
import type { SessionTrajectory } from './session';

/** Two approval tiers (harness discipline 2). */
export type RiskLevel = 'low' | 'high';

export interface ActionResult {
  ok: boolean;
  /** Human-readable summary for the action log / undo stack label. */
  summary: string;
  /** Structured payload fed back to the model (discipline 4: compact). */
  result: unknown;
}

/** Injected by the host app; tests provide fakes. */
export interface ActionContext {
  robots: readonly SessionTrajectory[];
  conflicts: readonly CollisionInterval[];
  setStartDelay(id: string, seconds: number): void;
  setAlliance(id: string, alliance: 'blue' | 'red'): void;
  setTeamNumber(id: string, teamNumber: string): void;
  editWaypoint(
    id: string,
    idx: number,
    pos: { x: number; y: number },
    kind: 'anchor' | 'prevControl' | 'nextControl',
  ): void;
  addWaypoint(id: string, afterIdx: number): void;
  removeWaypoint(id: string, idx: number): void;
  removeRobot(id: string): void;
  exportRobot(id: string, format: 'path' | 'traj' | 'ghostauto'): void;
  /** Push an undo snapshot before a mutating action. */
  pushUndo(label: string): void;
}

export type Args = Record<string, unknown>;

export interface ActionSpec {
  name: string;
  description: string;
  /** JSON-schema-shaped parameter declaration (subset: type/enum/required/properties). */
  parameters: {
    type: 'object';
    properties: Record<string, { type?: string; enum?: string[] }>;
    required?: string[];
  };
  risk: RiskLevel;
  handler: (ctx: ActionContext, args: Args) => ActionResult;
}

export class ActionRegistry {
  private specs = new Map<string, ActionSpec>();

  register(spec: ActionSpec): void {
    this.specs.set(spec.name, spec);
  }

  get(name: string): ActionSpec | undefined {
    return this.specs.get(name);
  }

  names(): string[] {
    return [...this.specs.keys()];
  }

  riskOf(name: string): RiskLevel | undefined {
    return this.specs.get(name)?.risk;
  }

  /** Tool declarations for OpenAI-compatible function calling. */
  llmTools(): { type: 'function'; function: { name: string; description: string; parameters: unknown } }[] {
    return [...this.specs.values()].map((s) => ({
      type: 'function' as const,
      function: { name: s.name, description: s.description, parameters: s.parameters },
    }));
  }

  /**
   * Whitelisted dispatch: unknown names never run; arguments are validated
   * against the declared schema before the handler sees them.
   */
  execute(name: string, args: Args, ctx: ActionContext): ActionResult {
    const spec = this.specs.get(name);
    if (!spec) {
      return {
        ok: false,
        summary: `rejected unknown action "${name}"`,
        result: { error: 'unknown action' },
      };
    }
    const invalid = validateArgs(spec, args);
    if (invalid) {
      return {
        ok: false,
        summary: `rejected "${name}" — ${invalid}`,
        result: { error: 'invalid arguments', detail: invalid },
      };
    }
    return spec.handler(ctx, args);
  }
}

/** Lightweight JSON-schema subset validation (type / enum / required). */
export function validateArgs(spec: ActionSpec, args: Args): string | null {
  if (typeof args !== 'object' || args === null) return 'arguments must be an object';
  const required = spec.parameters.required ?? [];
  for (const key of required) {
    if (args[key] === undefined || args[key] === null || args[key] === '') {
      return `missing required "${key}"`;
    }
  }
  for (const [key, decl] of Object.entries(spec.parameters.properties)) {
    const v = args[key];
    if (v === undefined) continue;
    if (decl.enum) {
      if (typeof v !== 'string' || !decl.enum.includes(v)) {
        return `"${key}" must be one of ${decl.enum.join('/')}`;
      }
      continue;
    }
    switch (decl.type) {
      case 'string':
        if (typeof v !== 'string') return `"${key}" must be a string`;
        break;
      case 'number':
        if (typeof v !== 'number' || !Number.isFinite(v)) return `"${key}" must be a number`;
        break;
      case undefined:
        break;
      default:
        break;
    }
  }
  return null;
}
