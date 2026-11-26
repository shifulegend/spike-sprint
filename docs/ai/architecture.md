# Architecture
<!-- DYNAMIC FILE — updated by AI agents as architecture evolves -->
<!-- Last updated: 2026-07-07 20:47 IST -->

## System Overview
Spike Sprint is a single self-contained `index.html` file with inline CSS and JavaScript. There is no server, database, or external API — the entire game runs client-side in the browser via the HTML5 Canvas 2D API and a `requestAnimationFrame` loop.

## Components
| Component | Responsibility | Technology |
|-----------|---------------|-----------|
| Game loop (`loop()`) | Drives update + render cycle every frame | `requestAnimationFrame` |
| State machine | Tracks `start` / `playing` / `over` states | Plain JS variable (`gameState`) |
| Player physics | Gravity, variable-height jump (hold-duration sampling) | Custom JS physics |
| Obstacle spawner | Randomly spawns enemies, pits, bushes at scaling intervals | `spawnObstacle()` |
| Collision system | Detects player-enemy, player-bush, player-pit, barrel-player collisions | Axis-aligned bounding box checks |
| Difficulty scaler | Ramps world speed 1x→2x (0-5min)→3x (5-10min), holds at 3x | Time-based interpolation in `update()` |
| Renderer | Procedurally draws all sprites (player, enemy, bush, barrel) via Canvas paths | Canvas 2D API, `ctx.scale(2,2)` for 2x zoom |
| HUD | Displays score, session high score, speed multiplier | DOM elements updated each frame |

## Data Flow
1. `requestAnimationFrame` calls `loop()` every frame.
2. `update(dt)` advances physics, spawns/moves obstacles, checks collisions, updates score/speed.
3. Canvas is cleared and scaled 2x; `drawBackground()`, `drawGround()`, obstacles, `drawBarrel()`, `drawPlayer()` render in order (back to front).
4. `drawHUD()` updates the score/high-score/speed DOM text after the canvas render.
5. No data persists beyond the current page load — refreshing resets score and high score (no localStorage/backend).

## Integration Points
None. This is a fully self-contained client-side application with zero external services.
| Integration | Purpose | Auth Method |
|-------------|---------|-------------|
| None        | N/A     | N/A         |

## Key Design Decisions
See `docs/ai/decision-log.md` for full rationale on: procedural asset generation (no external sprites, zero IP risk), single-file architecture (no build step), 2x canvas-scale zoom (applied to the whole scene, not just the character), and touch-based (not time-based) barrel collision.

## Known Constraints & Limitations
- No persistence: high score resets on page refresh.
- No mobile-specific UI (touch input works via pointer events, but no on-screen jump button).
- Single hardcoded difficulty curve (1x→2x over 5 min, 2x→3x over next 5 min, holds at 3x).

## Security Boundaries

## v2.0 Two-Mode & Embedded RL Bot Architecture (2026-11-24)
- **Mode Registry (`BASE_MODE` / `MODES`):** `MODES.villain` inherits 100% of `BASE_MODE` (legacy parity). `MODES.hero` overrides `autoSpawn: false`, `showSpawnControls: true`, `allowHumanJump: false`, `cooldownScale: 0.75`, `scoreLabel: 'HAVOC '`, `bestLabel: 'MIN HAVOC'`, `endTitle: 'VILLAGE SAVED!'`, `lowerIsBetter: true`, and `updateRunner: rlBotUpdate`.
- **Atomic Spawners & Shared Cooldown:** `spawnObstacle()` split into `spawnEnemy()`, `spawnPit()`, and `spawnBush()`. Both modes share `getBaseSpawnInterval(speedMult) = 55 - Math.min(25, speedMult * 8)`.
- **Embedded DQN RL Bot:** `[21, 64, 64, 5]` ReLU MLP packed as Base64 `Float32Array` (`RL_WEIGHTS_B64`, 5,893 floats, ~31.4 KB) with ~20-line vanilla JS forward pass (`RL_FRAME_SKIP = 4`) and step-level `no-op` key-release parity.
- **Reversible Responsive Zoom:** `RESPONSIVE_ZOOM_ENABLED = true` caps `ZOOM = Math.min(2, canvas.width / 490)` on narrow WebViews; set `false` to revert to fixed `ZOOM = 2`.

None applicable — no secrets, no network calls, no user data collected or transmitted.
