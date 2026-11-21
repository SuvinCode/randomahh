/**
 * A player's controller (phone or laptop), opened from the host's QR code:
 * /join?room=ABCD. No Phaser here: the host's browser runs the battle and
 * streams snapshots; this page draws them (arenaView.ts), sends buttons, and
 * shows your health, weapon and status.
 *
 * Phones (landscape): the arena fills the screen and follows you, with
 * see-through ◀ ▶ bottom-left (slide between them), attack and jump
 * bottom-right. Upright: arena on top, buttons below. Laptops: WASD / arrows,
 * Space or W to jump, J/K/F to attack.
 */
import { POWERUPS, WEAPONS_CATALOG, MAX_NAME } from '@shared/commands';
import { decodeFrame } from '@shared/frame';
import { BTN, MAX_HOST_MESSAGE_BYTES, PlayerToServerSchema, ServerToPlayerSchema, WS_PATH, decode, normalizeCode, type PlayerToServer, type You } from '@shared/room';
import { ArenaView } from './arenaView';
import './controller.css';

const NAME_KEY = 'random-ahh:player-name';
const PID_KEY = 'random-ahh:player-id';

const KEYS: Record<string, number> = {
  KeyA: BTN.left,
  ArrowLeft: BTN.left,
  KeyD: BTN.right,
  ArrowRight: BTN.right,
  KeyW: BTN.jump,
  ArrowUp: BTN.jump,
  Space: BTN.jump,
  KeyS: BTN.down,
  ArrowDown: BTN.down,
  KeyJ: BTN.attack,
  KeyK: BTN.attack,
  KeyF: BTN.attack,
  Enter: BTN.attack,
  ShiftLeft: BTN.attack,
};

function store(key: string, value?: string): string | null {
  try {
    if (value !== undefined) localStorage.setItem(key, value);
    return localStorage.getItem(key);
  } catch {
    return value ?? null;
  }
}

/** Stable per device, so a reload or a dropped connection gets your fighter back. */
function playerId(): string {
  const old = store(PID_KEY);
  if (old && /^[a-z0-9]{8,24}$/.test(old)) return old;
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const id = [...bytes].map((b) => (b % 36).toString(36)).join('');
  return store(PID_KEY, id) ?? id;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export function startController(): void {
  document.title = 'Random Ahh · Join';
  const code = normalizeCode(new URLSearchParams(location.search).get('room') ?? '');
  showJoin(code ?? '', '');
}

// ---------------------------------------------------------------------------
// Join form

function showJoin(code: string, error: string): void {
  document.querySelector('.join, .ctl, .banner')?.remove();
  const form = el('form', 'join');
  form.innerHTML = `
    <h1>RANDOM AHH</h1>
    <p class="sub">Join the battle on the big screen</p>
    <div class="fields">
      <label>Your name<input class="name" maxlength="${MAX_NAME}" autocomplete="nickname" enterkeyhint="go" placeholder="e.g. Banana Bob" /></label>
      <label>Room code<input class="code" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCD" /></label>
    </div>
    <button type="submit">JOIN ▶</button>
    <p class="err" role="alert"></p>`;
  document.body.append(form);
  const name = form.querySelector<HTMLInputElement>('.name')!;
  const codeIn = form.querySelector<HTMLInputElement>('.code')!;
  const err = form.querySelector<HTMLElement>('.err')!;
  name.value = store(NAME_KEY) ?? '';
  codeIn.value = code;
  err.textContent = error;
  (name.value && !code ? codeIn : name).focus();
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const c = normalizeCode(codeIn.value);
    const n = name.value.trim();
    if (!n) {
      err.textContent = 'Type your name first.';
      name.focus();
      return;
    }
    if (!c) {
      err.textContent = 'The room code is 4 letters (on the host’s screen).';
      codeIn.focus();
      return;
    }
    store(NAME_KEY, n);
    history.replaceState(null, '', `/join?room=${c}`);
    goBig();
    new Controller(c, n).connect();
  });
}

/** Phones: fullscreen + landscape where the browser allows it (needs a tap). */
function goBig(): void {
  const doc = document.documentElement;
  if (!matchMedia('(pointer: coarse)').matches || document.fullscreenElement || !doc.requestFullscreen) return;
  doc
    .requestFullscreen({ navigationUI: 'hide' })
    .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
    .catch(() => {
      /* not supported (iOS): the "turn sideways" hint covers it */
    });
}

// ---------------------------------------------------------------------------
// Controller

class Controller {
  private ws: WebSocket | null = null;
  private readonly pid = playerId();
  private buttons = 0;
  private readonly touches = new Map<number, number>();
  private keys = 0;
  private you: You | null = null;
  private retryMs = 800;
  private closed = false;
  private hostOn = true;
  private wakeLock: { release(): Promise<void> } | null = null;
  private readonly root: HTMLElement;
  private readonly view: ArenaView;
  private msgTimer = 0;
  private readonly ui: {
    name: HTMLElement;
    bar: HTMLElement;
    hpnum: HTMLElement;
    gear: HTMLElement;
    stats: HTMLElement;
    msg: HTMLElement;
    say: HTMLElement;
    turn: HTMLElement;
    top: HTMLElement;
    attackIco: HTMLElement;
  };

  constructor(
    private readonly code: string,
    private readonly name: string,
  ) {
    document.querySelector('.join')?.remove();
    this.root = el('div', 'ctl idle center');
    this.root.innerHTML = `
      <canvas class="view" aria-label="The arena"></canvas>
      <header class="top">
        <span class="name"></span>
        <span class="hp"><span class="bar"><i></i></span><span class="hpnum"></span></span>
        <span class="gear"></span>
        <span class="stats"></span>
      </header>
      <div class="pad left">
        <button class="btn arrow" data-b="${BTN.left}" aria-label="Left">◀</button>
        <button class="btn arrow" data-b="${BTN.right}" aria-label="Right">▶</button>
        <button class="btn down" data-b="${BTN.down}" aria-label="Fly down">▼</button>
      </div>
      <div class="msg" aria-live="polite"></div>
      <div class="say" aria-live="polite"></div>
      <div class="pad right">
        <button class="btn attack" data-b="${BTN.attack}" aria-label="Attack"><span class="ico">⚔️</span><small>ATTACK</small></button>
        <button class="btn jump" data-b="${BTN.jump}" aria-label="Jump">⤒<small>JUMP</small></button>
      </div>
      <div class="keys">A/D or ←/→ move · W/Space jump · S down (flying) · J attack</div>
      <div class="turn">↻ Turn sideways for a bigger view</div>`;
    document.body.append(this.root);
    const q = <T extends HTMLElement>(s: string) => this.root.querySelector<T>(s)!;
    this.ui = {
      name: q('.name'),
      bar: q('.bar i'),
      hpnum: q('.hpnum'),
      gear: q('.gear'),
      stats: q('.stats'),
      msg: q('.msg'),
      say: q('.say'),
      turn: q('.turn'),
      top: q('.top'),
      attackIco: q('.attack .ico'),
    };
    this.view = new ArenaView(q<HTMLCanvasElement>('.view'));
    const layout = () => this.layout();
    window.addEventListener('resize', layout);
    window.visualViewport?.addEventListener('resize', layout);
    layout();
    this.ui.name.textContent = name;
    this.setMsg('Connecting…');
    this.bindTouch();
    this.bindKeys();
    window.setInterval(() => this.sendButtons(true), 1000);
  }

  connect(): void {
    if (this.closed) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}${WS_PATH}`);
    this.ws = ws;
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      this.send({ t: 'join', code: this.code, pid: this.pid, name: this.name });
    };
    ws.onmessage = (e) => {
      // Binary = an arena frame (shared/frame.ts); everything else is JSON.
      if (e.data instanceof ArrayBuffer) {
        const frame = this.view.hasArena ? decodeFrame(new Uint8Array(e.data)) : null;
        if (frame) this.view.push(frame);
        return;
      }
      const m = decode(ServerToPlayerSchema, String(e.data), MAX_HOST_MESSAGE_BYTES);
      if (!m) return;
      switch (m.t) {
        case 'joined':
          this.retryMs = 800;
          this.ui.name.textContent = m.name;
          this.setMsg('You’re in! Waiting for the host…');
          this.keepAwake();
          this.sendButtons(true);
          return;
        case 'host':
          this.hostOn = m.on;
          this.root.classList.toggle('center', !m.on || this.you?.phase !== 'fight');
          if (!m.on) this.setMsg('The host’s screen lost connection… hang on.');
          else if (this.you) this.render(this.you);
          return;
        case 'bye':
          this.closed = true;
          ws.close();
          this.leave(m.reason);
          return;
        case 'you':
          this.render(m);
          return;
        case 'arena':
          this.view.setArena(m);
          this.layout();
          return;
        case 'roster':
          this.view.setRoster(m);
          return;
        case 'say':
          this.say(m.text, m.color);
          return;
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws || this.closed) return;
      this.ws = null;
      this.root.classList.add('center');
      this.setMsg('Reconnecting…');
      window.setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 5000);
    };
  }

  private leave(reason: string): void {
    this.root.remove();
    this.wakeLock?.release().catch(() => {});
    showJoin(this.code, reason);
  }

  // ---------------------------------------------------------------- input

  private bindTouch(): void {
    // Each finger presses whichever button it's over, so a thumb can slide from ◀ to ▶.
    const update = (e: PointerEvent) => {
      const under = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-b]');
      const bit = under && this.root.contains(under) ? Number(under.dataset.b) : 0;
      if (bit) this.touches.set(e.pointerId, bit);
      else this.touches.delete(e.pointerId);
      this.sync();
    };
    const end = (e: PointerEvent) => {
      this.touches.delete(e.pointerId);
      this.sync();
    };
    this.root.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      update(e);
    });
    this.root.addEventListener('pointermove', (e) => {
      if (this.touches.has(e.pointerId) || e.buttons) update(e);
    });
    this.root.addEventListener('pointerup', end);
    this.root.addEventListener('pointercancel', end);
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    // Long-presses must not select text or open menus.
    this.root.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  }

  private bindKeys(): void {
    const set = (e: KeyboardEvent, down: boolean) => {
      const bit = KEYS[e.code];
      if (!bit) return;
      e.preventDefault();
      this.keys = down ? this.keys | bit : this.keys & ~bit;
      this.sync();
    };
    window.addEventListener('keydown', (e) => set(e, true));
    window.addEventListener('keyup', (e) => set(e, false));
    // Let go of everything when the app is hidden (or a finger slides off the screen).
    const release = () => {
      this.keys = 0;
      this.touches.clear();
      this.sync();
    };
    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) release();
      else this.keepAwake();
    });
  }

  private sync(): void {
    let b = this.keys;
    for (const bit of this.touches.values()) b |= bit;
    for (const btn of this.root.querySelectorAll<HTMLElement>('[data-b]')) btn.classList.toggle('on', (b & Number(btn.dataset.b)) !== 0);
    if (b === this.buttons) return;
    if ((b & ~this.buttons) !== 0) navigator.vibrate?.(8);
    this.buttons = b;
    this.sendButtons(false);
  }

  private sendButtons(heartbeat: boolean): void {
    if (heartbeat && !this.buttons) return;
    this.send({ t: 'in', b: this.buttons });
  }

  private send(m: PlayerToServer): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    if (!PlayerToServerSchema.safeParse(m).success) return;
    this.ws.send(JSON.stringify(m));
  }

  // --------------------------------------------------------------- screen

  private render(y: You): void {
    const prev = this.you;
    this.you = y;
    this.root.style.setProperty('--c', y.color);
    this.ui.name.textContent = y.name;
    const fighting = y.phase === 'fight';
    this.root.classList.toggle('idle', !fighting);
    this.root.classList.toggle('center', !fighting || !this.hostOn);
    // Follow your fighter while you're in it; once out, watch the whole arena.
    this.view.me = y.fid;
    if (y.phase === 'lobby') this.view.clear();
    this.root.classList.toggle('flying', fighting && y.powerups.includes('flight'));
    const hp = Math.ceil(y.hp);
    this.ui.bar.style.width = `${hp}%`;
    this.ui.bar.style.background = hp > 50 ? '#4ade80' : hp > 25 ? '#facc15' : '#ef4444';
    this.ui.hpnum.textContent = fighting ? `${hp}` : '';
    const weapon = WEAPONS_CATALOG[y.weapon];
    this.ui.gear.textContent = fighting ? `${weapon.emoji}${y.powerups.map((p) => POWERUPS[p].emoji).join('')}` : '';
    this.ui.attackIco.textContent = fighting ? weapon.emoji : '⚔️';
    this.ui.stats.textContent = y.phase === 'lobby' ? '' : `💀 ${y.kills}${y.alive ? ` · 👥 ${y.alive}` : ''}`;

    if (!this.hostOn) return;
    if (y.phase === 'over' && y.place === 1) this.setMsg(y.msg, '🏆');
    else if (y.phase === 'out' || y.phase === 'over') this.setMsg(y.msg, y.place ? `#${y.place}` : '');
    else if (fighting) this.flashMsg(y.msg);
    else this.setMsg(y.msg);

    // Feel it: a buzz when hit, a long one when knocked out.
    if (prev && prev.phase === 'fight') {
      if (y.phase === 'out') navigator.vibrate?.([90, 50, 220]);
      else if (y.hp < prev.hp - 0.5) {
        navigator.vibrate?.(35);
        this.root.classList.remove('hurt');
        void this.root.offsetWidth;
        this.root.classList.add('hurt');
      }
    }
    if (prev?.phase !== 'fight' && fighting) navigator.vibrate?.([40, 40, 40]);
  }

  /** While fighting, status lines show for a few seconds and then get out of the way. */
  private flashMsg(text: string): void {
    if (this.ui.msg.textContent === text && this.ui.msg.dataset.shown === text) return;
    this.ui.msg.dataset.shown = text;
    this.setMsg(text);
    this.ui.msg.classList.remove('hide');
    window.clearTimeout(this.msgTimer);
    this.msgTimer = window.setTimeout(() => this.ui.msg.classList.add('hide'), 3000);
  }

  private say(text: string, color: string): void {
    const s = this.ui.say;
    s.textContent = text;
    s.style.color = color;
    s.classList.remove('show');
    void s.offsetWidth;
    s.classList.add('show');
  }

  /** The arena goes under the status bar; upright, status lines go under the arena. */
  private layout(): void {
    const bar = this.ui.top.getBoundingClientRect();
    this.view.topInset = bar.bottom + 4;
    const arenaH = Math.min(window.innerWidth * (540 / 960), window.innerHeight - bar.bottom - 8);
    this.root.style.setProperty('--arena-bottom', `${Math.round(bar.bottom + 4 + arenaH)}px`);
  }

  private setMsg(text: string, big = ''): void {
    this.ui.msg.classList.remove('hide');
    if (!big) delete this.ui.msg.dataset.shown;
    this.ui.msg.replaceChildren();
    if (big) this.ui.msg.append(el('span', 'big'), document.createTextNode(text));
    else this.ui.msg.textContent = text;
    if (big) (this.ui.msg.firstChild as HTMLElement).textContent = big;
  }

  /** Keep the screen on while playing (where supported). */
  private keepAwake(): void {
    const wl = (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock;
    if (!wl || document.hidden) return;
    wl.request('screen')
      .then((l) => (this.wakeLock = l))
      .catch(() => {});
  }
}
