# Decision Log
<!-- DYNAMIC FILE — updated by AI agents when architectural, tooling, or workflow decisions are made -->
<!-- Newest entries first -->

## Entry Template
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
