/**
 * Assistant loop (report v1.4 §6.4): natural-language mediation on top of
 * the Action API.
 *
 * Safety model: model output is only ever parsed as whitelisted tool calls
 * (manual schema validation inside executeAction — no eval, no arbitrary
 * code). Mutating actions land on the undo stack; export/remove wait for
 * explicit user approval through the confirm callback. Collision verdicts
 * always come from the deterministic detector, never the model.
 */

import { chatCompletion } from './client';
import type { ChatMessage } from './client';
import { executeAction } from './actions';
import { registry } from './actions';
import type { ActionContext } from './actions';
import type { AISettings } from './settings';

export interface AssistantEvent {
  kind: 'action' | 'notice' | 'error' | 'reply';
  text: string;
}

export interface ConfirmRequest {
  summary: string;
  perform: () => void;
}

const MAX_TOOL_ROUNDS = 8;

export async function runAssistantInstruction(
  instruction: string,
  settings: AISettings,
  ctx: ActionContext,
  onEvent: (e: AssistantEvent) => void,
  requestConfirmation: (req: ConfirmRequest) => Promise<boolean>,
): Promise<void> {
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt(ctx) },
    { role: 'user', content: instruction },
  ];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const choice = await chatCompletion(settings, messages);
    const calls = choice.message.tool_calls ?? [];

    if (calls.length === 0) {
      onEvent({ kind: 'reply', text: choice.message.content?.trim() || '(no reply)' });
      return;
    }

    messages.push({ role: 'assistant', content: choice.message.content ?? null, tool_calls: calls });

    for (const call of calls) {
      if (registry.riskOf(call.function.name) === 'high') {
        // Confirmation-required path: describe, await approval, then run.
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>;
        } catch {
          /* fall through with empty args; validation rejects */
        }
        const label = `${call.function.name} ${describeArgs(args, ctx)}`;
        const approved = await requestConfirmation({
          summary: label,
          perform: () => {
            const r = executeAction(call.function.name, args, ctx);
            onEvent({ kind: 'action', text: r.summary });
          },
        });
        onEvent({
          kind: 'notice',
          text: approved ? `approved: ${label}` : `denied by user: ${label}`,
        });
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({ done: approved, userApproved: approved }),
        });
        continue;
      }

      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>;
      } catch {
        /* validation will reject */
      }
      const r = executeAction(call.function.name, args, ctx);
      onEvent({ kind: r.ok ? 'action' : 'notice', text: r.summary });
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(r.result),
      });
    }
  }

  onEvent({ kind: 'notice', text: `stopped after ${MAX_TOOL_ROUNDS} tool rounds` });
}

function describeArgs(args: Record<string, unknown>, ctx: ActionContext): string {
  const name = typeof args.robotId === 'string' ? ctx.robots.find((r) => r.trajectory.id === args.robotId)?.trajectory.name ?? args.robotId : '';
  const fmt = typeof args.format === 'string' ? ` as .${args.format}` : '';
  return `${name}${fmt}`;
}

function systemPrompt(ctx: ActionContext): string {
  const robots = ctx.robots
    .map((r) => {
      const t = r.trajectory;
      const editable = t.editable?.kind ?? 'none';
      return `- id=${t.id} name="${t.name}" team#${t.teamNumber || '?'} alliance=${t.alliance} delay=${r.startDelayS}s source=${t.source} editable=${editable}${t.edited ? ' [adjusted]' : ''}`;
    })
    .join('\n');
  const collisions = ctx.conflicts
    .map((c) => {
      const a = ctx.robots.find((r) => r.trajectory.id === c.aId)?.trajectory.name ?? c.aId;
      const b = ctx.robots.find((r) => r.trajectory.id === c.bId)?.trajectory.name ?? c.bId;
      return `- ${a} × ${b} from t=${c.startT.toFixed(2)}s to ${c.endT.toFixed(2)}s`;
    })
    .join('\n');
  return [
    'You are the assistant inside PathBlender, an FRC alliance path-fusion viewer.',
    'Help strategy groups mediate path conflicts with the provided tools.',
    'Always inspect the session with list_robots / query_collisions before acting.',
    'Prefer the smallest change that resolves a conflict (a start delay before waypoint surgery).',
    'Collision verdicts come from the deterministic detector — never claim safety from your own reasoning.',
    'Field coordinates are meters in the blue-origin frame; x runs along the field length (0..16.54), y across (0..8.07).',
    'Current session:',
    robots || '(no robots loaded)',
    'Current collisions:',
    collisions || '(none)',
  ].join('\n');
}
