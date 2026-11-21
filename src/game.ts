import Phaser from 'phaser';
import { ARENA, GAME_HEIGHT } from './config';
import { BattleScene } from './scenes/Battle';
import { BootScene } from './scenes/Boot';
import { LobbyScene } from './scenes/Lobby';
import { ResultsScene } from './scenes/Results';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: ARENA.width,
  height: GAME_HEIGHT,
  backgroundColor: '#0d0f1a',
  // Lets scenes place real HTML (name list, god box) over the canvas, scaled with it.
  dom: { createContainer: true },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: ARENA.gravity },
      debug: false,
    },
  },
  scene: [BootScene, LobbyScene, BattleScene, ResultsScene],
});

// Handy for poking at the game from devtools / browser tests.
if (import.meta.env.DEV) (window as unknown as { game: Phaser.Game }).game = game;
