import Phaser from 'phaser';
import { FIGHTER, TEXTURES } from './config';

/** Hex string "#rrggbb" → 0xrrggbb. */
export function hex(color: string): number {
  return Phaser.Display.Color.HexStringToColor(color).color;
}

/** Draw with Graphics and bake into a texture (replacing any old one with that key). */
export function bake(scene: Phaser.Scene, key: string, w: number, h: number, draw: (g: Phaser.GameObjects.Graphics) => void) {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const g = scene.add.graphics();
  draw(g);
  g.generateTexture(key, w, h);
  g.destroy();
}

/** Textures that never change. Called once from Boot. */
export function makeStaticTextures(scene: Phaser.Scene): void {
  bake(scene, TEXTURES.spark, 8, 8, (g) => g.fillStyle(0xffffff, 1).fillCircle(4, 4, 4));
}

/** A fighter's body in their own colour: a little bean with eyes and a headband. */
export function fighterTexture(scene: Phaser.Scene, key: string, color: number): void {
  const w = FIGHTER.width;
  const h = FIGHTER.height;
  const dark = Phaser.Display.Color.IntegerToColor(color).darken(35).color;
  bake(scene, key, w, h, (g) => {
    g.fillStyle(0x000000, 1).fillRoundedRect(0, 0, w, h, 7);
    g.fillStyle(color, 1).fillRoundedRect(2, 2, w - 4, h - 4, 6);
    g.fillStyle(dark, 1).fillRect(2, 6, w - 4, 4);
    g.fillStyle(0xffffff, 1).fillRect(w - 10, 11, 4, 6).fillRect(w - 5, 11, 3, 6);
    g.fillStyle(0x111111, 1).fillRect(w - 8, 13, 2, 3).fillRect(w - 4, 13, 2, 3);
    g.fillStyle(dark, 1).fillRect(4, h - 6, 5, 4).fillRect(w - 9, h - 6, 5, 4);
  });
}

/** Evenly spread, bright colours for n fighters (golden-angle hues). */
export function fighterColors(n: number, offset = 0): number[] {
  return Array.from({ length: n }, (_, k) => {
    const hue = (offset + k * 0.381966) % 1;
    // Light enough to read as text on the dark UI (deep blues get extra lightness).
    const blueish = hue > 0.55 && hue < 0.8 ? 0.08 : 0;
    const light = (k % 3 === 0 ? 0.62 : k % 3 === 1 ? 0.56 : 0.7) + blueish;
    return Phaser.Display.Color.HSLToColor(hue, 0.9, light).color;
  });
}
