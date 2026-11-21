/**
 * The contract between the god box (local parser or Mistral) and the game.
 *
 * Whatever the host types is turned into a `CommandPlan`: a short list of
 * actions from a fixed catalog. The AI only ever outputs JSON matching
 * `CommandPlanSchema`; the game only ever runs a parsed plan. Objects are
 * strict: unknown keys are rejected, never ignored.
 */
import { z } from 'zod';

/** Things the host can unleash on the arena. One file each in src/disasters/. */
export const DISASTER_TYPES = [
  'tornado',
  'volcano',
  'black_hole',
  'lightning',
  'asteroids',
  'dr_doom',
  'earthquake',
  'tsunami',
  'orbital_laser',
  'mega_bomb',
  'zombie_horde',
  'ufo',
  'blizzard',
  'giant_stomp',
  'bee_swarm',
  'logo_ram',
  'thanos_snap',
  'disco',
  'lava_floor',
  'godzilla',
  'nuke',
] as const;

/** Weapons fighters carry. Defined in src/weapons/defs.ts. */
export const WEAPON_TYPES = ['sword', 'hammer', 'pistol', 'shotgun', 'minigun', 'sniper', 'laser', 'rocket'] as const;

/** Powerups: found in crates, or handed out by the host. Defined in src/powerups/defs.ts. */
export const POWERUP_TYPES = ['speed', 'flight', 'teleport', 'shield', 'rage', 'regen', 'invisible'] as const;

/** Everything a command can do: a disaster, or one of the helpers. */
export const ACTION_TYPES = [...DISASTER_TYPES, 'give_weapon', 'give_powerup', 'heal', 'add_fighter'] as const;

export type DisasterType = (typeof DISASTER_TYPES)[number];
export type WeaponType = (typeof WEAPON_TYPES)[number];
export type PowerupType = (typeof POWERUP_TYPES)[number];
export type ActionType = (typeof ACTION_TYPES)[number];

export const MAX_NAME = 20;
export const MAX_FIGHTERS = 50;
export const MAX_ACTIONS = 5;

/**
 * One thing to do. Every field is always present (simplest for strict JSON
 * schema output); unused ones are "" / "none" / 1.
 * - `target`: a fighter's name, "" for random/everyone; for add_fighter, the new name.
 * - `weapon`: only for give_weapon. `powerup`: only for give_powerup.
 * - `label`: optional flavour name shown in the kill feed ("Sharknado"); "" = default.
 */
export const ActionSchema = z
  .object({
    type: z.enum(ACTION_TYPES),
    count: z.number().int().min(1).max(10),
    target: z.string().max(MAX_NAME),
    weapon: z.enum([...WEAPON_TYPES, 'none']),
    powerup: z.enum([...POWERUP_TYPES, 'none']),
    label: z.string().max(40),
  })
  .strict();

export const CommandPlanSchema = z
  .object({
    actions: z.array(ActionSchema).max(MAX_ACTIONS),
    /** Short reply shown under the box ("Unleashing 3 tornadoes!"). */
    message: z.string().max(80),
  })
  .strict();

export type Action = z.infer<typeof ActionSchema>;
export type CommandPlan = z.infer<typeof CommandPlanSchema>;

/** POST /api/command body. */
export const CommandRequestSchema = z
  .object({
    text: z.string().trim().min(1).max(200),
    fighters: z.array(z.string().max(MAX_NAME)).max(MAX_FIGHTERS + 20),
  })
  .strict();

export const CommandResponseSchema = z.union([
  z.object({ plan: CommandPlanSchema }).strict(),
  z.object({ error: z.string() }).strict(),
]);

export type CommandRequest = z.infer<typeof CommandRequestSchema>;
export type CommandResponse = z.infer<typeof CommandResponseSchema>;

export function parseCommandPlan(input: unknown): CommandPlan {
  return CommandPlanSchema.parse(input);
}

/** Player-facing catalog: names, emoji, how many at most, and words that mean it. */
export interface CatalogEntry {
  name: string;
  emoji: string;
  /** Used when the host doesn't say how many. */
  defaultCount: number;
  maxCount: number;
  /** Lower-case words/phrases the local parser recognises. */
  aliases: string[];
  /** Aliases that also set a flavour label ("claude" → logo_ram labelled "Claude"). */
  aliasLabels?: Record<string, string>;
}

export const DISASTERS: Record<DisasterType, CatalogEntry> = {
  tornado: { name: 'Tornado', emoji: '🌪️', defaultCount: 1, maxCount: 3, aliases: ['tornado', 'twister', 'cyclone', 'hurricane', 'whirlwind', 'sharknado'] },
  volcano: { name: 'Volcano', emoji: '🌋', defaultCount: 1, maxCount: 2, aliases: ['volcano', 'eruption', 'erupt', 'lava', 'magma'] },
  black_hole: { name: 'Black hole', emoji: '🕳️', defaultCount: 1, maxCount: 2, aliases: ['black hole', 'blackhole', 'singularity', 'wormhole', 'vortex'] },
  lightning: { name: 'Lightning', emoji: '⚡', defaultCount: 5, maxCount: 10, aliases: ['lightning', 'thunder', 'thunderstorm', 'storm', 'zeus', 'bolt'] },
  asteroids: { name: 'Asteroids', emoji: '☄️', defaultCount: 6, maxCount: 10, aliases: ['asteroid', 'meteor', 'meteorite', 'comet', 'meteor shower'] },
  dr_doom: { name: 'Dr Doom', emoji: '🦹', defaultCount: 1, maxCount: 2, aliases: ['dr doom', 'dr. doom', 'doctor doom', 'doom', 'villain', 'boss'] },
  earthquake: { name: 'Earthquake', emoji: '🌍', defaultCount: 1, maxCount: 3, aliases: ['earthquake', 'quake', 'tremor', 'seismic'] },
  tsunami: { name: 'Tsunami', emoji: '🌊', defaultCount: 1, maxCount: 3, aliases: ['tsunami', 'tidal wave', 'flood', 'wave'] },
  orbital_laser: { name: 'Orbital laser', emoji: '🛰️', defaultCount: 1, maxCount: 5, aliases: ['orbital laser', 'space laser', 'death ray', 'laser strike', 'satellite', 'laser'] },
  mega_bomb: { name: 'Mega bomb', emoji: '💣', defaultCount: 1, maxCount: 3, aliases: ['mega bomb', 'bomb', 'dynamite', 'tnt', 'explosion'] },
  zombie_horde: { name: 'Zombie horde', emoji: '🧟', defaultCount: 5, maxCount: 10, aliases: ['zombie horde', 'zombie', 'undead', 'walkers', 'ghoul'] },
  ufo: { name: 'UFO', emoji: '🛸', defaultCount: 1, maxCount: 3, aliases: ['ufo', 'alien', 'aliens', 'flying saucer', 'abduction', 'abduct'] },
  blizzard: { name: 'Blizzard', emoji: '❄️', defaultCount: 1, maxCount: 2, aliases: ['blizzard', 'snowstorm', 'snow', 'ice age', 'freeze', 'frost', 'hail'] },
  giant_stomp: { name: 'Giant stomp', emoji: '🦶', defaultCount: 3, maxCount: 6, aliases: ['giant stomp', 'giant foot', 'bigfoot', 'foot', 'stomp'] },
  bee_swarm: { name: 'Killer bees', emoji: '🐝', defaultCount: 1, maxCount: 3, aliases: ['killer bees', 'bee swarm', 'bees', 'bee', 'wasps', 'hornets', 'swarm', 'insects'] },
  logo_ram: {
    name: 'Logo ram', emoji: '🏷️', defaultCount: 1, maxCount: 3,
    aliases: ['logo ram', 'logo', 'claude', 'anthropic', 'tanda'],
    aliasLabels: { claude: 'Claude', anthropic: 'Claude', tanda: 'Tanda' },
  },
  thanos_snap: { name: 'Thanos snap', emoji: '🫰', defaultCount: 1, maxCount: 1, aliases: ['thanos snap', 'thanos', 'snap', 'infinity gauntlet', 'gauntlet', 'perfectly balanced'] },
  disco: { name: 'Disco', emoji: '🪩', defaultCount: 1, maxCount: 1, aliases: ['disco', 'disco ball', 'party', 'rave', 'dance party', 'boogie'] },
  lava_floor: { name: 'Lava floor', emoji: '🔥', defaultCount: 1, maxCount: 1, aliases: ['lava floor', 'floor is lava', 'the floor is lava', 'hot floor'] },
  godzilla: { name: 'Godzilla', emoji: '🦖', defaultCount: 1, maxCount: 2, aliases: ['godzilla', 'kaiju', 'atomic breath', 'dinosaur', 'dino', 't-rex', 'monster'] },
  nuke: { name: 'Nuke', emoji: '☢️', defaultCount: 1, maxCount: 1, aliases: ['nuke', 'nuclear', 'atomic bomb', 'a-bomb', 'warhead', 'nuclear bomb'] },
};

export const POWERUPS: Record<PowerupType, { name: string; emoji: string; aliases: string[] }> = {
  speed: { name: 'Super speed', emoji: '⚡', aliases: ['super speed', 'speed', 'fast', 'sonic', 'zoom', 'sprint'] },
  flight: { name: 'Flight', emoji: '🪽', aliases: ['flight', 'fly', 'flying', 'wings', 'jetpack'] },
  teleport: { name: 'Teleportation', emoji: '🌀', aliases: ['teleportation', 'teleport', 'blink', 'warp'] },
  shield: { name: 'Shield', emoji: '🛡️', aliases: ['shield', 'force field', 'armor', 'armour', 'bubble', 'protection'] },
  rage: { name: 'Rage', emoji: '😡', aliases: ['rage', 'double damage', 'berserk', 'fury', 'strength', 'power'] },
  regen: { name: 'Regeneration', emoji: '💖', aliases: ['regeneration', 'regen', 'healing aura'] },
  invisible: { name: 'Invisibility', emoji: '👻', aliases: ['invisibility', 'invisible', 'stealth', 'cloak', 'ghost'] },
};

export const WEAPONS_CATALOG: Record<WeaponType, { name: string; emoji: string; aliases: string[] }> = {
  sword: { name: 'Sword', emoji: '🗡️', aliases: ['sword', 'katana', 'blade', 'sabre', 'saber'] },
  hammer: { name: 'Hammer', emoji: '🔨', aliases: ['hammer', 'mallet', 'axe'] },
  pistol: { name: 'Pistol', emoji: '🔫', aliases: ['pistol', 'gun', 'handgun', 'revolver'] },
  shotgun: { name: 'Shotgun', emoji: '💥', aliases: ['shotgun'] },
  minigun: { name: 'Minigun', emoji: '🌀', aliases: ['minigun', 'machine gun', 'machinegun', 'gatling', 'smg', 'uzi'] },
  sniper: { name: 'Sniper', emoji: '🎯', aliases: ['sniper', 'rifle'] },
  laser: { name: 'Laser', emoji: '🔆', aliases: ['laser gun', 'laser', 'blaster', 'ray gun', 'raygun', 'lightsaber'] },
  rocket: { name: 'Rocket launcher', emoji: '🚀', aliases: ['rocket launcher', 'rocket', 'bazooka', 'rpg', 'missile'] },
};
