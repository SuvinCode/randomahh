import Phaser from 'phaser';
import { POWERUPS, type PowerupType, type WeaponType } from '@shared/commands';
import { BTN } from '@shared/room';
import { sfx } from '../audio/sfx';
import { standingTops } from '../world/buildTerrain';
import { POWER, POWERUP_DEFS } from '../powerups/defs';
import { COMBAT_ENABLED, DEPTH, FIGHTER, POWERUPS_ENABLED } from '../config';
import type { Attacker, BattleContext, Box, Target } from '../battle/types';
import { fighterTexture } from '../textures';
import { attack, inRange } from '../weapons/attack';
import { WEAPONS } from '../weapons/defs';
import { newBrain, think, type Brain, type Plan } from './brain';

let nextId = 1;

/** Players' fighters all move and jump the same (bots get a random spread). */
const PLAYER_SPEED = 155;
const PLAYER_JUMP = 570;

/**
 * One brawler. Bots move on their own (see brain.ts); a player's fighter
 * (`pilot` = their id) follows their controller's buttons, and falls back to
 * the brain while they're disconnected. Carries one weapon, and has health. Damage only ever arrives through BattleContext.damage,
 * which calls applyDamage and handles kill credit.
 */
export class Fighter implements Target {
  readonly id = nextId++;
  readonly isBoss = false;
  readonly sprite: Phaser.Physics.Arcade.Sprite;
  readonly tag: Phaser.GameObjects.Text;
  hp: number = FIGHTER.maxHp;
  weapon: WeaponType;
  kills = 0;
  /** Times of recent kills, for multi-kill callouts. */
  recentKills: number[] = [];
  facing: 1 | -1 = 1;
  swingMs = 0;
  muzzleMs = 0;
  readonly speed: number;
  readonly jumpPower: number;
  readonly brain: Brain;
  private cooldownMs: number;
  private stunMs = 0;
  private flashMs = 0;
  private moveVx = 0;
  private extVx = 0;
  private dead = false;
  /** Active powerups → ms left. */
  readonly powerups = new Map<PowerupType, number>();
  shieldHp = 0;
  private teleportMs = 0;
  /** Blizzard etc.: slowed while > 0. */
  private chillMs = 0;
  /** Buttons the pilot holds (BTN bits); null = no pilot connected, the brain drives. */
  buttons: number | null = null;

  constructor(
    scene: Phaser.Scene,
    readonly name: string,
    readonly color: number,
    x: number,
    y: number,
    weapon: WeaponType,
    rng: Phaser.Math.RandomDataGenerator,
    /** Player id when a person controls this fighter. */
    readonly pilot: string | null = null,
  ) {
    const key = `fighter-${this.id}`;
    fighterTexture(scene, key, color);
    this.sprite = scene.physics.add.sprite(x, y, key).setOrigin(0.5, 1).setDepth(DEPTH.fighter);
    this.sprite.setCollideWorldBounds(true);
    this.body.setSize(FIGHTER.width - 2, FIGHTER.height - 2).setOffset(1, 2);
    this.body.setMaxVelocityY(1100);
    this.tag = scene.add
      .text(x, y, name, { fontFamily: 'monospace', fontSize: '10px', color: '#ffffff', stroke: '#000000', strokeThickness: 3 })
      .setOrigin(0.5, 1)
      .setDepth(DEPTH.tags);
    this.weapon = weapon;
    this.speed = pilot ? PLAYER_SPEED : rng.between(FIGHTER.speedMin, FIGHTER.speedMax);
    this.jumpPower = pilot ? PLAYER_JUMP : rng.between(FIGHTER.jumpMin, FIGHTER.jumpMax);
    // Nobody attacks in the first couple of seconds: time to see who's who.
    this.cooldownMs = pilot ? 1500 : rng.between(2000, 3200);
    this.brain = newBrain(rng);
    this.facing = rng.frac() < 0.5 ? 1 : -1;
  }

  get body(): Phaser.Physics.Arcade.Body {
    return this.sprite.body as Phaser.Physics.Arcade.Body;
  }
  get alive(): boolean {
    return !this.dead;
  }
  get x(): number {
    return this.body.center.x;
  }
  get y(): number {
    return this.body.center.y;
  }
  /** Invisible fighters aren't targeted by other fighters (they can still be hit). */
  get hidden(): boolean {
    return this.has('invisible');
  }
  get damageMult(): number {
    return this.has('rage') ? POWER.rageDamage : 1;
  }
  get flying(): boolean {
    return this.has('flight');
  }
  /** Powerups are off (POWERUPS_ENABLED); when on, only bots get them (they'd fight a player's controls). */
  get canPowerUp(): boolean {
    return POWERUPS_ENABLED && this.pilot === null;
  }
  has(p: PowerupType): boolean {
    return (this.powerups.get(p) ?? 0) > 0;
  }

  /** Start (or refresh) a powerup. */
  givePowerup(p: PowerupType): void {
    if (this.dead || !this.canPowerUp) return;
    this.powerups.set(p, POWERUP_DEFS[p].durationMs);
    if (p === 'shield') this.shieldHp = POWER.shieldHp;
    if (p === 'teleport') this.teleportMs = 600;
    this.refreshTag();
  }

  /** Slow them down for a while (blizzard). */
  chill(ms: number): void {
    this.chillMs = Math.max(this.chillMs, ms);
  }

  /** For the players' arena view. */
  get hurtFlash(): boolean {
    return this.flashMs > 0;
  }
  get chilled(): boolean {
    return this.chillMs > 0;
  }

  get onGround(): boolean {
    return this.body.blocked.down || this.body.touching.down;
  }

  bounds(): Box {
    const b = this.body;
    return { left: b.left, right: b.right, top: b.top, bottom: b.bottom };
  }

  attacker(): Attacker {
    return { name: this.name, icon: WEAPONS[this.weapon].emoji, color: this.color, fighter: this };
  }

  setWeapon(w: WeaponType): void {
    this.weapon = w;
    this.cooldownMs = Math.min(this.cooldownMs, 300);
  }

  heal(amount: number): void {
    if (!this.dead) this.hp = Math.min(FIGHTER.maxHp, this.hp + amount);
  }

  /** Push sideways this frame (tsunami, wind). */
  push(vx: number): void {
    this.extVx += vx;
  }

  pull(ax: number, ay: number, dt: number): void {
    if (this.dead) return;
    this.moveVx += ax * dt;
    this.body.velocity.y += ay * dt;
    this.stunMs = Math.max(this.stunMs, 120);
  }

  /** Launch (tornado fling, earthquake bounce). */
  fling(vx: number, vy: number): void {
    if (this.dead) return;
    this.moveVx = vx;
    this.body.setVelocityY(vy);
    this.stunMs = Math.max(this.stunMs, 400);
  }

  applyDamage(amount: number, fromX: number, knock: number, lift: number): boolean {
    if (this.dead) return false;
    if (this.shieldHp > 0 && amount < 500) {
      const absorbed = Math.min(this.shieldHp, amount);
      this.shieldHp -= absorbed;
      amount -= absorbed;
      knock *= 0.4;
      lift *= 0.4;
      if (this.shieldHp <= 0) {
        this.powerups.delete('shield');
        this.refreshTag();
      }
    }
    this.hp -= amount;
    this.flashMs = FIGHTER.flashMs;
    if (knock > 0 || lift > 0) {
      const away = this.x < fromX ? -1 : 1;
      this.moveVx = away * knock;
      if (lift > 0) this.body.setVelocityY(Math.min(this.body.velocity.y, -lift));
      this.stunMs = Math.max(this.stunMs, FIGHTER.stunMs);
    }
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      return true;
    }
    return false;
  }

  update(dt: number, ctx: BattleContext): void {
    if (this.dead) return;
    const s = dt / 1000;
    this.cooldownMs -= dt;
    this.swingMs = Math.max(0, this.swingMs - dt);
    this.muzzleMs = Math.max(0, this.muzzleMs - dt);
    this.flashMs = Math.max(0, this.flashMs - dt);
    this.stunMs = Math.max(0, this.stunMs - dt);
    this.chillMs = Math.max(0, this.chillMs - dt);
    this.tickPowerups(dt, ctx);

    const plan = this.buttons !== null ? this.manual(this.buttons, ctx) : think(this, ctx, dt);
    const speed = this.speed * (this.has('speed') ? POWER.speedMult : 1) * (this.chillMs > 0 ? 0.5 : 1);

    // Steering with acceleration; while stunned, momentum just bleeds off.
    if (this.stunMs > 0) {
      this.moveVx *= Math.pow(this.onGround ? 0.02 : 0.4, s);
    } else {
      const want = plan.dir * speed;
      const step = FIGHTER.accel * s * (this.has('speed') ? 1.6 : 1);
      this.moveVx = Math.abs(want - this.moveVx) <= step ? want : this.moveVx + Math.sign(want - this.moveVx) * step;
      if (plan.dir !== 0 && this.swingMs === 0 && this.muzzleMs === 0) this.facing = plan.dir;
    }
    if ((this.body.blocked.left && this.moveVx < 0) || (this.body.blocked.right && this.moveVx > 0)) this.moveVx = 0;
    this.body.setVelocityX(this.moveVx + this.extVx);
    this.extVx = 0;

    if (this.flying) {
      // Hover toward the brain's chosen height; gravity is off while flying.
      if (this.stunMs === 0) this.body.setVelocityY(Phaser.Math.Clamp((plan.flyY - this.y) * 3, -POWER.flySpeed, POWER.flySpeed));
    } else if (plan.jump && this.onGround && this.stunMs === 0) {
      this.body.setVelocityY(-this.jumpPower * (this.has('speed') ? 1.15 : 1));
    }

    if (COMBAT_ENABLED && this.cooldownMs <= 0) {
      const aim = plan.target && inRange(this, plan.target) ? plan.target : plan.aim;
      if (aim) {
        attack(this, aim, ctx);
        const jitter = this.buttons !== null ? 1 : ctx.rng.realInRange(0.9, 1.25);
        this.cooldownMs = WEAPONS[this.weapon].cooldownMs * jitter * (this.has('rage') ? POWER.rageCooldown : 1);
      }
    }

    // Look: lean into movement, flash white when hit.
    this.sprite.setFlipX(this.facing === -1);
    if (this.flashMs > 0) this.sprite.setTint(0xff7070);
    else if (this.chillMs > 0) this.sprite.setTint(0x9fd8ff);
    else this.sprite.clearTint();
    const ghost = this.hidden ? 0.22 + 0.08 * Math.sin(this.ms / 120) : 1;
    this.sprite.setAlpha(ghost);
    this.tag.setAlpha(this.hidden ? 0.35 : 1);
    this.sprite.setAngle(Phaser.Math.Clamp(this.moveVx / 30, -8, 8));
    this.tag.setPosition(this.x, this.body.top - 7);
  }

  /**
   * A player's buttons → this frame's plan. Holding jump hops again on landing;
   * while flying, jump rises, down sinks, neither hovers. Attack aims itself at
   * the nearest foe in front within range, else straight ahead.
   */
  private manual(b: number, ctx: BattleContext): Plan {
    const dir = (((b & BTN.right) !== 0 ? 1 : 0) - ((b & BTN.left) !== 0 ? 1 : 0)) as -1 | 0 | 1;
    const up = (b & BTN.jump) !== 0;
    const down = (b & BTN.down) !== 0;
    const flyY = up ? this.y - 200 : down ? this.y + 200 : this.y;
    let aim: Plan['aim'] = null;
    if ((b & BTN.attack) !== 0) {
      const facing = dir !== 0 && this.swingMs === 0 && this.muzzleMs === 0 ? dir : this.facing;
      let best: Target | null = null;
      let bestD = Infinity;
      for (const t of ctx.targets()) {
        if (t === this || t.hidden || (t.x - this.x) * facing < -6 || !inRange(this, t)) continue;
        const d = Math.hypot(t.x - this.x, (t.y - this.y) * 1.5);
        if (d < bestD) {
          bestD = d;
          best = t;
        }
      }
      aim = best ? { x: best.x, y: best.y } : { x: this.x + facing * WEAPONS[this.weapon].range, y: this.y - 2 };
    }
    return { dir, jump: up, flyY, target: null, aim };
  }

  /** Refresh the name tag (kill count, active powerups). */
  refreshTag(): void {
    if (this.dead) return;
    const icons = [...this.powerups.keys()].map((p) => POWERUPS[p].emoji).join('');
    this.tag.setText(`${this.name}${this.kills > 0 ? ` ×${this.kills}` : ''}${icons ? ` ${icons}` : ''}`);
  }

  private ms = 0;

  private tickPowerups(dt: number, ctx: BattleContext): void {
    this.ms += dt;
    let changed = false;
    for (const [p, left] of this.powerups) {
      const next = left - dt;
      if (next <= 0) {
        this.powerups.delete(p);
        if (p === 'shield') this.shieldHp = 0;
        changed = true;
      } else this.powerups.set(p, next);
    }
    if (changed) this.refreshTag();
    this.body.setAllowGravity(!this.flying);
    if (this.has('regen')) this.heal(POWER.regenPerSec * (dt / 1000));
    if (this.has('teleport')) {
      this.teleportMs -= dt;
      if (this.teleportMs <= 0) {
        this.teleportMs = ctx.rng.between(...POWER.teleportEveryMs);
        this.teleport(ctx);
      }
    }
  }

  /** Blink: behind the current enemy when hunting (or low on health: somewhere safe-ish). */
  private teleport(ctx: BattleContext): void {
    const [zl, zr] = ctx.zone();
    const enemy = this.brain.enemy;
    let x: number;
    let y: number;
    if (enemy?.alive && this.hp > 30) {
      const side = enemy.x > this.x ? 1 : -1; // land on their far side
      x = enemy.x + side * 34;
      y = enemy.bounds().bottom - 2;
    } else {
      const top = ctx.rng.pick(standingTops(ctx.terrain));
      x = ctx.rng.between(top.x + 12, top.x + top.width - 12);
      y = top.y - 2;
    }
    x = Phaser.Math.Clamp(x, Math.max(14, zl + 10), Math.min(946, zr - 10));
    ctx.juice.burst(this.x, this.y, 0xb388ff, 14);
    this.body.reset(x, y);
    this.moveVx = 0;
    ctx.juice.burst(this.x, this.y - 10, 0xb388ff, 14);
    sfx.play('teleport');
  }

  /** Remove from the world (after the knockout effect). */
  remove(): void {
    this.dead = true;
    this.sprite.destroy();
    this.tag.destroy();
  }
}
