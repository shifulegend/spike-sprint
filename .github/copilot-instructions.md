# GitHub Copilot — Repository Instructions
<!-- DYNAMIC FILE — updated automatically by Copilot as durable lessons emerge -->
<!-- Last updated: TIMESTAMP -->

## Session Start (Mandatory)
Before planning or coding in any session:
1. Read `docs/ai/project-overview.md`
2. Read `docs/ai/engineering-rules.md`
3. Read `docs/ai/mistakes.md` — summarize relevant recent mistakes
4. Read `docs/ai/decision-log.md` — summarize relevant recent decisions
5. Read relevant `.github/instructions/*.instructions.md` for the area being changed
6. State assumptions, open risks, and relevant rules before any action

## Project Context
<!-- Summarized from docs/ai/project-overview.md — keep in sync -->
- **Purpose**: TODO
- **Stack**: TODO
- **Architecture**: TODO
- **Key directories**: TODO

## Core Rules (from docs/ai/engineering-rules.md)
- Develop to the smallest sensible modular unit
- Zero hard-coding — all behavior must be configurable
- Documentation is mandatory and must be timestamped
- Every change needs granular commits explaining what + why
- Verify with tests, lint, typecheck, build before claiming done

## Dynamic Update Requirement
You MUST proactively update these files every session without waiting for user prompts:
- `docs/ai/mistakes.md` — on any mistake
- `docs/ai/decision-log.md` — on any durable decision
- `docs/ai/change-trace.md` — after each sub-step
- `.github/copilot-instructions.md` — when repo-wide rules change
- `.github/instructions/*.instructions.md` — when scoped rules change
- `.github/prompts/*.prompt.md` — when workflows improve

## Canonical Source
All rules originate in `docs/ai/`. If this file conflicts with `docs/ai/`, the shared docs win.
