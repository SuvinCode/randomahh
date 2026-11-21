import Phaser from 'phaser';
import { CMD, FONT, FrameWriter, MAX_TEXT, OBJ, to15 } from '@shared/frame';
import { DEPTH } from '../config';

/**
 * Copies what the disasters draw into a frame (shared/frame.ts "mirror"), so
 * players' phones show tornadoes, lasers, lava… exactly as the host draws them,
 * without each disaster knowing about phones. Works on Phaser Graphics command
 * buffers plus texts, rectangles, circles and containers; anything else is skipped.
 */

/** Depths that disasters draw at; the arena's own layers (crates, fighters…) are drawn natively by phones. */
const NATIVE = new Set<number>([DEPTH.crate, DEPTH.fighter, DEPTH.weapon, DEPTH.projectile]);
export function isMirrored(o: Phaser.GameObjects.GameObject & { depth: number }): boolean {
  const d = o.depth;
  return (d >= DEPTH.disasterBack && d <= DEPTH.telegraph && !NATIVE.has(d)) || d === DEPTH.banner + 10;
}

const TAU = Math.PI * 2;
const mrad = (a: number) => {
  const r = a % TAU;
  return Math.round((r < 0 ? r + TAU : r) * 1000);
};
const permille = (a: number) => Math.round(Math.max(0, Math.min(1, a)) * 1000);
const pct = (s: number) => Math.round(s * 100);

type Visible = Phaser.GameObjects.GameObject & {
  visible: boolean;
  alpha: number;
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
};

/** Append every mirrored object of the scene (in draw order) while it fits. */
export function writeMirror(w: FrameWriter, scene: Phaser.Scene): void {
  const list = (scene.children.list as (Visible & { depth: number })[])
    .filter((o) => isMirrored(o))
    .sort((a, b) => a.depth - b.depth);
  let front = false;
  for (const o of list) {
    if (!front && o.depth > DEPTH.fighter) {
      if (w.room < 1) return;
      w.push(OBJ.front); // the rest is drawn in front of the fighters
      front = true;
    }
    if (!writeObject(w, o)) return; // out of room: stop (keep what fits)
  }
}

/** False if the frame is full (the partial object is rolled back). */
function writeObject(w: FrameWriter, o: Visible): boolean {
  if (!o.visible || o.alpha <= 0.003) return true;
  const start = w.n;
  const ok = writeAny(w, o);
  if (ok === 'full') {
    w.n = start;
    return false;
  }
  if (ok === 'skip') w.n = start;
  return true;
}

function writeAny(w: FrameWriter, o: Visible): 'ok' | 'skip' | 'full' {
  if (o instanceof Phaser.GameObjects.Graphics) return writeGraphics(w, o);
  if (o instanceof Phaser.GameObjects.Container) {
    if (w.room < 16) return 'full';
    w.push(OBJ.push);
    w.push(o.x);
    w.push(o.y);
    w.push(mrad(o.rotation));
    w.push(pct(o.scaleX));
    w.push(pct(o.scaleY));
    w.push(permille(o.alpha));
    for (const child of o.list as Visible[]) {
      if (!child.visible || child.alpha <= 0.003) continue;
      const before = w.n;
      const r = writeAny(w, child);
      if (r === 'full') return 'full';
      if (r === 'skip') w.n = before;
    }
    if (w.room < 1) return 'full';
    w.push(OBJ.pop);
    return 'ok';
  }
  if (o instanceof Phaser.GameObjects.Text) {
    const text = o.text.slice(0, MAX_TEXT);
    if (!text) return 'skip';
    if (w.room < 13 + text.length) return 'full';
    const st = o.style;
    w.push(OBJ.text);
    w.push(o.x);
    w.push(o.y);
    w.push(pct(o.originX));
    w.push(pct(o.originY));
    w.push(parseInt(String(st.fontSize), 10) || 16);
    w.push(to15(colorOf(st.color)));
    w.push(to15(colorOf(st.stroke)));
    w.push(st.strokeThickness || 0);
    w.push(permille(o.alpha));
    w.push(mrad(o.rotation));
    const family = String(st.fontFamily).toLowerCase();
    w.push(/mono|courier|consol/.test(family) ? FONT.mono : /serif/.test(family) && !/sans/.test(family) ? FONT.serif : FONT.sans);
    w.push(text.length);
    for (let k = 0; k < text.length; k++) w.push((text.charCodeAt(k) << 16) >> 16); // uint16 → int16
    return 'ok';
  }
  if (o instanceof Phaser.GameObjects.Rectangle) {
    if (!o.isFilled) return 'skip';
    if (w.room < 11) return 'full';
    w.push(OBJ.rect);
    w.push(o.x);
    w.push(o.y);
    w.push(o.width * o.scaleX);
    w.push(o.height * o.scaleY);
    w.push(pct(o.originX));
    w.push(pct(o.originY));
    w.push(to15(o.fillColor));
    w.push(permille(o.fillAlpha));
    w.push(permille(o.alpha));
    w.push(mrad(o.rotation));
    return 'ok';
  }
  if (o instanceof Phaser.GameObjects.Arc) {
    if (!o.isFilled) return 'skip';
    if (w.room < 7) return 'full';
    w.push(OBJ.circle);
    w.push(o.x);
    w.push(o.y);
    w.push(o.radius * o.scaleX);
    w.push(to15(o.fillColor));
    w.push(permille(o.fillAlpha));
    w.push(permille(o.alpha));
    return 'ok';
  }
  return 'skip';
}

function writeGraphics(w: FrameWriter, g: Phaser.GameObjects.Graphics): 'ok' | 'skip' | 'full' {
  const b = g.commandBuffer as number[];
  if (!b.length) return 'skip';
  if (w.room < 8) return 'full';
  w.push(OBJ.graphics);
  w.push(g.x);
  w.push(g.y);
  w.push(mrad(g.rotation));
  w.push(pct(g.scaleX));
  w.push(pct(g.scaleY));
  w.push(permille(g.alpha));
  const nAt = w.n;
  w.push(0);
  const begin = w.n;
  for (let i = 0; i < b.length; ) {
    if (w.room < 8) return 'full';
    const op = b[i++];
    switch (op) {
      case CMD.arc: {
        const [x, y, r, s, e, anti] = [b[i], b[i + 1], b[i + 2], b[i + 3], b[i + 4], b[i + 5]];
        i += 7; // Phaser stores an extra "overshoot" value
        const d = Math.max(-TAU, Math.min(TAU, e - s));
        const s2 = mrad(s);
        w.push(op);
        w.push(x);
        w.push(y);
        w.push(r);
        w.push(s2);
        w.push(s2 + Math.round(d * 1000));
        w.push(anti ? 1 : 0);
        break;
      }
      case CMD.begin:
      case CMD.close:
      case CMD.fillPath:
      case CMD.strokePath:
      case CMD.save:
      case CMD.restore:
        w.push(op);
        break;
      case CMD.fillRect:
        w.push(op);
        for (let k = 0; k < 4; k++) w.push(b[i + k]);
        i += 4;
        break;
      case CMD.lineTo:
      case CMD.moveTo:
      case CMD.translate:
        w.push(op);
        w.push(b[i]);
        w.push(b[i + 1]);
        i += 2;
        break;
      case CMD.lineStyle:
        w.push(op);
        w.push(b[i] * 10);
        w.push(to15(b[i + 1]));
        w.push(permille(b[i + 2]));
        i += 3;
        break;
      case CMD.fillStyle:
        w.push(op);
        w.push(to15(b[i]));
        w.push(permille(b[i + 1]));
        i += 2;
        break;
      case CMD.fillTri:
      case CMD.strokeTri:
        w.push(op);
        for (let k = 0; k < 6; k++) w.push(b[i + k]);
        i += 6;
        break;
      case CMD.scale:
        w.push(op);
        w.push(pct(b[i]));
        w.push(pct(b[i + 1]));
        i += 2;
        break;
      case CMD.rotate:
        w.push(op);
        w.push(mrad(b[i]));
        i += 1;
        break;
      case 21: // gradient fill: alphas ×4, colours ×4 → plain fill with the top-left colour
        w.push(CMD.fillStyle);
        w.push(to15(b[i + 4]));
        w.push(permille(b[i]));
        i += 8;
        break;
      case 22: // gradient line: width, alpha, colours ×4
        w.push(CMD.lineStyle);
        w.push(b[i] * 10);
        w.push(to15(b[i + 2]));
        w.push(permille(b[i + 1]));
        i += 6;
        break;
      default:
        return 'skip'; // a command we don't know: leave this drawing out rather than garble it
    }
  }
  w.buf[nAt] = w.n - begin;
  return 'ok';
}

function colorOf(c: unknown): number {
  if (typeof c === 'number') return c;
  if (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)) return parseInt(c.slice(1), 16);
  return 0xffffff;
}
