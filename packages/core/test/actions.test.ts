/**
 * Action API registry (report v1.5 §6.4 harness disciplines 1 & 5):
 * self-describing registrations, schema validation, whitelisted dispatch,
 * and LLM tool generation from the single source of truth.
 */
import { describe, expect, it } from 'vitest';
import { ActionRegistry, validateArgs } from '../src';
import type { ActionContext, ActionSpec } from '../src';

const ctx = {} as ActionContext; // handlers not under test here

function echoSpec(): ActionSpec {
  return {
    name: 'echo',
    description: 'test action',
    parameters: {
      type: 'object',
      properties: { robotId: { type: 'string' }, level: { type: 'string', enum: ['low', 'high'] } },
      required: ['robotId'],
    },
    risk: 'low',
    handler: (_c, a) => ({ ok: true, summary: `echo ${String(a.robotId)}`, result: a }),
  };
}

describe('ActionRegistry', () => {
  it('registers, dispatches, and reports risk', () => {
    const r = new ActionRegistry();
    r.register(echoSpec());
    expect(r.names()).toEqual(['echo']);
    expect(r.riskOf('echo')).toBe('low');
    const out = r.execute('echo', { robotId: 'r1' }, ctx);
    expect(out.ok).toBe(true);
    expect(out.summary).toBe('echo r1');
  });

  it('unknown names never run', () => {
    const r = new ActionRegistry();
    const out = r.execute('evalCode', { code: 'x' }, ctx);
    expect(out.ok).toBe(false);
    expect(out.result).toEqual({ error: 'unknown action' });
  });

  it('validates required, types, and enums before the handler runs', () => {
    const spec = echoSpec();
    expect(validateArgs(spec, {})).toContain('missing required "robotId"');
    expect(validateArgs(spec, { robotId: 'r', level: 'nope' })).toContain('one of');
    expect(validateArgs(spec, { robotId: 'r', level: 'high' })).toBeNull();
    const r = new ActionRegistry();
    r.register(spec);
    const bad = r.execute('echo', { robotId: 42 }, ctx);
    expect(bad.ok).toBe(false);
  });

  it('generates OpenAI-compatible tool declarations from the registry', () => {
    const r = new ActionRegistry();
    r.register(echoSpec());
    const tools = r.llmTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]!.function.name).toBe('echo');
    expect((tools[0]!.function.parameters as { required: string[] }).required).toEqual(['robotId']);
  });
});
