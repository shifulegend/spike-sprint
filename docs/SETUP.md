# Setup Guide
<!-- DYNAMIC FILE — update as setup steps change -->

## Prerequisites
<!-- TODO: List required tools, runtimes, and accounts -->
- Git
- GitHub CLI (optional but recommended): `brew install gh`

## First-Time Setup
```bash
# 1. Clone
git clone https://github.com/shifulegend/YOUR_REPO_NAME.git
cd YOUR_REPO_NAME

# 2. Copy env template
cp .env.example .env
# Fill in .env with real values — never commit it

# 3. Install dependencies
# TODO: npm ci | pip install -r requirements.txt | go mod download

# 4. Run development server
# TODO: npm run dev | python main.py | go run ./...
```

## Available Commands
| Command | Purpose |
|---------|---------|
| `TODO`  | Dev server |
| `TODO`  | Lint |
| `TODO`  | Typecheck |
| `TODO`  | Test |
| `TODO`  | Build |

## Environment Variables
See `.env.example` for all required and optional variables.

## AI Agent Setup
On first session in a new repo from this template:
1. Open Copilot / Claude Code / Antigravity
2. Run the `start-session` prompt/skill/workflow
3. Fill in `docs/ai/project-overview.md` TODOs
4. The agent will update all memory files from there
