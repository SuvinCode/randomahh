import Phaser from 'phaser';
import { POWERUPS, POWERUP_TYPES, type PowerupType } from '@shared/commands';
import type { Fighter } from '../fighters/fighter';

/**
 * Powerup tuning. Each lasts `durationMs` from pickup; picking the same one up
 * again refreshes it. Effects live in Fighter (movement, damage) and the brain
 * (flight, teleport, invisibility); drawPowerups() shows them.
 */
export const POWERUP_DEFS: Record<PowerupType, { durationMs: number; color: number }> = {
  speed: { durationMs: 10_000, color: 0xfff275 },
  flight: { durationMs: 10_000, color: 0x9be7ff },
  teleport: { durationMs: 12_000, color: 0xb388ff },
  shield: { durationMs: 15_000, color: 0x4cc9f0 },
  rage: { durationMs: 10_000, color: 0xff4d4d },
  regen: { durationMs: 10_000, color: 0x7dff9a },
  invisible: { durationMs: 8_000, color: 0xdddddd },
};

/** Tunables for the effects themselves. */
export const POWER = {
  speedMult: 1.85,
  /** Flying fighters drift toward a height at up to this speed (px/s). */
  flySpeed: 230,
  teleportEveryMs: [1800, 3000] as const,
  shieldHp: 60,
  rageDamage: 2,
  rageCooldown: 0.6,
  regenPerSec: 7,
} as const;

export function randomPowerup(rand: () => number): PowerupType {
  return POWERUP_TYPES[Math.floor(rand() * POWERUP_TYPES.length)];
}

export const powerupLabel = (p: PowerupType) => `${POWERUPS[p].emoji} ${POWERUPS[p].name}`;

/** Auras and gadgets for a fighter's active powerups (drawn each frame). */
export function drawPowerups(g: Phaser.GameObjects.Graphics, f: Fighter, timeMs: number): void {
  const x = f.x;
  const y = f.y;
  if (f.has('rage')) {
    g.fillStyle(0xff4d4d, 0.18 + 0.1 * Math.sin(timeMs / 80)).fillCircle(x, y, 20);
  }
  if (f.has('speed')) {
    // Afterimage streaks behind them.
    const d = -Math.sign(f.body.velocity.x || f.facing);
    g.lineStyle(2, 0xfff275, 0.7);
    for (let k = 0; k < 3; k++) g.lineBetween(x + d * (14 + k * 5), y - 8 + k * 7, x + d * (26 + k * 8), y - 8 + k * 7);
  }
  if (f.has('flight')) {
    // Wings that flap, plus a little jet flame.
    const flap = Math.sin(timeMs / 60) * 6;
    g.fillStyle(0xffffff, 0.9);
    g.fillTriangle(x - 4, y - 6, x - 22, y - 14 - flap, x - 10, y + 2);
    g.fillTriangle(x + 4, y - 6, x + 22, y - 14 - flap, x + 10, y + 2);
    g.fillStyle(0xffa53d, Phaser.Math.FloatBetween(0.5, 1)).fillTriangle(x - 5, y + 13, x + 5, y + 13, x, y + 22 + Phaser.Math.Between(0, 6));
  }
  if (f.has('shield') && f.shieldHp > 0) {
    const a = 0.25 + 0.5 * (f.shieldHp / POWER.shieldHp);
    g.lineStyle(2, 0x4cc9f0, a).strokeCircle(x, y, 21);
    g.fillStyle(0x4cc9f0, a * 0.25).fillCircle(x, y, 21);
  }
  if (f.has('regen') && Math.floor(timeMs / 200) % 2 === 0) {
    const ox = ((timeMs / 7) % 24) - 12;
    g.fillStyle(0x7dff9a, 0.9).fillRect(x + ox - 1, y - 24, 3, 9).fillRect(x + ox - 4, y - 21, 9, 3);
  }
  if (f.has('teleport')) {
    g.lineStyle(2, 0xb388ff, 0.6).strokeEllipse(x, f.body.bottom, 30 + 4 * Math.sin(timeMs / 90), 8);
  }
}
