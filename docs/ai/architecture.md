# Architecture
<!-- DYNAMIC FILE — updated by AI agents as architecture evolves -->
<!-- Last updated: 2026-07-15 23:32 IST -->

## System Overview
Spike Sprint is a single self-contained `index.html` file with inline CSS and JavaScript. There is no server or database. The one external call is a fire-and-forget play-count beacon (see Integration Points) — everything else runs client-side via the HTML5 Canvas 2D API and a `requestAnimationFrame` loop.

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
| Integration | Purpose | Auth Method |
|-------------|---------|-------------|
| `api.countapi.xyz` (`trackPlay()`, called from `startBtn`/`restartBtn` click handlers) | Anonymous play-count beacon — one `fetch` GET per game start/restart, no request body or identifying data | None (public, no-signup, no API key) |

## Key Design Decisions
See `docs/ai/decision-log.md` for full rationale on: procedural asset generation (no external sprites, zero IP risk), single-file architecture (no build step), 2x canvas-scale zoom (applied to the whole scene, not just the character), and touch-based (not time-based) barrel collision.

## Known Constraints & Limitations
- No persistence: high score resets on page refresh.
- No mobile-specific UI (touch input works via pointer events, but no on-screen jump button).
- Single hardcoded difficulty curve (1x→2x over 5 min, 2x→3x over next 5 min, holds at 3x).

## Security Boundaries
No secrets or user data anywhere in the codebase. The one network call (`trackPlay()`) sends no payload beyond the fixed namespace/key path — no IP logging, cookies, or personal data are handled by this app; whatever `api.countapi.xyz` does with the incoming request is outside this app's control. The call is wrapped in try/catch and never blocks or affects gameplay if it fails.
