/**
 * The arena on a player's phone, drawn from the host's snapshots (shared/room.ts)
 * with a plain 2D canvas (no Phaser). Positions are smoothed between snapshots.
 *
 * Always shows the whole arena (you need to see what's coming), as big as fits
 * under the status bar. Your fighter gets a big bouncing arrow and a white
 * outline; other players are labelled, bots only get health bars (less clutter).
 */
import { WEAPONS_CATALOG, WEAPON_TYPES } from '@shared/commands';
import { FLAG, type Arena, type Roster, type Snap } from '@shared/room';

const W = 960;
const H = 540;
const FW = 20;
const FH = 26;

type Fx = { kind: 'boom' | 'skull'; x: number; y: number; r: number; ms: number };

const rgb = (c: number) => `#${(c & 0xffffff).toString(16).padStart(6, '0')}`;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class ArenaView {
  private arena: Arena | null = null;
  private roster = new Map<number, { name: string; color: string; player: boolean }>();
  private prev: Snap | null = null;
  private cur: Snap | null = null;
  private curAt = 0;
  private interval = 66;
  private fx: Fx[] = [];
  private last = new Map<number, { x: number; y: number }>();
  private lastFrame = 0;
  private readonly ctx: CanvasRenderingContext2D;
  /** Your fighter's id (0 = none). */
  me = 0;
  /** Screen px kept clear at the top (status bar). */
  topInset = 0;
  /** Where the arena ends on screen (css px), after the last draw. */
  arenaBottom = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    const loop = (t: number) => {
      requestAnimationFrame(loop);
      const dt = Math.min(100, this.lastFrame ? t - this.lastFrame : 16);
      this.lastFrame = t;
      this.draw(dt);
    };
    requestAnimationFrame(loop);
  }

  get hasArena(): boolean {
    return this.arena !== null;
  }

  setArena(a: Arena): void {
    this.arena = a;
    this.prev = this.cur = null;
    this.fx = [];
    this.last.clear();
  }

  clear(): void {
    this.arena = null;
    this.prev = this.cur = null;
    this.fx = [];
  }

  setRoster(r: Roster): void {
    this.roster = new Map(r.f.map(([id, name, color, player]) => [id, { name, color, player }]));
  }

  push(s: Snap): void {
    const now = performance.now();
    if (this.cur) this.interval = lerp(this.interval, Math.min(250, Math.max(30, now - this.curAt)), 0.2);
    // Someone vanished since the last snapshot: they were knocked out.
    if (this.cur) {
      const still = new Set(s.f.map((f) => f[0]));
      for (const f of this.cur.f) if (!still.has(f[0])) this.fx.push({ kind: 'skull', x: f[1], y: f[2], r: 0, ms: 0 });
    }
    for (const [x, y, r] of s.x) this.fx.push({ kind: 'boom', x, y, r, ms: 0 });
    this.prev = this.cur;
    this.cur = s;
    this.curAt = now;
  }

  /** Position of fighter `id` right now (smoothed), or null. */
  private fighterAt(id: number, t: number): { x: number; y: number } | null {
    const c = this.cur?.f.find((f) => f[0] === id);
    if (!c) return null;
    const p = this.prev?.f.find((f) => f[0] === id);
    // Teleports and respawns snap instead of sliding across the arena.
    if (!p || Math.abs(p[1] - c[1]) + Math.abs(p[2] - c[2]) > 160) return { x: c[1], y: c[2] };
    return { x: lerp(p[1], c[1], t), y: lerp(p[2], c[2], t) };
  }

  // ---------------------------------------------------------------------

  private draw(dt: number): void {
    const cv = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = cv.clientWidth;
    const cssH = cv.clientHeight;
    if (!cssW || !cssH) return;
    if (cv.width !== Math.round(cssW * dpr) || cv.height !== Math.round(cssH * dpr)) {
      cv.width = Math.round(cssW * dpr);
      cv.height = Math.round(cssH * dpr);
    }
    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cv.width, cv.height);
    const a = this.arena;
    if (!a) return;

    const t = this.cur ? Math.min(1, (performance.now() - this.curAt) / this.interval) : 1;
    // ---- camera: the whole arena, as big as fits under the status bar
    const scale = Math.min(cssW / W, (cssH - this.topInset - 4) / H);
    const ox = (cssW - W * scale) / 2;
    const oy = this.topInset;
    this.arenaBottom = oy + H * scale;
    const S = scale * dpr;
    const toScreen = (x: number, y: number) => ({ x: (ox + x * scale) * dpr, y: (oy + y * scale) * dpr });
    g.setTransform(S, 0, 0, S, ox * dpr, oy * dpr);

    // ---- world
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, a.sky);
    sky.addColorStop(1, shade(a.sky, -0.35));
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    for (const [x, y, w, h] of a.solid) block(g, x, y, w, h, a.ground, 6);
    for (const [x, y, w, h] of a.ledges) block(g, x, y, w, h, a.platform, 4);

    const s = this.cur;
    if (s) {
      // Storm
      const [zl, zr] = s.z;
      if (zl > 1 || zr < W - 1) {
        g.fillStyle = 'rgba(106,27,154,0.33)';
        g.fillRect(0, 0, Math.max(0, zl), H);
        g.fillRect(zr, 0, Math.max(0, W - zr), H);
        g.strokeStyle = 'rgba(208,168,255,0.9)';
        g.lineWidth = 3;
        line(g, zl, 0, zl, H);
        line(g, zr, 0, zr, H);
      }
      // Crates
      for (const [x, y, power] of s.c) {
        g.fillStyle = power ? '#7b2cbf' : '#8a5a2b';
        g.strokeStyle = power ? '#ffd23f' : '#000';
        g.lineWidth = 2;
        g.fillRect(x - 11, y - 9, 22, 18);
        g.strokeRect(x - 11, y - 9, 22, 18);
      }
      // Bosses / minions (interpolated by index when the list is stable)
      const pb = this.prev && this.prev.b.length === s.b.length ? this.prev.b : null;
      s.b.forEach(([x, y, w, h, c], i) => {
        const bx = pb ? lerp(pb[i][0], x, t) : x;
        const by = pb ? lerp(pb[i][1], y, t) : y;
        g.fillStyle = '#000';
        roundRect(g, bx - 1, by - 1, w + 2, h + 2, 5);
        g.fillStyle = rgb(c);
        roundRect(g, bx, by, w, h, 4);
      });
      // Fighters
      for (const f of s.f) this.drawFighter(g, f, t);
      // Projectiles
      for (const [x, y, c, r] of s.p) {
        g.fillStyle = rgb(c);
        g.beginPath();
        g.arc(x, y, Math.max(2, r), 0, Math.PI * 2);
        g.fill();
      }
      // Beams
      for (const [x1, y1, x2, y2, half, c] of s.l) {
        g.strokeStyle = rgb(c);
        g.globalAlpha = 0.4;
        g.lineWidth = half * 3;
        line(g, x1, y1, x2, y2);
        g.globalAlpha = 1;
        g.lineWidth = Math.max(1, half);
        g.strokeStyle = '#fff';
        line(g, x1, y1, x2, y2);
      }
    }
    // Effects
    this.fx = this.fx.filter((e) => (e.ms += dt) < (e.kind === 'boom' ? 380 : 1000));
    for (const e of this.fx) {
      if (e.kind !== 'boom') continue;
      const k = e.ms / 380;
      g.globalAlpha = 1 - k;
      g.fillStyle = '#ffb347';
      g.beginPath();
      g.arc(e.x, e.y, e.r * (0.4 + 0.6 * k), 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
    }

    // ---- screen-space labels (crisp at any zoom)
    g.setTransform(1, 0, 0, 1, 0, 0);
    const font = Math.round(Math.max(10, Math.min(13, 11 * scale)) * dpr);
    g.textAlign = 'center';
    g.textBaseline = 'bottom';
    if (s) {
      for (const [x, y, power] of s.c) {
        const p = toScreen(x, y + 5);
        g.font = `bold ${font}px monospace`;
        g.fillStyle = '#ffd23f';
        if (power) g.fillText('?', p.x, p.y);
      }
      for (const f of s.f) {
        const pos = this.fighterAt(f[0], t)!;
        const info = this.roster.get(f[0]);
        const hidden = (f[5] & FLAG.hidden) !== 0;
        const mine = f[0] === this.me;
        if (hidden && !mine) continue;
        // Weapon
        const hand = toScreen(pos.x + f[3] * 13, pos.y + 7);
        g.font = `${Math.round(font * 1.15)}px sans-serif`;
        g.fillText(WEAPONS_CATALOG[WEAPON_TYPES[f[6]] ?? 'sword'].emoji, hand.x, hand.y);
        // HP bar, and a name for people (bots stay unlabelled on a small screen)
        const top = toScreen(pos.x, pos.y - FH / 2);
        const bw = 24 * dpr;
        const pct = f[4] / 100;
        g.fillStyle = 'rgba(0,0,0,0.7)';
        g.fillRect(top.x - bw / 2 - dpr, top.y - 6 * dpr, bw + 2 * dpr, 4 * dpr);
        g.fillStyle = pct > 0.5 ? '#4ade80' : pct > 0.25 ? '#facc15' : '#ef4444';
        g.fillRect(top.x - bw / 2, top.y - 5 * dpr, bw * pct, 2 * dpr);
        if (info && (info.player || mine)) {
          g.font = `${mine ? 'bold ' : ''}${font}px monospace`;
          g.lineWidth = 3 * dpr;
          g.strokeStyle = '#000';
          g.strokeText(info.name, top.x, top.y - 8 * dpr);
          g.fillStyle = mine ? '#ffd23f' : '#fff';
          g.fillText(info.name, top.x, top.y - 8 * dpr);
        }
        // Players get an arrow; yours is big and bouncy.
        if (info?.player || mine) {
          const bob = mine ? Math.sin(performance.now() / 160) * 3 * dpr : 0;
          const ay = top.y - 8 * dpr - font - 3 * dpr + bob;
          const sz = (mine ? 9 : 5) * dpr;
          const col = (f[5] & FLAG.autopilot) !== 0 ? '#8a8aa8' : (info?.color ?? '#fff');
          g.fillStyle = '#000';
          tri(g, top.x, ay + 2 * dpr, sz + 2 * dpr);
          g.fillStyle = mine ? '#fff' : col;
          tri(g, top.x, ay, sz);
        }
      }
    }
    for (const e of this.fx) {
      if (e.kind !== 'skull') continue;
      const p = toScreen(e.x, e.y - (e.ms / 1000) * 40);
      g.globalAlpha = 1 - e.ms / 1000;
      g.font = `${Math.round(font * 1.6)}px sans-serif`;
      g.fillText('💀', p.x, p.y);
      g.globalAlpha = 1;
    }
  }

  private drawFighter(g: CanvasRenderingContext2D, f: Snap['f'][number], t: number): void {
    const [id, , , facing, , flags] = f;
    const pos = this.fighterAt(id, t)!;
    const info = this.roster.get(id);
    const mine = id === this.me;
    const color = info?.color ?? '#cccccc';
    const x = pos.x - FW / 2;
    const y = pos.y - FH / 2;
    g.globalAlpha = (flags & FLAG.hidden) !== 0 ? (mine ? 0.5 : 0.18) : 1;
    if ((flags & FLAG.rage) !== 0) {
      g.fillStyle = 'rgba(255,77,77,0.35)';
      g.beginPath();
      g.arc(pos.x, pos.y, 20, 0, Math.PI * 2);
      g.fill();
    }
    if ((flags & FLAG.flying) !== 0) {
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.beginPath();
      g.moveTo(pos.x - 6, pos.y - 4);
      g.lineTo(pos.x - 20, pos.y - 12);
      g.lineTo(pos.x - 8, pos.y + 4);
      g.moveTo(pos.x + 6, pos.y - 4);
      g.lineTo(pos.x + 20, pos.y - 12);
      g.lineTo(pos.x + 8, pos.y + 4);
      g.fill();
    }
    // Body: a little bean with a headband and eyes, like the host's.
    g.fillStyle = mine ? '#fff' : '#000';
    roundRect(g, x - (mine ? 1 : 0), y - (mine ? 1 : 0), FW + (mine ? 2 : 0), FH + (mine ? 2 : 0), 7);
    g.fillStyle = (flags & FLAG.hurt) !== 0 ? '#ff7070' : (flags & FLAG.chilled) !== 0 ? '#9fd8ff' : color;
    roundRect(g, x + 2, y + 2, FW - 4, FH - 4, 6);
    g.fillStyle = shade(color, -0.35);
    g.fillRect(x + 2, y + 6, FW - 4, 3);
    const ex = pos.x + facing * 3;
    g.fillStyle = '#fff';
    g.fillRect(ex - 5, y + 10, 4, 5);
    g.fillRect(ex + 1, y + 10, 4, 5);
    g.fillStyle = '#000';
    g.fillRect(ex - 4 + facing, y + 11, 2, 3);
    g.fillRect(ex + 2 + facing, y + 11, 2, 3);
    if ((flags & FLAG.shield) !== 0) {
      g.strokeStyle = 'rgba(76,201,240,0.9)';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(pos.x, pos.y, 19, 0, Math.PI * 2);
      g.stroke();
    }
    if ((flags & FLAG.attacking) !== 0) {
      g.strokeStyle = 'rgba(255,255,255,0.7)';
      g.lineWidth = 3;
      g.beginPath();
      g.arc(pos.x + facing * 6, pos.y, 18, facing === 1 ? -1.2 : Math.PI - 0.2, facing === 1 ? 0.2 : Math.PI + 1.2);
      g.stroke();
    }
    g.globalAlpha = 1;
  }
}

function block(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, trim: number): void {
  g.fillStyle = color;
  g.fillRect(x, y, w, h);
  g.fillStyle = 'rgba(255,255,255,0.18)';
  g.fillRect(x, y, w, trim);
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 2;
  g.strokeRect(x, y, w, h);
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  g.fill();
}

function line(g: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.stroke();
}

/** Downward-pointing triangle with its tip at (x, y). */
function tri(g: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  g.beginPath();
  g.moveTo(x - size, y - size);
  g.lineTo(x + size, y - size);
  g.lineTo(x, y);
  g.closePath();
  g.fill();
}

/** Lighten (k > 0) or darken (k < 0) a "#rrggbb" colour. */
function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k);
  return rgb((ch((n >> 16) & 255) << 16) | (ch((n >> 8) & 255) << 8) | ch(n & 255));
}
