/**
 * Two apps, one page: `/join` is a player's controller (phone or laptop, no
 * Phaser, loads fast); everything else is the host's game.
 */
if (/^\/join\/?$/.test(location.pathname)) {
  document.documentElement.classList.add('controller');
  void import('./controller/controller').then((m) => m.startController());
} else {
  void import('./game');
}
