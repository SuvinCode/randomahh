/**
 * Party rooms relay. The host's browser runs the battle; players' controllers
 * send button bits. This hub only routes messages between them, validating
 * every one against shared/room.ts. Transport-agnostic (see wsServer.ts), so
 * it's unit-tested with fake connections.
 *
 * - A connection's first message decides its role: host `open` or player `join`.
 * - Host drops: the room waits `hostGraceMs` for it to come back (with its token).
 * - Player drops: the host is told (`leave`); the same `pid` can join again and
 *   the host gives it back its fighter.
 */
import { randomInt } from 'node:crypto';
import { cleanName } from '../shared/parseCommand';
import {
  HostToServerSchema,
  MAX_ROOM_PLAYERS,
  PlayerToServerSchema,
  ROOM_CODE_ALPHABET,
  decode,
  type ServerToHost,
  type ServerToPlayer,
} from '../shared/room';

export interface Conn {
  send(data: string): void;
  close(): void;
}

export interface Session {
  message(raw: string): void;
  closed(): void;
}

interface Player {
  name: string;
  conn: Conn;
}

interface Room {
  code: string;
  token: string;
  host: Conn | null;
  hostGoneTimer: ReturnType<typeof setTimeout> | null;
  players: Map<string, Player>;
}

export interface HubOptions {
  maxRooms?: number;
  hostGraceMs?: number;
  /** Messages per second a connection may send (token bucket, burst = 2 s worth). */
  playerRate?: number;
  hostRate?: number;
  random?: () => number;
  now?: () => number;
}

export class RoomHub {
  private readonly rooms = new Map<string, Room>();
  private readonly opts: Required<HubOptions>;

  constructor(opts: HubOptions = {}) {
    this.opts = {
      maxRooms: 500,
      hostGraceMs: 60_000,
      playerRate: 40,
      hostRate: 400,
      // Crypto-random: the token is what lets a host reclaim its room.
      random: () => randomInt(0, 2 ** 31) / 2 ** 31,
      now: Date.now,
      ...opts,
    };
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  /** A new connection. Feed it messages; call `closed()` when the socket closes. */
  connect(conn: Conn): Session {
    let role: { kind: 'host'; room: Room } | { kind: 'player'; room: Room; pid: string } | null = null;
    let done = false;
    const bucket = this.bucket();

    return {
      message: (raw) => {
        if (done) return;
        if (!bucket(role?.kind === 'host' ? this.opts.hostRate : this.opts.playerRate)) return;
        if (!role) {
          const h = decode(HostToServerSchema, raw);
          if (h?.t === 'open') {
            const room = this.openRoom(conn, h.resume);
            if (room) role = { kind: 'host', room };
            else {
              sendTo(conn, { t: 'error', reason: 'The server is full. Try again in a minute.' });
              done = true;
              conn.close();
            }
            return;
          }
          const p = decode(PlayerToServerSchema, raw);
          if (p?.t === 'join') {
            const res = this.joinRoom(conn, p.code, p.pid, p.name);
            if (typeof res === 'string') {
              sendTo(conn, { t: 'bye', reason: res });
              done = true;
              conn.close();
            } else role = { kind: 'player', room: res, pid: p.pid };
          }
          return;
        }
        if (role.kind === 'host') this.fromHost(role.room, conn, raw);
        else this.fromPlayer(role.room, role.pid, conn, raw);
      },
      closed: () => {
        if (done) return;
        done = true;
        if (!role) return;
        if (role.kind === 'host') this.hostLeft(role.room, conn);
        else this.playerLeft(role.room, role.pid, conn);
      },
    };
  }

  // -------------------------------------------------------------------------

  private openRoom(conn: Conn, resume?: { code: string; token: string }): Room | null {
    const old = resume ? this.rooms.get(resume.code) : undefined;
    if (old && old.token === resume!.token) {
      // The host is back (page kept running, connection blipped).
      if (old.host && old.host !== conn) old.host.close();
      old.host = conn;
      if (old.hostGoneTimer) clearTimeout(old.hostGoneTimer);
      old.hostGoneTimer = null;
      sendTo(conn, { t: 'room', code: old.code, token: old.token });
      for (const [id, p] of old.players) {
        sendTo(conn, { t: 'join', id, name: p.name });
        sendTo(p.conn, { t: 'host', on: true });
      }
      return old;
    }
    if (this.rooms.size >= this.opts.maxRooms) return null;
    const room: Room = { code: this.newCode(), token: this.newToken(), host: conn, hostGoneTimer: null, players: new Map() };
    this.rooms.set(room.code, room);
    sendTo(conn, { t: 'room', code: room.code, token: room.token });
    return room;
  }

  private joinRoom(conn: Conn, code: string, pid: string, rawName: string): Room | string {
    const room = this.rooms.get(code);
    if (!room) return `No room ${code}. Check the code on the host's screen.`;
    const name = cleanName(rawName) || 'Player';
    const existing = room.players.get(pid);
    if (existing) {
      // Same player again (reload, second tab): the newest connection wins.
      sendTo(existing.conn, { t: 'bye', reason: 'You joined from another tab.' });
      existing.conn.close();
    } else if (room.players.size >= MAX_ROOM_PLAYERS) {
      return `Room ${code} is full (${MAX_ROOM_PLAYERS} players).`;
    }
    room.players.set(pid, { name, conn });
    sendTo(conn, { t: 'joined', code, name });
    if (room.host) sendTo(room.host, { t: 'join', id: pid, name });
    else sendTo(conn, { t: 'host', on: false });
    return room;
  }

  private fromHost(room: Room, conn: Conn, raw: string): void {
    if (room.host !== conn) return;
    const m = decode(HostToServerSchema, raw);
    if (!m) return;
    if (m.t === 'to') {
      const p = room.players.get(m.id);
      if (p) sendTo(p.conn, m.m);
    } else if (m.t === 'kick') {
      const p = room.players.get(m.id);
      if (!p) return;
      room.players.delete(m.id);
      sendTo(p.conn, { t: 'bye', reason: m.reason || 'The host removed you.' });
      p.conn.close();
      sendTo(conn, { t: 'leave', id: m.id });
    }
  }

  private fromPlayer(room: Room, pid: string, conn: Conn, raw: string): void {
    if (room.players.get(pid)?.conn !== conn) return;
    const m = decode(PlayerToServerSchema, raw);
    if (m?.t === 'in' && room.host) sendTo(room.host, { t: 'in', id: pid, b: m.b });
  }

  private hostLeft(room: Room, conn: Conn): void {
    if (room.host !== conn) return;
    room.host = null;
    for (const p of room.players.values()) sendTo(p.conn, { t: 'host', on: false });
    room.hostGoneTimer = setTimeout(() => this.closeRoom(room, 'The host left. Scan the new QR code to play again.'), this.opts.hostGraceMs);
  }

  private playerLeft(room: Room, pid: string, conn: Conn): void {
    const p = room.players.get(pid);
    if (!p || p.conn !== conn) return; // replaced by a newer connection
    room.players.delete(pid);
    if (room.host) sendTo(room.host, { t: 'leave', id: pid });
  }

  private closeRoom(room: Room, reason: string): void {
    if (this.rooms.get(room.code) !== room) return;
    this.rooms.delete(room.code);
    for (const p of room.players.values()) {
      sendTo(p.conn, { t: 'bye', reason });
      p.conn.close();
    }
    room.players.clear();
  }

  /** Close everything (server shutdown). */
  closeAll(): void {
    for (const room of [...this.rooms.values()]) {
      if (room.hostGoneTimer) clearTimeout(room.hostGoneTimer);
      this.closeRoom(room, 'The server is restarting. Scan the QR code again in a moment.');
      room.host?.close();
    }
  }

  private newCode(): string {
    for (;;) {
      let c = '';
      for (let k = 0; k < 4; k++) c += ROOM_CODE_ALPHABET[Math.floor(this.opts.random() * ROOM_CODE_ALPHABET.length)];
      if (!this.rooms.has(c)) return c;
    }
  }

  private newToken(): string {
    let t = '';
    while (t.length < 24) t += Math.floor(this.opts.random() * 36).toString(36);
    return t;
  }

  /** Token bucket: true if this message may go through. */
  private bucket(): (rate: number) => boolean {
    let tokens = -1;
    let last = this.opts.now();
    return (rate) => {
      const now = this.opts.now();
      if (tokens < 0) tokens = rate * 2;
      tokens = Math.min(rate * 2, tokens + ((now - last) / 1000) * rate);
      last = now;
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    };
  }
}

function sendTo(conn: Conn, m: ServerToHost | ServerToPlayer): void {
  try {
    conn.send(JSON.stringify(m));
  } catch {
    /* socket already closing */
  }
}
