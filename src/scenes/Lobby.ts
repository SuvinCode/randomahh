import Phaser from 'phaser';
import qrcode from 'qrcode-generator';
import { MAX_FIGHTERS } from '@shared/commands';
import { MAX_ROOM_PLAYERS } from '@shared/room';
import { addNames, randomNames } from '@shared/names';
import { sfx } from '../audio/sfx';
import { ARENA, COMBAT_ENABLED, GAME_HEIGHT, REGISTRY_KEYS } from '../config';
import { hostRoom, joinBaseUrl } from '../net/hostRoom';
import { waitingYou } from '../net/youState';
import { fighterColors } from '../textures';
import { canGoFullscreen, goFullscreen, title } from './ui';

const STORE_KEY = 'random-ahh:roster';

const CSS = `
.lobby-wrap { width: 920px; display: flex; gap: 16px; align-items: flex-start; }
.lobby { flex: 1; min-width: 0; font: 14px monospace; color: #fff; display: flex; flex-direction: column; gap: 10px; }
.party { width: 240px; flex: none; box-sizing: border-box; padding: 12px; border-radius: 12px; background: #1d2036;
  border: 2px solid #4cc9f0; font: 13px monospace; color: #c9c9e0; display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center; }
.party h2 { margin: 0; font-size: 15px; color: #4cc9f0; letter-spacing: 1px; }
.party .qr { width: 196px; height: 196px; border-radius: 10px; background: #fff; display: flex; align-items: center; justify-content: center;
  color: #141726; overflow: hidden; padding: 0 8px; box-sizing: border-box; }
.party .qr svg { width: 196px; height: 196px; display: block; flex: none; }
.party .code { font: bold 40px monospace; letter-spacing: 8px; color: #ffd23f; line-height: 1; padding-left: 8px; }
.party .url { font-size: 12px; color: #fff; word-break: break-all; }
.party .hint { font-size: 11px; color: #9a9ab5; line-height: 1.4; }
.party .warn { color: #ff8a8a; }
.party .joined { font-size: 13px; font-weight: bold; color: #4cc9f0; }
.party .joined.full { color: #ff8a8a; }
.chip.player { background: #102a35; }
.lobby-row { display: flex; gap: 8px; }
.lobby input { flex: 1; min-width: 0; height: 42px; box-sizing: border-box; padding: 0 14px; border-radius: 10px;
  border: 2px solid #ffd23f; background: #0d0f1a; color: #fff; font: 16px monospace; outline: none; }
.lobby input::placeholder { color: #8a8aa8; }
.lobby button { height: 42px; padding: 0 16px; border-radius: 10px; border: 2px solid #ffd23f; background: transparent;
  color: #ffd23f; font: bold 14px monospace; cursor: pointer; white-space: nowrap; }
.lobby button.primary { background: #ffd23f; color: #141726; }
.lobby button.start { height: 52px; font-size: 20px; background: #ff5d73; border-color: #ff5d73; color: #fff; }
.lobby button:disabled { opacity: .4; cursor: default; }
.lobby-list { height: 270px; overflow-y: auto; display: flex; flex-wrap: wrap; align-content: flex-start; gap: 6px;
  padding: 10px; border-radius: 10px; background: #0d0f1a; border: 1px solid #33365a; box-sizing: border-box; }
.lobby-empty { color: #7d7d99; margin: auto; text-align: center; line-height: 1.6; }
.chip { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 6px 0 10px; border-radius: 15px;
  background: #1d2036; border: 2px solid var(--c); font: 13px monospace; }
.chip button { height: 22px; width: 22px; padding: 0; border: 0; border-radius: 11px; background: #33365a; color: #fff; font-size: 12px; }
.lobby-info { display: flex; justify-content: space-between; color: #9a9ab5; font-size: 13px; }
`;

const css = (c: number) => Phaser.Display.Color.IntegerToColor(c).rgba;

/** Add the fighters: type names (or paste a list), add random ones, then start. */
export class LobbyScene extends Phaser.Scene {
  private names: string[] = [];
  private els!: {
    input: HTMLInputElement;
    list: HTMLElement;
    count: HTMLElement;
    start: HTMLButtonElement;
    qr: HTMLElement;
    code: HTMLElement;
    url: HTMLElement;
    hint: HTMLElement;
    joined: HTMLElement;
  };
  private joinBase: { url: string; lanOnly: boolean; warn?: string } | null = null;
  private shownQr = '';

  constructor() {
    super('Lobby');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#141726');
    this.input.keyboard?.disableGlobalCapture();
    this.names = (this.registry.get(REGISTRY_KEYS.roster) as string[] | undefined) ?? loadRoster();
    const cx = ARENA.width / 2;
    title(this, cx, 52, 'RANDOM AHH', 64, '#ffd23f');
    title(this, cx, 104, COMBAT_ENABLED ? 'scan to play from your phone · or add bots · then play god' : 'scan to join · survive the disasters · you play god', 18, '#c9c9e0');

    const html = `
      <div class="lobby-wrap"><style>${CSS}</style>
      <div class="party" aria-label="Join from your phone">
        <h2>📱 SCAN TO JOIN</h2>
        <div class="qr" role="img" aria-label="QR code to join">…</div>
        <div class="code" aria-label="Room code">····</div>
        <div class="url"></div>
        <div class="joined"></div>
        <div class="hint"></div>
      </div>
      <div class="lobby">
        <div class="lobby-row">
          <input class="name" maxlength="400" autocomplete="off" spellcheck="false" enterkeyhint="done"
            placeholder="Type a name and press Enter (or paste: Ann, Bob, Cat)" aria-label="Fighter name" />
          <button class="primary" data-a="add" type="button">Add</button>
        </div>
        <div class="lobby-row">
          <button data-a="rand5" type="button">+5 random</button>
          <button data-a="rand10" type="button">+10 random</button>
          <button data-a="clear" type="button">Clear all</button>
        </div>
        <div class="lobby-list" aria-label="Fighters"></div>
        <div class="lobby-info"><span class="count"></span><span>Last one standing wins.</span></div>
        <button class="start" data-a="start" type="button">⚔️ START BATTLE</button>
      </div></div>`;
    const dom = this.add.dom(cx, 136).createFromHTML(html).setOrigin(0.5, 0);
    const root = dom.node as HTMLElement;
    this.els = {
      input: root.querySelector('.name')!,
      list: root.querySelector('.lobby-list')!,
      count: root.querySelector('.count')!,
      start: root.querySelector('[data-a="start"]')!,
      qr: root.querySelector('.qr')!,
      code: root.querySelector('.code')!,
      url: root.querySelector('.url')!,
      hint: root.querySelector('.hint')!,
      joined: root.querySelector('.joined')!,
    };
    const add = () => {
      const v = this.els.input.value;
      if (!v.trim()) return;
      // Bots can't take a player's name (or each other's).
      const players = hostRoom.list().map((p) => p.name);
      this.setNames([...this.names, ...addNames([...players, ...this.names], v).slice(players.length + this.names.length)]);
      this.els.input.value = '';
      sfx.play('click');
    };
    this.els.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        if (!this.els.input.value.trim() && this.names.length >= 2) this.start();
        else add();
      }
    });
    root.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!btn) return;
      if (btn.dataset.kick) {
        hostRoom.kick(btn.dataset.kick);
        return;
      }
      const remove = btn.dataset.remove;
      if (remove !== undefined) {
        this.setNames(this.names.filter((_, i) => i !== Number(remove)));
        return;
      }
      switch (btn.dataset.a) {
        case 'add':
          return add();
        case 'rand5':
        case 'rand10':
          sfx.play('click');
          return this.setNames([...this.names, ...randomNames([...hostRoom.list().map((p) => p.name), ...this.names], btn.dataset.a === 'rand5' ? 5 : 10)]);
        case 'clear':
          return this.setNames([]);
        case 'start':
          return this.start();
      }
    });
    // The party room: phones and laptops join by QR code and play their own fighter.
    hostRoom.reservedNames = () => this.names;
    hostRoom.dropDisconnected();
    hostRoom.start();
    const off = hostRoom.on('change', () => this.render());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, off);
    void joinBaseUrl().then((base) => {
      this.joinBase = base;
      if (this.scene.isActive()) this.render();
    });

    this.render();
    if (!this.sys.game.device.input.touch) window.setTimeout(() => this.els.input.focus(), 0);

    if (canGoFullscreen(this) && this.sys.game.device.input.touch) {
      const fs = this.add
        .text(ARENA.width - 14, 14, '⛶ Full screen', { fontFamily: 'monospace', fontSize: '15px', color: '#ffd23f', backgroundColor: '#00000066', padding: { x: 8, y: 6 } })
        .setOrigin(1, 0)
        .setInteractive({ useHandCursor: true });
      fs.on('pointerup', () => {
        goFullscreen(this);
        fs.destroy();
      });
    }
    const sound = title(this, cx, GAME_HEIGHT - 16, '', 13, '#9a9ab5').setInteractive({ useHandCursor: true });
    const showSound = () => sound.setText(`Sound: ${sfx.muted ? 'off' : 'on'} (tap to change)`);
    showSound();
    sound.on('pointerup', () => {
      sfx.toggleMute();
      showSound();
    });
  }

  private setNames(names: string[]): void {
    this.names = names;
    saveRoster(names);
    this.render();
  }

  private render(): void {
    const { list, count, start } = this.els;
    const players = hostRoom.connected();
    const total = players.length + this.names.length;
    const colors = fighterColors(total, 0.12);
    const chip = (name: string, color: number, attr: 'kick' | 'remove', value: string, player: boolean) => {
      const el = document.createElement('span');
      el.className = player ? 'chip player' : 'chip';
      el.style.setProperty('--c', css(color));
      const label = document.createElement('span');
      label.textContent = player ? `📱 ${name}` : name;
      const x = document.createElement('button');
      x.type = 'button';
      x.dataset[attr] = value;
      x.textContent = '✕';
      x.setAttribute('aria-label', `Remove ${name}`);
      el.append(label, x);
      return el;
    };
    if (!total) {
      list.innerHTML =
        '<div class="lobby-empty">No fighters yet.<br>Scan the QR code to play from your phone,<br>or add bots: your cat, your boss… or hit “+10 random”.</div>';
    } else {
      list.replaceChildren(
        ...players.map((p, i) => chip(p.name, colors[i], 'kick', p.id, true)),
        ...this.names.map((name, i) => chip(name, colors[players.length + i], 'remove', String(i), false)),
      );
      list.scrollTop = list.scrollHeight;
    }
    const who = players.length ? `${players.length} 📱 + ${this.names.length} bots` : `${this.names.length} / ${MAX_FIGHTERS} fighters`;
    const over = total > MAX_FIGHTERS ? ` · only ${MAX_FIGHTERS} fit: ${total - MAX_FIGHTERS} bot${total - MAX_FIGHTERS === 1 ? '' : 's'} sit out` : '';
    count.textContent = `${who}${total < 2 ? ' · need at least 2' : over}`;
    start.disabled = total < 2;
    players.forEach((p, i) => hostRoom.sendYou(p.id, waitingYou(p.name, colors[i], "You're in! Waiting for the host to start…")));
    this.renderParty();
  }

  /** QR code, room code and address for players. */
  private renderParty(): void {
    const { qr, code, url, hint, joined } = this.els;
    const n = hostRoom.connected().length;
    joined.textContent = n >= MAX_ROOM_PLAYERS ? `📱 ${n} / ${MAX_ROOM_PLAYERS} joined · room full` : `📱 ${n} / ${MAX_ROOM_PLAYERS} joined`;
    joined.classList.toggle('full', n >= MAX_ROOM_PLAYERS);
    const base = this.joinBase;
    const keys = COMBAT_ENABLED
      ? 'Phones: ◀ ▶ jump · attack buttons<br>Laptops: WASD / arrows · J to attack'
      : 'Dodge the disasters!<br>Phones: ◀ ▶ + jump · Laptops: WASD / arrows';
    if (hostRoom.status !== 'open' || !hostRoom.code) {
      code.textContent = '····';
      qr.textContent = hostRoom.status === 'offline' ? 'Room server unreachable. Retrying…' : 'Opening a room…';
      this.shownQr = '';
      hint.innerHTML = keys;
      return;
    }
    code.textContent = hostRoom.code;
    if (!base) return;
    const link = `${base.url}/join?room=${hostRoom.code}`;
    if (link !== this.shownQr) {
      const q = qrcode(0, 'M');
      q.addData(link);
      q.make();
      qr.innerHTML = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
      this.shownQr = link;
    }
    url.textContent = `${base.url.replace(/^https?:\/\//, '')}/join`;
    hint.innerHTML = base.warn ? `<span class="warn">${base.warn}</span>` : base.lanOnly ? `Same Wi-Fi as this computer.<br>${keys}` : keys;
  }

  private start(): void {
    if (hostRoom.connected().length + this.names.length < 2) return;
    sfx.play('click');
    this.registry.set(REGISTRY_KEYS.roster, this.names);
    this.scene.start('Battle');
  }
}

export function loadRoster(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]');
    return Array.isArray(v) ? addNames([], v.filter((n) => typeof n === 'string').join(',')) : [];
  } catch {
    return [];
  }
}

function saveRoster(names: string[]): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(names));
  } catch {
    /* storage unavailable */
  }
}
