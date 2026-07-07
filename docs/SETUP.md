# Setup Guide
<!-- DYNAMIC FILE — update as setup steps change -->

## Prerequisites
- Any modern web browser (Chrome recommended)
- Git (only needed to clone the repo; no runtime dependencies)

## First-Time Setup
```bash
# 1. Clone
git clone https://github.com/shifulegend/pixel-runner-game.git
cd pixel-runner-game

# 2. Open the game directly — no build step, no install step
open index.html    # macOS
# or double-click index.html in your file explorer
# or: python3 -m http.server 8000  then visit http://localhost:8000
```

There is no `.env`, no package manager, and no server required — `index.html` is fully self-contained (HTML + CSS + JavaScript in one file).

## Available Commands
| Command | Purpose |
|---------|---------|
| N/A     | No build/dev/lint/test commands exist — open `index.html` directly |

CI runs a Playwright smoke test on every push (see `.github/workflows/ci.yml`) to catch console errors and verify core gameplay logic, but there is nothing to run locally beyond opening the file.

## Environment Variables
None. This project has no `.env` file or secrets — `.env.example` is inherited from the golden-template scaffold but unused here.

## AI Agent Setup
On first session in this repo:
1. Open Copilot / Claude Code / Antigravity
2. Read `docs/ai/project-overview.md` and `docs/ai/architecture.md` for full context
3. All canonical rules live in `docs/ai/` — see `docs/ai/tool-sync-policy.md`
