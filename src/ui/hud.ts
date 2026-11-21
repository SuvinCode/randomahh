import Phaser from 'phaser';
import { ARENA, DEPTH } from '../config';

const STYLE = { fontFamily: 'monospace', color: '#ffffff', stroke: '#000000', strokeThickness: 4 } as const;

/** Top-left: fighters alive, match clock, storm status. Centre: announcements. */
export class Hud {
  private readonly alive: Phaser.GameObjects.Text;
  private readonly clock: Phaser.GameObjects.Text;
  private readonly storm: Phaser.GameObjects.Text;
  private announceY = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    arenaName: string,
  ) {
    this.alive = scene.add.text(12, 8, '', { ...STYLE, fontSize: '18px', fontStyle: 'bold' }).setDepth(DEPTH.hud);
    this.clock = scene.add.text(12, 32, '', { ...STYLE, fontSize: '13px' }).setDepth(DEPTH.hud);
    this.storm = scene.add.text(12, 50, '', { ...STYLE, fontSize: '12px', color: '#d0a8ff' }).setDepth(DEPTH.hud);
    const name = scene.add.text(ARENA.width / 2, 8, arenaName, { ...STYLE, fontSize: '12px', color: '#dddddd' }).setOrigin(0.5, 0).setDepth(DEPTH.hud);
    scene.tweens.add({ targets: name, alpha: 0.35, delay: 3000, duration: 800 });
  }

  set(alive: number, total: number, elapsedMs: number, stormText: string): void {
    this.alive.setText(`👥 ${alive} / ${total} alive`);
    const s = Math.floor(elapsedMs / 1000);
    this.clock.setText(`⏱ ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
    this.storm.setText(stormText);
  }

  /** Big centred callout that floats up and fades. Several stack instead of overlapping. */
  announce(text: string, color = 0xffd23f, size = 28): void {
    const y = 150 + this.announceY * 36;
    this.announceY = (this.announceY + 1) % 4;
    const t = this.scene.add
      .text(ARENA.width / 2, y, text, {
        ...STYLE,
        fontSize: `${size}px`,
        fontStyle: 'bold',
        strokeThickness: 6,
        color: Phaser.Display.Color.IntegerToColor(color).rgba,
        align: 'center',
        wordWrap: { width: ARENA.width - 80 },
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.banner)
      .setScale(0.4);
    this.scene.tweens.add({ targets: t, scale: 1, duration: 180, ease: 'Back.Out' });
    this.scene.tweens.add({ targets: t, alpha: 0, y: y - 30, delay: 1600, duration: 500, onComplete: () => t.destroy() });
  }
}
