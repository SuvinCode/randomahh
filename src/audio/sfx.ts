import Phaser from 'phaser';

/**
 * Tiny synthesized sound effects (no audio files). Uses Phaser's Web Audio
 * context, so Phaser's "unlock on first tap/click" handling applies. Silently
 * does nothing where Web Audio isn't available.
 */
export type SfxName =
  | 'shoot'
  | 'laser'
  | 'slash'
  | 'hit'
  | 'explode'
  | 'kill'
  | 'thunder'
  | 'rumble'
  | 'spawn'
  | 'pickup'
  | 'heal'
  | 'multikill'
  | 'win'
  | 'click'
  | 'teleport'
  | 'powerup'
  | 'buzz'
  | 'groan'
  | 'beat'
  | 'siren'
  | 'snap'
  | 'roar';

/** Minimum gap between two plays of the same sound, so a 50-fighter brawl isn't a wall of noise. */
const MIN_GAP_MS: Partial<Record<SfxName, number>> = { shoot: 70, laser: 90, slash: 70, hit: 60, explode: 90, kill: 80, teleport: 120, buzz: 300, groan: 900 };

const MUTE_KEY = 'random-ahh:muted';
const MASTER = 0.22;

class Sfx {
  private ctx?: AudioContext;
  private master?: GainNode;
  private noise?: AudioBuffer;
  private _muted = false;

  constructor() {
    try {
      this._muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      /* storage unavailable: default to sound on */
    }
  }

  /** Call once with the game, after boot. */
  attach(game: Phaser.Game): void {
    const mgr = game.sound as Phaser.Sound.WebAudioSoundManager;
    if (!mgr || !('context' in mgr) || !mgr.context) return;
    this.ctx = mgr.context;
    this.master = this.ctx.createGain();
    this.master.gain.value = this._muted ? 0 : MASTER;
    this.master.connect(this.ctx.destination);
    // One second of white noise, reused for hits and whooshes.
    this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }

  get muted(): boolean {
    return this._muted;
  }

  toggleMute(): boolean {
    this._muted = !this._muted;
    if (this.master) this.master.gain.value = this._muted ? 0 : MASTER;
    try {
      localStorage.setItem(MUTE_KEY, this._muted ? '1' : '0');
    } catch {
      /* ignore */
    }
    return this._muted;
  }

  private last = new Map<SfxName, number>();

  play(name: SfxName): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this._muted || ctx.state !== 'running') return;
    const now = performance.now();
    if (now - (this.last.get(name) ?? -1e9) < (MIN_GAP_MS[name] ?? 0)) return;
    this.last.set(name, now);
    const t = ctx.currentTime;
    switch (name) {
      case 'shoot':
        return this.burst(t, 0.07, 2600, 0.25);
      case 'laser':
        return this.tone('sawtooth', 1600, 300, t, 0.14, 0.18);
      case 'slash':
        return this.burst(t, 0.1, 900, 0.25, 4000);
      case 'hit':
        return this.tone('square', 220, 110, t, 0.06, 0.18);
      case 'explode':
        this.burst(t, 0.5, 300, 0.7, 80);
        return this.tone('sine', 120, 40, t, 0.4, 0.5);
      case 'kill':
        this.tone('square', 660, 330, t, 0.12, 0.25);
        return this.tone('square', 330, 165, t + 0.08, 0.14, 0.25);
      case 'thunder':
        this.burst(t, 0.6, 1800, 0.8, 120);
        return this.tone('sawtooth', 90, 40, t, 0.5, 0.35);
      case 'rumble':
        return this.burst(t, 1.2, 120, 0.7, 60);
      case 'spawn':
        return this.burst(t, 0.35, 500, 0.4, 2400);
      case 'pickup':
        this.tone('square', 660, 660, t, 0.06, 0.25);
        return this.tone('square', 990, 990, t + 0.06, 0.08, 0.25);
      case 'heal':
        [523, 784, 1047].forEach((f, i) => this.tone('sine', f, f, t + i * 0.07, 0.12, 0.3));
        return;
      case 'multikill':
        [440, 554, 659, 880].forEach((f, i) => this.tone('sawtooth', f, f, t + i * 0.06, 0.1, 0.25));
        return;
      case 'win':
        [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone('square', f, f, t + i * 0.12, 0.16, 0.3));
        return;
      case 'click':
        return this.tone('square', 880, 880, t, 0.03, 0.15);
      case 'teleport':
        return this.tone('sine', 300, 1800, t, 0.16, 0.3);
      case 'powerup':
        [392, 523, 659, 784, 1047].forEach((f, i) => this.tone('triangle', f, f, t + i * 0.05, 0.09, 0.3));
        return;
      case 'buzz':
        return this.tone('sawtooth', 210, 230, t, 0.25, 0.08);
      case 'groan':
        return this.tone('sawtooth', 140, 90, t, 0.45, 0.2);
      case 'beat':
        this.tone('sine', 150, 45, t, 0.18, 0.6);
        return this.burst(t, 0.05, 6000, 0.15);
      case 'siren':
        this.tone('square', 600, 900, t, 0.5, 0.18);
        return this.tone('square', 900, 600, t + 0.5, 0.5, 0.18);
      case 'snap':
        this.burst(t, 0.06, 3500, 0.8);
        return this.tone('triangle', 1400, 700, t, 0.08, 0.4);
      case 'roar':
        this.tone('sawtooth', 110, 60, t, 1.1, 0.45);
        return this.burst(t, 1.1, 400, 0.5, 150);
    }
  }

  /** One oscillator with a pitch sweep and a quick attack/decay. */
  private tone(type: OscillatorType, from: number, to: number, at: number, dur: number, vol: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + dur);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(vol, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(gain).connect(this.master!);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  /** Filtered noise: hits and whooshes. With `toHz`, the filter sweeps (whoosh). */
  private burst(at: number, dur: number, hz: number, vol: number, toHz?: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise!;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(hz, at);
    if (toHz) filter.frequency.exponentialRampToValueAtTime(toHz, at + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(filter).connect(gain).connect(this.master!);
    src.start(at);
    src.stop(at + dur + 0.02);
  }
}

/** The game's one sound player. */
export const sfx = new Sfx();
