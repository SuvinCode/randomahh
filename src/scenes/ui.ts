import Phaser from 'phaser';

export const TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace',
  color: '#ffffff',
  stroke: '#000000',
  strokeThickness: 5,
};

export function title(scene: Phaser.Scene, x: number, y: number, text: string, size = 48, color = '#ffffff') {
  return scene.add.text(x, y, text, { ...TEXT_STYLE, fontSize: `${size}px`, color }).setOrigin(0.5);
}

/**
 * A tappable/clickable button (mouse and touch). Returns a container centred on (x, y).
 * `primary` buttons are filled with the highlight colour.
 */
export function button(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  onPress: () => void,
  primary = false,
  color = 0xffd23f,
): Phaser.GameObjects.Container {
  const text = scene.add
    .text(0, 0, label, {
      fontFamily: 'monospace',
      fontSize: '18px',
      fontStyle: 'bold',
      color: primary ? '#141726' : Phaser.Display.Color.IntegerToColor(color).rgba,
    })
    .setOrigin(0.5);
  const w = Math.max(140, text.width + 36);
  const h = 44;
  const bg = scene.add
    .rectangle(0, 0, w, h, primary ? color : 0x000000, primary ? 1 : 0.25)
    .setStrokeStyle(2, color, 1);
  const c = scene.add.container(x, y, [bg, text]).setSize(w, h).setDepth(120);
  c.setInteractive({ useHandCursor: true });
  c.on('pointerover', () => c.setScale(1.05));
  c.on('pointerout', () => c.setScale(1));
  c.on('pointerdown', () => c.setScale(0.97));
  c.on('pointerup', () => {
    c.setScale(1);
    onPress();
  });
  return c;
}

/** Binds a key to an action for the lifetime of the scene. */
export function onKey(scene: Phaser.Scene, key: string, action: () => void): void {
  scene.input.keyboard!.once(`keydown-${key}`, action);
}

/**
 * Phones: go fullscreen and (where the browser allows) lock to landscape, so the
 * arena fills the screen. Must be called from a tap. iOS Safari has no Fullscreen
 * API for pages; there "Add to Home Screen" opens it fullscreen (see the manifest).
 */
export function canGoFullscreen(scene: Phaser.Scene): boolean {
  return scene.sys.game.device.fullscreen.available && !scene.scale.isFullscreen;
}

export function goFullscreen(scene: Phaser.Scene): void {
  if (!canGoFullscreen(scene)) return;
  scene.scale.startFullscreen();
  const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
  orientation.lock?.('landscape').catch(() => {
    /* not supported (desktop, iOS): the rotate hint covers it */
  });
}
