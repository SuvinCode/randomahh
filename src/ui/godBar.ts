import Phaser from 'phaser';
import { DISASTER_TYPES, DISASTERS, POWERUP_TYPES, type Action, type DisasterType } from '@shared/commands';
import { ghostFor, makeSuggester, type Suggestion } from '@shared/suggest';
import { ARENA, COMBAT_ENABLED, GAME_HEIGHT, PANEL_HEIGHT, POWERUPS_ENABLED } from '../config';

const CSS = `
.god { width: 940px; height: ${PANEL_HEIGHT - 8}px; box-sizing: border-box; font: 14px monospace; color: #fff;
  display: flex; flex-direction: column; gap: 6px; padding: 6px 4px; }
.god-row { display: flex; gap: 6px; align-items: center; }
.god-field { position: relative; flex: 1; min-width: 0; height: 36px; border-radius: 8px; background: #0d0f1a; }
.god-input, .god-ghost { position: absolute; inset: 0; width: 100%; height: 36px; box-sizing: border-box; padding: 0 12px;
  border-radius: 8px; border: 2px solid transparent; font: 15px monospace; line-height: 32px; }
.god-input { border-color: #ffd23f; background: transparent; color: #fff; outline: none; z-index: 1; }
.god-input::placeholder { color: #8a8aa8; }
.god-ghost { color: #6b6b8a; white-space: pre; overflow: hidden; pointer-events: none; }
.god-ghost .typed { color: transparent; }
.god-ghost .key { margin-left: 10px; font-size: 11px; color: #8a8aa8; border: 1px solid #4a4a6a; border-radius: 4px; padding: 0 4px; }
.god-sugg { position: absolute; left: 0; right: 0; bottom: calc(100% + 6px); margin: 0; padding: 4px; list-style: none;
  background: #1d2036f2; border: 1px solid #4a4a6a; border-radius: 10px; display: none; z-index: 2;
  box-shadow: 0 -6px 20px #00000066; }
.god-sugg.open { display: block; }
.god-sugg button { display: flex; width: 100%; align-items: center; gap: 8px; padding: 6px 8px; border: 0; border-radius: 6px;
  background: transparent; color: #fff; font: 14px monospace; text-align: left; cursor: pointer; }
.god-sugg button.on, .god-sugg button:hover { background: #33365a; }
.god-sugg b { color: #ffd23f; font-weight: normal; }
.god-sugg .hint { margin-left: auto; color: #8a8aa8; font-size: 12px; }
.god-send { height: 36px; padding: 0 16px; border-radius: 8px; border: 0; background: #ffd23f; color: #141726;
  font: bold 15px monospace; cursor: pointer; }
.god-send:disabled { opacity: .5; }
.god-status { width: 250px; flex: none; font-size: 12px; color: #c9c9e0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.god-chips { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: thin; padding-bottom: 2px; }
.god-chip { flex: none; height: 30px; padding: 0 10px; border-radius: 15px; border: 1px solid #4a4a6a; background: #1d2036;
  color: #fff; font: 13px monospace; cursor: pointer; white-space: nowrap; }
.god-chip:hover, .god-chip:active { border-color: #ffd23f; background: #2a2d4a; }
.god-chip.help { border-color: #7dff9a; }
`;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Quick buttons: every disaster, with the logo ram split into the two famous logos. */
type Chip = { type: DisasterType; label: string; text: string };
const CHIPS: Chip[] = DISASTER_TYPES.flatMap((t): Chip[] =>
  t === 'logo_ram'
    ? [
        { type: t, label: 'Claude', text: '✴️ Claude logo' },
        { type: t, label: 'Tanda', text: '🏷️ Tanda logo' },
      ]
    : [{ type: t, label: '', text: `${DISASTERS[t].emoji} ${DISASTERS[t].name}` }],
);

/**
 * The god box under the arena: type anything ("3 tornadoes on Bob", "summon a
 * sharknado") or tap a quick button. As you type it predicts what you mean
 * (shared/suggest.ts): grey ghost text to accept with Tab or →, and a list
 * above the box to pick from with ↑↓ / Enter or a tap. Keyboard and touch.
 */
export class GodBar {
  private readonly input: HTMLInputElement;
  private readonly send: HTMLButtonElement;
  private readonly status: HTMLElement;
  private readonly ghost: HTMLElement;
  private readonly list: HTMLElement;
  private suggestions: Suggestion[] = [];
  private active = -1;
  private suggester = makeSuggester([], { powerups: POWERUPS_ENABLED, weapons: COMBAT_ENABLED });
  private suggesterKey = '';

  constructor(
    scene: Phaser.Scene,
    private readonly onText: (text: string) => void,
    private readonly onAction: (action: Action) => void,
    private readonly fighterNames: () => string[],
  ) {
    const html = `
      <div class="god"><style>${CSS}</style>
        <div class="god-row">
          <div class="god-field">
            <ul class="god-sugg" role="listbox" aria-label="Suggestions"></ul>
            <div class="god-ghost" aria-hidden="true"></div>
            <input class="god-input" maxlength="200" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="send"
              placeholder="Play god: “3 tornadoes”, “lightning on Bob”, “give Alice flight”…" aria-label="God command"
              role="combobox" aria-autocomplete="both" aria-expanded="false" />
          </div>
          <button class="god-send" type="button">Unleash</button>
          <span class="god-status" aria-live="polite"></span>
        </div>
        <div class="god-chips">
          ${CHIPS.map((c, i) => `<button class="god-chip" type="button" data-c="${i}">${c.text}</button>`).join('')}
          <button class="god-chip help" type="button" data-h="heal">💚 Heal all</button>
          ${POWERUPS_ENABLED ? '<button class="god-chip help" type="button" data-h="power">✨ Random powerup for all</button>' : ''}
          ${COMBAT_ENABLED ? '<button class="god-chip help" type="button" data-h="arm">🎁 Rocket for all</button>' : ''}
        </div>
      </div>`;
    const dom = scene.add.dom(ARENA.width / 2, GAME_HEIGHT - PANEL_HEIGHT + 4).createFromHTML(html).setOrigin(0.5, 0);
    const root = dom.node as HTMLElement;
    this.input = root.querySelector('.god-input')!;
    this.send = root.querySelector('.god-send')!;
    this.status = root.querySelector('.god-status')!;
    this.ghost = root.querySelector('.god-ghost')!;
    this.list = root.querySelector('.god-sugg')!;

    this.send.addEventListener('click', () => this.submit());
    this.input.addEventListener('input', () => this.refresh());
    this.input.addEventListener('focus', () => this.refresh());
    // Delay so a tap on a suggestion lands before the list hides.
    this.input.addEventListener('blur', () => window.setTimeout(() => this.close(), 150));
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    this.list.addEventListener('pointerdown', (e) => e.preventDefault()); // keep focus in the box
    this.list.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-i]');
      if (b) this.pick(Number(b.dataset.i));
    });

    // Mouse wheel scrolls the quick buttons sideways (touch can just swipe).
    const chips = root.querySelector<HTMLElement>('.god-chips')!;
    chips.addEventListener(
      'wheel',
      (e) => {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          chips.scrollLeft += e.deltaY;
          e.preventDefault();
        }
      },
      { passive: false },
    );
    root.querySelectorAll<HTMLButtonElement>('.god-chip').forEach((b) =>
      b.addEventListener('click', () => {
        const base = { count: 1, target: '', weapon: 'none', powerup: 'none', label: '' } as const;
        if (b.dataset.c !== undefined) {
          const c = CHIPS[Number(b.dataset.c)];
          this.onAction({ ...base, type: c.type, count: DISASTERS[c.type].defaultCount, label: c.label });
        } else if (b.dataset.h === 'heal') this.onAction({ ...base, type: 'heal' });
        else if (b.dataset.h === 'power') {
          const powerup = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
          this.onAction({ ...base, type: 'give_powerup', powerup });
        } else this.onAction({ ...base, type: 'give_weapon', weapon: 'rocket' });
      }),
    );
  }

  private onKey(e: KeyboardEvent): void {
    e.stopPropagation();
    const atEnd = this.input.selectionStart === this.input.value.length;
    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        if (this.active >= 0) this.pick(this.active);
        else this.submit();
        return;
      case 'Tab':
        if (this.suggestions.length) {
          e.preventDefault();
          this.accept(this.suggestions[Math.max(0, this.active)]);
        }
        return;
      case 'ArrowRight':
        if (atEnd && this.ghost.dataset.rest) {
          e.preventDefault();
          this.accept(this.suggestions[0]);
        }
        return;
      case 'ArrowDown':
      case 'ArrowUp':
        if (!this.suggestions.length) return;
        e.preventDefault();
        this.active = (this.active + (e.key === 'ArrowDown' ? 1 : -1) + this.suggestions.length + 1) % (this.suggestions.length + 1);
        if (this.active === this.suggestions.length) this.active = -1;
        this.renderList();
        return;
      case 'Escape':
        this.close();
        return;
    }
  }

  /** Fill the box with a suggestion; keep typing if it expects more (ends in a space). */
  private accept(s: Suggestion | undefined): void {
    if (!s) return;
    this.input.value = s.full;
    this.input.setSelectionRange(s.full.length, s.full.length);
    this.refresh();
  }

  /** Choosing from the list: a finished command runs straight away. */
  private pick(i: number): void {
    const s = this.suggestions[i];
    if (!s) return;
    if (s.full.endsWith(' ')) this.accept(s);
    else {
      this.input.value = s.full;
      this.submit();
    }
  }

  private submit(): void {
    const text = this.input.value.trim();
    if (!text) return;
    this.input.value = '';
    this.close();
    this.onText(text);
  }

  private refresh(): void {
    const names = this.fighterNames();
    const key = names.join('\u0000');
    if (key !== this.suggesterKey) {
      this.suggesterKey = key;
      this.suggester = makeSuggester(names, { powerups: POWERUPS_ENABLED, weapons: COMBAT_ENABLED });
    }
    const value = this.input.value;
    this.suggestions = document.activeElement === this.input ? this.suggester(value) : [];
    this.active = -1;
    const rest = ghostFor(value, this.suggestions);
    this.ghost.dataset.rest = rest;
    // Ghost text only fits while the typed text isn't scrolled.
    this.ghost.innerHTML = rest && this.input.scrollLeft === 0
      ? `<span class="typed">${esc(value)}</span>${esc(rest)}<span class="key">Tab</span>`
      : '';
    this.renderList();
  }

  private renderList(): void {
    const value = this.input.value;
    const open = this.suggestions.length > 0;
    this.list.classList.toggle('open', open);
    this.input.setAttribute('aria-expanded', String(open));
    this.list.innerHTML = this.suggestions
      .map((s, i) => {
        // Bold the part being predicted.
        const same = s.full.toLowerCase().startsWith(value.toLowerCase()) ? value.length : 0;
        return `<li><button type="button" data-i="${i}" class="${i === this.active ? 'on' : ''}" role="option">
          <span>${s.emoji}</span><span>${esc(s.full.slice(0, same))}<b>${esc(s.full.slice(same))}</b></span>
          <span class="hint">${esc(s.hint)}</span></button></li>`;
      })
      .join('');
  }

  private close(): void {
    this.suggestions = [];
    this.active = -1;
    this.ghost.innerHTML = '';
    this.ghost.dataset.rest = '';
    this.renderList();
  }

  setStatus(text: string, color = '#c9c9e0'): void {
    this.status.textContent = text;
    this.status.style.color = color;
    this.status.title = text;
  }

  setBusy(busy: boolean): void {
    this.send.disabled = busy;
    this.send.textContent = busy ? '…' : 'Unleash';
  }

  /** Grey it out when the battle is over. */
  disable(): void {
    this.input.disabled = true;
    this.send.disabled = true;
    this.close();
  }
}
