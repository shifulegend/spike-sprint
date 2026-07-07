# Golden Template — shifulegend

A cross-tool AI development template for starting any new repository with a documentation-first, modular, verification-first, security-first workflow.

## What's Included

### Shared Canonical Memory (`docs/ai/`)
| File | Purpose |
|------|---------|
| `project-overview.md` | Project purpose, stack, architecture |
| `engineering-rules.md` | Modularity, zero-hardcoding, verification rules |
| `mistakes.md` | Central mistake log — read first every session |
| `decision-log.md` | Timestamped decisions |
| `change-trace.md` | Notable changes per sub-step |
| `session-start-checklist.md` | Mandatory startup checklist |
| `commit-log-guidance.md` | Commit message standards |
| `tool-sync-policy.md` | How tool-specific files stay in sync |
| `architecture.md` | System architecture, components, integrations |
| `testing-strategy.md` | Test types, coverage targets, regression policy |

### GitHub Copilot (`.github/`)
- `copilot-instructions.md` — repo-wide instructions
- `instructions/*.instructions.md` — scoped instructions (core, docs, tests, config)
- `prompts/*.prompt.md` — reusable prompts (start-session, plan, implement, review, debug, memory)

### Claude Code (`CLAUDE.md` + `.claude/`)
- `CLAUDE.md` — project memory entrypoint
- `.claude/rules/` — modular scoped rules (core, docs, tests, config)
- `.claude/skills/` — reusable skills (session-start, project-memory, review-verify, implement)

### Google Antigravity (`gemini/` + `.agents/`)
- `gemini/GEMINI.md` — global Antigravity rules
- `AGENTS.md` — cross-tool portability layer
- `.agents/rules/` — scoped rules (core, docs, tests, config)
- `.agents/workflows/` — reusable workflows (start-session, review-verify, update-memory)

### Security & Dependencies
- `.github/workflows/ci.yml` — CI: lint, typecheck, test, build
- `.github/dependabot.yml` — automated dependency updates
- `CODEOWNERS` — auto-assign reviewers per path

### Developer Experience
- `LICENSE` — MIT
- `.gitignore` — comprehensive multi-stack gitignore
- `.env.example` — safe env template (never commit `.env`)
- `CITATION.cff` — GitHub-native citation support
- `docs/SETUP.md` — first-time setup guide
- `docs/BRANCHES.md` — branch strategy and protection rules

## How to Use

### Create a New Repo from This Template
1. Go to [github.com/shifulegend/golden-template](https://github.com/shifulegend/golden-template)
2. Click **Use this template** → **Create a new repository**
3. Fill in the new repo details and create

### After Creating from Template
1. `cp .env.example .env` and fill in real values
2. Update `docs/ai/project-overview.md` — purpose, stack, architecture
3. Update `docs/ai/architecture.md` — components, data flow, integrations
4. Update `docs/SETUP.md` — actual commands for your stack
5. Uncomment the right `dependabot.yml` ecosystem block
6. Enable branch protection rules (Settings → Branches)
7. Search for `TODO` markers and fill them in
8. Run your first AI session using the `start-session` prompt/skill/workflow

## Core Principles
- **Extremely modular** — smallest sensible unit, explicit interfaces
- **Zero hard-coding** — config files, env vars, schemas, or databases for all behavior
- **Documentation-first** — docs updated proactively every session by AI agents
- **Mistake-first sessions** — always read mistake log before coding
- **Granular commits** — one small, reviewable sub-step per commit
- **Security-first** — CODEOWNERS, Dependabot, CodeQL, secret scanning, .env.example
- **Cross-tool portable** — Claude Code, GitHub Copilot, and Google Antigravity all supported

## AI Agent Dynamic Update Rule
All `docs/ai/` files and tool adapter files are **dynamic**. Any AI agent working in a repo created from this template must proactively update them every session — without waiting for explicit user prompts. See `docs/ai/tool-sync-policy.md`.
