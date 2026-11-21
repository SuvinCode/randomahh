import { CommandResponseSchema, type CommandPlan } from '@shared/commands';

export type CommandResult = { ok: true; plan: CommandPlan } | { ok: false; error: string };

/**
 * Ask the server's AI to interpret god-box text the local parser couldn't.
 * Every response is validated against the shared schema before use.
 */
export async function interpretRemotely(text: string, fighters: string[], timeoutMs = 16_000): Promise<CommandResult> {
  try {
    const res = await fetch('/api/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, fighters }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const parsed = CommandResponseSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) return { ok: false, error: 'The god box got a confusing answer. Try a simpler word.' };
    return 'plan' in parsed.data ? { ok: true, plan: parsed.data.plan } : { ok: false, error: parsed.data.error };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Try: tornado, volcano, black hole…" };
  }
}
