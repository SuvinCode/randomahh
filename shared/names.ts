import { MAX_FIGHTERS } from './commands';
import { cleanName } from './parseCommand';

/** Silly names for "Add random fighters". */
export const RANDOM_NAMES = [
  'Banana Bob', 'Captain Crunch', 'Sir Wobbles', 'Lady Lasagna', 'Big Steve', 'Tiny Tim', 'Noodle', 'Pickle Rick',
  'Waffles', 'Professor Plum', 'Mr Sprinkles', 'Duchess', 'Biscuit', 'Turbo', 'Zigzag', 'Muffin', 'Gizmo',
  'Pancake', 'Sergeant Snacks', 'Bubbles', 'Rocket Ron', 'Disco Dan', 'Ninja Nan', 'Kevin', 'Karen', 'Chad',
  'Grandma Gertrude', 'Uncle Fester', 'Spud', 'Taco', 'Nugget', 'Pretzel', 'Mango', 'Sushi', 'Doughnut', 'Chewie',
  'Wiggles', 'Boomer', 'Sparky', 'Ziggy', 'Pip', 'Moose', 'Goose', 'Toast', 'Cheddar', 'Bean', 'Lil Yeet',
  'Dr Fluff', 'Count Chocula', 'Baron Bacon', 'Queen Bee', 'Slick Rick', 'Speedy', 'Clumsy Carl', 'Sneaky Pete',
];

/**
 * Add names (from a box that may hold "a, b, c" or one per line) to an existing
 * list: cleaned, blank ones dropped, duplicates numbered ("Bob 2"), capped at MAX_FIGHTERS.
 */
export function addNames(existing: readonly string[], input: string): string[] {
  const out = [...existing];
  for (const raw of input.split(/[,\n;]+/)) {
    if (out.length >= MAX_FIGHTERS) break;
    const name = cleanName(raw);
    if (!name) continue;
    out.push(uniqueName(out, name));
  }
  return out;
}

export function uniqueName(taken: readonly string[], name: string): string {
  const lower = new Set(taken.map((n) => n.toLowerCase()));
  if (!lower.has(name.toLowerCase())) return name;
  for (let k = 2; ; k++) {
    const suffix = ` ${k}`;
    const candidate = name.slice(0, 20 - suffix.length) + suffix;
    if (!lower.has(candidate.toLowerCase())) return candidate;
  }
}

/** `count` random names not already in the list. */
export function randomNames(existing: readonly string[], count: number, rand: () => number = Math.random): string[] {
  const pool = RANDOM_NAMES.filter((n) => !existing.some((e) => e.toLowerCase() === n.toLowerCase()));
  const picked: string[] = [];
  while (picked.length < count && pool.length) picked.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  return addNames(existing, picked.join(',')).slice(existing.length);
}
