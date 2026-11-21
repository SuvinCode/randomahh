import type { You } from '@shared/room';

/** 0xrrggbb → "#rrggbb". */
export function colorHex(c: number): string {
  return `#${(c & 0xffffff).toString(16).padStart(6, '0')}`;
}

/** A controller screen for someone who isn't in a battle right now (lobby, results). */
export function waitingYou(name: string, color: number, msg: string): You {
  return {
    t: 'you',
    name,
    color: colorHex(color),
    phase: 'lobby',
    hp: 100,
    weapon: 'sword',
    powerups: [],
    kills: 0,
    alive: 0,
    place: 0,
    msg: msg.slice(0, 80),
  };
}
