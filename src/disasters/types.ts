import type { DisasterType } from '@shared/commands';
import type { Attacker, BattleContext } from '../battle/types';
import type { Fighter } from '../fighters/fighter';

export interface DisasterSpec {
  type: DisasterType;
  /** Already clamped to the catalog's maxCount. */
  count: number;
  /** A named fighter to aim at, if the host named one (they may die before it lands). */
  target?: Fighter;
  /** Credit for the kill feed: label or catalog name + emoji. */
  by: Attacker;
}

/** One running disaster. Ends itself: `update` returns false when it's over. */
export interface Disaster {
  update(dt: number): boolean;
  destroy(): void;
}

export type DisasterFactory = (ctx: BattleContext, spec: DisasterSpec) => Disaster;

/** The named fighter if still alive, otherwise a random living one. */
export function aimAt(ctx: BattleContext, spec: DisasterSpec): Fighter | undefined {
  if (spec.target?.alive) return spec.target;
  const all = ctx.fighters();
  return all.length ? ctx.rng.pick(all) : undefined;
}
