import Phaser from 'phaser';
import { ARENA, DEPTH } from '../config';

const MAX = 6;
const LIFE_MS = 7000;
const ROW = 20;

interface Entry {
  row: Phaser.GameObjects.Container;
  ms: number;
}

const css = (c: number) => Phaser.Display.Color.IntegerToColor(c).rgba;

/**
 * Top-right list of eliminations: "Killer 🔫 Victim", newest on top, each in
 * its fighter's colour. Old entries fade out.
 */
export class KillFeed {
  private entries: Entry[] = [];

  constructor(private readonly scene: Phaser.Scene) {}

  add(parts: { text: string; color?: number }[]): void {
    const texts = parts.map((p) =>
      this.scene.add
        .text(0, 0, p.text, {
          fontFamily: 'monospace',
          fontSize: '13px',
          fontStyle: 'bold',
          color: p.color === undefined ? '#ffffff' : css(p.color),
          stroke: '#000000',
          strokeThickness: 4,
        })
        .setOrigin(1, 0),
    );
    // Lay out right-to-left.
    let x = 0;
    for (let k = texts.length - 1; k >= 0; k--) {
      texts[k].setX(x);
      x -= texts[k].width + 6;
    }
    const bg = this.scene.add.rectangle(4, -2, -x + 8, ROW, 0x000000, 0.45).setOrigin(1, 0);
    const row = this.scene.add.container(ARENA.width - 10, 10, [bg, ...texts]).setDepth(DEPTH.hud);
    row.setAlpha(0);
    this.scene.tweens.add({ targets: row, alpha: 1, duration: 150 });
    this.entries.unshift({ row, ms: 0 });
    while (this.entries.length > MAX) this.entries.pop()!.row.destroy();
    this.layout();
  }

  update(dt: number): void {
    for (let k = this.entries.length - 1; k >= 0; k--) {
      const e = this.entries[k];
      e.ms += dt;
      if (e.ms > LIFE_MS) {
        e.row.destroy();
        this.entries.splice(k, 1);
      } else if (e.ms > LIFE_MS - 600) e.row.setAlpha((LIFE_MS - e.ms) / 600);
    }
  }

  private layout(): void {
    this.entries.forEach((e, k) => e.row.setY(10 + k * (ROW + 3)));
  }
}
