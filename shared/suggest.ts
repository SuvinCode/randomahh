/**
 * Predictive god box: as the host types, suggest what they probably mean.
 *
 * Built on tries (shared/trie.ts) of everything the game understands:
 * disasters and their nicknames, powerups, weapons, helpers, and the names of
 * the fighters in the arena. It completes only the last clause ("tornado and
 * vol" → "tornado and volcano"), keeps a leading count ("3 tor" → "3 tornado"),
 * and knows where a fighter's name goes ("lightning on B" → "lightning on Bob",
 * "give B" → "give Bob ", "give Bob fl" → "give Bob flight").
 */
import { DISASTER_TYPES, DISASTERS, POWERUP_TYPES, POWERUPS, WEAPON_TYPES, WEAPONS_CATALOG } from './commands';
import { Trie } from './trie';

export interface Suggestion {
  /** The whole box text after accepting it. */
  full: string;
  /** Icon shown in the list. */
  emoji: string;
  /** What it is ("Tornado", "fighter", "Powerup"). */
  hint: string;
}

interface Entry {
  text: string;
  emoji: string;
  hint: string;
  /** Higher sorts first. */
  weight: number;
}

const MAX = 6;
const NUMBER_WORDS = ['two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'a', 'an', 'some', 'many'];

/** Commands that start a clause. */
function commandTrie(): Trie<Entry> {
  const t = new Trie<Entry>();
  for (const type of DISASTER_TYPES) {
    const d = DISASTERS[type];
    t.insert(d.name, { text: d.name.toLowerCase(), emoji: d.emoji, hint: d.name, weight: 10 });
    for (const alias of d.aliases) {
      if (alias === d.name.toLowerCase()) continue;
      const label = d.aliasLabels?.[alias];
      t.insert(alias, { text: label ?? alias, emoji: d.emoji, hint: d.name, weight: label ? 9 : 5 });
    }
  }
  for (const p of POWERUP_TYPES) {
    t.insert(`give everyone ${POWERUPS[p].name}`, { text: `give everyone ${POWERUPS[p].name.toLowerCase()}`, emoji: POWERUPS[p].emoji, hint: 'Powerup', weight: 4 });
  }
  for (const w of WEAPON_TYPES) {
    t.insert(`give everyone a ${WEAPONS_CATALOG[w].name}`, { text: `give everyone a ${WEAPONS_CATALOG[w].name.toLowerCase()}`, emoji: WEAPONS_CATALOG[w].emoji, hint: 'Weapon', weight: 3 });
  }
  t.insert('heal everyone', { text: 'heal everyone', emoji: '💚', hint: 'Heal', weight: 6 });
  t.insert('let everyone fly', { text: 'let everyone fly', emoji: POWERUPS.flight.emoji, hint: 'Powerup', weight: 4 });
  t.insert('add ', { text: 'add ', emoji: '➕', hint: 'New fighter', weight: 2 });
  return t;
}

/** Things you can give someone: powerups, then weapons. */
function itemTrie(): Trie<Entry> {
  const t = new Trie<Entry>();
  for (const p of POWERUP_TYPES) {
    t.insert(POWERUPS[p].name, { text: POWERUPS[p].name.toLowerCase(), emoji: POWERUPS[p].emoji, hint: 'Powerup', weight: 5 });
    for (const a of POWERUPS[p].aliases) if (a !== POWERUPS[p].name.toLowerCase()) t.insert(a, { text: a, emoji: POWERUPS[p].emoji, hint: POWERUPS[p].name, weight: 2 });
  }
  for (const w of WEAPON_TYPES) {
    const name = WEAPONS_CATALOG[w].name.toLowerCase();
    t.insert(`a ${name}`, { text: `a ${name}`, emoji: WEAPONS_CATALOG[w].emoji, hint: 'Weapon', weight: 3 });
    t.insert(name, { text: `a ${name}`, emoji: WEAPONS_CATALOG[w].emoji, hint: 'Weapon', weight: 3 });
  }
  return t;
}

const COMMANDS = commandTrie();
const ITEMS = itemTrie();

function rank(entries: Entry[], typed: string): Entry[] {
  const seen = new Set<string>();
  return entries
    .filter((e) => e.text.toLowerCase() !== typed.toLowerCase())
    .sort((a, b) => b.weight - a.weight || a.text.length - b.text.length || a.text.localeCompare(b.text))
    .filter((e) => (seen.has(e.text) ? false : (seen.add(e.text), true)));
}

const POWERUP_HINTS = new Set(['Powerup', ...POWERUP_TYPES.map((p) => POWERUPS[p].name)]);

/**
 * Make a suggester for the current fighters. Cheap to call per keystroke.
 * `powerups: false` / `weapons: false` leave those out (when the game has them switched off).
 */
export function makeSuggester(fighters: readonly string[], opts: { powerups?: boolean; weapons?: boolean } = {}): (input: string) => Suggestion[] {
  const allowed = (e: Entry) =>
    (opts.powerups !== false || !POWERUP_HINTS.has(e.hint)) && (opts.weapons !== false || e.hint !== 'Weapon');
  const people = new Trie<Entry>();
  for (const name of fighters) people.insert(name, { text: name, emoji: '🧍', hint: 'fighter', weight: 5 });
  people.insert('everyone', { text: 'everyone', emoji: '👥', hint: 'all fighters', weight: 6 });

  return (input: string): Suggestion[] => {
    if (!input.trim()) return [];
    // Only the last clause is completed.
    const sep = /^(.*(?:,|;|\+|&|\band\b|\bthen\b|\bplus\b)\s*)(.*)$/i.exec(input);
    const head = sep ? sep[1] : '';
    const clause = sep ? sep[2] : input;
    if (!clause) return [];

    const out = (prefix: string, typed: string, trie: Trie<Entry>, suffix = ''): Suggestion[] =>
      rank(trie.withPrefix(typed).filter(allowed), typed)
        .slice(0, MAX)
        .map((e) => ({ full: head + prefix + e.text + suffix, emoji: e.emoji, hint: e.hint }));

    const verb = /^((?:give|grant|heal|let|make)\s+)(.*)$/i.exec(clause);
    if (verb) {
      // "give Big Steve fl" / "give everyone a ro": a known name, then complete the item.
      const rest = verb[2];
      const name = [...fighters, 'everyone']
        .sort((a, b) => b.length - a.length)
        .find((n) => rest.toLowerCase().startsWith(n.toLowerCase() + ' '));
      if (name && !verb[1].toLowerCase().startsWith('heal')) {
        const after = rest.slice(name.length);
        const gap = /^\s+/.exec(after)![0];
        return out(verb[1] + rest.slice(0, name.length) + gap, after.slice(gap.length), ITEMS);
      }
      // "give B" / "heal Big St": complete the person.
      if (!name) return out(verb[1], rest, people, verb[1].toLowerCase().startsWith('heal') ? '' : ' ');
    }
    // "lightning on B": complete the target.
    const on = /^(.*\s(?:on|at|to|for|near|vs)\s+)(.*)$/i.exec(clause);
    if (on) return out(on[1], on[2], people).filter((s) => !s.full.endsWith('everyone'));
    // "3 tor" / "two vol": keep the count, complete the command.
    const count = new RegExp(`^((?:\\d{1,3}|${NUMBER_WORDS.join('|')})\\s+)(.*)$`, 'i').exec(clause);
    if (count && count[2]) return out(count[1], count[2], COMMANDS);
    return out('', clause, COMMANDS);
  };
}

/** The ghost-text completion: what to show after the caret (or "" if none fits). */
export function ghostFor(input: string, suggestions: readonly Suggestion[]): string {
  const top = suggestions[0];
  if (!top || !top.full.toLowerCase().startsWith(input.toLowerCase())) return '';
  return top.full.slice(input.length);
}
