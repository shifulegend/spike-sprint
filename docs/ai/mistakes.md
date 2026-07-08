# Mistake Log
<!-- DYNAMIC FILE — updated immediately by AI agents when any mistake is identified -->
<!-- Newest entries first. Read this FIRST at the start of every session. -->

## Entry Template
```
### [TIMESTAMP] — <Short Title>
- **Summary**: What went wrong
- **Root Cause**: Why it happened
- **Affected Files/Modules**: 
- **Detection Method**: How it was found
- **Correction**: What was done to fix it
- **Prevention Rule**: Rule to avoid recurrence
```

---

### [2026-07-08 02:50 IST] — CI failing on every push since repo creation
- **Summary**: All 20+ CI runs failed from the moment the repo was created from golden-template.
- **Root Cause**: `.github/workflows/ci.yml` inherited from golden-template as a generic stub (every step is `echo "TODO..."`), written for a project with a real build/lint/test/typecheck pipeline. This is a static, dependency-free HTML/JS project with none of that tooling, so the stub steps were never replaced per the template's own "After Creating from Template" setup checklist.
- **Affected Files/Modules**: `.github/workflows/ci.yml`
- **Detection Method**: Checked GitHub Actions run history via API; all runs showed `conclusion: failure`.
- **Correction**: Replaced the stub workflow with a real Playwright-based smoke test (checks start screen render, console/page errors, score increment, jump input) suited to a static HTML/JS game.
- **Prevention Rule**: When bootstrapping a new repo from golden-template, immediately customize `.github/workflows/ci.yml` for the actual stack in the same session — do not leave TODO stubs live on `main`, since they will fail on every push and create alert noise.

### [2026-07-08 02:50 IST] — docs/ai/ files left with unfilled template placeholders after repo bootstrap
- **Summary**: `.github/copilot-instructions.md` retained `TODO` placeholders in its Project Context section (Purpose/Stack/Architecture/Key directories) and a literal `<!-- Last updated: TIMESTAMP -->` comment, while `CLAUDE.md`, `gemini/GEMINI.md`, and `AGENTS.md` had already been correctly filled in — a direct violation of this repo's own `tool-sync-policy.md`, which requires all tool adapter files to stay synchronized. Additionally, `docs/ai/decision-log.md` and `docs/ai/mistakes.md` were still empty ("No entries yet") despite `docs/ai/architecture.md` explicitly stating "See `docs/ai/decision-log.md` for full rationale on: procedural asset generation..." — a factual contradiction between two canonical docs. `docs/ai/testing-strategy.md` was also left as a generic TODO stub, contradicting `docs/SETUP.md` and `docs/ai/architecture.md`, both of which already correctly describe the Playwright-based CI testing approach in use.
- **Root Cause**: Individual documentation updates (README, SETUP.md, architecture.md, CLAUDE.md/GEMINI.md/AGENTS.md) were made incrementally across several user requests without a full cross-file consistency sweep after each change, allowing `copilot-instructions.md`, `decision-log.md`, `mistakes.md`, and `testing-strategy.md` to drift out of sync with the rest of `docs/ai/`.
- **Affected Files/Modules**: `.github/copilot-instructions.md`, `docs/ai/decision-log.md`, `docs/ai/mistakes.md`, `docs/ai/testing-strategy.md`, `docs/ai/engineering-rules.md`
- **Detection Method**: Full repo-wide documentation audit requested by user — fetched and diffed every canonical doc and tool adapter file against each other.
- **Correction**: Filled in `copilot-instructions.md` Project Context to match CLAUDE.md/GEMINI.md/AGENTS.md; backfilled `decision-log.md` with the 4 decisions `architecture.md` already referenced; logging this very mistake here; rewrote `testing-strategy.md` to describe the actual Playwright smoke-test approach; fixed the stale `TIMESTAMP` placeholder in `engineering-rules.md`.
- **Prevention Rule**: After any change to `docs/ai/project-overview.md` or `docs/ai/architecture.md`, immediately grep all tool adapter files (`.github/copilot-instructions.md`, `CLAUDE.md`, `gemini/GEMINI.md`, `AGENTS.md`) and cross-referenced canonical docs (`decision-log.md`, `mistakes.md`, `testing-strategy.md`) for TODO/TIMESTAMP placeholders or claims that aren't yet backed by real entries, per this repo's own `tool-sync-policy.md` and `session-start-checklist.md` dynamic-update rules.
