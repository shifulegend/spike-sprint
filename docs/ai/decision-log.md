# Decision Log
<!-- DYNAMIC FILE — updated by AI agents when architectural, tooling, or workflow decisions are made -->
<!-- Newest entries first -->

## Entry Template
### 2026-11-24 — v2.0 Two-Mode Registry, Hero Cooldown, Embedded DQN RL Bot & Responsive Zoom
- **Mode Registry (ADR-01):** Adopted shared core engine + `BASE_MODE`/`MODES` override registry to prevent code duplication and isolate Hero mode changes from legacy Villain mode.
- **Shared Deterministic Cooldown (ADR-02):** Reused `getBaseSpawnInterval(speedMult)` across all 3 Hero buttons with an easily-tweakable `MODES.hero.cooldownScale` (default `0.75`, giving 35->23 frames for tactical combos without spam).
- **Single-File Embedded DQN RL Bot (ADR-03):** Embedded `[21, 64, 64, 5]` MLP weights as Base64 `Float32Array` (~31.4 KB) with step-level `no-op` release parity (11/11 pit clearance, 0 external deps).
- **Havoc Scoring & Micro-Storytelling (ADR-04):** Added `HAVOC / MIN HAVOC`, `VILLAGE SAVED!` with stop-cause flavor, 2-line start-screen story hook, and opt-in `?` lore card.
- **Reversible Responsive Zoom (ADR-05):** Added `RESPONSIVE_ZOOM_ENABLED = true` (`MIN_LOGICAL_W = 490`) and renamed purple defenders to **Purple Heroes**.

```
### [TIMESTAMP] — <Decision Title>
- **Context**: Why this decision was needed
- **Decision**: What was decided
- **Rationale**: Why this option was chosen
- **Alternatives Rejected**: What else was considered and why rejected
- **Consequences**: What this means going forward
- **Reversible**: Yes / No / Partially
```

---

### [2026-07-08 20:32 IST] — Rename project from Pixel Runner to Spike Sprint
- **Context**: User requested a more distinctive name and tagline for the game; "Spike Sprint" was selected from suggested name lists.
- **Decision**: Renamed the game everywhere — GitHub repo (`pixel-runner-game` → `spike-sprint`), page `<title>`, README, CITATION.cff, docs/ai/*, and all cross-tool AI instruction files (CLAUDE.md, GEMINI.md, copilot-instructions.md). Added tagline "A poorly coded pixel runner" and redesigned the start screen with dedicated branded title/tagline styling, removing verbose gameplay instructions (kept only the jump control hint).
- **Rationale**: A distinctive name improves shareability; a cleaner start screen with just title/tagline/jump-hint reduces clutter and looks more polished.
- **Alternatives Rejected**: Keeping instructions on the start screen (rejected — user explicitly asked to remove all instructions except jump control).
- **Consequences**: GitHub automatically redirects the old repo URL (`pixel-runner-game`) to the new one (`spike-sprint`), but any external links/bookmarks should be updated to the new URL going forward.
- **Reversible**: Yes.

### [2026-07-08 02:50 IST] — Replace generic golden-template CI stub with Playwright smoke test
- **Context**: `.github/workflows/ci.yml` inherited from golden-template had every step as a TODO `echo` stub, causing all 21+ CI runs to fail since there is no npm/pip/go project here.
- **Decision**: Replace the stub workflow with a real Playwright-based smoke test (start screen renders, no console errors, score increments, jump works).
- **Rationale**: This project has zero build tooling (single static HTML file), so generic lint/typecheck/build steps don't apply; Playwright gives genuine browser-based verification instead.
- **Alternatives Rejected**: HTML validator only (rejected — doesn't catch JS runtime errors or gameplay regressions).
- **Consequences**: CI will now pass/fail based on real gameplay behavior; smoke test script lives inline in `ci.yml` for simplicity.
- **Reversible**: Yes.

### [2026-07-07] — Touch-based (not time-based) barrel collision
- **Context**: Barrel previously only killed the player once its catch-up progress value reached 1.0 (a fixed time delay), causing the barrel to visually overlap and cross the player before death registered.
- **Decision**: Calculate the barrel's actual leading-edge x-position every frame and trigger game over the instant it reaches the player's x-position, independent of the catch-up progress value.
- **Rationale**: Matches visual expectation — death should happen on contact, not after an animation timer completes.
- **Alternatives Rejected**: Shortening the catch-up duration (rejected — still not visually precise; a coincidental timing match, not a real collision check).
- **Consequences**: Barrel danger now feels fair and readable; catch-up value is now purely a visual animation driver.
- **Reversible**: Yes.

### [2026-07-07] — 2x zoom applied to the whole scene, not just the character
- **Context**: An initial attempt doubled only the player character's size, which looked inconsistent with the rest of the game world (ground, obstacles, barrel) remaining at original scale.
- **Decision**: Revert character-only resize; instead apply `ctx.scale(2, 2)` to the entire canvas render pass, with `logicalW()`/`logicalH()` helpers so all spawn positions and collision math operate correctly in the zoomed coordinate space.
- **Rationale**: A uniform camera zoom keeps all elements proportionally consistent, matching the "bring the whole game closer" request.
- **Alternatives Rejected**: Scaling only the player sprite (rejected — caused visual mismatch with obstacles/ground).
- **Consequences**: All future obstacle/enemy spawn logic must use `logicalW()`/`logicalH()` instead of raw `canvas.width`/`canvas.height`.
- **Reversible**: Yes.

### [2026-07-07] — Procedural (code-drawn) art instead of external sprite sheets
- **Context**: Needed a running character sprite with zero IP/licensing risk.
- **Decision**: Draw all visuals (player, enemies, bushes, barrel) procedurally using Canvas 2D paths/shapes instead of importing any third-party sprite sheet (even CC0-licensed ones).
- **Rationale**: Fully original, code-generated art has no attribution requirement and zero licensing ambiguity, simplifying the MIT-licensed distribution of this repo.
- **Alternatives Rejected**: Kenney.nl CC0 pixel-platformer sprite sheet (rejected — while legally safe with attribution, procedural art removes any dependency on external asset files entirely).
- **Consequences**: All obstacle/character visuals must be maintained as Canvas drawing code, not swappable image assets.
- **Reversible**: Partially (could be swapped for a real sprite sheet later without changing game logic).

### [2026-07-07] — Single self-contained `index.html` (no build step)
- **Context**: Game needed to be trivially shareable and playable with zero setup friction.
- **Decision**: Keep all HTML, CSS, and JavaScript in one file with no npm dependencies, bundler, or server requirement.
- **Rationale**: Maximizes portability — the file can be opened directly in any browser or hosted via GitHub Pages with no build pipeline.
- **Alternatives Rejected**: Splitting into separate .js/.css files with a bundler (rejected — adds complexity with no benefit for a project this size).
- **Consequences**: All future features must be added within the single-file structure; testing strategy is browser-based (Playwright), not unit-test-based.
- **Reversible**: Yes.
