import Phaser from 'phaser';
import { DISASTERS, MAX_FIGHTERS, WEAPONS_CATALOG, WEAPON_TYPES, type Action, type DisasterType, type PowerupType, type WeaponType } from '@shared/commands';
import { FLAG, FRAME_MAGIC, FrameWriter, to15 } from '@shared/frame';
import type { Arena } from '@shared/room';
import { uniqueName } from '@shared/names';
import { parseCommand } from '@shared/parseCommand';
import { DISASTER_SOUNDS } from '../audio/disasterSounds';
import { sfx } from '../audio/sfx';
import { boxHitsCircle, boxHitsRect, boxHitsSegment } from '../battle/geometry';
import { Projectiles } from '../battle/projectiles';
import type { Attacker, BattleContext, HitOptions, PaletteColors, Target } from '../battle/types';
import { ARENA, BATTLE, COMBAT_ENABLED, DEPTH, FIGHTER, GAME_HEIGHT, POWERUPS_ENABLED, REGISTRY_KEYS } from '../config';
import { disasterRegistry } from '../disasters/registry';
import type { Disaster } from '../disasters/types';
import { Fighter } from '../fighters/fighter';
import { Juice } from '../fx';
import { interpretRemotely } from '../net/commandClient';
import { hostRoom, type RoomPlayer } from '../net/hostRoom';
import { writeMirror } from '../net/mirror';
import { colorHex, waitingYou } from '../net/youState';
import { fighterColors, hex } from '../textures';
import { GodBar } from '../ui/godBar';
import { Hud } from '../ui/hud';
import { KillFeed } from '../ui/killFeed';
import { WEAPONS, randomWeapon } from '../weapons/defs';
import { drawWeapon } from '../weapons/attack';
import { drawPowerups, powerupLabel, randomPowerup } from '../powerups/defs';
import { Background } from '../world/background';
import { buildTerrain, standingTops, type TerrainShape } from '../world/buildTerrain';
import { drawTerrain, landsOnTop, topOf, type ArenaBodies } from '../world/drawArena';
import { ARENAS, type ArenaTheme } from '../world/theme';
import type { ResultsData } from './Results';

const STORM: Attacker = { name: 'The storm', icon: '☁️', color: 0xb07cff };
const SELF_ANNOUNCING = new Set<DisasterType>(['dr_doom', 'thanos_snap', 'nuke', 'lava_floor']);
const MULTI = ['', '', 'DOUBLE KILL!', 'TRIPLE KILL!', 'QUAD KILL!', 'RAMPAGE!'];

/** A crate holds a weapon or a mystery powerup. */
type CrateLoot = { kind: 'weapon'; weapon: WeaponType } | { kind: 'powerup'; powerup: PowerupType };

interface Crate {
  x: number;
  y: number;
  vy: number;
  loot: CrateLoot;
  ms: number;
  img: Phaser.GameObjects.Container;
}

interface BeamFx {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  half: number;
  color: number;
  ms: number;
}

/**
 * The battle: fighters brawl until one is left. Bots fight on their own;
 * people who joined the party room steer theirs from their phone or laptop
 * (hostRoom). The host watches and plays god through the god box (GodBar).
 * Kills go to the feed.
 */
export class BattleScene extends Phaser.Scene {
  private fighters: Fighter[] = [];
  private bosses: Target[] = [];
  private disasters: Disaster[] = [];
  private crates: Crate[] = [];
  private beams: BeamFx[] = [];
  private eliminated: string[] = [];
  private stats = new Map<string, { kills: number; color: number }>();
  private ctx!: BattleContext;
  private theme!: ArenaTheme;
  private terrain!: TerrainShape;
  private bodies!: ArenaBodies;
  private projectiles!: Projectiles;
  private juice!: Juice;
  private background!: Background;
  private hud!: Hud;
  private feed!: KillFeed;
  private god!: GodBar;
  private overlay!: Phaser.GameObjects.Graphics;
  private zoneG!: Phaser.GameObjects.Graphics;
  private colors!: PaletteColors;
  private rng!: Phaser.Math.RandomDataGenerator;
  private elapsed = 0;
  private stormTick = 0;
  private crateMs = 0;
  private totalFighters = 0;
  private ending = false;
  private colorPool: number[] = [];
  private stormWarned = false;
  /** Final place by fighter name (for players' controllers). */
  private places = new Map<string, { place: number; by: string }>();
  private syncMs = 0;
  private unsubscribe: (() => void)[] = [];
  /** Players' arena view: snapshot timer, explosions since the last one, roster needs resending. */
  private snapMs = 0;
  private readonly frame = new FrameWriter();
  private booms: [number, number, number][] = [];
  private rosterDirty = true;

  constructor() {
    super('Battle');
  }

  create(): void {
    this.fighters = [];
    this.bosses = [];
    this.disasters = [];
    this.crates = [];
    this.beams = [];
    this.eliminated = [];
    this.stats = new Map();
    this.elapsed = 0;
    this.stormTick = 0;
    this.crateMs = BATTLE.crateEveryMs / 2;
    this.ending = false;
    this.stormWarned = false;
    this.places = new Map();
    this.syncMs = 0;
    this.snapMs = 0;
    this.booms = [];
    this.rosterDirty = true;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());
    // Typing in the god box needs Space etc.; nothing in the battle uses the keyboard.
    this.input.keyboard?.disableGlobalCapture();

    const roster = (this.registry.get(REGISTRY_KEYS.roster) as string[] | undefined) ?? [];
    this.rng = new Phaser.Math.RandomDataGenerator([`${Date.now()}`]);
    this.theme = this.rng.pick([...ARENAS]);
    const p = this.theme.palette;
    this.colors = { sky: hex(p.sky), ground: hex(p.ground), platform: hex(p.platform), accent: hex(p.accent), hazard: hex(p.hazard) };

    this.cameras.main.setBackgroundColor('#0d0f1a');
    this.physics.world.setBounds(0, -2000, ARENA.width, ARENA.height + 2000);
    this.physics.world.setBoundsCollision(true, true, false, false);
    this.background = new Background(this, p, this.theme.backgroundStyle);
    this.terrain = buildTerrain(this.theme.layout);
    this.bodies = drawTerrain(this, this.terrain, p);
    this.add.rectangle(ARENA.width / 2, ARENA.height + (GAME_HEIGHT - ARENA.height) / 2, ARENA.width, GAME_HEIGHT - ARENA.height, 0x141726).setDepth(DEPTH.hud - 1);
    this.juice = new Juice(this);
    this.projectiles = new Projectiles(this);
    this.overlay = this.add.graphics().setDepth(DEPTH.weapon);
    this.zoneG = this.add.graphics().setDepth(DEPTH.zone);
    this.hud = new Hud(this, this.theme.name);
    this.feed = new KillFeed(this);
    this.god = new GodBar(
      this,
      (t) => void this.command(t),
      (a) => this.apply([a], true),
      () => this.fighters.filter((f) => f.alive).map((f) => f.name),
    );
    this.ctx = this.makeContext();
    this.projectiles.attach(this.ctx);

    this.colorPool = fighterColors(MAX_FIGHTERS + 20, this.rng.frac());
    // People in the party room play their own fighter; the rest of the roster are bots.
    const players = hostRoom.connected();
    const playerNames = new Set(players.map((pl) => pl.name.toLowerCase()));
    players.forEach((pl) => this.spawnFighter(pl.name, false, pl.id));
    roster.filter((name) => !playerNames.has(name.toLowerCase())).forEach((name) => this.spawnFighter(name, false));
    this.totalFighters = this.fighters.length;
    hostRoom.reservedNames = () => this.fighters.map((f) => f.name);
    this.unsubscribe = [hostRoom.on('join', (pl) => this.playerJoined(pl))];
    // Phones show the arena too: terrain now, then live snapshots (updatePlayers).
    hostRoom.broadcast(this.arenaFeed());
    this.hud.onAnnounce = (text, color) => hostRoom.broadcast({ t: 'say', text: text.slice(0, 80), color: colorHex(color) });
    this.hud.announce(COMBAT_ENABLED ? 'FIGHT!' : 'SURVIVE!', 0xffd23f, 44);
    this.god.setStatus('Type a disaster, or tap one below.');
    sfx.play('spawn');

    if (import.meta.env.DEV) (window as unknown as { battle: BattleScene }).battle = this;
  }

  // -------------------------------------------------------------------------
  // World

  private makeContext(): BattleContext {
    const floorY = Math.min(...this.terrain.ground.map((g) => g.y));
    return {
      scene: this,
      rng: this.rng,
      colors: this.colors,
      terrain: this.terrain,
      bodies: this.bodies,
      floorY,
      juice: this.juice,
      projectiles: this.projectiles,
      fighters: () => this.fighters.filter((f) => f.alive),
      targets: () => [...this.fighters.filter((f) => f.alive), ...this.bosses.filter((b) => b.alive)],
      damage: (t, amount, by, opts) => this.damage(t, amount, by, opts),
      explode: (x, y, r, dmg, by, spare) => this.explode(x, y, r, dmg, by, spare),
      beam: (x1, y1, x2, y2, half, dmg, by, color, spare) => this.beam(x1, y1, x2, y2, half, dmg, by, color, spare),
      addTarget: (t) => this.bosses.push(t),
      removeTarget: (t) => (this.bosses = this.bosses.filter((b) => b !== t)),
      announce: (text, color) => this.hud.announce(text, color),
      fighterByName: (name) => this.fighters.find((f) => f.alive && f.name.toLowerCase() === name.toLowerCase()),
      crates: () => this.crates.filter((c) => c.vy === 0).map((c) => ({ x: c.x, y: c.y })),
      inFloor: (x, y) => this.terrain.ground.some((g) => x >= g.x && x <= g.x + g.width && y >= g.y && y <= g.y + g.height),
      effects: { lavaFloor: false },
      zone: () => this.zone(),
    };
  }

  private spawnFighter(name: string, dropIn: boolean, pilot: string | null = null): Fighter | undefined {
    if (this.fighters.filter((f) => f.alive).length >= MAX_FIGHTERS) return undefined;
    const tops = standingTops(this.terrain);
    const surface = this.rng.frac() < 0.55 ? tops[0] : this.rng.pick(tops);
    const x = this.rng.between(surface.x + 14, surface.x + surface.width - 14);
    const y = dropIn ? -30 : surface.y - 2;
    const color = this.colorPool[this.stats.size % this.colorPool.length];
    const f = new Fighter(this, name, color, x, y, randomWeapon(() => this.rng.frac()), this.rng, pilot);
    this.physics.add.collider(f.sprite, this.bodies.ground);
    this.physics.add.collider(f.sprite, this.bodies.platforms, undefined, (_s: unknown, ledge: unknown) => landsOnTop(f.body, topOf(ledge)));
    this.fighters.push(f);
    this.stats.set(name, { kills: 0, color });
    this.rosterDirty = true;
    return f;
  }

  /** Someone joined (or came back to) the room mid-battle. */
  private playerJoined(pl: RoomPlayer): void {
    // (Re)joiners need the arena and who's who before snapshots make sense.
    hostRoom.sendTo(pl.id, this.arenaFeed());
    this.rosterDirty = true;
    if (this.ending || this.fighters.some((f) => f.pilot === pl.id)) return;
    const f = this.spawnFighter(pl.name, true, pl.id);
    if (!f) return;
    this.totalFighters++;
    this.hud.announce(`📱 ${f.name} drops in!`, f.color, 22);
    sfx.play('spawn');
  }

  /** Steer players' fighters from their buttons, and keep their controllers' screens current. */
  private updatePlayers(dt: number): void {
    for (const f of this.fighters) {
      if (!f.pilot || !f.alive) continue;
      const pl = hostRoom.get(f.pilot);
      // Disconnected players' fighters keep fighting on autopilot until they're back.
      f.buttons = pl?.connected && !this.ending ? pl.buttons : null;
    }
    this.snapMs -= dt;
    if (this.snapMs <= 0 && hostRoom.connected().length) {
      // 20 frames a second; 15 in big rooms (a quarter less data, phones smooth it out).
      this.snapMs = hostRoom.connected().length > 24 ? 66 : 50;
      if (this.rosterDirty) {
        this.rosterDirty = false;
        hostRoom.broadcast({
          t: 'roster',
          f: this.fighters.slice(-120).map((f) => [f.id, f.name, colorHex(f.color), f.pilot !== null] as [number, string, string, boolean]),
        });
      }
      hostRoom.sendFrame(this.writeFrame());
    }
    this.syncMs -= dt;
    if (this.syncMs > 0) return;
    this.syncMs = 150;
    const alive = this.fighters.filter((f) => f.alive).length;
    for (const pl of hostRoom.connected()) {
      const f = this.fighters.find((k) => k.pilot === pl.id);
      if (!f) {
        hostRoom.sendYou(pl.id, waitingYou(pl.name, 0xffd23f, "You're in the next battle. Watch the big screen!"));
        continue;
      }
      const done = this.places.get(f.name);
      const won = this.ending && f.alive;
      const phase = won || (this.ending && done) ? 'over' : f.alive ? 'fight' : 'out';
      let msg: string;
      if (won) msg = 'YOU WIN! Last one standing.';
      else if (done) msg = `💀 Knocked out by ${done.by} (of ${this.totalFighters} fighters)`;
      else if (this.ending) msg = 'Battle over!';
      else msg = alive <= 3 ? `🔥 Final ${alive}!` : COMBAT_ENABLED ? 'Fight! Last one standing wins.' : 'Dodge the disasters! Last one standing wins.';
      hostRoom.sendYou(pl.id, {
        t: 'you',
        name: f.name,
        color: colorHex(f.color),
        phase,
        hp: f.alive ? Math.max(0, Math.min(100, Math.ceil(f.hp))) : 0,
        weapon: f.weapon,
        powerups: f.alive ? [...f.powerups.keys()] : [],
        kills: f.kills,
        alive,
        place: won ? 1 : (done?.place ?? 0),
        msg,
        fid: f.id,
      });
    }
  }

  /** The arena's look and terrain, for players' phones. */
  private arenaFeed(): Arena {
    const p = this.theme.palette;
    const rect = (r: { x: number; y: number; width: number; height: number }) =>
      [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] as [number, number, number, number];
    return {
      t: 'arena',
      theme: this.theme.name.slice(0, 40),
      sky: p.sky,
      ground: p.ground,
      platform: p.platform,
      accent: p.accent,
      solid: this.terrain.ground.slice(0, 16).map(rect),
      ledges: this.terrain.platforms.slice(0, 40).map(rect),
    };
  }

  /** Everything moving, plus the disasters' drawings, as one binary frame (shared/frame.ts). */
  private writeFrame(): Uint8Array<ArrayBuffer> {
    const w = this.frame;
    w.n = 0;
    const i16 = (v: number) => (v << 16) >> 16;
    const t = Math.floor(performance.now()) >>> 0;
    const [zl, zr] = this.zone();
    w.push(FRAME_MAGIC);
    w.push(i16(t >>> 16));
    w.push(i16(t & 0xffff));
    w.push(zl);
    w.push(zr);
    const alive = this.fighters.filter((k) => k.alive).slice(0, 120);
    w.push(alive.length);
    for (const k of alive) {
      let flags = 0;
      if (k.hidden) flags |= FLAG.hidden;
      if (k.hurtFlash) flags |= FLAG.hurt;
      if (k.has('shield')) flags |= FLAG.shield;
      if (k.flying) flags |= FLAG.flying;
      if (k.chilled) flags |= FLAG.chilled;
      if (k.has('rage')) flags |= FLAG.rage;
      if (k.swingMs > 0 || k.muzzleMs > 0) flags |= FLAG.attacking;
      if (k.pilot && k.buttons === null) flags |= FLAG.autopilot;
      w.push(k.id);
      w.push(k.x);
      w.push(k.y);
      w.push(k.facing);
      w.push(Math.max(0, Math.min(100, Math.ceil(k.hp))));
      w.push(flags);
      w.push(WEAPON_TYPES.indexOf(k.weapon));
    }
    const crates = this.crates.slice(0, 30);
    w.push(crates.length);
    for (const c of crates) {
      w.push(c.x);
      w.push(c.y);
      w.push(c.loot.kind === 'powerup' ? 1 : 0);
    }
    const shots = this.projectiles.snapshot(300);
    w.push(shots.length);
    for (const [px, py, pc, pr] of shots) {
      w.push(px);
      w.push(py);
      w.push(to15(pc));
      w.push(pr);
    }
    const beams = this.beams.slice(0, 30);
    w.push(beams.length);
    for (const b of beams) {
      w.push(b.x1);
      w.push(b.y1);
      w.push(b.x2);
      w.push(b.y2);
      w.push(Math.max(1, b.half));
      w.push(to15(b.color));
    }
    const booms = this.booms.splice(0).slice(0, 40);
    w.push(booms.length);
    for (const [x, y, r] of booms) {
      w.push(x);
      w.push(y);
      w.push(r);
    }
    writeMirror(w, this);
    return w.bytes();
  }

  /** Current storm-safe span. Full width until zoneStartMs, then closes toward the middle. */
  private zone(): [number, number] {
    const t = Phaser.Math.Clamp((this.elapsed - BATTLE.zoneStartMs) / (BATTLE.zoneEndMs - BATTLE.zoneStartMs), 0, 1);
    // Survival mode: the storm closes completely, so a battle always ends.
    const half = Phaser.Math.Linear(ARENA.width / 2, (COMBAT_ENABLED ? BATTLE.zoneMinWidth : 0) / 2, t);
    return [ARENA.width / 2 - half, ARENA.width / 2 + half];
  }

  // -------------------------------------------------------------------------
  // Damage

  private damage(t: Target, amount: number, by: Attacker, opts: HitOptions = {}): void {
    if (!t.alive || this.ending) return;
    const fromX = opts.fromX ?? by.fighter?.x ?? t.x;
    const died = t.applyDamage(amount, fromX, opts.knock ?? 0, opts.lift ?? 0);
    if (amount >= 3) sfx.play('hit');
    if (!died) return;
    if (t.minion) {
      this.juice.burst(t.x, t.y, t.color, 16);
      return;
    }
    if (t.isBoss) {
      this.hud.announce(`${by.name} defeated ${t.name}!`, 0x7dff9a, 30);
      if (by.fighter && by.fighter.alive) this.creditKill(by.fighter);
      return;
    }
    this.eliminate(t as Fighter, by);
  }

  private eliminate(f: Fighter, by: Attacker): void {
    this.eliminated.push(f.name);
    const left = this.fighters.filter((k) => k.alive && k !== f).length;
    this.places.set(f.name, { place: left + 1, by: by.fighter === f ? 'yourself' : by.name });
    if (f.pilot) this.syncMs = 0; // tell them right away
    const self = by.fighter === f;
    if (by.fighter && !self && by.fighter.alive) this.creditKill(by.fighter);
    this.feed.add(
      self
        ? [{ text: f.name, color: f.color }, { text: `${by.icon} oops` }]
        : [{ text: by.name, color: by.color }, { text: by.icon }, { text: f.name, color: f.color }],
    );
    this.juice.knockout(f.x, f.y, f.color);
    const skull = this.add.text(f.x, f.y - 10, '💀', { fontSize: '20px' }).setOrigin(0.5).setDepth(DEPTH.tags);
    this.tweens.add({ targets: skull, y: f.y - 50, alpha: 0, duration: 1100, onComplete: () => skull.destroy() });
    sfx.play('kill');
    f.remove();
    this.checkEnd();
  }

  private creditKill(k: Fighter): void {
    k.kills++;
    k.refreshTag();
    const s = this.stats.get(k.name);
    if (s) s.kills = k.kills;
    const now = this.elapsed;
    k.recentKills = [...k.recentKills.filter((t) => now - t < BATTLE.multiKillMs), now];
    const n = k.recentKills.length;
    if (n >= 2) {
      this.hud.announce(`${k.name}: ${MULTI[Math.min(n, MULTI.length - 1)]}`, k.color, 30);
      sfx.play('multikill');
    } else if (this.eliminated.length === 1) {
      this.hud.announce(`🩸 First blood: ${k.name}!`, k.color, 26);
    }
  }

  private explode(x: number, y: number, radius: number, dmg: number, by: Attacker, spare?: Target): void {
    this.juice.explosion(x, y, radius);
    if (this.booms.length < 40) this.booms.push([Math.round(x), Math.round(y), Math.max(1, Math.min(2000, Math.round(radius)))]);
    sfx.play('explode');
    for (const t of this.ctx.targets()) {
      if (t === spare || !boxHitsCircle(t.bounds(), x, y, radius)) continue;
      const d = Math.hypot(t.x - x, t.y - y);
      const f = Phaser.Math.Clamp(1 - d / radius, 0.25, 1);
      this.damage(t, Math.round(dmg * f), by, { fromX: x, knock: 160 + 340 * f, lift: 220 + 260 * f });
    }
  }

  private beam(x1: number, y1: number, x2: number, y2: number, half: number, dmg: number, by: Attacker, color: number, spare?: Target): void {
    this.beams.push({ x1, y1, x2, y2, half, color, ms: 0 });
    for (const t of this.ctx.targets()) {
      if (t === spare || !boxHitsSegment(t.bounds(), x1, y1, x2, y2, half)) continue;
      this.damage(t, dmg, by, { fromX: x1, knock: 140, lift: 120 });
    }
  }

  // -------------------------------------------------------------------------
  // God box

  /** Run god-box text: local parser first, the server's AI for anything else. */
  async command(text: string): Promise<void> {
    if (this.ending) return;
    const names = this.fighters.filter((f) => f.alive).map((f) => f.name);
    const local = parseCommand(text, names);
    if (local) {
      const note = this.apply(local.actions);
      this.god.setStatus(note ?? local.message, note ? '#ff8a8a' : '#ffd23f');
      return;
    }
    this.god.setBusy(true);
    this.god.setStatus(`🤔 Interpreting “${text.slice(0, 40)}”…`);
    const res = await interpretRemotely(text, names);
    if (!this.scene.isActive()) return;
    this.god.setBusy(false);
    if (!res.ok) {
      this.god.setStatus(res.error, '#ff8a8a');
      return;
    }
    if (!res.plan.actions.length) {
      this.god.setStatus(res.plan.message || 'Nothing happened. Try: tornado, asteroids…', '#ff8a8a');
      return;
    }
    const note = this.apply(res.plan.actions);
    this.god.setStatus(note ?? (res.plan.message || 'Done!'), note ? '#ff8a8a' : '#ffd23f');
  }

  /** Carry out validated actions. Returns a note for the god box when something couldn't be done. */
  apply(actions: readonly Action[], fromChip = false): string | null {
    if (this.ending) return null;
    let note: string | null = null;
    for (const a of actions) {
      switch (a.type) {
        case 'add_fighter': {
          const taken = this.fighters.map((f) => f.name);
          const f = this.spawnFighter(uniqueName(taken, a.target), true);
          if (f) {
            this.totalFighters++;
            this.hud.announce(`➕ ${f.name} drops in!`, f.color, 22);
            sfx.play('spawn');
          }
          break;
        }
        case 'give_powerup': {
          const p: PowerupType = a.powerup === 'none' ? 'speed' : a.powerup;
          const who = (a.target ? this.fighters.filter((f) => f.alive && f.name === a.target) : this.ctx.fighters()).filter((f) => f.canPowerUp);
          if (!POWERUPS_ENABLED) note = 'Powerups are turned off. Try a weapon: "give everyone a rocket".';
          else if (!who.length && a.target) note = `${a.target} is a player: players don't get powerups.`;
          who.forEach((f) => {
            f.givePowerup(p);
            this.juice.burst(f.x, f.y, 0xffd23f, 10);
          });
          if (who.length) this.hud.announce(`${powerupLabel(p)} for ${a.target || 'everyone'}!`, 0xffd23f, 22);
          sfx.play('powerup');
          break;
        }
        case 'heal': {
          const who = a.target ? this.fighters.filter((f) => f.alive && f.name === a.target) : this.ctx.fighters();
          who.forEach((f) => {
            f.heal(50);
            this.juice.burst(f.x, f.y, 0x7dff9a, 8);
          });
          sfx.play('heal');
          break;
        }
        case 'give_weapon': {
          if (!COMBAT_ENABLED) {
            note = "Survival mode: nobody can attack, so weapons are off. Throw a disaster instead!";
            break;
          }
          const w = a.weapon === 'none' ? 'sword' : a.weapon;
          const who = a.target ? this.fighters.filter((f) => f.alive && f.name === a.target) : this.ctx.fighters();
          who.forEach((f) => f.setWeapon(w));
          if (who.length) this.hud.announce(`🎁 ${a.target || 'Everyone'} got a ${WEAPONS_CATALOG[w].name}!`, 0xffd23f, 22);
          sfx.play('pickup');
          break;
        }
        default: {
          const type = a.type as DisasterType;
          const entry = DISASTERS[type];
          const name = a.label || entry.name;
          const target = a.target ? this.ctx.fighterByName(a.target) : undefined;
          const by: Attacker = { name, icon: entry.emoji, color: this.colors.hazard };
          this.disasters.push(disasterRegistry[type](this.ctx, { type, count: Math.min(entry.maxCount, Math.max(1, a.count)), target, by }));
          // Some disasters make their own entrance (Dr Doom, Thanos, the nuke, lava).
          if (!SELF_ANNOUNCING.has(type)) this.hud.announce(`${entry.emoji} ${name}${target ? ` → ${target.name}` : ''}!`, 0xffffff, 24);
          const sound = DISASTER_SOUNDS[type];
          if (sound) sfx.play(sound);
        }
      }
    }
    if (fromChip) this.god.setStatus(`${actions.map((a) => (a.type in DISASTERS ? DISASTERS[a.type as DisasterType].emoji : '✨')).join(' ')} unleashed!`, '#ffd23f');
    return note;
  }

  // -------------------------------------------------------------------------
  // Loop

  update(_time: number, delta: number): void {
    const dt = Math.min(delta, 50);
    this.background.update(dt);
    if (!this.ending) this.elapsed += dt;
    const ctx = this.ctx;

    this.fighters.forEach((f) => f.update(dt, ctx));
    this.disasters = this.disasters.filter((d) => {
      let keep: boolean;
      try {
        keep = d.update(dt);
      } catch (err) {
        // A broken disaster must never freeze the battle: drop it and carry on.
        console.error('[battle] disaster failed and was removed:', err);
        keep = false;
      }
      if (!keep) d.destroy();
      return keep;
    });
    this.projectiles.update(dt);
    this.updateStorm(dt);
    this.updateCrates(dt);
    this.feed.update(dt);
    this.updatePlayers(dt);
    this.draw(dt);

    const alive = this.fighters.filter((f) => f.alive).length;
    const [zl, zr] = this.zone();
    const closing = this.elapsed >= BATTLE.zoneStartMs;
    const stormText = closing ? `☁️ Storm closing: ${Math.round(zr - zl)}px safe` : `☁️ Storm in ${Math.ceil((BATTLE.zoneStartMs - this.elapsed) / 1000)}s`;
    this.hud.set(alive, this.totalFighters, this.elapsed, stormText);
  }

  private updateStorm(dt: number): void {
    if (this.elapsed < BATTLE.zoneStartMs) return;
    if (!this.stormWarned) {
      this.stormWarned = true;
      this.hud.announce('☁️ The storm is closing in!', 0xb07cff, 26);
    }
    this.stormTick -= dt;
    if (this.stormTick > 0) return;
    this.stormTick = 500;
    const [zl, zr] = this.zone();
    for (const f of this.ctx.fighters()) {
      if (f.x < zl || f.x > zr) this.damage(f, BATTLE.zoneDps / 2, STORM, { knock: 0, lift: 0 });
    }
  }

  private updateCrates(dt: number): void {
    this.crateMs -= dt;
    // Nothing to put in a crate in survival mode with powerups off.
    if (this.crateMs <= 0 && !this.ending && (COMBAT_ENABLED || POWERUPS_ENABLED)) {
      this.crateMs = BATTLE.crateEveryMs * this.rng.realInRange(0.7, 1.3);
      const [zl, zr] = this.zone();
      const x = this.rng.between(Math.max(30, zl + 20), Math.min(ARENA.width - 30, zr - 20));
      // Powerups are a bit more common than weapons; their crates are mystery boxes.
      const loot: CrateLoot =
        POWERUPS_ENABLED && (!COMBAT_ENABLED || this.rng.frac() < 0.6)
          ? { kind: 'powerup', powerup: randomPowerup(() => this.rng.frac()) }
          : { kind: 'weapon', weapon: randomWeapon(() => this.rng.frac()) };
      const isPower = loot.kind === 'powerup';
      const box = this.add.rectangle(0, 0, 22, 18, isPower ? 0x7b2cbf : 0x8a5a2b).setStrokeStyle(2, isPower ? 0xffd23f : 0x000000);
      const icon = isPower
        ? this.add.text(0, 0, '?', { fontFamily: 'monospace', fontSize: '14px', fontStyle: 'bold', color: '#ffd23f' }).setOrigin(0.5)
        : this.add.text(0, 0, WEAPONS[loot.weapon].emoji, { fontSize: '12px' }).setOrigin(0.5);
      const chute = this.add.triangle(0, -22, -14, 0, 14, 0, 0, -12, 0xffffff, 0.8);
      const img = this.add.container(x, -20, [chute, box, icon]).setDepth(DEPTH.crate);
      if (isPower) this.tweens.add({ targets: box, alpha: 0.7, yoyo: true, repeat: -1, duration: 300 });
      this.crates.push({ x, y: -20, vy: 170, loot, ms: 0, img });
    }
    // Crates only land where a fighter can jump to: the floor and the lower ledges.
    const floorY = this.ctx.floorY;
    const tops = standingTops(this.terrain).filter((t) => t.y >= floorY - 125);
    for (let k = this.crates.length - 1; k >= 0; k--) {
      const c = this.crates[k];
      c.ms += dt;
      const prevBottom = c.y + 9;
      c.y += c.vy * (dt / 1000);
      const land = tops.find((t) => c.x > t.x && c.x < t.x + t.width && prevBottom <= t.y && c.y + 9 >= t.y);
      if (land) {
        c.y = land.y - 9;
        c.vy = 0;
        (c.img.list[0] as Phaser.GameObjects.Triangle).setVisible(false);
      }
      c.img.setPosition(c.x, c.y);
      // Players walk past mystery (powerup) crates; weapon crates are for everyone.
      const taker = this.ctx
        .fighters()
        .find((f) => (c.loot.kind === 'weapon' || f.canPowerUp) && boxHitsRect(f.bounds(), c.x - 11, c.y - 9, 22, 18));
      if (taker || c.ms > 16000) {
        if (taker) {
          let label: string;
          if (c.loot.kind === 'weapon') {
            taker.setWeapon(c.loot.weapon);
            sfx.play('pickup');
            label = `+${WEAPONS[c.loot.weapon].emoji}`;
          } else {
            taker.givePowerup(c.loot.powerup);
            sfx.play('powerup');
            label = powerupLabel(c.loot.powerup);
            this.juice.burst(taker.x, taker.y, 0xffd23f, 12);
          }
          const t = this.add
            .text(taker.x, taker.y - 24, label, { fontFamily: 'monospace', fontSize: '13px', fontStyle: 'bold', color: '#ffd23f', stroke: '#000000', strokeThickness: 4 })
            .setOrigin(0.5)
            .setDepth(DEPTH.tags);
          this.tweens.add({ targets: t, y: t.y - 24, alpha: 0, duration: 800, onComplete: () => t.destroy() });
        }
        c.img.destroy();
        this.crates.splice(k, 1);
      }
    }
  }

  private draw(dt: number): void {
    const g = this.overlay;
    g.clear();
    for (const f of this.fighters) {
      if (!f.alive) continue;
      drawPowerups(g, f, this.elapsed);
      if (!f.hidden && COMBAT_ENABLED) drawWeapon(g, f);
      // Health bar above the name.
      const w = 22;
      const x = f.x - w / 2;
      const y = f.body.top - 5;
      g.fillStyle(0x000000, 0.7).fillRect(x - 1, y - 1, w + 2, 4);
      const pct = f.hp / FIGHTER.maxHp;
      g.fillStyle(pct > 0.5 ? 0x4ade80 : pct > 0.25 ? 0xfacc15 : 0xef4444, 1).fillRect(x, y, w * pct, 2);
      // Players' fighters get a bobbing arrow in their colour (grey while they're disconnected).
      if (f.pilot && !f.hidden) {
        const ay = f.body.top - 22 + Math.sin(this.elapsed / 180) * 2;
        const c = f.buttons === null ? 0x8a8aa8 : f.color;
        g.fillStyle(0x000000, 0.85).fillTriangle(f.x - 9, ay - 11, f.x + 9, ay - 11, f.x, ay + 1);
        g.fillStyle(c, 1).fillTriangle(f.x - 6, ay - 9, f.x + 6, ay - 9, f.x, ay - 2);
      }
    }
    for (let k = this.beams.length - 1; k >= 0; k--) {
      const b = this.beams[k];
      b.ms += dt;
      if (b.ms > 160) {
        this.beams.splice(k, 1);
        continue;
      }
      const a = 1 - b.ms / 160;
      g.lineStyle(b.half * 3, b.color, 0.35 * a).lineBetween(b.x1, b.y1, b.x2, b.y2);
      g.lineStyle(b.half * 1.6, b.color, a).lineBetween(b.x1, b.y1, b.x2, b.y2);
      g.lineStyle(Math.max(1, b.half * 0.6), 0xffffff, a).lineBetween(b.x1, b.y1, b.x2, b.y2);
    }
    // Storm: purple haze outside the safe zone.
    this.zoneG.clear();
    if (this.elapsed >= BATTLE.zoneStartMs) {
      const [zl, zr] = this.zone();
      const pulse = 0.28 + 0.06 * Math.sin(this.elapsed / 300);
      this.zoneG.fillStyle(0x6a1b9a, pulse).fillRect(0, 0, zl, ARENA.height).fillRect(zr, 0, ARENA.width - zr, ARENA.height);
      this.zoneG.lineStyle(3, 0xd0a8ff, 0.9).lineBetween(zl, 0, zl, ARENA.height).lineBetween(zr, 0, zr, ARENA.height);
    }
  }

  // -------------------------------------------------------------------------
  // End

  private checkEnd(): void {
    if (this.ending) return;
    const alive = this.fighters.filter((f) => f.alive);
    if (alive.length > 1) return;
    this.ending = true;
    this.god.disable();
    const winner = alive[0];
    if (winner) {
      this.hud.announce(`🏆 ${winner.name} WINS!`, winner.color, 46);
      sfx.play('win');
    } else {
      this.hud.announce('Nobody survived! The disasters win.', 0xff5d73, 32);
    }
    const placements = [...(winner ? [winner.name] : []), ...[...this.eliminated].reverse()];
    const data: ResultsData = {
      winner: winner ? { name: winner.name, color: winner.color, kills: winner.kills, hp: Math.ceil(winner.hp) } : null,
      placements: placements.map((name) => ({ name, kills: this.stats.get(name)?.kills ?? 0, color: this.stats.get(name)?.color ?? 0xffffff })),
      durationMs: this.elapsed,
    };
    this.syncMs = 0;
    this.time.delayedCall(BATTLE.endDelayMs, () => this.scene.start('Results', data));
  }

  private cleanup(): void {
    this.hud.onAnnounce = null;
    this.unsubscribe.forEach((u) => u());
    this.unsubscribe = [];
    for (const f of this.fighters) f.buttons = null;
    this.disasters.forEach((d) => d.destroy());
    this.disasters = [];
    this.projectiles?.destroy();
    this.input.keyboard?.enableGlobalCapture();
  }
}
