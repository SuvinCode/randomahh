import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomHub, type Conn } from '../server/rooms';
import { CMD, FLAG, FRAME_MAGIC, FrameWriter, OBJ, decodeFrame, to15 } from '../shared/frame';
import { BTN, MAX_ROOM_PLAYERS, YouSchema, decode, normalizeCode, type You } from '../shared/room';

class FakeConn implements Conn {
  sent: any[] = [];
  frames: Uint8Array[] = [];
  closed = false;
  send(data: string | Uint8Array) {
    if (typeof data === 'string') this.sent.push(JSON.parse(data));
    else this.frames.push(data);
  }
  close() {
    this.closed = true;
  }
  last(t?: string) {
    const list = t ? this.sent.filter((m) => m.t === t) : this.sent;
    return list[list.length - 1];
  }
}

let clock = 0;
const hub = () => new RoomHub({ now: () => clock, hostGraceMs: 1000 });

function host(h: RoomHub) {
  const conn = new FakeConn();
  const s = h.connect(conn);
  s.message(JSON.stringify({ t: 'open' }));
  return { conn, s, code: conn.last('room').code as string, token: conn.last('room').token as string };
}

function player(h: RoomHub, code: string, pid = 'player0001', name = 'Bob') {
  const conn = new FakeConn();
  const s = h.connect(conn);
  s.message(JSON.stringify({ t: 'join', code, pid, name }));
  return { conn, s };
}

const you: You = {
  t: 'you', name: 'Bob', color: '#ff0000', phase: 'fight', hp: 80, weapon: 'sword', powerups: ['shield'], kills: 1, alive: 5, place: 0, msg: 'Fight!', fid: 7,
};

beforeEach(() => {
  clock = 0;
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('room hub', () => {
  it('opens a room with a 4-letter code and a token', () => {
    const h = hub();
    const { code, token } = host(h);
    expect(code).toMatch(/^[A-HJ-NP-Z]{4}$/);
    expect(token).toMatch(/^[a-z0-9]{16,40}$/);
    expect(h.roomCount).toBe(1);
  });

  it('relays joins and inputs to the host, and status back to the player', () => {
    const h = hub();
    const hst = host(h);
    const p = player(h, hst.code, 'player0001', '  Bob <b> ');
    expect(p.conn.last('joined')).toEqual({ t: 'joined', code: hst.code, name: 'Bob b' });
    expect(hst.conn.last('join')).toEqual({ t: 'join', id: 'player0001', name: 'Bob b' });

    p.s.message(JSON.stringify({ t: 'in', b: BTN.left | BTN.attack }));
    expect(hst.conn.last('in')).toEqual({ t: 'in', id: 'player0001', b: BTN.left | BTN.attack });

    hst.s.message(JSON.stringify({ t: 'to', id: 'player0001', m: you }));
    expect(p.conn.last('you')).toEqual(you);
  });

  it('relays binary arena frames from the host to every player, untouched', () => {
    const h = hub();
    const hst = host(h);
    const a = player(h, hst.code, 'player0001', 'Ann');
    const b = player(h, hst.code, 'player0002', 'Bo');
    const bytes = sampleFrame();
    hst.s.binary(bytes);
    expect(a.conn.frames).toEqual([bytes]);
    expect(b.conn.frames).toEqual([bytes]);
    // Garbage is dropped; players can't send frames.
    hst.s.binary(new Uint8Array([1, 2, 3, 4]));
    a.s.binary(bytes);
    expect(a.conn.frames).toHaveLength(1);
    expect(b.conn.frames).toHaveLength(1);
  });

  it('rejects unknown rooms, bad messages and unknown keys', () => {
    const h = hub();
    const hst = host(h);
    const lost = player(h, 'ZZZZ');
    expect(lost.conn.last('bye').reason).toMatch(/No room ZZZZ/);
    expect(lost.conn.closed).toBe(true);

    const p = player(h, hst.code);
    const before = hst.conn.sent.length;
    p.s.message(JSON.stringify({ t: 'in', b: 999 }));
    p.s.message(JSON.stringify({ t: 'in', b: 1, extra: true }));
    p.s.message('not json');
    p.s.message(JSON.stringify({ t: 'to', id: 'player0001', m: you })); // players can't talk to players
    expect(hst.conn.sent.length).toBe(before);
    expect(p.conn.sent.filter((m) => m.t === 'you')).toHaveLength(0);
  });

  it('tells the host when a player leaves; the same pid can come back', () => {
    const h = hub();
    const hst = host(h);
    const p = player(h, hst.code);
    p.s.closed();
    expect(hst.conn.last('leave')).toEqual({ t: 'leave', id: 'player0001' });
    const again = player(h, hst.code);
    expect(again.conn.last('joined')).toBeTruthy();
    expect(hst.conn.sent.filter((m) => m.t === 'join')).toHaveLength(2);
  });

  it('a second tab with the same pid replaces the first', () => {
    const h = hub();
    const hst = host(h);
    const a = player(h, hst.code);
    const b = player(h, hst.code);
    expect(a.conn.closed).toBe(true);
    expect(a.conn.last('bye').reason).toMatch(/another tab/);
    a.s.closed(); // old socket closing must not kick the new one
    expect(hst.conn.sent.filter((m) => m.t === 'leave')).toHaveLength(0);
    b.s.message(JSON.stringify({ t: 'in', b: BTN.jump }));
    expect(hst.conn.last('in').b).toBe(BTN.jump);
  });

  it('caps players per room', () => {
    const h = hub();
    const hst = host(h);
    for (let k = 0; k < MAX_ROOM_PLAYERS; k++) player(h, hst.code, `player${String(k).padStart(4, '0')}`);
    const extra = player(h, hst.code, 'latecomer1');
    expect(extra.conn.last('bye').reason).toMatch(/full/);
  });

  it('kicks a player on the host’s request', () => {
    const h = hub();
    const hst = host(h);
    const p = player(h, hst.code);
    hst.s.message(JSON.stringify({ t: 'kick', id: 'player0001', reason: 'bye' }));
    expect(p.conn.closed).toBe(true);
    expect(hst.conn.last('leave')).toEqual({ t: 'leave', id: 'player0001' });
  });

  it('keeps the room while the host reconnects with its token, then closes it after the grace period', () => {
    const h = hub();
    const hst = host(h);
    const p = player(h, hst.code);
    hst.s.closed();
    expect(p.conn.last('host')).toEqual({ t: 'host', on: false });

    // Back in time: same room, players re-announced.
    const back = new FakeConn();
    back.sent = [];
    h.connect(back).message(JSON.stringify({ t: 'open', resume: { code: hst.code, token: hst.token } }));
    expect(back.last('room').code).toBe(hst.code);
    expect(back.last('join')).toEqual({ t: 'join', id: 'player0001', name: 'Bob' });
    expect(p.conn.last('host')).toEqual({ t: 'host', on: true });
    vi.advanceTimersByTime(5000);
    expect(h.roomCount).toBe(1);

    // A wrong token gets a new room; the old one is untouched.
    const thief = new FakeConn();
    h.connect(thief).message(JSON.stringify({ t: 'open', resume: { code: hst.code, token: 'x'.repeat(24) } }));
    expect(thief.last('room').code).not.toBe(hst.code);

    // Host gone for good: players are told and the room is deleted.
    const hub2 = hub();
    const h2 = host(hub2);
    const p2 = player(hub2, h2.code);
    h2.s.closed();
    vi.advanceTimersByTime(1001);
    expect(p2.conn.last('bye').reason).toMatch(/host left/);
    expect(p2.conn.closed).toBe(true);
    expect(hub2.roomCount).toBe(0);
  });

  it('rate-limits a chatty player', () => {
    const h = hub();
    const hst = host(h);
    const p = player(h, hst.code);
    for (let k = 0; k < 500; k++) p.s.message(JSON.stringify({ t: 'in', b: k % 2 }));
    const relayed = hst.conn.sent.filter((m) => m.t === 'in').length;
    expect(relayed).toBeLessThan(100);
    clock += 1000;
    p.s.message(JSON.stringify({ t: 'in', b: 1 }));
    expect(hst.conn.sent.filter((m) => m.t === 'in').length).toBe(relayed + 1);
  });

  it('refuses new rooms when full', () => {
    const h = new RoomHub({ maxRooms: 1 });
    host(h);
    const c = new FakeConn();
    h.connect(c).message(JSON.stringify({ t: 'open' }));
    expect(c.last('error')).toBeTruthy();
    expect(c.closed).toBe(true);
  });
});

describe('room contract', () => {
  it('validates controller snapshots strictly', () => {
    expect(YouSchema.safeParse(you).success).toBe(true);
    expect(YouSchema.safeParse({ ...you, hp: 101 }).success).toBe(false);
    expect(YouSchema.safeParse({ ...you, weapon: 'banana' }).success).toBe(false);
    expect(YouSchema.safeParse({ ...you, secret: 1 }).success).toBe(false);
  });

  it('drops oversized messages', () => {
    expect(decode(YouSchema, JSON.stringify({ ...you, msg: 'x'.repeat(2000) }))).toBeNull();
  });

  it('normalises typed room codes', () => {
    expect(normalizeCode(' ab cd ')).toBe('ABCD');
    expect(normalizeCode('ABIO')).toBeNull(); // no I/O in codes
    expect(normalizeCode('ABC')).toBeNull();
  });
});

/** A frame with one fighter, one crate, a shot and a tornado-ish drawing. */
function sampleFrame(): Uint8Array {
  const w = new FrameWriter();
  for (const v of [FRAME_MAGIC, 0, 1234, 0, 960]) w.push(v);
  w.push(1);
  for (const v of [7, 100, 400, 1, 80, FLAG.shield | FLAG.flying, 3]) w.push(v);
  w.push(1);
  for (const v of [300, 480, 1]) w.push(v);
  w.push(1);
  for (const v of [10, 10, to15(0xffd23f), 3]) w.push(v);
  w.push(0);
  w.push(0);
  // mirror: one graphics object (fill style, circle) then a front marker and a text
  w.push(OBJ.graphics);
  for (const v of [0, 0, 0, 100, 100, 1000]) w.push(v);
  const cmds = [CMD.fillStyle, to15(0xaaaaaa), 800, CMD.begin, CMD.arc, 200, 300, 40, 0, 6283, 0, CMD.fillPath];
  w.push(cmds.length);
  cmds.forEach((v) => w.push(v));
  w.push(OBJ.front);
  w.push(OBJ.text);
  for (const v of [480, 100, 50, 50, 22, to15(0xffffff), 0, 5, 1000, 0, 1, 2]) w.push(v);
  w.push('3'.charCodeAt(0));
  w.push('!'.charCodeAt(0));
  return w.bytes();
}

describe('arena frames', () => {
  it('round-trip through the binary format', () => {
    const f = decodeFrame(sampleFrame())!;
    expect(f).not.toBeNull();
    expect(f.ms).toBe(1234);
    expect(f.f).toEqual([[7, 100, 400, 1, 80, FLAG.shield | FLAG.flying, 3]]);
    expect(f.c).toEqual([[300, 480, 1]]);
    expect(f.p[0][0]).toBe(10);
    expect(f.mirror[0]).toBe(OBJ.graphics);
  });

  it('rejects malformed frames', () => {
    const good = sampleFrame();
    expect(decodeFrame(good.slice(0, good.length - 2))).toBeNull(); // truncated text
    const bad = new Uint8Array(good);
    new DataView(bad.buffer).setInt16(0, 1, true); // wrong magic
    expect(decodeFrame(bad)).toBeNull();
    const w = new FrameWriter();
    for (const v of [FRAME_MAGIC, 0, 0, 0, 960, 0, 0, 0, 0, 0, OBJ.graphics, 0, 0, 0, 100, 100, 1000, 2, 99, 0]) w.push(v);
    expect(decodeFrame(w.bytes())).toBeNull(); // unknown drawing command
    const p = new FrameWriter();
    for (const v of [FRAME_MAGIC, 0, 0, 0, 960, 0, 0, 0, 0, 0, OBJ.pop]) p.push(v);
    expect(decodeFrame(p.bytes())).toBeNull(); // unbalanced container
  });
});
