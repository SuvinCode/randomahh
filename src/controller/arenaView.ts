/**
 * The arena on a player's phone, drawn from the host's binary frames
 * (shared/frame.ts) on a plain 2D canvas (no Phaser).
 *
 * Smooth on shaky networks: frames carry the host's clock, and we play them
 * back a little behind real time (a jitter buffer), interpolating fighters
 * between the two frames around the playback time. Bursty delivery then
 * doesn't show as stutter.
 *
 * Cheap to draw: the sky and terrain are drawn once into a layer; the
 * disasters' drawings (the "mirror", split behind/in front of the fighters)
 * are replayed into their own layers only when a new frame comes up; emoji
 * are cached as small bitmaps.
 */
import { WEAPONS_CATALOG, WEAPON_TYPES } from '@shared/commands';
import { CMD, FLAG, FONT_CSS, OBJ, OBJ_ARGS, css15, type Frame } from '@shared/frame';
import type { Arena, Roster } from '@shared/room';
import { COMBAT_ENABLED } from '../config';

const W = 960;
const H = 540;
const FW = 20;
const FH = 26;
/** Playback runs at least this far behind the host (ms). Frames come every 50 ms, so less than ~60 starves. */
const MIN_DELAY = 70;
/** Never buffer more than this: rarer, longer stalls are bridged by extrapolating instead. */
const MAX_DELAY = 300;
/** Lateness samples kept (~5 s of frames at 20/s). */
const LATE_WINDOW = 100;
/** When the buffer runs dry, keep fighters moving on their last velocity for up to this long (ms). */
const EXTRAPOLATE_MS = 120;

type Fx = { kind: 'boom' | 'skull'; x: number; y: number; r: number; ms: number };

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const layer = () => document.createElement('canvas');

export class ArenaView {
  private arena: Arena | null = null;
  private roster = new Map<number, { name: string; color: string; player: boolean }>();
  private frames: Frame[] = [];
  /** host clock − local clock for the least-delayed recent frame. */
  private offset: number | null = null;
  private offsets: number[] = [];
  /** How late each recent frame arrived compared to the best case (ms). */
  private late: number[] = [];
  /** How far behind the host playback runs (ms): covers 95% of late frames plus the gap to the next one. */
  private bufferMs = 100;
  private lastShown: Frame | null = null;
  private fx: Fx[] = [];
  private lastFrame = 0;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly world = layer();
  private readonly back = layer();
  private readonly front = layer();
  private worldKey = '';
  private mirrorOf: Frame | null = null;
  private readonly emoji = new Map<string, HTMLCanvasElement>();
  /** Your fighter's id (0 = none). */
  me = 0;
  /** Screen px kept clear at the top (status bar). */
  topInset = 0;

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
    this.reset();
    this.worldKey = '';
  }

  clear(): void {
    this.arena = null;
    this.reset();
  }

  private reset(): void {
    this.frames = [];
    this.offsets = [];
    this.offset = null;
    this.late = [];
    this.bufferMs = 100;
    this.fx = [];
    this.lastShown = null;
    this.mirrorOf = null;
  }

  setRoster(r: Roster): void {
    this.roster = new Map(r.f.map(([id, name, color, player]) => [id, { name, color, player }]));
  }

  push(frame: Frame): void {
    const now = performance.now();
    const newest = this.frames[this.frames.length - 1];
    // The host's clock jumped (new page, wrap-around): start over.
    if (newest && (frame.ms <= newest.ms || frame.ms - newest.ms > 5000)) {
      this.frames = [];
      this.offsets = [];
      this.late = [];
    }
    const off = frame.ms - now;
    this.offsets.push(off);
    if (this.offsets.length > 60) this.offsets.shift();
    this.offset = Math.max(...this.offsets);
    // Size the buffer from the worst recent lateness (95th percentile), not the
    // average: an average-sized buffer runs dry on every slow burst. +60 covers
    // the 50 ms until the next frame. (Measured on 80 ms ± 80 ms jitter: frozen
    // 11% of the time → under 1%, for ~30 ms more delay; clean networks unchanged.)
    this.late.push(this.offset - off);
    if (this.late.length > LATE_WINDOW) this.late.shift();
    if (this.late.length >= 10) {
      const s = [...this.late].sort((x, y) => x - y);
      this.bufferMs = Math.max(MIN_DELAY, Math.min(MAX_DELAY, s[Math.floor(s.length * 0.95)] + 60));
    }
    this.frames.push(frame);
    if (this.frames.length > 40) this.frames.shift();
    for (const [x, y, r] of frame.x) this.fx.push({ kind: 'boom', x, y, r, ms: 0 });
  }

  /** The two frames around the playback time, and how far between them (0..1). */
  private playback(): { a: Frame; b: Frame; t: number } | null {
    if (!this.frames.length || this.offset === null) return null;
    const target = performance.now() + this.offset - this.bufferMs;
    const fs = this.frames;
    while (fs.length > 2 && fs[1].ms <= target) fs.shift();
    const a = fs[0];
    const b = fs[1] ?? a;
    if (b === a || target <= a.ms) return { a, b: a, t: 0 };
    // Past the newest frame (a stall): t > 1 carries fighters on along their
    // last motion for a moment instead of freezing them.
    const span = b.ms - a.ms;
    return { a, b, t: Math.min(1 + EXTRAPOLATE_MS / span, (target - a.ms) / span) };
  }

  // ---------------------------------------------------------------------

  private draw(dt: number): void {
    const cv = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = cv.clientWidth;
    const cssH = cv.clientHeight;
    if (!cssW || !cssH) return;
    const pw = Math.round(cssW * dpr);
    const ph = Math.round(cssH * dpr);
    if (cv.width !== pw || cv.height !== ph) {
      cv.width = pw;
      cv.height = ph;
    }
    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, pw, ph);
    const a = this.arena;
    if (!a) return;

    // The whole arena, as big as fits under the status bar.
    const scale = Math.min(cssW / W, (cssH - this.topInset - 4) / H);
    const ox = Math.round((cssW - W * scale) / 2) * dpr;
    const oy = Math.round(this.topInset) * dpr;
    const S = scale * dpr;
    const aw = Math.round(W * S);
    const ah = Math.round(H * S);
    const toScreen = (x: number, y: number) => ({ x: ox + x * S, y: oy + y * S });

    // Sky + terrain: drawn once per arena and size.
    const key = `${a.theme}|${aw}x${ah}`;
    if (key !== this.worldKey) {
      this.worldKey = key;
      this.paintWorld(a, aw, ah, S);
      this.mirrorOf = null;
    }
    g.drawImage(this.world, ox, oy);

    const pb = this.playback();
    if (!pb) return;
    const { a: fa, b: fb, t } = pb;
    if (fa !== this.lastShown) {
      // Someone in the previous frame is gone: knocked out.
      if (this.lastShown) {
        const still = new Set(fa.f.map((f) => f[0]));
        for (const f of this.lastShown.f) if (!still.has(f[0])) this.fx.push({ kind: 'skull', x: f[1], y: f[2], r: 0, ms: 0 });
      }
      this.lastShown = fa;
    }
    const pos = (f: number[]) => {
      const n = fb.f.find((k) => k[0] === f[0]);
      // Teleports snap instead of sliding across the arena.
      if (!n || Math.abs(n[1] - f[1]) + Math.abs(n[2] - f[2]) > 160) return { x: f[1], y: f[2] };
      if (t <= 1) return { x: lerp(f[1], n[1], t), y: lerp(f[2], n[2], t) };
      // Extrapolating through a stall: sideways freely, but only a little
      // vertically so a falling fighter doesn't sink into the floor.
      const dy = (n[2] - f[2]) * (t - 1);
      return { x: lerp(f[1], n[1], t), y: n[2] + Math.max(-10, Math.min(10, dy)) };
    };

    // Disasters' drawings: replayed once per frame into two layers.
    if (this.mirrorOf !== fa) {
      this.paintMirror(fa, aw, ah, S);
      this.mirrorOf = fa;
    }
    g.drawImage(this.back, ox, oy);

    g.save();
    g.setTransform(S, 0, 0, S, ox, oy);
    g.beginPath();
    g.rect(0, 0, W, H);
    g.clip();
    // Storm
    const [zl, zr] = fa.zone;
    if (zl > 1 || zr < W - 1) {
      g.fillStyle = 'rgba(106,27,154,0.33)';
      g.fillRect(0, 0, Math.max(0, zl), H);
      g.fillRect(zr, 0, Math.max(0, W - zr), H);
      g.strokeStyle = 'rgba(208,168,255,0.9)';
      g.lineWidth = 3;
      line(g, zl, 0, zl, H);
      line(g, zr, 0, zr, H);
    }
    for (const [x, y, power] of fa.c) {
      g.fillStyle = power ? '#7b2cbf' : '#8a5a2b';
      g.strokeStyle = power ? '#ffd23f' : '#000';
      g.lineWidth = 2;
      g.fillRect(x - 11, y - 9, 22, 18);
      g.strokeRect(x - 11, y - 9, 22, 18);
    }
    for (const f of fa.f) this.drawFighter(g, f, pos(f));
    for (const [x, y, c, r] of fa.p) {
      g.fillStyle = css15(c);
      g.beginPath();
      g.arc(x, y, Math.max(2, r), 0, Math.PI * 2);
      g.fill();
    }
    for (const [x1, y1, x2, y2, half, c] of fa.l) {
      g.strokeStyle = css15(c, 0.4);
      g.lineWidth = half * 3;
      line(g, x1, y1, x2, y2);
      g.lineWidth = Math.max(1, half);
      g.strokeStyle = '#fff';
      line(g, x1, y1, x2, y2);
    }
    this.fx = this.fx.filter((e) => (e.ms += dt) < (e.kind === 'boom' ? 380 : 1000));
    for (const e of this.fx) {
      if (e.kind !== 'boom') continue;
      const k = e.ms / 380;
      g.fillStyle = `rgba(255,179,71,${(1 - k).toFixed(2)})`;
      g.beginPath();
      g.arc(e.x, e.y, e.r * (0.4 + 0.6 * k), 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
    g.drawImage(this.front, ox, oy);

    // ---- labels in screen space (crisp at any zoom)
    const font = Math.round(Math.max(10, Math.min(13, 11 * scale)) * dpr);
    g.textAlign = 'center';
    g.textBaseline = 'bottom';
    for (const [x, y, power] of fa.c) {
      if (!power) continue;
      const p = toScreen(x, y + 5);
      g.font = `bold ${font}px monospace`;
      g.fillStyle = '#ffd23f';
      g.fillText('?', p.x, p.y);
    }
    for (const f of fa.f) {
      const at = pos(f);
      const info = this.roster.get(f[0]);
      const mine = f[0] === this.me;
      if ((f[5] & FLAG.hidden) !== 0 && !mine) continue;
      const hand = toScreen(at.x + f[3] * 13, at.y + 8);
      if (COMBAT_ENABLED) this.drawEmoji(g, WEAPONS_CATALOG[WEAPON_TYPES[f[6]] ?? 'sword'].emoji, hand.x, hand.y, Math.round(font * 1.2));
      const top = toScreen(at.x, at.y - FH / 2);
      const bw = 24 * dpr;
      const hp = f[4] / 100;
      g.fillStyle = 'rgba(0,0,0,0.7)';
      g.fillRect(top.x - bw / 2 - dpr, top.y - 6 * dpr, bw + 2 * dpr, 4 * dpr);
      g.fillStyle = hp > 0.5 ? '#4ade80' : hp > 0.25 ? '#facc15' : '#ef4444';
      g.fillRect(top.x - bw / 2, top.y - 5 * dpr, bw * hp, 2 * dpr);
      // Names for people only (bots would clutter a small screen).
      if (info && (info.player || mine)) {
        g.font = `${mine ? 'bold ' : ''}${font}px monospace`;
        g.lineWidth = 3 * dpr;
        g.strokeStyle = '#000';
        g.strokeText(info.name, top.x, top.y - 8 * dpr);
        g.fillStyle = mine ? '#ffd23f' : '#fff';
        g.fillText(info.name, top.x, top.y - 8 * dpr);
        const bob = mine ? Math.sin(performance.now() / 160) * 3 * dpr : 0;
        const ay = top.y - 8 * dpr - font - 3 * dpr + bob;
        const sz = (mine ? 9 : 5) * dpr;
        g.fillStyle = '#000';
        tri(g, top.x, ay + 2 * dpr, sz + 2 * dpr);
        g.fillStyle = mine ? '#fff' : (f[5] & FLAG.autopilot) !== 0 ? '#8a8aa8' : info.color;
        tri(g, top.x, ay, sz);
      }
    }
    for (const e of this.fx) {
      if (e.kind !== 'skull') continue;
      const p = toScreen(e.x, e.y - (e.ms / 1000) * 40);
      g.globalAlpha = 1 - e.ms / 1000;
      this.drawEmoji(g, '💀', p.x, p.y, Math.round(font * 1.6));
      g.globalAlpha = 1;
    }
  }

  private paintWorld(a: Arena, aw: number, ah: number, S: number): void {
    const c = this.world;
    c.width = aw;
    c.height = ah;
    const g = c.getContext('2d')!;
    g.setTransform(S, 0, 0, S, 0, 0);
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, a.sky);
    sky.addColorStop(1, shade(a.sky, -0.35));
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    for (const [x, y, w, h] of a.solid) block(g, x, y, w, h, a.ground, 6);
    for (const [x, y, w, h] of a.ledges) block(g, x, y, w, h, a.platform, 4);
  }

  /** Replay the disasters' drawings exactly as the host drew them: behind the fighters, then (after OBJ.front) in front. */
  private paintMirror(f: Frame, aw: number, ah: number, S: number): void {
    for (const c of [this.back, this.front]) {
      if (c.width !== aw || c.height !== ah) {
        c.width = aw;
        c.height = ah;
      } else c.getContext('2d')!.clearRect(0, 0, aw, ah);
    }
    const m = f.mirror;
    if (!m.length) return;
    let g = this.back.getContext('2d')!;
    const start = (ctx: CanvasRenderingContext2D) => {
      ctx.setTransform(S, 0, 0, S, 0, 0);
      ctx.lineJoin = 'round';
      ctx.globalAlpha = 1;
    };
    start(g);
    const alphas: number[] = [];
    let alpha = 1;
    try {
      for (let i = 0; i < m.length; ) {
        const op = m[i++];
        const v = m.subarray(i, i + OBJ_ARGS[op]);
        i += OBJ_ARGS[op];
        switch (op) {
          case OBJ.front:
            g = this.front.getContext('2d')!;
            start(g);
            break;
          case OBJ.push:
            g.save();
            g.translate(v[0], v[1]);
            g.rotate(v[2] / 1000);
            g.scale(v[3] / 100, v[4] / 100);
            alphas.push(alpha);
            alpha *= v[5] / 1000;
            break;
          case OBJ.pop:
            g.restore();
            alpha = alphas.pop() ?? 1;
            break;
          case OBJ.graphics: {
            const n = v[6];
            g.save();
            g.translate(v[0], v[1]);
            g.rotate(v[2] / 1000);
            g.scale(v[3] / 100, v[4] / 100);
            g.globalAlpha = alpha * (v[5] / 1000);
            replay(g, m, i, i + n);
            g.restore();
            i += n;
            break;
          }
          case OBJ.text: {
            const n = v[11];
            let text = '';
            for (let k = 0; k < n; k++) text += String.fromCharCode(m[i + k] & 0xffff);
            i += n;
            g.save();
            g.translate(v[0], v[1]);
            g.rotate(v[9] / 1000);
            g.globalAlpha = alpha * (v[8] / 1000);
            g.font = `bold ${v[4]}px ${FONT_CSS[v[10]] ?? 'monospace'}`;
            g.textAlign = 'left';
            g.textBaseline = 'middle';
            const tw = g.measureText(text).width;
            const x = -tw * (v[2] / 100);
            const y = v[4] * (0.5 - v[3] / 100);
            if (v[7] > 0) {
              g.lineWidth = v[7];
              g.strokeStyle = css15(v[6]);
              g.strokeText(text, x, y);
            }
            g.fillStyle = css15(v[5]);
            g.fillText(text, x, y);
            g.restore();
            break;
          }
          case OBJ.rect:
            g.save();
            g.translate(v[0], v[1]);
            g.rotate(v[9] / 1000);
            g.globalAlpha = alpha * (v[8] / 1000);
            g.fillStyle = css15(v[6], v[7] / 1000);
            g.fillRect(-v[2] * (v[4] / 100), -v[3] * (v[5] / 100), v[2], v[3]);
            g.restore();
            break;
          case OBJ.circle:
            g.save();
            g.globalAlpha = alpha * (v[5] / 1000);
            g.fillStyle = css15(v[3], v[4] / 1000);
            g.beginPath();
            g.arc(v[0], v[1], Math.max(0, v[2]), 0, Math.PI * 2);
            g.fill();
            g.restore();
            break;
        }
      }
    } catch (err) {
      console.warn('[arena] bad drawing skipped', err);
    }
  }

  private drawFighter(g: CanvasRenderingContext2D, f: number[], pos: { x: number; y: number }): void {
    const [id, , , facing, , flags] = f;
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
    // A little bean with a headband and eyes, like on the big screen.
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

  /** Emoji are slow to draw as text on phones: render each once, then blit. */
  private drawEmoji(g: CanvasRenderingContext2D, e: string, x: number, y: number, size: number): void {
    const key = `${e}|${size}`;
    let c = this.emoji.get(key);
    if (!c) {
      c = layer();
      c.width = c.height = Math.ceil(size * 1.4);
      const cg = c.getContext('2d')!;
      cg.font = `${size}px sans-serif`;
      cg.textAlign = 'center';
      cg.textBaseline = 'middle';
      cg.fillText(e, c.width / 2, c.height / 2 + size * 0.05);
      if (this.emoji.size > 200) this.emoji.clear();
      this.emoji.set(key, c);
    }
    g.drawImage(c, x - c.width / 2, y - c.height);
  }
}

/** Run a Graphics command stream (shared/frame.ts CMD) on a canvas. Already validated. */
function replay(g: CanvasRenderingContext2D, m: Int16Array, i: number, end: number): void {
  while (i < end) {
    const op = m[i++];
    switch (op) {
      case CMD.arc:
        g.arc(m[i], m[i + 1], Math.max(0, m[i + 2]), m[i + 3] / 1000, m[i + 4] / 1000, m[i + 5] === 1);
        i += 6;
        break;
      case CMD.begin:
        g.beginPath();
        break;
      case CMD.close:
        g.closePath();
        break;
      case CMD.fillRect:
        g.fillRect(m[i], m[i + 1], m[i + 2], m[i + 3]);
        i += 4;
        break;
      case CMD.lineTo:
        g.lineTo(m[i], m[i + 1]);
        i += 2;
        break;
      case CMD.moveTo:
        g.moveTo(m[i], m[i + 1]);
        i += 2;
        break;
      case CMD.lineStyle:
        g.lineWidth = m[i] / 10;
        g.strokeStyle = css15(m[i + 1], m[i + 2] / 1000);
        i += 3;
        break;
      case CMD.fillStyle:
        g.fillStyle = css15(m[i], m[i + 1] / 1000);
        i += 2;
        break;
      case CMD.fillPath:
        g.fill();
        break;
      case CMD.strokePath:
        g.stroke();
        break;
      case CMD.fillTri:
      case CMD.strokeTri:
        g.beginPath();
        g.moveTo(m[i], m[i + 1]);
        g.lineTo(m[i + 2], m[i + 3]);
        g.lineTo(m[i + 4], m[i + 5]);
        g.closePath();
        if (op === CMD.fillTri) g.fill();
        else g.stroke();
        i += 6;
        break;
      case CMD.save:
        g.save();
        break;
      case CMD.restore:
        g.restore();
        break;
      case CMD.translate:
        g.translate(m[i], m[i + 1]);
        i += 2;
        break;
      case CMD.scale:
        g.scale(m[i] / 100, m[i + 1] / 100);
        i += 2;
        break;
      case CMD.rotate:
        g.rotate(m[i] / 1000);
        i += 1;
        break;
      default:
        return;
    }
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
  const c = (ch((n >> 16) & 255) << 16) | (ch((n >> 8) & 255) << 8) | ch(n & 255);
  return `#${c.toString(16).padStart(6, '0')}`;
}
