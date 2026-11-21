import { describe, expect, it } from 'vitest';
import { CommandPlanSchema, DISASTER_TYPES, DISASTERS, POWERUP_TYPES, POWERUPS, parseCommandPlan } from '../shared/commands';
import { addNames, randomNames, uniqueName } from '../shared/names';
import { cleanName, describePlan, parseCommand } from '../shared/parseCommand';

const FIGHTERS = ['Bob', 'Alice Smith', 'Storm', 'Big Steve'];
const one = (text: string) => parseCommand(text, FIGHTERS)!.actions[0];

describe('CommandPlanSchema (the AI ⇄ game contract)', () => {
  const good = { actions: [{ type: 'tornado', count: 2, target: 'Bob', weapon: 'none', powerup: 'none', label: '' }], message: 'Twisters!' };

  it('accepts a valid plan', () => {
    expect(parseCommandPlan(good).actions[0].type).toBe('tornado');
  });

  it('rejects unknown actions, extra keys, bad counts and too many actions', () => {
    const bad = (patch: (p: any) => void) => {
      const p = structuredClone(good) as any;
      patch(p);
      return CommandPlanSchema.safeParse(p).success;
    };
    expect(bad((p) => (p.actions[0].type = 'delete_everything'))).toBe(false);
    expect(bad((p) => (p.actions[0].script = 'alert(1)'))).toBe(false);
    expect(bad((p) => (p.extra = 1))).toBe(false);
    expect(bad((p) => (p.actions[0].count = 11))).toBe(false);
    expect(bad((p) => (p.actions[0].count = 0))).toBe(false);
    expect(bad((p) => (p.actions = Array(6).fill(good.actions[0])))).toBe(false);
    expect(bad((p) => (p.actions[0].weapon = 'nuke'))).toBe(false);
    expect(bad((p) => (p.actions[0].powerup = 'god_mode'))).toBe(false);
    expect(bad((p) => delete p.actions[0].powerup)).toBe(false);
  });

  it('every disaster has a catalog entry with sane counts', () => {
    for (const t of DISASTER_TYPES) {
      const d = DISASTERS[t];
      expect(d.defaultCount).toBeGreaterThanOrEqual(1);
      expect(d.defaultCount).toBeLessThanOrEqual(d.maxCount);
      expect(d.maxCount).toBeLessThanOrEqual(10);
      expect(d.aliases.length).toBeGreaterThan(0);
    }
    for (const p of POWERUP_TYPES) expect(POWERUPS[p].aliases.length).toBeGreaterThan(0);
  });
});

describe('parseCommand (local, offline)', () => {
  it('reads each disaster by its common words', () => {
    expect(one('tornado').type).toBe('tornado');
    expect(one('summon a twister').type).toBe('tornado');
    expect(one('volcano').type).toBe('volcano');
    expect(one('black hole').type).toBe('black_hole');
    expect(one('lightning').type).toBe('lightning');
    expect(one('asteroids').type).toBe('asteroids');
    expect(one('meteor shower').type).toBe('asteroids');
    expect(one('dr doom').type).toBe('dr_doom');
    expect(one('Doctor Doom').type).toBe('dr_doom');
    expect(one('earthquake').type).toBe('earthquake');
    expect(one('tsunami').type).toBe('tsunami');
    expect(one('space laser').type).toBe('orbital_laser');
    expect(one('mega bomb').type).toBe('mega_bomb');
    expect(one('nuke').type).toBe('nuke');
    expect(one('zombies').type).toBe('zombie_horde');
    expect(one('8 zombies').count).toBe(8);
    expect(one('send a ufo').type).toBe('ufo');
    expect(one('aliens on Bob')).toMatchObject({ type: 'ufo', target: 'Bob' });
    expect(one('blizzard').type).toBe('blizzard');
    expect(one('make it snow').type).toBe('blizzard');
    expect(one('stomp').type).toBe('giant_stomp');
    expect(one('giant foot on Big Steve')).toMatchObject({ type: 'giant_stomp', target: 'Big Steve' });
    expect(one('killer bees').type).toBe('bee_swarm');
  });

  it('reads counts (digits and words), clamped to the max, with sensible defaults', () => {
    expect(one('3 tornadoes').count).toBe(3);
    expect(one('two volcanoes').count).toBe(2);
    expect(one('99 tornadoes').count).toBe(DISASTERS.tornado.maxCount);
    expect(one('lightning').count).toBe(DISASTERS.lightning.defaultCount);
    expect(one('a black hole').count).toBe(1);
  });

  it('targets named fighters (case-insensitive, multi-word, longest match)', () => {
    expect(one('lightning on bob').target).toBe('Bob');
    expect(one('drop a nuke on alice smith').target).toBe('Alice Smith');
    expect(one('meteor at Big Steve').target).toBe('Big Steve');
    expect(one('tornado').target).toBe('');
  });

  it("a fighter's name never triggers a disaster", () => {
    // "Storm" is a fighter; "storm" is also a lightning word.
    expect(parseCommand('heal Storm', FIGHTERS)!.actions[0]).toMatchObject({ type: 'heal', target: 'Storm' });
    expect(parseCommand('Storm', FIGHTERS)).toBeNull();
  });

  it('gives weapons, heals and adds fighters', () => {
    expect(one('give Bob a rocket launcher')).toMatchObject({ type: 'give_weapon', target: 'Bob', weapon: 'rocket' });
    expect(one('give everyone swords')).toMatchObject({ type: 'give_weapon', target: '', weapon: 'sword' });
    expect(one('Alice Smith gets a laser gun')).toMatchObject({ type: 'give_weapon', target: 'Alice Smith', weapon: 'laser' });
    expect(one('heal everyone')).toMatchObject({ type: 'heal', target: '' });
    expect(one('give Bob super speed')).toMatchObject({ type: 'give_powerup', target: 'Bob', powerup: 'speed' });
    expect(one('let everyone fly')).toMatchObject({ type: 'give_powerup', target: '', powerup: 'flight' });
    expect(one('Alice Smith gets a shield')).toMatchObject({ type: 'give_powerup', target: 'Alice Smith', powerup: 'shield' });
    expect(one('give Bob teleportation')).toMatchObject({ powerup: 'teleport' });
    expect(one('make Bob invisible')).toMatchObject({ powerup: 'invisible' });
    expect(one('give everyone rage')).toMatchObject({ powerup: 'rage' });
    expect(one('add Grandma')).toMatchObject({ type: 'add_fighter', target: 'Grandma' });
  });

  it('handles several actions at once, up to 5', () => {
    const plan = parseCommand('tornado and 2 volcanoes, lightning on Bob', FIGHTERS)!;
    expect(plan.actions.map((a) => a.type)).toEqual(['tornado', 'volcano', 'lightning']);
    expect(parseCommand('add Ann, Ben, Cat', FIGHTERS)!.actions.map((a) => a.target)).toEqual(['Ann', 'Ben', 'Cat']);
    expect(parseCommand('tornado, volcano, tsunami, nuke, earthquake, black hole', FIGHTERS)!.actions).toHaveLength(5);
  });

  it('returns null for things it cannot read (the AI handles those)', () => {
    expect(parseCommand('summon a giant penguin', FIGHTERS)).toBeNull();
    expect(parseCommand('   ', FIGHTERS)).toBeNull();
  });

  it('always produces schema-valid plans', () => {
    for (const text of ['3 tornadoes on Bob', 'add ' + 'x'.repeat(80), 'give Bob a gun and heal Storm', 'asteroids, dr doom']) {
      const plan = parseCommand(text, FIGHTERS)!;
      expect(CommandPlanSchema.safeParse(plan).success, text).toBe(true);
    }
  });

  it('describes plans briefly', () => {
    expect(describePlan(one('3 tornadoes on Bob') ? parseCommand('3 tornadoes on Bob', FIGHTERS)!.actions : [])).toBe('🌪️ Tornado ×3 on Bob');
  });
});

describe('names', () => {
  it('cleans names: trims, strips markup characters, caps length', () => {
    expect(cleanName('  <b>Bob</b>  ')).toBe('bBob/b');
    expect(cleanName('x'.repeat(50))).toHaveLength(20);
  });

  it('adds lists, skips blanks, numbers duplicates', () => {
    expect(addNames(['Bob'], 'Ann, , bob\nCat')).toEqual(['Bob', 'Ann', 'bob 2', 'Cat']);
    expect(uniqueName(['Bob', 'Bob 2'], 'Bob')).toBe('Bob 3');
  });

  it('caps the roster at 50 and makes unique random names', () => {
    expect(addNames([], Array.from({ length: 80 }, (_, i) => `P${i}`).join(','))).toHaveLength(50);
    const r = randomNames(['Banana Bob'], 10);
    expect(r).toHaveLength(10);
    expect(new Set(r.map((n) => n.toLowerCase())).size).toBe(10);
    expect(r).not.toContain('Banana Bob');
  });
});
