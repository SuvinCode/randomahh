import Phaser from 'phaser';
import { sfx } from '../audio/sfx';
import { ARENA, GAME_HEIGHT } from '../config';
import { hostRoom } from '../net/hostRoom';
import { waitingYou } from '../net/youState';
import { button, onKey, title } from './ui';

export interface ResultsData {
  winner: { name: string; color: number; kills: number; hp: number } | null;
  placements: { name: string; kills: number; color: number }[];
  durationMs: number;
}

const css = (c: number) => Phaser.Display.Color.IntegerToColor(c).rgba;

/** Winner, leaderboard (placement + kills), and rematch / edit fighters. */
export class ResultsScene extends Phaser.Scene {
  constructor() {
    super('Results');
  }

  create(data: ResultsData): void {
    const cx = ARENA.width / 2;
    this.cameras.main.setBackgroundColor('#141726');
    this.cameras.main.fadeIn(250);
    const touch = this.sys.game.device.input.touch;

    if (data.winner) {
      title(this, cx, 60, '🏆 WINNER 🏆', 26, '#ffd23f');
      const name = title(this, cx, 118, data.winner.name, 58, css(data.winner.color)).setScale(0.3);
      this.tweens.add({ targets: name, scale: 1, duration: 450, ease: 'Back.Out' });
      title(this, cx, 168, `${data.winner.kills} kill${data.winner.kills === 1 ? '' : 's'} · ${data.winner.hp} HP left`, 18, '#c9c9e0');
    } else {
      title(this, cx, 100, 'NOBODY SURVIVED', 50, '#ff5d73');
      title(this, cx, 158, 'the disasters win this one', 18, '#c9c9e0');
    }
    const s = Math.round(data.durationMs / 1000);
    title(this, cx, 200, `Battle lasted ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} · ${data.placements.length} fighters`, 14, '#9a9ab5');

    // Leaderboard: top 10 by placement, two columns.
    const rows = data.placements.slice(0, 10);
    rows.forEach((p, i) => {
      const col = i < 5 ? 0 : 1;
      const x = cx - 230 + col * 250;
      const y = 245 + (i % 5) * 34;
      const medal = ['🥇', '🥈', '🥉'][i] ?? `#${i + 1}`;
      this.add.text(x, y, medal, { fontFamily: 'monospace', fontSize: '16px', color: '#ffffff' });
      this.add.text(x + 40, y, p.name, { fontFamily: 'monospace', fontSize: '16px', fontStyle: 'bold', color: css(p.color), stroke: '#000000', strokeThickness: 3 });
      this.add.text(x + 225, y, `${p.kills} 💀`, { fontFamily: 'monospace', fontSize: '14px', color: '#c9c9e0' }).setOrigin(1, 0);
    });
    const top = [...data.placements].sort((a, b) => b.kills - a.kills)[0];
    if (top && top.kills > 0) title(this, cx, 425, `Most kills: ${top.name} (${top.kills})`, 16, css(top.color));

    const rematch = () => {
      sfx.play('click');
      this.scene.start('Battle');
    };
    const edit = () => {
      sfx.play('click');
      this.scene.start('Lobby');
    };
    button(this, cx - 150, 490, touch ? 'Rematch' : 'Rematch  (R)', rematch, true);
    button(this, cx + 150, 490, touch ? 'Edit fighters' : 'Edit fighters  (E)', edit);
    title(this, cx, GAME_HEIGHT - 40, 'Same fighters, new arena, new chaos.', 13, '#7d7d99');
    onKey(this, 'R', rematch);
    onKey(this, 'E', edit);
    // Players joining now are in the next battle.
    const off = hostRoom.on('join', (p) => hostRoom.sendYou(p.id, waitingYou(p.name, 0xffd23f, "You're in! Next battle starts soon…")));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, off);
  }
}
