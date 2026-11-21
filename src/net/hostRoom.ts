import { uniqueName } from '@shared/names';
import {
  DEFAULT_PLAYER_LIMIT,
  PLAYER_LIMITS,
  ServerToHostSchema,
  WS_PATH,
  decode,
  type Feed,
  type HostToServer,
  type PlayerLimit,
  type ServerToHost,
  type You,
} from '@shared/room';

/** A person in the room, playing from their phone or laptop. */
export interface RoomPlayer {
  id: string;
  /** Unique among everyone in the battle (set by the host when they first join). */
  name: string;
  connected: boolean;
  /** Buttons held right now (BTN bits). */
  buttons: number;
}

export type RoomStatus = 'connecting' | 'open' | 'offline';

type Events = {
  change: () => void;
  join: (p: RoomPlayer) => void;
  leave: (p: RoomPlayer) => void;
};

const RESUME_KEY = 'random-ahh:room';
const LIMIT_KEY = 'random-ahh:max-players';

function loadLimit(): PlayerLimit {
  try {
    const v = JSON.parse(localStorage.getItem(LIMIT_KEY) ?? 'undefined');
    if ((PLAYER_LIMITS as readonly PlayerLimit[]).includes(v)) return v;
  } catch {
    /* no storage, or nothing saved */
  }
  return DEFAULT_PLAYER_LIMIT;
}

/**
 * The host's side of a party room: one WebSocket for the whole session (lobby,
 * battles, results), reconnecting on its own. Players who drop keep their slot
 * (and name) so they get their fighter back when they rejoin.
 */
class HostRoom {
  status: RoomStatus = 'connecting';
  code: string | null = null;
  private token: string | null = null;
  private ws: WebSocket | null = null;
  private started = false;
  private retryMs = 1000;
  private readonly players = new Map<string, RoomPlayer>();
  private readonly listeners: { [K in keyof Events]: Set<Events[K]> } = { change: new Set(), join: new Set(), leave: new Set() };
  private readonly lastSent = new Map<string, { json: string; at: number }>();
  /** Names the joining players must not clash with (bots in the lobby, fighters in a battle). */
  reservedNames: () => string[] = () => [];
  /** Most players the room lets in (null = unlimited); the host picks it in the lobby. */
  maxPlayers: PlayerLimit = loadLimit();

  /** Change the player limit (players already in stay in). */
  setMaxPlayers(max: PlayerLimit): void {
    this.maxPlayers = max;
    try {
      localStorage.setItem(LIMIT_KEY, JSON.stringify(max));
    } catch {
      /* no storage */
    }
    this.send({ t: 'limit', max });
    this.emit('change');
  }

  /** Open the room (once). Safe to call from every scene. */
  start(): void {
    if (this.started) return;
    this.started = true;
    try {
      const saved = JSON.parse(sessionStorage.getItem(RESUME_KEY) ?? 'null');
      if (saved && typeof saved.code === 'string' && typeof saved.token === 'string') {
        this.code = saved.code;
        this.token = saved.token;
      }
    } catch {
      /* no storage */
    }
    this.connect();
  }

  on<K extends keyof Events>(event: K, fn: Events[K]): () => void {
    this.listeners[event].add(fn);
    return () => this.listeners[event].delete(fn);
  }

  /** Everyone who has joined (connected or not), in join order. */
  list(): RoomPlayer[] {
    return [...this.players.values()];
  }

  connected(): RoomPlayer[] {
    return this.list().filter((p) => p.connected);
  }

  get(id: string): RoomPlayer | undefined {
    return this.players.get(id);
  }

  /** Update a player's controller screen. Unchanged snapshots are only re-sent every 2 s. */
  sendYou(id: string, you: You): void {
    const json = JSON.stringify(you);
    const last = this.lastSent.get(id);
    const now = performance.now();
    if (last && last.json === json && now - last.at < 2000) return;
    if (this.send({ t: 'to', id, m: you })) this.lastSent.set(id, { json, at: now });
  }

  /** Send to every player (arena, roster, snapshots, announcements). */
  broadcast(m: Feed): void {
    if (this.players.size) this.send({ t: 'all', m });
  }

  /** Stream an arena frame (binary, shared/frame.ts) to every player. */
  sendFrame(bytes: Uint8Array<ArrayBuffer>): void {
    if (this.players.size && this.ws?.readyState === WebSocket.OPEN) this.ws.send(bytes);
  }

  /** Send to one player. */
  sendTo(id: string, m: Feed): void {
    this.send({ t: 'to', id, m });
  }

  kick(id: string): void {
    this.send({ t: 'kick', id, reason: 'The host removed you from the game.' });
    const p = this.players.get(id);
    this.players.delete(id);
    if (p) {
      p.connected = false;
      this.emit('leave', p);
    }
    this.emit('change');
  }

  /** Forget players who left (lobby tidy-up). */
  dropDisconnected(): void {
    let changed = false;
    for (const [id, p] of this.players) {
      if (!p.connected) {
        this.players.delete(id);
        changed = true;
      }
    }
    if (changed) this.emit('change');
  }

  // -------------------------------------------------------------------------

  private connect(): void {
    this.setStatus('connecting');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${proto}://${location.host}${WS_PATH}`);
    } catch {
      return this.retry();
    }
    this.ws = ws;
    ws.onopen = () => {
      const resume = this.code && this.token ? { code: this.code, token: this.token } : undefined;
      this.send({ t: 'open', resume });
    };
    ws.onmessage = (e) => {
      const m = decode(ServerToHostSchema, String(e.data));
      if (m) this.handle(m);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      for (const p of this.players.values()) {
        p.connected = false;
        p.buttons = 0;
      }
      this.retry();
    };
  }

  private retry(): void {
    this.setStatus('offline');
    const wait = this.retryMs;
    this.retryMs = Math.min(this.retryMs * 2, 8000);
    window.setTimeout(() => this.connect(), wait);
  }

  private handle(m: ServerToHost): void {
    switch (m.t) {
      case 'room': {
        if (m.code !== this.code) {
          // A brand-new room: nobody from the old one is coming back.
          this.players.clear();
        }
        this.code = m.code;
        this.token = m.token;
        this.retryMs = 1000;
        this.lastSent.clear();
        this.send({ t: 'limit', max: this.maxPlayers });
        try {
          sessionStorage.setItem(RESUME_KEY, JSON.stringify({ code: m.code, token: m.token }));
        } catch {
          /* no storage */
        }
        this.setStatus('open');
        return;
      }
      case 'join': {
        let p = this.players.get(m.id);
        if (p) {
          p.connected = true;
          p.buttons = 0;
        } else {
          const taken = [...this.reservedNames(), ...this.list().map((o) => o.name)];
          p = { id: m.id, name: uniqueName(taken, m.name), connected: true, buttons: 0 };
          this.players.set(m.id, p);
        }
        this.lastSent.delete(m.id);
        this.emit('join', p);
        this.emit('change');
        return;
      }
      case 'leave': {
        const p = this.players.get(m.id);
        if (!p) return;
        p.connected = false;
        p.buttons = 0;
        this.emit('leave', p);
        this.emit('change');
        return;
      }
      case 'in': {
        const p = this.players.get(m.id);
        if (p) p.buttons = m.b;
        return;
      }
      case 'error':
        console.warn('[room]', m.reason);
        return;
    }
  }

  private send(m: HostToServer): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(m));
    return true;
  }

  private setStatus(s: RoomStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.emit('change');
  }

  private emit<K extends keyof Events>(event: K, ...args: Parameters<Events[K]>): void {
    for (const fn of this.listeners[event]) {
      try {
        (fn as (...a: Parameters<Events[K]>) => void)(...args);
      } catch (err) {
        console.error('[room] listener failed:', err);
      }
    }
  }
}

export const hostRoom = new HostRoom();

/**
 * The address players should open. On localhost that's useless to a phone, so
 * ask the dev/local server for this machine's LAN address.
 */
export async function joinBaseUrl(): Promise<{ url: string; lanOnly: boolean; warn?: string }> {
  const { protocol, hostname, port, origin } = location;
  if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(hostname)) {
    return { url: origin, lanOnly: /^(192\.168\.|10\.|172\.)/.test(hostname) };
  }
  try {
    const res = await fetch('/api/lan', { signal: AbortSignal.timeout(3000) });
    const { ips } = (await res.json()) as { ips?: string[] };
    if (ips?.length) return { url: `${protocol}//${ips[0]}${port ? `:${port}` : ''}`, lanOnly: true };
  } catch {
    /* fall through */
  }
  return { url: origin, lanOnly: true, warn: 'No network address found: connect this computer to Wi-Fi.' };
}
