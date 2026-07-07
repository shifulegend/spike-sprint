# Session Start Checklist
<!-- DYNAMIC FILE — update this checklist when startup procedure improves -->
<!-- Run this at the start of EVERY session, regardless of which tool you are using -->

## Mandatory Steps (All Tools)
- [ ] Read tool-native entrypoint file:
  - GitHub Copilot → `.github/copilot-instructions.md`
  - Claude Code → `CLAUDE.md`
  - Antigravity → `gemini/GEMINI.md` + `AGENTS.md`
- [ ] Read `docs/ai/project-overview.md`
- [ ] Read `docs/ai/engineering-rules.md`
- [ ] Read `docs/ai/mistakes.md` — summarize recent mistakes relevant to today's work
- [ ] Read `docs/ai/decision-log.md` — summarize recent decisions relevant to today's work
- [ ] Read relevant scoped rule files for the area being changed
- [ ] Before coding, state:
  - Relevant rules
  - Recent mistakes
  - Recent decisions
  - Open risks
  - Explicit assumptions

## Dynamic Update Reminder
Without waiting for user prompts, during this session you MUST update:
- `docs/ai/mistakes.md` — if any mistake is identified
- `docs/ai/decision-log.md` — if any durable decision is made
- `docs/ai/change-trace.md` — after each implementation sub-step
- Tool-specific instruction files — if durable rules change
- Scoped rule files — if recurring scoped patterns appear
