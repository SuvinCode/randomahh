/**
 * God-box text the local parser couldn't read → Mistral → validated CommandPlan.
 *
 * Mistral answers with JSON-schema structured output generated from the shared
 * Zod contract (shared/commands.ts), so the two cannot drift. Its reply is
 * validated and cleaned (unknown targets dropped, counts clamped) before it is
 * returned; nothing it says is ever executed. MISTRAL_API_KEY / MISTRAL_MODEL
 * are read from the server environment only.
 */
import GOD_PROMPT from './prompts/godCommands.md?raw';
import { z } from 'zod';
import {
  CommandPlanSchema,
  CommandRequestSchema,
  DISASTERS,
  type Action,
  type CommandPlan,
  type CommandResponse,
  type DisasterType,
} from '../shared/commands';
import { cleanName, findFighter } from '../shared/parseCommand';

const MISTRAL_URL = 'https://api.mistral.ai/v1/chat/completions';
const TIMEOUT_MS = 15_000;

type FetchFn = typeof fetch;
type Env = Record<string, string | undefined>;

export interface CommandDeps {
  fetch?: FetchFn;
  env?: Env;
  /** Return false to refuse (rate limit). */
  canUseAi?: () => boolean;
}

export function mistralConfig(env: Env): { apiKey: string; model: string } | null {
  const apiKey = env.MISTRAL_API_KEY?.trim();
  const model = env.MISTRAL_MODEL?.trim();
  return apiKey && model ? { apiKey, model } : null;
}

export function godPrompt(): string {
  return GOD_PROMPT;
}

/** JSON Schema for Mistral's `response_format`, generated from the shared contract. */
export function commandJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(CommandPlanSchema) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

/** Make a validated plan safe to run: real targets only, counts within each disaster's max. */
export function sanitizePlan(plan: CommandPlan, fighters: readonly string[]): CommandPlan {
  const actions: Action[] = plan.actions.map((a) => {
    const none = { weapon: 'none', powerup: 'none' } as const;
    if (a.type === 'add_fighter') return { ...a, ...none, target: cleanName(a.target), count: 1 };
    const target = a.target ? (findFighter(a.target, fighters) ?? '') : '';
    if (a.type === 'give_weapon') return { ...a, ...none, target, count: 1, weapon: a.weapon === 'none' ? 'sword' : a.weapon };
    if (a.type === 'give_powerup') return { ...a, ...none, target, count: 1, powerup: a.powerup === 'none' ? 'speed' : a.powerup };
    if (a.type === 'heal') return { ...a, ...none, target, count: 1 };
    const max = DISASTERS[a.type as DisasterType].maxCount;
    return { ...a, ...none, target, count: Math.min(max, a.count) };
  });
  return { actions: actions.filter((a) => a.type !== 'add_fighter' || a.target), message: plan.message };
}

export type Interpretation = { ok: true; plan: CommandPlan } | { ok: false; reason: string };

/** Parse and clean the model's raw text. */
export function validateReply(raw: string, fighters: readonly string[]): Interpretation {
  let data: unknown;
  try {
    data = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    return { ok: false, reason: 'not JSON' };
  }
  const parsed = CommandPlanSchema.safeParse(data);
  if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? 'invalid' };
  return { ok: true, plan: sanitizePlan(parsed.data, fighters) };
}

export async function interpretCommand(text: string, fighters: readonly string[], deps: CommandDeps = {}): Promise<Interpretation> {
  const cfg = mistralConfig(deps.env ?? process.env);
  if (!cfg) return { ok: false, reason: 'not configured' };
  if (deps.canUseAi && !deps.canUseAi()) return { ok: false, reason: 'rate limited' };
  const fetchFn = deps.fetch ?? fetch;
  const user = [`Fighters: ${fighters.length ? fighters.map((f) => JSON.stringify(f)).join(', ') : '(none)'}`, '<text>', text, '</text>'].join('\n');
  let res: Response;
  try {
    res = await fetchFn(MISTRAL_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: 'system', content: godPrompt() },
          { role: 'user', content: user },
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'command_plan', schema: commandJsonSchema(), strict: true } },
        temperature: 0.4,
        max_tokens: 600,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    console.warn('[command] Mistral request failed:', err instanceof Error ? err.message : err);
    return { ok: false, reason: 'unreachable' };
  }
  if (!res.ok) {
    console.warn(`[command] Mistral ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    return { ok: false, reason: `upstream ${res.status}` };
  }
  type R = { choices?: { message?: { content?: string | { text?: string }[] } }[] };
  const content = ((await res.json()) as R).choices?.[0]?.message?.content;
  const raw = Array.isArray(content) ? content.map((c) => c.text ?? '').join('') : content;
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, reason: 'empty reply' };
  return validateReply(raw, fighters);
}

// ---------------------------------------------------------------------------
// HTTP: POST /api/command

class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}
  take(key: string): boolean {
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    const ok = recent.length < this.max;
    if (ok) recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.hits.clear();
    return ok;
  }
}
const limiter = new RateLimiter(20, 60_000);

function json(body: CommandResponse, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function handleCommand(request: Request, deps: CommandDeps = {}): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const parsed = CommandRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: 'Send JSON like {"text": "3 tornadoes", "fighters": ["Bob"]}.' }, 400);
  const client = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  const result = await interpretCommand(parsed.data.text, parsed.data.fighters, {
    canUseAi: () => limiter.take(client),
    ...deps,
  });
  if (result.ok) return json({ plan: result.plan }, 200);
  const messages: Record<string, [string, number]> = {
    'not configured': ['The AI god box is not set up on this server. Try: tornado, volcano, black hole, lightning…', 503],
    'rate limited': ['Easy there, deity! Wait a moment before the next miracle.', 429],
  };
  const [error, status] = messages[result.reason] ?? ["Couldn't understand that one. Try: tornado, asteroids, dr doom…", 502];
  return json({ error }, status);
}
