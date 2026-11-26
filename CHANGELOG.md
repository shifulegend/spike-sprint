# Changelog

## [2.3.0] - 2026-11-24
### Added
- **Four Hero Difficulty Tiers (`HERO_DIFFICULTIES`):** Easy (`0.55x`), Normal (`0.65x`, default), Hard (`0.75x`), and Insane (`0.90x`) with independent per-tier `MIN HAVOC` tracking.
- **Explicit Hero-Only Difficulty Card UX:** Grouped **PLAY AS HERO**, the `HERO DIFFICULTY` label, and the 4 difficulty pills inside a dedicated green-bordered card with dynamic button text (`PLAY AS HERO · NORMAL`), visually separated from **PLAY AS VILLAIN**.
- **Live Run Duration (`TIME MM:SS`):** Added live elapsed timer in the top-right HUD and on the end screen for both Villain and Hero modes.

## [2.0.0] - 2026-11-24
### Added
- **Two-Mode Architecture (`BASE_MODE` / `MODES`):** Replaced single `START GAME` button with **Play as Villain** (legacy runner) and **Play as Hero** (village defense) plus **Change Mode** on the end screen, powered by one shared core engine with zero duplicated game loop.
- **Hero Mode Controls & Cooldown:** Added 3 procedural inline-SVG obstacle buttons (**Pit**, **Bush**, **Purple Hero**, keys `1`/`2`/`3`) with a shared deterministic cooldown (`getBaseSpawnInterval(speedMult) * MODES.hero.cooldownScale`, default `0.75` for combo play) and synchronized refill-wipe + gold ready-flash animation.
- **Havoc Scoring & Story UX:** Added **HAVOC / MIN HAVOC** (lowest wins, isolated from Villain's `HIGH SCORE`), **`VILLAGE SAVED!`** victory screen with dynamic stop-cause flavor, 2-line `#startScreen` story hook, and opt-in `?` lore card.
- **Embedded Single-File DQN RL Bot:** Packed the trained `[21, 64, 64, 5]` ReLU MLP (`Sprint_web_DQN.rlbot.json`, 5,893 weights) as a ~31.4 KB Base64 `Float32Array` with zero external libraries and step-level key-release parity (11/11 pit clearance).
- **Reversible Responsive Zoom Floor:** Added `RESPONSIVE_ZOOM_ENABLED = true` (`MIN_LOGICAL_W = 490`) so narrow mobile WebViews match desktop/iOS Safari framing while keeping exact `ZOOM = 2` on `>= 980px` viewports.

All notable changes to Spike Sprint are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning follows [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

> Changes staged for the next release go here.

---

## [1.0.0] — 2026-07-09

### 🎮 Added
- Endless runner core loop — auto-running character with animated leg swing
- Variable-height jump: short tap = hop, hold up to ~320ms = full jump (Space / tap / click)
- **Enemies** — half-height sprites that approach from the right; jump on top to squash (+100 score), sideways collision = game over
- **Pits** — gaps in the ground that must be jumped over; falling in is instant game over
- **Bushes** — stationary obstacles of varying heights that block the path
- **Spiked barrel chaser** — always visible at left edge, surges when player is stuck on a bush; game over triggers precisely when the spike tip's rightmost pixel reaches the player's leftmost pixel
- Score HUD (`00000` format, top-right) — increases continuously, scales with speed multiplier
- Session high score — persists across restarts for the browser tab session; resets on page refresh
- Difficulty scaling: 1× → 2× over first 5 minutes → 3× over next 5 minutes → holds at 3× indefinitely
- Fully responsive canvas — resizes to browser window on load and resize events
- 2× world zoom via canvas scale transform for a closer, more immersive view
- Branded start screen with "Spike Sprint" title and tagline *"A poorly coded pixel runner"*
- Copyright footer rendered at the bottom of the game screen
- Web Audio API sound effects with mute toggle button
- iOS Shortcut — launches game locally in Safari via embedded base64 `data:text/html` URL (no server needed)
- Gameplay demo GIF in README
- Screenshots: start screen, gameplay, barrel chase, spike-touch collision, game over with high score

### ⚙️ Tech
- Pure HTML5 Canvas + Vanilla JS — single `index.html`, zero external dependencies
- No build step, no npm, no server required
- All sprites drawn procedurally in code — no licensed third-party assets
- Playwright CI smoke test (no console errors, collision timing, high score persistence)
- Dependabot config for automated dependency alerts
- CITATION.cff for academic/APA citation support
- MIT License

### 🔧 Fixed
- Barrel collision detection: game-over now triggers on precise spike tip → player edge contact, not barrel body edge
- Safari Web Audio silent bug — dummy-unlock pattern + `visibilitychange` resume
- Cross-browser Web Audio guard: dummy-unlock runs once only

### 🏷️ Renamed
- Project renamed from **Pixel Runner** → **Spike Sprint** across all files and documentation

---

## Repository

- **Live game:** https://shifulegend.github.io/spike-sprint/
- **Source:** https://github.com/shifulegend/spike-sprint

[Unreleased]: https://github.com/shifulegend/spike-sprint/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/shifulegend/spike-sprint/releases/tag/v1.0.0
