# Testing Strategy
<!-- DYNAMIC FILE — updated by AI agents as testing patterns evolve -->
<!-- Last updated: 2026-07-08 02:50 IST -->

## Philosophy
- Tests are first-class — every change to gameplay logic must be verified in a real browser before being committed.
- Since this is a static, dependency-free HTML/CSS/JS project, "testing" means automated browser verification, not unit tests against isolated functions.
- Flaky tests must be fixed immediately and logged in `mistakes.md`.

## Test Types
| Type            | Tool                | Location                  | When to run |
|------------------|---------------------|----------------------------|-------------|
| Smoke test       | Playwright (Python)  | `.github/workflows/ci.yml` (inline script) | Every push/PR (CI) |
| Manual gameplay  | Local browser        | N/A — open `index.html`    | Before every feature change, for visual/feel verification |

## Commands
```bash
# CI runs this automatically on every push — to run locally:
pip install playwright
playwright install chromium
python3 -c "
import asyncio
from playwright.async_api import async_playwright
# see .github/workflows/ci.yml for the full smoke test script
"
```

## What CI Verifies
- The start screen renders without errors.
- No JavaScript console or page errors occur during load or gameplay.
- Score increments over time once the game starts.
- Jump input (mouse down/up) does not throw errors.

## Coverage Targets
- Not applicable in the traditional line-coverage sense (no unit-testable modules).
- Every user-facing gameplay change (jump physics, collisions, scoring, difficulty scaling) must be manually verified in a real browser session before commit, and ideally covered by an extension to the CI smoke test.

## Regression Policy
- Every bug fix must include a manual or automated verification step showing the fix works (see `docs/ai/mistakes.md` for examples, e.g. the ZOOM initialization-order bug).
- Log the bug in `docs/ai/mistakes.md` before writing the fix.
