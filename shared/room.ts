/**
 * Party rooms: the contract between the host's game, the relay server
 * (server/rooms.ts) and the players' controllers (src/controller/).
 *
 * The host's browser runs the battle. Players' phones/laptops are only
 * controllers: they send button bits, and get back a small status snapshot
 * ("you"). The server just relays, validating every message with these
 * schemas. Objects are `.strict()`: unknown keys are rejected.
 */
import { z } from 'zod';
import { MAX_NAME, POWERUP_TYPES, WEAPON_TYPES } from './commands';

/** Room codes: 4 letters, no I/O (they look like 1/0). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export const ROOM_CODE_RE = /^[A-HJ-NP-Z]{4}$/;
/** People who can join by QR code per room (bots fill the rest of the arena). */
export const MAX_ROOM_PLAYERS = 10;
/** Bigger messages from players are dropped. */
export const MAX_MESSAGE_BYTES = 1024;
/** The host's JSON messages (arena layout, roster) can be bigger. */
export const MAX_HOST_MESSAGE_BYTES = 16 * 1024;
/** WebSocket path on the same origin as the game. */
export const WS_PATH = '/ws';

/** Controller buttons, as bits. */
export const BTN = { left: 1, right: 2, jump: 4, attack: 8, down: 16 } as const;
export const BTN_MASK = 31;

const PlayerId = z.string().regex(/^[a-z0-9]{8,24}$/);
const Code = z.string().regex(ROOM_CODE_RE);
const Token = z.string().regex(/^[a-z0-9]{16,40}$/);
const Name = z.string().min(1).max(MAX_NAME);

/** What a player's controller shows: sent by the host, relayed to that player. */
export const YouSchema = z
  .object({
    t: z.literal('you'),
    name: Name,
    /** "#rrggbb" */
    color: z.string().regex(/^#[0-9a-f]{6}$/i),
    /** lobby: waiting for the host · fight: in the battle · out: knocked out, watching · over: battle finished */
    phase: z.enum(['lobby', 'fight', 'out', 'over']),
    hp: z.number().min(0).max(100),
    weapon: z.enum(WEAPON_TYPES),
    powerups: z.array(z.enum(POWERUP_TYPES)).max(POWERUP_TYPES.length),
    kills: z.number().int().min(0).max(999),
    alive: z.number().int().min(0).max(999),
    /** Final place (1 = winner) once out or over; 0 = not yet. */
    place: z.number().int().min(0).max(999),
    /** One short line ("Waiting for the host to start…", "🏆 You win!"). */
    msg: z.string().max(80),
    /** Your fighter's id in snapshots (0 = none yet). */
    fid: z.number().int().min(0).max(1_000_000),
  })
  .strict();
export type You = z.infer<typeof YouSchema>;

// ---------------------------------------------------------------------------
// Live arena view on the controllers. The fast-moving part (fighters, shots,
// disasters' drawings) streams as binary frames: see shared/frame.ts.
// Coordinates are arena pixels (960×540), rounded to integers.

const Hex = z.string().regex(/^#[0-9a-f]{6}$/i);
const N = z.number().int().min(-5000).max(5000);
const Id = z.number().int().min(0).max(32_767);
const Rect = z.tuple([N, N, N, N]);

/** The arena's look and terrain: sent when a battle starts (and to anyone who joins). */
export const ArenaSchema = z
  .object({
    t: z.literal('arena'),
    theme: z.string().max(40),
    sky: Hex,
    ground: Hex,
    platform: Hex,
    accent: Hex,
    /** Solid floor rects [x, y, w, h]. */
    solid: z.array(Rect).max(16),
    /** One-way ledges [x, y, w, h]. */
    ledges: z.array(Rect).max(40),
  })
  .strict();
export type Arena = z.infer<typeof ArenaSchema>;

/** Who's who: [fighter id, name, colour, is a player]. Sent when fighters are added. */
export const RosterSchema = z
  .object({
    t: z.literal('roster'),
    f: z.array(z.tuple([Id, z.string().min(1).max(MAX_NAME), Hex, z.boolean()])).max(120),
  })
  .strict();
export type Roster = z.infer<typeof RosterSchema>;

/** A big announcement ("DOUBLE KILL!", "🌪️ Tornado!"). */
export const SaySchema = z.object({ t: z.literal('say'), text: z.string().max(80), color: Hex }).strict();

/** Anything the host may send to players. */
export const FeedSchema = z.discriminatedUnion('t', [YouSchema, ArenaSchema, RosterSchema, SaySchema]);
export type Feed = z.infer<typeof FeedSchema>;

// ---------------------------------------------------------------------------
// Player ⇄ server

export const PlayerToServerSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('join'), code: Code, pid: PlayerId, name: z.string().max(60) }).strict(),
  z.object({ t: z.literal('in'), b: z.number().int().min(0).max(BTN_MASK) }).strict(),
]);
export type PlayerToServer = z.infer<typeof PlayerToServerSchema>;

export const ServerToPlayerSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('joined'), code: Code, name: Name }).strict(),
  /** The host dropped (on: false) or came back. */
  z.object({ t: z.literal('host'), on: z.boolean() }).strict(),
  /** Room gone or join refused: show `reason`, don't auto-reconnect. */
  z.object({ t: z.literal('bye'), reason: z.string().max(120) }).strict(),
  YouSchema,
  ArenaSchema,
  RosterSchema,
  SaySchema,
]);
export type ServerToPlayer = z.infer<typeof ServerToPlayerSchema>;

// ---------------------------------------------------------------------------
// Host ⇄ server

export const HostToServerSchema = z.discriminatedUnion('t', [
  /** Open a new room, or reclaim one after a dropped connection. */
  z.object({ t: z.literal('open'), resume: z.object({ code: Code, token: Token }).strict().optional() }).strict(),
  /** To one player. */
  z.object({ t: z.literal('to'), id: PlayerId, m: FeedSchema }).strict(),
  /** To every player in the room. (Arena frames go as binary messages: shared/frame.ts.) */
  z.object({ t: z.literal('all'), m: FeedSchema }).strict(),
  z.object({ t: z.literal('kick'), id: PlayerId, reason: z.string().max(120) }).strict(),
]);
export type HostToServer = z.infer<typeof HostToServerSchema>;

export const ServerToHostSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('room'), code: Code, token: Token }).strict(),
  z.object({ t: z.literal('join'), id: PlayerId, name: Name }).strict(),
  z.object({ t: z.literal('leave'), id: PlayerId }).strict(),
  z.object({ t: z.literal('in'), id: PlayerId, b: z.number().int().min(0).max(BTN_MASK) }).strict(),
  z.object({ t: z.literal('error'), reason: z.string().max(120) }).strict(),
]);
export type ServerToHost = z.infer<typeof ServerToHostSchema>;

/** Parse one JSON message against a schema; null if it's not valid. */
export function decode<T>(schema: z.ZodType<T>, raw: string, maxBytes = MAX_MESSAGE_BYTES): T | null {
  if (raw.length > maxBytes) return null;
  try {
    const r = schema.safeParse(JSON.parse(raw));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

/** "abcd" / " ab cd " → "ABCD" (or null if it can't be a code). */
export function normalizeCode(raw: string): string | null {
  const c = raw.toUpperCase().replace(/[^A-Z]/g, '');
  return ROOM_CODE_RE.test(c) ? c : null;
}
