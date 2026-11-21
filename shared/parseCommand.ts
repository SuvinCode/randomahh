/**
 * Instant, offline parsing of god-box text into a CommandPlan. Handles the
 * common phrasings ("3 tornadoes", "lightning on Bob", "give Alice a rocket
 * launcher", "heal everyone", "add Steve"). Anything it can't read returns null
 * and the client asks the server (Mistral) instead.
 */
import {
  DISASTER_TYPES,
  DISASTERS,
  MAX_ACTIONS,
  MAX_NAME,
  POWERUP_TYPES,
  POWERUPS,
  WEAPON_TYPES,
  WEAPONS_CATALOG,
  type Action,
  type CommandPlan,
  type DisasterType,
  type PowerupType,
  type WeaponType,
} from './commands';

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, couple: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  few: 3, some: 3, many: 6, lots: 8, tons: 10,
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasWord = (text: string, phrase: string) => new RegExp(`(^|[^a-z0-9])${escape(phrase)}(e?s)?($|[^a-z0-9])`, 'i').test(text);

const DISASTER_ALIASES = DISASTER_TYPES.flatMap((t) => DISASTERS[t].aliases.map((a) => ({ type: t, alias: a }))).sort(
  (a, b) => b.alias.length - a.alias.length,
);
const POWERUP_ALIASES = POWERUP_TYPES.flatMap((t) => POWERUPS[t].aliases.map((a) => ({ type: t, alias: a }))).sort(
  (a, b) => b.alias.length - a.alias.length,
);
const WEAPON_ALIASES = WEAPON_TYPES.flatMap((t) => WEAPONS_CATALOG[t].aliases.map((a) => ({ type: t, alias: a }))).sort(
  (a, b) => b.alias.length - a.alias.length,
);

/** The longest fighter name that appears in the text as whole words (case-insensitive). */
export function findFighter(text: string, fighters: readonly string[]): string | undefined {
  return [...fighters]
    .sort((a, b) => b.length - a.length)
    .find((name) => name.trim() && new RegExp(`(^|[^\\p{L}\\p{N}])${escape(name)}($|[^\\p{L}\\p{N}])`, 'iu').test(text));
}

function countIn(text: string): number | undefined {
  const digits = /\b(\d{1,3})\b/.exec(text);
  if (digits) return Number(digits[1]);
  for (const w of text.toLowerCase().split(/[^a-z]+/)) if (w in NUMBER_WORDS && w !== 'a' && w !== 'an') return NUMBER_WORDS[w];
  return undefined;
}

const action = (type: Action['type'], extra: Partial<Action> = {}): Action => ({
  type,
  count: 1,
  target: '',
  weapon: 'none',
  powerup: 'none',
  label: '',
  ...extra,
});

/** Clean up a new fighter's name: printable, single-spaced, at most MAX_NAME characters. */
export function cleanName(raw: string): string {
  return raw
    .replace(/[\u0000-\u001f<>"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME)
    .trim();
}

function parseClause(raw: string, fighters: readonly string[], previous?: Action): Action | null {
  const text = raw.trim();
  if (!text) return null;
  const lower = text.toLowerCase();

  const add = /^(?:add|join|spawn (?:player|fighter)|new (?:player|fighter)|player|fighter)\s+(.+)$/i.exec(text);
  if (add) {
    const name = cleanName(add[1]);
    return name ? action('add_fighter', { target: name }) : null;
  }

  const target = findFighter(text, fighters) ?? '';
  // Don't let a fighter called "Storm" summon lightning.
  const rest = target ? lower.replace(target.toLowerCase(), ' ') : lower;
  const everyone = /\b(everyone|everybody|all|every one)\b/.test(rest);

  if (/\b(heal|heals|revive|health|medkit|potion|bandage)\b/.test(rest)) {
    return action('heal', { target: everyone ? '' : target });
  }

  if (/\b(give|gives|grant|grants|arm|hand|get|gets|equip|let|make|makes)\b/.test(rest)) {
    const powerup = POWERUP_ALIASES.find((p) => hasWord(rest, p.alias))?.type;
    if (powerup) return action('give_powerup', { target: everyone ? '' : target, powerup });
    const weapon = WEAPON_ALIASES.find((w) => hasWord(rest, w.alias))?.type;
    if (weapon) return action('give_weapon', { target: everyone ? '' : target, weapon });
  }

  const hit = DISASTER_ALIASES.find((d) => hasWord(rest, d.alias));
  if (hit) {
    const entry = DISASTERS[hit.type];
    const count = Math.min(entry.maxCount, Math.max(1, countIn(rest) ?? entry.defaultCount));
    return action(hit.type, { count, target, label: entry.aliasLabels?.[hit.alias] ?? '' });
  }

  // "add Bob, Alice, Carl": bare names after an add carry on adding.
  if (previous?.type === 'add_fighter' && !/\s{2,}/.test(text) && text.split(' ').length <= 3) {
    const name = cleanName(text);
    return name ? action('add_fighter', { target: name }) : null;
  }
  return null;
}

/** Parse god-box text locally. Null if nothing in it was recognised. */
export function parseCommand(text: string, fighters: readonly string[]): CommandPlan | null {
  const clauses = text.split(/\s*(?:,|;|\+|&|\band\b|\bthen\b|\bplus\b)\s*/i);
  const actions: Action[] = [];
  for (const clause of clauses) {
    const a = parseClause(clause, fighters, actions[actions.length - 1]);
    if (a) actions.push(a);
    if (actions.length >= MAX_ACTIONS) break;
  }
  if (!actions.length) return null;
  return { actions, message: describePlan(actions) };
}

/** A short, friendly summary of what's about to happen. */
export function describePlan(actions: readonly Action[]): string {
  const parts = actions.map((a) => {
    const on = a.target ? ` on ${a.target}` : '';
    switch (a.type) {
      case 'add_fighter':
        return `➕ ${a.target} joins`;
      case 'heal':
        return `💚 heal ${a.target || 'everyone'}`;
      case 'give_powerup': {
        const p = POWERUPS[a.powerup as PowerupType];
        return `${p.emoji} ${p.name} for ${a.target || 'everyone'}`;
      }
      case 'give_weapon': {
        const w = WEAPONS_CATALOG[a.weapon as WeaponType];
        return `${w.emoji} ${w.name} for ${a.target || 'everyone'}`;
      }
      default: {
        const d = DISASTERS[a.type as DisasterType];
        const name = a.label || d.name;
        return `${d.emoji} ${name}${a.count > 1 ? ` ×${a.count}` : ''}${on}`;
      }
    }
  });
  return parts.join(' · ').slice(0, 80);
}
