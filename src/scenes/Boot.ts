import Phaser from 'phaser';
import { addNames, randomNames } from '@shared/names';
import { sfx } from '../audio/sfx';
import { REGISTRY_KEYS } from '../config';
import { makeStaticTextures } from '../textures';
import { loadRoster } from './Lobby';

/**
 * Shared textures and sound, then the lobby. Testing shortcuts (work in
 * production too): `?names=Ann,Bob,Cat` or `?n=12` start a battle straight away.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    makeStaticTextures(this);
    sfx.attach(this.game);
    const q = new URLSearchParams(window.location.search);
    const fromUrl = q.get('names') ? addNames([], q.get('names')!) : q.get('n') ? randomNames([], Math.min(50, Number(q.get('n')) || 10)) : [];
    if (fromUrl.length >= 2) {
      this.registry.set(REGISTRY_KEYS.roster, fromUrl);
      this.scene.start('Battle');
      return;
    }
    this.registry.set(REGISTRY_KEYS.roster, loadRoster());
    this.scene.start('Lobby');
  }
}
