import Phaser from 'phaser';
import { DEPTH, TEXTURES } from './config';

/**
 * Per-scene visual juice: particle bursts and camera effects. Two emitters,
 * re-tinted per burst, so it's cheap to call often.
 */
export class Juice {
  private readonly emitter: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly smoke: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor(private readonly scene: Phaser.Scene) {
    this.emitter = scene.add
      .particles(0, 0, TEXTURES.spark, {
        speed: { min: 90, max: 300 },
        angle: { min: 0, max: 360 },
        lifespan: { min: 260, max: 600 },
        scale: { start: 1.1, end: 0 },
        alpha: { start: 1, end: 0 },
        gravityY: 700,
        emitting: false,
      })
      .setDepth(DEPTH.particles);
    this.smoke = scene.add
      .particles(0, 0, TEXTURES.spark, {
        speed: { min: 20, max: 120 },
        angle: { min: 0, max: 360 },
        lifespan: { min: 400, max: 900 },
        scale: { start: 2.6, end: 0.5 },
        alpha: { start: 0.55, end: 0 },
        gravityY: -60,
        emitting: false,
      })
      .setDepth(DEPTH.particles - 1);
  }

  /** Sparks in a colour (hits, impacts). */
  burst(x: number, y: number, color: number, count = 14): void {
    this.emitter.setParticleTint(color);
    this.emitter.explode(count, x, y);
  }

  /** An explosion: fireball sparks, smoke, flash and shake scaled by radius. */
  explosion(x: number, y: number, radius: number, color = 0xffa53d): void {
    this.burst(x, y, color, Math.min(60, 12 + radius / 3));
    this.burst(x, y, 0xffffff, 8);
    this.smoke.setParticleTint(0x555555);
    this.smoke.explode(Math.min(30, 6 + radius / 8), x, y);
    const ring = this.scene.add.circle(x, y, radius * 0.35, color, 0.55).setDepth(DEPTH.particles);
    this.scene.tweens.add({ targets: ring, scale: 2.9, alpha: 0, duration: 320, onComplete: () => ring.destroy() });
    this.shake(Math.min(500, 120 + radius * 1.5), Math.min(0.02, 0.003 + radius / 12000));
  }

  /** A fighter is out: a pop in their colour. */
  knockout(x: number, y: number, color: number): void {
    this.burst(x, y, color, 30);
    this.burst(x, y, 0xffffff, 10);
  }

  shake(ms: number, intensity: number): void {
    this.scene.cameras.main.shake(ms, intensity);
  }

  flash(ms: number, color = 0xffffff): void {
    const c = Phaser.Display.Color.IntegerToColor(color);
    this.scene.cameras.main.flash(ms, c.red, c.green, c.blue, true);
  }
}
