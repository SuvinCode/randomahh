# Random Ahh

A 2D battle royale you watch and meddle with, in the browser. The host adds
fighters by name (friends, pets, anyone; or random silly names). Each becomes a
little AI brawler in a single-screen side-view arena. They wander, jump and
fight on their own with random weapons (swords, hammers, pistols, shotguns,
miniguns, snipers, lasers, rocket launchers). Crates parachute in every ~6 s
holding a weapon or a mystery **powerup** (super speed, flight, teleportation,
shield, rage, regeneration, invisibility; ~10 s each), and fighters go for
crates that land nearby (only on the floor and low ledges they can reach). Every
elimination shows in the kill feed (with multi-kill callouts). Last one
standing wins. After 50 s a storm closes in from both sides so battles end.

The host plays god through the **god box** under the arena: type anything
("3 tornadoes", "lightning on Bob", "give Alice a rocket launcher", "heal
everyone", "give Bob flight", "add Grandma", "summon a sharknado") or tap a
quick button. Disasters: tornado, volcano, black hole, lightning, asteroids,
Dr Doom (a flying boss the fighters can shoot back at), earthquake, tsunami,
orbital laser, mega bomb, zombie horde (fighters can fight back), UFO
abductions, blizzard, giant stomp, killer bees, logo ram ("Claude" / "Tanda" /
any brand as `label`), Thanos snap (half the fighters turn to dust), disco,
lava floor (fighters flee to ledges), Godzilla (sweeping purple beam), nuke
(mushroom cloud, then the arena goes black for 2 s).

The god box **predicts as you type** (`shared/suggest.ts` on `shared/trie.ts`):
grey ghost text (Tab / → accepts) and a list above the box (↑↓ + Enter, or tap).
It completes the last clause, keeps counts, and slots in fighter names and
give-able items. Picking a finished suggestion runs it.

## Current mode: survival (switches in src/config.ts)

Right now the game runs as **survival**: `COMBAT_ENABLED = false` (nobody,
player or bot, attacks; bots just roam; no weapons drawn, no crates, weapon
commands/suggestions/quick button hidden, the god box explains) and
`POWERUPS_ENABLED = false`. The only danger is the host's disasters and the
storm, which in survival closes **completely** so every battle ends. Phones
show only ◀ ▶ and Jump. Flip both to true for the original brawl (everything
described below about weapons, crates and powerups still exists in the code).

## Party mode (phones join by QR code)

The lobby opens a **party room** automatically and shows a QR code + 4-letter
code. Players scan it (or open `<site>/join` and type the code), enter a name,
and their phone/laptop becomes a **controller** for their own fighter; bots fill
the rest of the roster. The host starts the battle and just watches / plays god.

- **The host's browser is authoritative**: it runs the whole battle. Controllers
  only send button bits (`BTN`: left, right, jump, attack, down). The host sends
  each a status (`You`: HP, weapon, powerups, phase, place, `fid`) plus, as JSON,
  the arena (`arena`, once per battle/join), `roster` (when fighters are added)
  and `say` (announcements). Everything moving streams 20×/s as **binary frames**
  (`shared/frame.ts`: int16s; fighters, crates, shots, beams, explosions, and a
  *mirror* of every disaster's drawing: Phaser Graphics command buffers, texts,
  rects, circles, containers at disaster depths, see `src/net/mirror.ts`). So new
  disasters show on phones automatically, as long as they draw with those object
  types at `DEPTH.disasterBack`…`DEPTH.telegraph`. Frames are 1–6 KB.
- **Player limit, picked by the host in the lobby: 10 (default), 20 or Unlimited**
  (`PLAYER_LIMITS` in shared/room.ts; remembered in localStorage). The host sends
  it as `{t:'limit'}` on open/resume and on change; the server refuses new phones
  when full ("Room ABCD is full"), but anyone who already joined that room (and
  wasn't kicked) can always come back. Lowering it never kicks anyone. The lobby
  shows "📱 n / 10 joined · room full". Every phone that's in gets a fighter. Bots fill
  the arena up to `MAX_FIGHTERS` (50; players don't count toward it, extra bots sit
  out). Frames and the roster carry up to `MAX_FRAME_FIGHTERS` (500, shared/frame.ts);
  the god box sends the AI at most 70 names (ones in the text first). Tested with
  100 phones: host 104–120 fps through every disaster; each phone gets ~16 KB/s
  calm, ~115–140 KB/s during big disasters. Big rooms are limited by the server's
  outgoing bandwidth (every frame goes to every phone), the Wi-Fi, and how crowded
  a 960 px arena gets.
- Phones (`src/controller/arenaView.ts`) play frames back ~70–150 ms behind the
  host's clock (jitter buffer, fighters interpolated) so bursty networks don't
  stutter; terrain is a cached layer, the mirror is replayed once per frame into
  behind/in-front layers, emoji are cached bitmaps.
- `shared/room.ts` is the room contract (Zod, `.strict()`) and `shared/frame.ts`
  the binary frame format (`decodeFrame` fully checks one), validated by the
  server and both clients. `server/rooms.ts` (`RoomHub`) only relays: no game
  logic. `server/wsServer.ts` attaches it at `/ws` to the dev server (vite.config)
  and the prod server. Rooms are in memory (one Render instance).
- A host that drops keeps its room for 60 s (resumes with its token, stored in
  sessionStorage). A player is identified by a per-device `pid` (localStorage):
  rejoining gives back the same fighter; while disconnected it runs on the AI
  brain (grey arrow over it). Late joiners drop into a running battle.
- `Fighter.pilot` = player id; `Fighter.buttons` (null = brain drives) is set by
  Battle each frame. `Fighter.manual()` turns buttons into a `Plan` (hold jump
  to hop; attack auto-aims at the nearest foe in front, else straight ahead).
  With powerups turned back on, only bots get them (`Fighter.canPowerUp`).
- `/join` loads `src/controller/` (plain DOM, no Phaser); everything else loads
  `src/game.ts`. Controls: phone (landscape) ◀ ▶ bottom-left (slide between
  them), attack + jump bottom-right, ▼ while flying; laptop WASD/arrows,
  Space/W jump, S down, J/K/F attack.
- Dev on localhost: the QR uses this machine's LAN IP (`/api/lan`, never on
  Render) and Vite listens on the LAN (`server.host`), so phones must be on the
  same Wi-Fi (allow Node through the Windows firewall if they can't connect).

## Architecture rule (most important)

`shared/commands.ts` is **the contract between the god box (and the AI) and the game**.

- Text becomes a `CommandPlan`: `{ actions: Action[] (≤5), message (≤80) }`, each
  `Action` = `{ type, count 1–10, target (fighter name or ""), weapon, powerup, label (≤40) }`.
  `type` is a disaster or `give_weapon` / `give_powerup` / `heal` / `add_fighter`. Objects are
  `.strict()`: unknown keys are rejected, never ignored.
- **Local first:** `shared/parseCommand.ts` reads common phrasings instantly and
  offline (aliases in the catalogs, counts, "on <name>", several clauses). Only
  text it can't read goes to `POST /api/command`, where **Mistral** (the
  project's LLM, by the owner's choice; not Anthropic) maps it to the catalog
  with JSON-schema structured output generated from the Zod schema
  (`z.toJSONSchema`), so it can't drift. The server validates and sanitises
  (unknown targets → "", counts clamped to each disaster's max, names cleaned).
  The AI never writes code; the game only runs parsed plans.
- Gameplay lives in code, chosen and tuned only by the plan's enums and numbers.
  `label` is flavour (kill feed: "Sharknado 🌪️ Bob").

## Rules

- **The API key never goes in `src/` or any client code.** `MISTRAL_API_KEY` and
  `MISTRAL_MODEL` are read only by server code (`server/`, `api/`). Nothing under
  `src/` imports from `server/`; client and server share code only via `shared/`.
- **Any contract change** updates `shared/commands.ts`, the prompt
  (`server/prompts/godCommands.md`), and `tests/` in the same change.
- New disaster = one file in `src/disasters/`, registered in
  `src/disasters/registry.ts` (a full `Record`, so a missing one fails to
  compile), a `DISASTERS` catalog entry (emoji, aliases, default/max count),
  a signature sound in `src/audio/disasterSounds.ts` (also a full `Record`;
  synthesize new ones in `src/audio/sfx.ts`), and a line in the prompt. Play
  sounds at its big moments too (impact, eruption…); repeating ones rely on
  `MIN_GAP_MS` throttling in sfx.ts. Disasters end themselves (`update` returns false).
- Every disaster **warns first** (flashing marker, reticle, cracks, ring)
  before it can hurt, so the spectacle reads.
- After `ctx.damage(f, …)` a fighter may be gone (sprite destroyed): check
  `f.alive` before touching `f.body` again. Battle also drops any disaster whose
  `update` throws, so one bug can't freeze a battle.
- All damage goes through `BattleContext.damage` (kill credit, feed, effects).
  Bosses and minions (zombies: `minion: true`, no callout/credit) implement
  `Target` and register with `ctx.addTarget`.
- New powerup = `POWERUP_TYPES` + `POWERUPS` (shared/commands.ts), tuning in
  `src/powerups/defs.ts` (`POWERUP_DEFS`, `POWER`, `drawPowerups`), effect in
  `Fighter` (`has()`, `givePowerup()`) and/or the brain, plus the prompt.
- Tone: cartoon violence only. AI labels stay playful and family friendly
  (enforced in the prompt). Fighter names are the host's own input.
- **Test in the browser after each change** (dev server + Playwright/Edge or
  the `webapp-testing` skill), in addition to `npm test` and `npm run build`.
- No external art: everything is drawn with Phaser Graphics and the arena
  palette (`src/textures.ts`, `src/world/`), so pixel art can be swapped in later.

## Balance (measured, 16 fighters)

Fighters have 100 HP. Weapons are deliberately weak (a 13-fighter brawl with no
god input is about half gone at 30 s, over by ~45–60 s with the storm).
Disasters are the deadly part: a black hole takes ~4–7 of 16; zombies (5) ~4–6
over 20 s; UFO 2–3 (max 2 abductions per beam, 2 passes); bombs, tsunamis,
giant stomps, orbital lasers, lightning and Dr Doom ~1–4; tornadoes, volcanoes,
earthquakes, blizzards, bees and asteroids mostly soften people up. Tune numbers in `src/weapons/defs.ts`,
`src/config.ts` and each disaster file.

## Stack

Phaser 4 + TypeScript + Vite, Arcade Physics. Zod schemas shared by client and
server. Vitest. Route modules in `api/` (`export function POST(request: Request)`,
thin wrappers over `server/`). Production: a plain Node server
(`server/prodServer.ts`, bundled to `dist-server/`) serves `dist/` and `/api/*`;
deployed on **Render** via `render.yaml`. Dev: the `apiRoutes` plugin in
`vite.config.ts` serves the same modules through `server/nodeAdapter.ts` and
loads `.env` for server code only.

## Layout

```
shared/commands.ts        the contract (Zod) + DISASTERS / WEAPONS_CATALOG (names, emoji, aliases, counts)
shared/parseCommand.ts    offline god-box parser, cleanName, describePlan
shared/trie.ts, suggest.ts predictive god box: tries of commands/items/fighters, makeSuggester, ghostFor
shared/names.ts           roster helpers (dedupe "Bob 2", cap 50), random silly names
api/command.ts            POST /api/command
server/interpretCommand.ts text → Mistral → validated, sanitised CommandPlan; rate limit
server/prompts/godCommands.md  system prompt
server/nodeAdapter.ts     Node http ⇄ web Request/Response (dev + prod)
server/prodServer.ts      static dist/ (gzip, caching, security headers) + /api + /healthz + /ws
shared/room.ts            party-room contract (button bits, controller status, messages)
shared/frame.ts           binary arena frames (encode/validate/decode) streamed to phones
server/rooms.ts, wsServer.ts  room relay (RoomHub) + WebSocket attach at /ws; lan.ts: LAN IPs for the QR
src/main.ts               /join → controller, else game
src/game.ts               Phaser config (960×636: 540 arena + 96 god panel)
src/controller/           player's controller page (DOM: join form, buttons, HP/weapon/status)
src/net/hostRoom.ts       host's room connection (players, buttons, sendYou, sendFrame), joinBaseUrl; youState.ts
src/net/mirror.ts         copies disasters' drawings into frames
src/config.ts             tunables: ARENA, FIGHTER, BATTLE (storm, crates), DEPTH
src/scenes/               Boot, Lobby (add fighters), Battle, Results, ui.ts (buttons, fullscreen)
src/battle/               types.ts (BattleContext, Target, Attacker), projectiles.ts, geometry.ts
src/fighters/             fighter.ts (body, HP, physics, weapon, powerups), brain.ts (random-but-scrappy AI, crate looting, flying)
src/powerups/defs.ts      powerup durations + effect tuning + drawing (auras, wings, shield bubble)
src/weapons/              defs.ts (all weapon numbers), attack.ts (melee/gun/laser/rocket + drawing)
src/disasters/            one file per disaster + registry.ts, types.ts, warning.ts
src/ui/                   godBar.ts (DOM input + quick buttons), killFeed.ts, hud.ts (alive, clock, storm, callouts)
src/world/                theme.ts (5 arenas), buildTerrain.ts (classic/towers/steps), drawArena.ts, background.ts
src/net/commandClient.ts  POST /api/command, response validated with the shared schema
src/fx.ts, src/audio/sfx.ts  particles/shake; synthesized sounds (throttled per sound); audio/disasterSounds.ts: each disaster's signature sound
tests/                    vitest: contract, parser, names, server (network faked), rooms (fake sockets)
```

## Engine pitfalls (learned the hard way)

- **Arcade only separates overlaps ≤ 4 px.** Gravity sprites use origin `(0.5, 1)`
  (feet) so scaling never pushes them into the floor.
- **Physics steps at a fixed 60 Hz; rendering can be 120+ Hz.** Never drive a body
  with `velocity = positionError / frameDelta`; carry state across frames.
- **Let Phaser centre the canvas.** `#game` must not be a flex/grid centring
  container, or the DOM overlay (lobby, god box) drifts off the canvas.
- **Give DOM elements a fixed width** (`add.dom()` measures before layout).
- The Battle and Lobby scenes call `keyboard.disableGlobalCapture()` so typing
  spaces works in the DOM inputs; DOM inputs `stopPropagation` on keydown.
- **Audio is paused by browsers until a click/tap/key press.** `sfx` resumes it
  from window capture-phase listeners (our DOM inputs stop key events), sets
  `pauseOnBlur = false` (the host may watch on a second screen), retries on play,
  and shows a "🔇 Click to turn on sound" badge while blocked or muted. Headless
  Playwright allows autoplay, so test the blocked state by stubbing `ctx.resume`.
- World bounds are open at the top (`setBounds(0, -2000, …)`) so fighters can
  be flung high and fall back.

## Commands

- `npm run dev`: dev server at http://localhost:5173 (also serves `/api/*`).
  Copy `.env.example` to `.env` and add the Mistral settings for the AI god box.
- `npm test`, `npm run typecheck`
- `npm run build`: typecheck, game → `dist/`, server → `dist-server/`
- `npm start`: production server (PORT env, default 3000); `npm run preview` = build + start

## Deploy (Render)

`render.yaml` is a Blueprint: Render → New → Blueprint → this repo. Build:
`npm ci --include=dev && npm run build`; start: `npm start`; health: `/healthz`.
Set `MISTRAL_API_KEY` and `MISTRAL_MODEL` in the dashboard (optional: without
them the god box still understands the built-in words).

Testing aids (work in production too): `?n=16` starts a battle with 16 random
fighters; `?names=Ann,Bob,Cat` with those names. Dev only: `window.game`,
`window.battle` (e.g. `battle.command('3 tornadoes')`, `battle.elapsed`).

## Mobile

One responsive build: the canvas scales to fit (FIT). Touch devices get a Full
screen button (fullscreen + landscape lock where supported), the god box's quick
buttons scroll sideways, and `public/manifest.webmanifest` makes it installable
(fullscreen, landscape), which is the route on iPhone. Mouse wheel scrolls the
quick buttons on desktop.

## Ideas / roadmap

- Party mode: aim stick, emotes from the controller, predict your own fighter on the phone (hide latency)
- Teams mode, more weapons and disasters (zombies, sharks, UFO), slow-mo on the final kill
- Pixel art
- Old survival-mode prototype: `old-survival-version.zip` (git-ignored backup)
