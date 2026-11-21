import Phaser from 'phaser';
import { sfx } from '../audio/sfx';
import { boxHitsRect } from '../battle/geometry';
import type { BattleContext, Target } from '../battle/types';
import type { Fighter } from '../fighters/fighter';
import { WEAPONS } from './defs';

/** Can the fighter hit this target from here with their current weapon? */
export function inRange(f: Fighter, t: Target): boolean {
  const w = WEAPONS[f.weapon];
  const dx = Math.abs(t.x - f.x);
  const dy = Math.abs(t.y - f.y);
  if (w.kind === 'melee') return dx < w.range + 10 && dy < 34;
  return Math.hypot(dx, dy) < w.range;
}

/**
 * Attack toward `t` (a target, or just a point) with the fighter's weapon. Aim
 * is deliberately sloppy (these are chaotic little brawlers). Call only when
 * the weapon is ready.
 */
export function attack(f: Fighter, t: { x: number; y: number }, ctx: BattleContext): void {
  const w = WEAPONS[f.weapon];
  const by = f.attacker();
  const dmg = w.damage * f.damageMult;
  f.facing = t.x >= f.x ? 1 : -1;
  const hx = f.x + f.facing * 10;
  const hy = f.y - 2;

  switch (w.kind) {
    case 'melee': {
      f.swingMs = 180;
      sfx.play('slash');
      const reach = w.range;
      const left = f.facing === 1 ? f.x : f.x - reach;
      for (const other of ctx.targets()) {
        if (other === f || !boxHitsRect(other.bounds(), left, f.y - 26, reach, 44)) continue;
        ctx.damage(other, dmg, by, { fromX: f.x, knock: w.knock, lift: w.knock * 0.6 });
      }
      return;
    }
    case 'gun': {
      f.muzzleMs = 70;
      sfx.play('shoot');
      // Lead a little toward where the target is heading, plus some wobble.
      const aim = Math.atan2(t.y - hy, t.x - hx) + ctx.rng.realInRange(-0.06, 0.06);
      for (let k = 0; k < (w.pellets ?? 1); k++) {
        const a = aim + ctx.rng.realInRange(-(w.spread ?? 0), w.spread ?? 0);
        ctx.projectiles.fire({
          kind: 'bullet', x: hx, y: hy, vx: Math.cos(a) * w.speed!, vy: Math.sin(a) * w.speed!,
          damage: dmg, radius: f.weapon === 'sniper' ? 3 : 2.5, color: w.color, by, owner: f, knock: w.knock,
          lifeMs: (w.range * 1.6 * 1000) / w.speed!,
        });
      }
      return;
    }
    case 'laser': {
      f.muzzleMs = 140;
      sfx.play('laser');
      const a = Math.atan2(t.y - hy, t.x - hx) + ctx.rng.realInRange(-0.05, 0.05);
      ctx.beam(hx, hy, hx + Math.cos(a) * w.range, hy + Math.sin(a) * w.range, 5, dmg, by, w.color, f);
      return;
    }
    case 'rocket': {
      f.muzzleMs = 120;
      sfx.play('shoot');
      const a = Math.atan2(t.y - hy, t.x - hx) + ctx.rng.realInRange(-0.08, 0.08);
      ctx.projectiles.fire({
        kind: 'rocket', x: hx, y: hy, vx: Math.cos(a) * w.speed!, vy: Math.sin(a) * w.speed!,
        damage: dmg, radius: 5, color: w.color, by, owner: f, explodeRadius: w.blast, lifeMs: 3000,
      });
      return;
    }
  }
}

/** Draw the held weapon (and swing/muzzle flashes) for one fighter. */
export function drawWeapon(g: Phaser.GameObjects.Graphics, f: Fighter): void {
  const w = WEAPONS[f.weapon];
  const d = f.facing;
  const hx = f.x + d * 8;
  const hy = f.y + 1;
  switch (w.kind) {
    case 'melee': {
      // Resting: pointing up-forward. Swinging: sweeps down through an arc.
      const swing = f.swingMs > 0 ? 1 - f.swingMs / 180 : 0;
      const ang = (d === 1 ? -Math.PI / 3 : (-2 * Math.PI) / 3) + d * swing * 2.2;
      const len = f.weapon === 'hammer' ? 22 : 24;
      const ex = hx + Math.cos(ang) * len;
      const ey = hy + Math.sin(ang) * len;
      g.lineStyle(f.weapon === 'hammer' ? 3 : 3, f.weapon === 'hammer' ? 0x6b4226 : 0xbbbbbb, 1).lineBetween(hx, hy, ex, ey);
      if (f.weapon === 'hammer') g.fillStyle(0x777777, 1).fillRect(ex - 6, ey - 5, 12, 10);
      else g.lineStyle(2, 0xffffff, 1).lineBetween(hx + Math.cos(ang) * 6, hy + Math.sin(ang) * 6, ex, ey);
      if (f.swingMs > 0) {
        g.lineStyle(3, 0xffffff, 0.5 * (f.swingMs / 180));
        g.beginPath();
        g.arc(hx, hy, len, ang - d * 1.2, ang, d === -1);
        g.strokePath();
      }
      return;
    }
    default: {
      const len = f.weapon === 'sniper' ? 22 : f.weapon === 'rocket' ? 20 : f.weapon === 'pistol' ? 10 : 15;
      const thick = f.weapon === 'rocket' ? 6 : f.weapon === 'shotgun' || f.weapon === 'minigun' ? 4 : 3;
      g.lineStyle(thick + 2, 0x111111, 1).lineBetween(hx, hy, hx + d * len, hy);
      g.lineStyle(thick, w.kind === 'laser' ? w.color : 0x555555, 1).lineBetween(hx, hy, hx + d * len, hy);
      if (f.muzzleMs > 0) g.fillStyle(w.color, 0.9).fillCircle(hx + d * (len + 4), hy, 4 + Phaser.Math.Between(0, 2));
    }
  }
}
