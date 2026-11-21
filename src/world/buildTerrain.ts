import { ARENA } from '../config';
import type { ArenaLayout } from './theme';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TerrainShape {
  /** Thick floor, drawn in the palette's `ground` colour. Always spans the arena: nobody falls out. */
  ground: Rect[];
  /** One-way ledges, drawn in the palette's `platform` colour. */
  platforms: Rect[];
}

const W = ARENA.width;
const H = ARENA.height;
const G = ARENA.groundHeight;
const P = 14;
const floor = (): Rect[] => [{ x: 0, y: H - G, width: W, height: G }];
const ledge = (x: number, y: number, width: number): Rect => ({ x, y, width, height: P });

/** Arena layout name → rectangles. Pure data, no Phaser. */
export function buildTerrain(layout: ArenaLayout): TerrainShape {
  switch (layout) {
    case 'classic':
      return {
        ground: floor(),
        platforms: [ledge(110, 385, 190), ledge(660, 385, 190), ledge(385, 295, 190), ledge(50, 210, 150), ledge(760, 210, 150), ledge(400, 140, 160)],
      };
    case 'towers':
      return {
        ground: floor(),
        platforms: [
          ledge(60, 400, 120), ledge(60, 300, 120), ledge(60, 200, 120),
          ledge(780, 400, 120), ledge(780, 300, 120), ledge(780, 200, 120),
          ledge(330, 340, 300), ledge(400, 220, 160),
        ],
      };
    case 'steps':
      return {
        ground: floor(),
        platforms: [ledge(60, 420, 160), ledge(240, 350, 160), ledge(420, 280, 120), ledge(560, 350, 160), ledge(740, 420, 160), ledge(140, 200, 140), ledge(680, 200, 140)],
      };
  }
}

/** Every surface top a fighter can stand on (floor first). */
export function standingTops(t: TerrainShape): Rect[] {
  return [...t.ground, ...t.platforms];
}
