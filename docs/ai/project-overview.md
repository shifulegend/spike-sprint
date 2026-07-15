# Project Overview
<!-- Last updated: 2026-07-15 23:32 IST -->
<!-- DYNAMIC FILE — updated automatically by AI agents every session as applicable -->

## Purpose
A single-file, browser-based endless runner game ("Spike Sprint") for casual play. The main character auto-runs right, jumps over/on enemies, avoids pits, and must clear stationary pipes before a chasing spiked barrel catches up. Built with zero external art assets to eliminate IP/licensing risk.

## Stack & Key Dependencies
- Vanilla JavaScript (ES6+), no frameworks or build tools
- HTML5 Canvas 2D API for all rendering
- No npm dependencies — single self-contained `index.html` file
- No backend; runs entirely client-side in the browser

## Architecture Overview
- Single `<canvas>` element rendered via a `requestAnimationFrame` game loop
- Game state machine: `start` → `playing` → `over`
- Physics: gravity-based jump with variable height via hold-duration sampling (short tap vs. long hold)
- Obstacle spawner randomly generates enemies, pits, and pipes at scaling intervals
- Difficulty scaling: speed multiplier ramps 1x→2x (0–5 min), 2x→3x (5–10 min), holds at 3x after 10 min; score accrual rate scales with speed
- All visuals (player, enemy, barrel, pipe) are procedurally drawn shapes — no image/sprite assets

## Important Directories
| Directory | Purpose |
|-----------|---------|
| `index.html` | The entire game (HTML + CSS + JS in one file) |
| `docs/`   | Documentation and AI memory |
| `.github/`, `.claude/`, `.agents/`, `gemini/` | Cross-tool AI instructions inherited from golden-template |

## Domain Terminology
- **Barrel chaser**: spiked barrel visible at ~1/3 size on far-left edge; surges toward player only if stuck on a bush; game ends the instant its leading edge touches the player (not on full crossing)
- **Stuck state**: player collides with a bush and cannot proceed until jumping away
- **Speed multiplier**: global scalar applied to world scroll speed and score accrual rate
- **Session high score**: highest score reached across all restarts within the current page load; not persisted after refresh (no localStorage/backend)

## Major Integration Boundaries
- `api.countapi.xyz` — anonymous, no-signup play-count beacon fired on each game start/restart (`trackPlay()` in `index.html`). No account, no dashboard, no PII. Best-effort only: wrapped in try/catch and never blocks gameplay. Current count: `GET https://api.countapi.xyz/get/shifulegend-spike-sprint/plays`.
