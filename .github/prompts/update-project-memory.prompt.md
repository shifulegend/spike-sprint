# Update Project Memory
<!-- Run after any task that produced a durable lesson -->

Steps:
1. Identify the lesson learned.
2. Classify it: repo-wide, scoped, or workflow-specific.
3. Update the relevant files:
   - `docs/ai/mistakes.md` (if a mistake)
   - `docs/ai/decision-log.md` (if a decision)
   - `docs/ai/change-trace.md` (if a notable change)
   - `.github/copilot-instructions.md` (if a repo-wide rule)
   - `.github/instructions/*.instructions.md` (if a scoped rule)
   - `.github/prompts/*.prompt.md` (if a workflow improved)
4. Synchronize all tool-specific adapter files per `docs/ai/tool-sync-policy.md`.
5. Propose the commit checkpoint with message type `ai(memory): ...`
