/**
 * Arena frames: what the host streams to players' phones ~20×/s, as compact
 * binary (little-endian int16s) instead of JSON: smaller on the wire, and the
 * relay server checks them with a quick walk (validFrame) instead of parsing.
 *
 * Layout (each value one int16):
 *   MAGIC, timeHi, timeLo, zoneLeft, zoneRight,
 *   nF, nF × [id, x, y, facing, hp, flags, weapon]        living fighters
 *   nC, nC × [x, y, isPowerup]                             crates
 *   nP, nP × [x, y, colour15, radius]                      projectiles
 *   nL, nL × [x1, y1, x2, y2, halfWidth, colour15]         beams
 *   nX, nX × [x, y, radius]                                explosions since the last frame
 *   then the rest is the MIRROR: disasters' own drawings, as a list of
 *   objects (OBJ) each followed by its values; graphics carry a command
 *   stream (CMD) that maps one-to-one onto canvas 2D calls.
 *
 * Positions are arena pixels (960×540); angles in milliradians; alphas in
 * thousandths; scales in hundredths; colours as RGB555 (colour15).
 */

export const FRAME_MAGIC = 7001;
/** int16 values per frame (48 KB). The host stops adding drawings when full. */
export const MAX_FRAME_VALUES = 24_000;
export const MAX_FRAME_BYTES = MAX_FRAME_VALUES * 2;

/** Fighter flags. */
export const FLAG = { hidden: 1, hurt: 2, shield: 4, flying: 8, chilled: 16, rage: 32, attacking: 64, autopilot: 128 } as const;

/** Most fighters a frame (and the roster) carries: phones only see this many at once. */
export const MAX_FRAME_FIGHTERS = 500;

const LIMITS = { f: MAX_FRAME_FIGHTERS, c: 30, p: 300, l: 30, x: 40 } as const;

/** Mirrored objects. `front`: everything after it is drawn in front of the fighters. */
export const OBJ = { graphics: 1, text: 2, rect: 3, circle: 4, push: 5, pop: 6, front: 7 } as const;
/** Values after the OBJ code (graphics/text: plus a variable-length tail, see below). */
export const OBJ_ARGS: Record<number, number> = {
  [OBJ.graphics]: 7, // x, y, rot, sx, sy, alpha, n  → then n command values
  [OBJ.text]: 12, // x, y, originX, originY, size, fill15, stroke15, strokeWidth, alpha, rot, font (FONT), n → then n char codes
  [OBJ.rect]: 10, // x, y, w, h, originX, originY, fill15, fillAlpha, alpha, rot
  [OBJ.circle]: 6, // x, y, r, fill15, fillAlpha, alpha
  [OBJ.push]: 6, // x, y, rot, sx, sy, alpha  (a container's transform)
  [OBJ.pop]: 0,
  [OBJ.front]: 0,
};

/** Graphics commands (same codes as Phaser's), and how many values follow each here. */
export const CMD = {
  arc: 0, // x, y, r, start, end, anticlockwise
  begin: 1,
  close: 2,
  fillRect: 3, // x, y, w, h
  lineTo: 4, // x, y
  moveTo: 5, // x, y
  lineStyle: 6, // width×10, colour15, alpha
  fillStyle: 7, // colour15, alpha
  fillPath: 8,
  strokePath: 9,
  fillTri: 10, // 6
  strokeTri: 11, // 6
  save: 14,
  restore: 15,
  translate: 16, // x, y
  scale: 17, // sx, sy (hundredths)
  rotate: 18, // mrad
} as const;
export const CMD_ARGS: Record<number, number> = { 0: 6, 1: 0, 2: 0, 3: 4, 4: 2, 5: 2, 6: 3, 7: 2, 8: 0, 9: 0, 10: 6, 11: 6, 14: 0, 15: 0, 16: 2, 17: 2, 18: 1 };

export const MAX_TEXT = 80;
/** Text font families. */
export const FONT = { mono: 0, sans: 1, serif: 2 } as const;
export const FONT_CSS = ['monospace', 'Arial, Helvetica, sans-serif', 'Georgia, serif'] as const;

// ---------------------------------------------------------------------------

/** 0xrrggbb → RGB555 (fits a positive int16). */
export function to15(c: number): number {
  return (((c >> 19) & 31) << 10) | (((c >> 11) & 31) << 5) | ((c >> 3) & 31);
}

/** RGB555 → "rgba(r,g,b,a)". */
export function css15(v: number, alpha = 1): string {
  const k = 255 / 31;
  return `rgba(${Math.round(((v >> 10) & 31) * k)},${Math.round(((v >> 5) & 31) * k)},${Math.round((v & 31) * k)},${alpha})`;
}

/** Builds a frame. Values are rounded and clamped to int16. */
export class FrameWriter {
  readonly buf = new Int16Array(MAX_FRAME_VALUES);
  n = 0;

  get room(): number {
    return MAX_FRAME_VALUES - this.n;
  }

  push(v: number): void {
    this.buf[this.n++] = v > 32767 ? 32767 : v < -32768 ? -32768 : Math.round(v) || 0;
  }

  /** Little-endian bytes, ready to send. */
  bytes(): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(this.n * 2);
    const dv = new DataView(out.buffer);
    for (let k = 0; k < this.n; k++) dv.setInt16(k * 2, this.buf[k], true);
    return out;
  }
}

export interface Frame {
  /** Host clock, ms (wraps at 2^32). */
  ms: number;
  zone: [number, number];
  /** [id, x, y, facing, hp, flags, weapon] */
  f: number[][];
  /** [x, y, isPowerup] */
  c: number[][];
  /** [x, y, colour15, radius] */
  p: number[][];
  /** [x1, y1, x2, y2, half, colour15] */
  l: number[][];
  /** [x, y, radius] */
  x: number[][];
  /** The mirror stream (see OBJ / CMD). */
  mirror: Int16Array;
}

function toInt16(bytes: Uint8Array): Int16Array | null {
  if (bytes.byteLength % 2 || bytes.byteLength > MAX_FRAME_BYTES || bytes.byteLength < 22) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Int16Array(bytes.byteLength / 2);
  for (let k = 0; k < out.length; k++) out[k] = dv.getInt16(k * 2, true);
  return out;
}

/** Decode (and fully check) a frame. Null if anything is off. */
export function decodeFrame(bytes: Uint8Array): Frame | null {
  const v = toInt16(bytes);
  if (!v || v[0] !== FRAME_MAGIC) return null;
  let i = 5;
  const ms = (v[1] & 0xffff) * 65536 + (v[2] & 0xffff);
  const zone: [number, number] = [v[3], v[4]];
  const section = (max: number, width: number, check?: (row: Int16Array) => boolean): number[][] | null => {
    if (i >= v.length) return null;
    const n = v[i++];
    if (n < 0 || n > max || i + n * width > v.length) return null;
    const rows: number[][] = [];
    for (let k = 0; k < n; k++, i += width) {
      const row = v.subarray(i, i + width);
      if (check && !check(row)) return null;
      rows.push(Array.from(row));
    }
    return rows;
  };
  const f = section(LIMITS.f, 7, (r) => r[0] >= 0 && Math.abs(r[3]) <= 1 && r[4] >= 0 && r[4] <= 100 && r[5] >= 0 && r[5] <= 255 && r[6] >= 0 && r[6] < 32);
  const c = f && section(LIMITS.c, 3, (r) => r[2] === 0 || r[2] === 1);
  const p = c && section(LIMITS.p, 4, (r) => r[2] >= 0 && r[3] >= 0);
  const l = p && section(LIMITS.l, 6, (r) => r[4] >= 0 && r[5] >= 0);
  const x = l && section(LIMITS.x, 3, (r) => r[2] >= 0);
  if (!x) return null;
  const mirror = v.subarray(i);
  if (!validMirror(mirror)) return null;
  return { ms, zone, f: f!, c: c!, p: p!, l: l!, x, mirror };
}

/** The relay server's check: well-formed, within limits. */
export function validFrame(bytes: Uint8Array): boolean {
  return decodeFrame(bytes) !== null;
}

function validMirror(m: Int16Array): boolean {
  let i = 0;
  let depth = 0;
  let fronts = 0;
  while (i < m.length) {
    const op = m[i++];
    const args = OBJ_ARGS[op];
    if (args === undefined || i + args > m.length) return false;
    if (op === OBJ.push) depth++;
    if (op === OBJ.pop && --depth < 0) return false;
    if (op === OBJ.front && (depth !== 0 || ++fronts > 1)) return false;
    if (op === OBJ.graphics) {
      const n = m[i + 6];
      i += args;
      if (n < 0 || i + n > m.length) return false;
      const end = i + n;
      while (i < end) {
        const a = CMD_ARGS[m[i++]];
        if (a === undefined || i + a > end) return false;
        i += a;
      }
      continue;
    }
    if (op === OBJ.text) {
      const font = m[i + 10];
      const n = m[i + 11];
      i += args;
      if (font < 0 || font >= FONT_CSS.length || n < 0 || n > MAX_TEXT || i + n > m.length) return false;
      i += n;
      continue;
    }
    i += args;
  }
  return depth === 0;
}
