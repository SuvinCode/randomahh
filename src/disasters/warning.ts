import type Phaser from 'phaser';
import { blink } from '../battle/geometry';

/** A flashing arrow pointing left/right, drawn into a Graphics. */
export function arrowAt(g: Phaser.GameObjects.Graphics, x: number, y: number, dir: 1 | -1, color: number, ms: number): void {
  const s = 14;
  g.fillStyle(color, blink(ms)).fillTriangle(x - dir * s, y - s, x - dir * s, y + s, x + dir * s, y);
  g.lineStyle(2, 0x000000, 0.8).strokeTriangle(x - dir * s, y - s, x - dir * s, y + s, x + dir * s, y);
}
