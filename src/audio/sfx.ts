import Phaser from 'phaser';

/**
 * Tiny synthesized sound effects (no audio files). Uses Phaser's Web Audio
 * context, so Phaser's "unlock on first tap/click" handling applies. Silently
 * does nothing where Web Audio isn't available.
 *
 * Every disaster has a signature sound when it's unleashed (see
 * DISASTER_SOUNDS in disasterSounds.ts) plus sounds at its big moments.
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
  | 'roar'
  // Disasters
  | 'wind'
  | 'volcano'
  | 'erupt'
  | 'blackhole'
  | 'hum'
  | 'crackle'
  | 'whistle'
  | 'villain'
  | 'quake'
  | 'swell'
  | 'wave'
  | 'charge'
  | 'beam'
  | 'fuse'
  | 'tick'
  | 'ufo'
  | 'abduct'
  | 'giant'
  | 'stomp'
  | 'swarm'
  | 'horn'
  | 'shimmer'
  | 'party'
  | 'lava'
  | 'bubble'
  | 'blizzard'
  | 'kaiju'
  | 'nuke';

/** Minimum gap between two plays of the same sound, so a 50-fighter brawl isn't a wall of noise. */
const MIN_GAP_MS: Partial<Record<SfxName, number>> = {
  shoot: 70,
  laser: 90,
  slash: 70,
  hit: 60,
  explode: 90,
  kill: 80,
  teleport: 120,
  buzz: 300,
  groan: 900,
  wind: 1300,
  erupt: 650,
  hum: 1100,
  whistle: 140,
  tick: 300,
  bubble: 150,
  blizzard: 1800,
  quake: 1400,
  ufo: 1400,
  wave: 600,
  stomp: 150,
  abduct: 400,
  beam: 200,
};

const MUTE_KEY = 'random-ahh:muted';
/** Overall volume. A limiter after it keeps stacked disasters from distorting. */
const MASTER = 0.45;

const BADGE_CSS = `position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:20;display:none;
  padding:8px 14px;border-radius:999px;border:2px solid #ffd23f;background:#141726ee;color:#ffd23f;
  font:bold 14px monospace;cursor:pointer;box-shadow:0 2px 10px #0008`;

interface NoiseOpts {
  /** Filter: bandpass (default), lowpass or highpass. */
  type?: BiquadFilterType;
  hz: number;
  /** Sweep the filter to this frequency over the sound. */
  toHz?: number;
  vol: number;
  /** Fade-in time (s): swells instead of hits. */
  attack?: number;
  q?: number;
}

class Sfx {
  private ctx?: AudioContext;
  private master?: GainNode;
  private noiseBuf?: AudioBuffer;
  private _muted = false;
  private badge?: HTMLButtonElement;

  constructor() {
    try {
      this._muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      /* storage unavailable: default to sound on */
    }
  }

  /**
   * Call once with the game, after boot. Browsers keep audio paused until the
   * first click/tap/key press, so we resume it on any of those (capture phase:
   * our text boxes stop key events from bubbling), keep it running when the
   * window loses focus (the host may have the game on a second screen), and
   * show a "click to turn on sound" badge whenever it's blocked or muted.
   */
  attach(game: Phaser.Game): void {
    const mgr = game.sound as Phaser.Sound.WebAudioSoundManager;
    let ctx: AudioContext | undefined = mgr && 'context' in mgr ? mgr.context : undefined;
    if (mgr) mgr.pauseOnBlur = false;
    if (!ctx) {
      try {
        ctx = new AudioContext();
      } catch {
        return; // no Web Audio at all
      }
    }
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this._muted ? 0 : MASTER;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.2;
    this.master.connect(limiter).connect(ctx.destination);
    const wake = () => this.wake();
    for (const ev of ['pointerdown', 'touchend', 'keydown', 'mousedown']) window.addEventListener(ev, wake, { capture: true });
    ctx.addEventListener('statechange', () => this.updateBadge());
    this.makeBadge();
    // Three seconds of white noise, reused for hits, whooshes and rumbles.
    this.noiseBuf = this.ctx.createBuffer(1, this.ctx.sampleRate * 3, this.ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }

  get muted(): boolean {
    return this._muted;
  }

  /** Is sound actually coming out (not muted, not blocked by the browser)? */
  get audible(): boolean {
    return !!this.ctx && this.ctx.state === 'running' && !this._muted;
  }

  /** Resume audio if the browser paused it (works from a click/tap/key press, or after one). */
  private wake(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'running' || ctx.state === 'closed') return;
    const now = performance.now();
    if (now - this.wokeAt < 500) return; // sounds call this a lot; twice a second is plenty
    this.wokeAt = now;
    ctx.resume().catch(() => {});
  }
  private wokeAt = -1e9;

  private makeBadge(): void {
    if (typeof document === 'undefined' || this.badge) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.style.cssText = BADGE_CSS;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this._muted) this.toggleMute();
      this.wake();
      window.setTimeout(() => {
        this.updateBadge();
        this.play('click');
      }, 50);
    });
    document.body.append(b);
    this.badge = b;
    this.updateBadge();
    // Some browsers don't fire statechange reliably: check now and then.
    window.setInterval(() => this.updateBadge(), 1000);
  }

  private updateBadge(): void {
    const b = this.badge;
    if (!b) return;
    // Players' controllers don't play sound: no badge there.
    if (document.documentElement.classList.contains('controller')) {
      b.style.display = 'none';
      return;
    }
    const blocked = !this.ctx || this.ctx.state !== 'running';
    b.textContent = this._muted ? '🔇 Sound is off · click to turn it on' : '🔇 Click to turn on sound';
    b.style.display = this._muted || blocked ? 'block' : 'none';
  }

  toggleMute(): boolean {
    this._muted = !this._muted;
    if (this.master) this.master.gain.value = this._muted ? 0 : MASTER;
    try {
      localStorage.setItem(MUTE_KEY, this._muted ? '1' : '0');
    } catch {
      /* ignore */
    }
    this.updateBadge();
    return this._muted;
  }

  private last = new Map<SfxName, number>();

  play(name: SfxName): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this._muted) return;
    if (ctx.state !== 'running') {
      // Paused by the browser: try to wake it (allowed once the page has had a click) and skip this one.
      this.wake();
      return;
    }
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

      // ---------------------------------------------------------- disasters
      case 'wind': // tornado: a howling gust that swells and fades
        this.noise(t, 1.5, { hz: 350, toHz: 1300, vol: 1.6, attack: 0.5, q: 1.2 });
        return this.noise(t + 0.2, 1.2, { hz: 1500, toHz: 500, vol: 0.5, attack: 0.4, q: 6 });
      case 'volcano': // deep rumble with rock crackle on top
        this.noise(t, 1.8, { type: 'lowpass', hz: 110, toHz: 60, vol: 1.1, attack: 0.25 });
        for (let k = 0; k < 6; k++) this.burst(t + 0.2 + Math.random() * 1.2, 0.05, 2500 + Math.random() * 2000, 0.3);
        return;
      case 'erupt': // each lava burst: a boom
        this.tone('sine', 90, 35, t, 0.55, 0.6);
        return this.noise(t, 0.5, { type: 'lowpass', hz: 600, toHz: 120, vol: 0.7 });
      case 'blackhole': // a warping, falling drone being sucked in
        this.wobble('sine', 420, 40, t, 1.6, 0.35, 5, 40);
        return this.noise(t, 1.6, { hz: 2000, toHz: 120, vol: 0.35, attack: 0.3, q: 4 });
      case 'hum': // the open hole's low throb
        return this.wobble('sine', 55, 55, t, 1.2, 0.35, 4, 8);
      case 'crackle': // lightning gathering: electric zaps
        for (let k = 0; k < 7; k++) {
          const at = t + Math.random() * 0.6;
          this.burst(at, 0.04, 4000 + Math.random() * 3000, 0.5);
          if (k % 2) this.tone('sawtooth', 2400, 3200, at, 0.05, 0.08);
        }
        return;
      case 'whistle': // something falling from the sky
        return this.tone('sine', 1900 + Math.random() * 300, 380, t, 0.85, 0.13);
      case 'villain': // Dr Doom: "mwa-ha-ha-HAA"
        [233, 220, 196].forEach((f, i) => this.wobble('sawtooth', f, f * 0.94, t + i * 0.2, 0.17, 0.4, 9, 6));
        return this.wobble('sawtooth', 165, 98, t + 0.62, 0.6, 0.45, 7, 8);
      case 'quake': // the ground groaning
        this.noise(t, 2.0, { type: 'lowpass', hz: 70, toHz: 45, vol: 1.3, attack: 0.3 });
        return this.wobble('sine', 38, 32, t, 2.0, 0.35, 3, 4);
      case 'swell': // tsunami on the horizon: the sea drawing back
        return this.noise(t, 1.8, { type: 'lowpass', hz: 300, toHz: 1400, vol: 0.6, attack: 1.2 });
      case 'wave': // the wave crashing in
        this.noise(t, 1.4, { type: 'lowpass', hz: 2500, toHz: 250, vol: 0.9 });
        return this.noise(t, 0.8, { type: 'highpass', hz: 3000, vol: 0.25 });
      case 'charge': // orbital laser powering up
        this.tone('sine', 180, 2400, t, 1.1, 0.14);
        return this.tone('square', 90, 1200, t, 1.1, 0.04);
      case 'beam': // the beam from space hits
        this.tone('sawtooth', 900, 110, t, 0.7, 0.32);
        return this.noise(t, 0.7, { hz: 2500, toHz: 400, vol: 0.5 });
      case 'fuse': // mega bomb: falling whistle, then a fizzing fuse
        this.tone('sine', 1500, 500, t, 0.6, 0.12);
        return this.noise(t + 0.4, 1.0, { type: 'highpass', hz: 5000, vol: 0.18 });
      case 'tick': // bomb countdown
        return this.tone('square', 1250, 1250, t, 0.05, 0.22);
      case 'ufo': // the saucer's warbling hum
        return this.wobble('sine', 720, 760, t, 1.3, 0.45, 7, 110);
      case 'abduct': // tractor beam lifting someone up
        this.wobble('triangle', 220, 1500, t, 1.0, 0.18, 12, 30);
        return this.tone('sine', 440, 1760, t + 0.1, 0.9, 0.08);
      case 'giant': // "fee, fi, fo, fum"
        [98, 92, 82, 65].forEach((f, i) => this.tone('square', f, f * 0.97, t + i * 0.28, 0.24, 0.22));
        return;
      case 'stomp': // a foot the size of a house landing
        this.tone('sine', 85, 24, t, 0.8, 0.9);
        return this.noise(t, 0.6, { type: 'lowpass', hz: 220, toHz: 60, vol: 0.9 });
      case 'swarm': // a cloud of bees arriving
        [196, 208, 221, 234].forEach((f) => this.wobble('sawtooth', f, f * 1.05, t, 1.2, 0.1, 23, 9));
        return;
      case 'horn': // logo ram: a big truck horn, then rumbling wheels
        this.tone('square', 233, 233, t, 0.55, 0.14);
        this.tone('square', 294, 294, t, 0.55, 0.12);
        return this.noise(t + 0.3, 1.0, { type: 'lowpass', hz: 160, vol: 0.6, attack: 0.1 });
      case 'shimmer': // Thanos: the gauntlet's stones glowing
        [1568, 1976, 2349, 2637, 3136].forEach((f, i) => this.tone('triangle', f, f, t + i * 0.09, 0.3, 0.1));
        return this.wobble('sine', 98, 98, t, 1.2, 0.2, 2, 3);
      case 'party': // disco: a funky little riff
        [110, 165, 110, 220].forEach((f, i) => this.tone('square', f, f, t + i * 0.13, 0.11, 0.2));
        [659, 784, 880, 1047].forEach((f, i) => this.tone('triangle', f, f, t + 0.06 + i * 0.13, 0.08, 0.12));
        return;
      case 'lava': // the floor heating up: a rising hiss
        this.noise(t, 1.6, { type: 'highpass', hz: 2500, toHz: 5000, vol: 0.25, attack: 1.0 });
        return this.noise(t, 1.6, { type: 'lowpass', hz: 120, vol: 0.7, attack: 0.6 });
      case 'bubble': { // a lava bubble popping
        const f = 250 + Math.random() * 300;
        return this.tone('sine', f, f * 2.2, t, 0.07, 0.25);
      }
      case 'blizzard': // icy howling wind with a whistle in it
        this.noise(t, 2.2, { hz: 1300, toHz: 2300, vol: 0.85, attack: 0.7, q: 2 });
        return this.wobble('sine', 950, 1150, t + 0.2, 1.6, 0.1, 3, 60);
      case 'kaiju': // Godzilla's roar: growly, rattling, long
        this.wobble('sawtooth', 190, 70, t, 1.6, 0.4, 22, 14);
        this.wobble('square', 95, 45, t, 1.6, 0.12, 17, 6);
        return this.noise(t, 1.6, { hz: 700, toHz: 200, vol: 0.45, attack: 0.15, q: 2 });
      case 'nuke': // the biggest boom in the game
        this.tone('sine', 70, 18, t, 3.2, 1.0);
        this.noise(t, 3.2, { type: 'lowpass', hz: 900, toHz: 50, vol: 1.2 });
        return this.noise(t + 0.15, 2.5, { type: 'lowpass', hz: 200, toHz: 40, vol: 0.8 });
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

  /** A tone with vibrato (an LFO on its pitch): warbles, growls, throbs. */
  private wobble(type: OscillatorType, from: number, to: number, at: number, dur: number, vol: number, lfoHz: number, depthHz: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + dur);
    lfo.frequency.value = lfoHz;
    lfoGain.gain.value = depthHz;
    lfo.connect(lfoGain).connect(osc.frequency);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(vol, at + Math.min(0.08, dur / 4));
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(gain).connect(this.master!);
    osc.start(at);
    lfo.start(at);
    osc.stop(at + dur + 0.02);
    lfo.stop(at + dur + 0.02);
  }

  /** Filtered noise: hits and whooshes. With `toHz`, the filter sweeps (whoosh). */
  private burst(at: number, dur: number, hz: number, vol: number, toHz?: number): void {
    this.noise(at, dur, { hz, toHz, vol });
  }

  /** Filtered noise with optional fade-in: rumbles, wind, waves, hiss. */
  private noise(at: number, dur: number, o: NoiseOpts): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf!;
    const filter = ctx.createBiquadFilter();
    filter.type = o.type ?? 'bandpass';
    if (o.q) filter.Q.value = o.q;
    filter.frequency.setValueAtTime(o.hz, at);
    if (o.toHz) filter.frequency.exponentialRampToValueAtTime(o.toHz, at + dur);
    const gain = ctx.createGain();
    if (o.attack) {
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(o.vol, at + o.attack);
    } else gain.gain.setValueAtTime(o.vol, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(filter).connect(gain).connect(this.master!);
    // Start somewhere random in the buffer so repeated rumbles don't sound identical.
    src.start(at, Math.random() * Math.max(0, 3 - dur));
    src.stop(at + dur + 0.02);
  }
}

/** The game's one sound player. */
export const sfx = new Sfx();
