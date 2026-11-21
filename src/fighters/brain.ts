import type Phaser from 'phaser';
import type { BattleContext, Target } from '../battle/types';
import type { Rect } from '../world/buildTerrain';
import { inRange } from '../weapons/attack';
import { COMBAT_ENABLED } from '../config';
import { WEAPONS } from '../weapons/defs';
import type { Fighter } from './fighter';

/**
 * A fighter's mood. Each fighter mostly wanders at random and every so often
 * decides to go after someone; how often depends on its personality. It
 * always shoots/swings at whoever is in range, and heads inside the storm.
 */
export interface Brain {
  /** 0..1: how often it hunts instead of wandering. */
  aggression: number;
  /** 0..1: how often it jumps around for no reason. */
  bounciness: number;
  mode: 'wander' | 'hunt';
  modeMs: number;
  wanderX: number;
  enemy: Target | null;
  enemyMs: number;
  stuckMs: number;
  lastX: number;
  /** Preferred cruising height while flying. */
  flyY: number;
  /** Heading for a crate at this x (null = not looting). */
  lootX: number | null;
}

export interface Plan {
  dir: -1 | 0 | 1;
  jump: boolean;
  /** Height to hover at when flying. */
  flyY: number;
  /** Attack this target if the weapon is ready and it's in range. */
  target: Target | null;
  /** Players only: attack toward this point now (aim already chosen). */
  aim?: { x: number; y: number } | null;
}

export function newBrain(rng: Phaser.Math.RandomDataGenerator): Brain {
  return {
    aggression: rng.realInRange(0.25, 0.7),
    bounciness: rng.realInRange(0.2, 1),
    mode: 'wander',
    modeMs: 0,
    wanderX: rng.between(40, 920),
    enemy: null,
    enemyMs: 0,
    stuckMs: 0,
    lastX: 0,
    flyY: rng.between(90, 380),
    lootX: null,
  };
}

export function think(f: Fighter, ctx: BattleContext, dt: number): Plan {
  const b = f.brain;
  const { rng } = ctx;
  // Invisible fighters are ignored (but stray shots still hit them).
  const others = ctx.targets().filter((t) => t !== f && !t.hidden);

  // Pick (or re-pick) someone to care about: usually the nearest, sometimes anyone.
  b.enemyMs -= dt;
  if (!b.enemy || !b.enemy.alive || b.enemyMs <= 0) {
    b.enemyMs = rng.between(900, 2400);
    if (others.length === 0) b.enemy = null;
    else if (rng.frac() < 0.7) b.enemy = nearest(f, others);
    else b.enemy = rng.pick(others);
  }

  b.modeMs -= dt;
  if (b.modeMs <= 0) {
    b.modeMs = rng.between(1200, 3600);
    // Survival mode: nobody can hurt anybody, so just roam around.
    b.mode = COMBAT_ENABLED && rng.frac() < b.aggression ? 'hunt' : 'wander';
    b.wanderX = rng.between(30, 930);
    b.flyY = rng.between(70, ctx.floorY - 60);
    // Sometimes go grab a crate that's not too far away.
    const crate = ctx.crates().find((c) => Math.abs(c.x - f.x) < 320);
    b.lootX = crate && rng.frac() < 0.55 ? crate.x : null;
  }
  if (b.lootX !== null && !ctx.crates().some((c) => Math.abs(c.x - b.lootX!) < 2)) b.lootX = null;
  // Spot a crate that just landed nearby (a few times a second, some fighters go for it).
  if (b.lootX === null && rng.frac() < 1.2 * (dt / 1000)) {
    const crate = ctx.crates().find((c) => Math.abs(c.x - f.x) < 380);
    if (crate) b.lootX = crate.x;
  }

  let goal = b.wanderX;
  const [zl, zr] = ctx.zone();
  const lavaLedge = ctx.effects.lavaFloor && !f.flying ? safeLedge(f, ctx) : null;
  if (lavaLedge) {
    // The floor is lava: get onto (or stay on) the nearest reachable ledge.
    goal = lavaLedge.x + lavaLedge.width / 2;
  } else if (f.x < zl + 24 || f.x > zr - 24) {
    goal = (zl + zr) / 2; // get out of the storm
  } else if (b.lootX !== null) {
    goal = b.lootX;
  } else if (b.mode === 'hunt' && b.enemy) {
    const w = WEAPONS[f.weapon];
    const keep = w.kind === 'melee' ? 0 : w.range * rng.realInRange(0.35, 0.6);
    const side = f.x < b.enemy.x ? -1 : 1;
    goal = b.enemy.x + side * keep;
  }
  goal = Math.min(Math.max(goal, zl + 10), zr - 10);
  const dx = goal - f.x;
  const dir: -1 | 0 | 1 = Math.abs(dx) < 10 ? 0 : dx > 0 ? 1 : -1;
  if (dir === 0 && b.mode === 'wander') b.wanderX = rng.between(30, 930);

  // Jumping: to reach someone above, when stuck against something, or just because.
  b.stuckMs = dir !== 0 && Math.abs(f.x - b.lastX) < 0.3 ? b.stuckMs + dt : 0;
  b.lastX = f.x;
  let jump = rng.frac() < b.bounciness * 0.6 * (dt / 1000);
  if (b.stuckMs > 250) jump = true;
  if (lavaLedge && f.body.bottom > lavaLedge.y + 2 && Math.abs(dx) < 50) jump = true;
  if (b.mode === 'hunt' && b.enemy && b.enemy.y < f.y - 50 && Math.abs(b.enemy.x - f.x) < 220) jump = rng.frac() < 2.5 * (dt / 1000) || jump;

  // Attack the chosen enemy if possible, otherwise anyone in range.
  let target: Target | null = null;
  if (b.enemy && inRange(f, b.enemy)) target = b.enemy;
  else target = others.find((o) => inRange(f, o)) ?? null;

  // Flyers swoop to their enemy's height when hunting, else cruise.
  let flyY = b.flyY;
  if (b.mode === 'hunt' && b.enemy) flyY = b.enemy.y - 6;
  if (b.lootX !== null) {
    const c = ctx.crates().find((k) => Math.abs(k.x - b.lootX!) < 2);
    if (c) {
      flyY = c.y;
      if (c.y < f.y - 50 && Math.abs(c.x - f.x) < 160) jump = true;
    }
  }
  flyY = Math.min(Math.max(flyY, 40), ctx.floorY - 20);

  return { dir, jump, target, flyY };
}

/** Ledge to escape lava onto: the one they're on, else the nearest one a jump can reach. */
function safeLedge(f: Fighter, ctx: BattleContext): Rect | null {
  const b = f.body;
  const on = ctx.terrain.platforms.find((p) => Math.abs(b.bottom - p.y) < 4 && b.right > p.x && b.left < p.x + p.width);
  if (on) return on;
  const reachable = ctx.terrain.platforms.filter((p) => p.y >= ctx.floorY - 125);
  let best: Rect | null = null;
  for (const p of reachable) {
    if (!best || Math.abs(p.x + p.width / 2 - f.x) < Math.abs(best.x + best.width / 2 - f.x)) best = p;
  }
  return best;
}

function nearest(f: Fighter, list: Target[]): Target {
  let best = list[0];
  let bestD = Infinity;
  for (const t of list) {
    const d = (t.x - f.x) ** 2 + ((t.y - f.y) * 1.5) ** 2;
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
}
