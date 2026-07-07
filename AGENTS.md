# AGENTS.md — Cross-Tool Portability Layer
<!-- DYNAMIC FILE — mirror of gemini/GEMINI.md for cross-tool compatibility -->
<!-- Last updated: TIMESTAMP -->
<!-- Canonical source: docs/ai/ — if conflict exists, shared docs win -->

## Session Start (Mandatory — All Tools)
1. Read the tool's native entrypoint file
2. Read `docs/ai/project-overview.md`
3. Read `docs/ai/engineering-rules.md`
4. Read `docs/ai/mistakes.md`
5. Read `docs/ai/decision-log.md`
6. Read `docs/ai/session-start-checklist.md`
7. Summarize: rules, recent mistakes, recent decisions, open risks, assumptions

## Core Rules
- Smallest sensible modular unit per responsibility
- Zero hard-coding — all behavior configurable
- Documentation mandatory and timestamped
- Granular commits: what + why
- Verify: lint → typecheck → test → build

## Dynamic Update Requirement
ALL of the following are dynamic files — update proactively every session:
- `docs/ai/mistakes.md`, `docs/ai/decision-log.md`, `docs/ai/change-trace.md`
- GitHub Copilot: `.github/copilot-instructions.md`, `.github/instructions/`, `.github/prompts/`
- Claude Code: `CLAUDE.md`, `.claude/rules/`, `.claude/skills/`
- Antigravity: `gemini/GEMINI.md`, `AGENTS.md`, `.agents/rules/`, `.agents/workflows/`

## Tool-Specific Entrypoints
| Tool           | Primary File |
|----------------|-------------|
| GitHub Copilot | `.github/copilot-instructions.md` |
| Claude Code    | `CLAUDE.md` |
| Google Antigravity | `gemini/GEMINI.md` |

## Sync Policy
See `docs/ai/tool-sync-policy.md` for full sync rules.
