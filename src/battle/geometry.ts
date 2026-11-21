import Phaser from 'phaser';
import type { Box } from './types';

/** Does a circle touch the box? */
export function boxHitsCircle(b: Box, x: number, y: number, r: number): boolean {
  const cx = Phaser.Math.Clamp(x, b.left, b.right);
  const cy = Phaser.Math.Clamp(y, b.top, b.bottom);
  return (cx - x) ** 2 + (cy - y) ** 2 < r * r;
}

/** Does a thick segment (half-thickness `half`) touch the box? Sampled along its length. */
export function boxHitsSegment(b: Box, x1: number, y1: number, x2: number, y2: number, half: number): boolean {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.max(1, Math.ceil(len / Math.max(4, half)));
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    if (boxHitsCircle(b, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, half)) return true;
  }
  return false;
}

export function boxHitsRect(b: Box, x: number, y: number, w: number, h: number): boolean {
  return b.right > x && b.left < x + w && b.bottom > y && b.top < y + h;
}

/** Flashing alpha for warnings drawn with Graphics. */
export function blink(ms: number, lo = 0.3, hi = 1): number {
  return Math.floor(ms / 110) % 2 === 0 ? hi : lo;
}
