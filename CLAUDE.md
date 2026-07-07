# Claude Code — Project Memory
<!-- DYNAMIC FILE — updated automatically by Claude as durable lessons emerge -->
<!-- Last updated: 2026-07-07 20:47 IST -->

## Session Start (Mandatory)
Before planning or coding in any session:
1. Read `docs/ai/project-overview.md`
2. Read `docs/ai/engineering-rules.md`
3. Read `docs/ai/mistakes.md` — summarize relevant recent mistakes
4. Read `docs/ai/decision-log.md` — summarize relevant recent decisions
5. Read relevant `.claude/rules/*.md` for the area being changed
6. State assumptions, open risks, and relevant rules before any action

## Project Context
<!-- Summarized from docs/ai/project-overview.md — keep in sync -->
- **Purpose**: Pixel Runner — a single-file, browser-based endless runner game (procedurally drawn character, enemies, bushes, spiked barrel chaser)
- **Stack**: Vanilla JavaScript (ES6+), HTML5 Canvas 2D API, no frameworks or build tools
- **Architecture**: Single `index.html` with a `requestAnimationFrame` game loop; state machine (start/playing/over); canvas-scale-based 2x zoom
- **Key directories**: `index.html` (the game), `docs/screenshots/` (gameplay images), `docs/ai/` (project memory)
- **Commands**: No build/lint/test tooling — open `index.html` directly in a browser; CI runs a Playwright smoke test on push

## Core Rules
- Smallest sensible modular unit per responsibility
- Zero hard-coding — all behavior configurable
- Documentation mandatory and timestamped
- Granular commits: what + why
- Verify: lint → typecheck → test → build
- See `.claude/rules/` for detailed scoped rules

## Dynamic Update Requirement
Proactively update these files every session without waiting for user prompts:
- `docs/ai/mistakes.md` — on any mistake
- `docs/ai/decision-log.md` — on any durable decision
- `docs/ai/change-trace.md` — after each sub-step
- `CLAUDE.md` — when repo-wide rules change
- `.claude/rules/*.md` — when scoped rules change

## Canonical Source
All rules originate in `docs/ai/`. If this file conflicts with `docs/ai/`, the shared docs win.
