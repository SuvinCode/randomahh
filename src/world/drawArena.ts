import Phaser from 'phaser';
import type { Palette } from './theme';
import { hex } from '../textures';
import type { TerrainShape } from './buildTerrain';

export interface ArenaBodies {
  /** Solid from every side. */
  ground: Phaser.Physics.Arcade.StaticGroup;
  /** One-way ledges: you can jump up through them and land on top. */
  platforms: Phaser.Physics.Arcade.StaticGroup;
}

/** Creates coloured, collidable rectangles for the terrain. */
export function drawTerrain(scene: Phaser.Scene, shape: TerrainShape, palette: Palette): ArenaBodies {
  const ground = scene.physics.add.staticGroup();
  const platforms = scene.physics.add.staticGroup();
  const add = (
    group: Phaser.Physics.Arcade.StaticGroup,
    r: { x: number; y: number; width: number; height: number },
    color: string,
    trim: number,
  ) => {
    const rect = scene.add
      .rectangle(r.x + r.width / 2, r.y + r.height / 2, r.width, r.height, hex(color))
      .setStrokeStyle(2, 0x000000, 0.35);
    scene.physics.add.existing(rect, true);
    group.add(rect);
    // Lighter top edge so ledges read clearly. Kept on the rect so obstacles can hide it too.
    const top = scene.add.rectangle(r.x + r.width / 2, r.y + trim / 2, r.width, trim, 0xffffff, 0.18);
    rect.setData('trim', top);
  };
  shape.ground.forEach((r) => add(ground, r, palette.ground, 6));
  shape.platforms.forEach((r) => add(platforms, r, palette.platform, 4));
  return { ground, platforms };
}

/**
 * Process callback for one-way ledges: only collide while falling and when the
 * body's feet were above the ledge top on the previous step.
 */
export function landsOnTop(body: Phaser.Physics.Arcade.Body, top: number): boolean {
  return body.velocity.y >= 0 && body.prev.y + body.height <= top + 2;
}

/** Top edge of a ledge game object's physics body. */
export function topOf(obj: unknown): number {
  return ((obj as Phaser.GameObjects.GameObject).body as Phaser.Physics.Arcade.Body | Phaser.Physics.Arcade.StaticBody).top;
}
