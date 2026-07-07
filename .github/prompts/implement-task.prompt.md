# Implement Task
<!-- Use to execute an approved plan -->

Steps:
1. Confirm the plan is approved.
2. Implement one sub-step at a time.
3. After each sub-step:
   - Verify (lint, typecheck, test, build as applicable)
   - Update `docs/ai/change-trace.md`
   - Propose exact commit message (what + why)
4. Update `docs/ai/mistakes.md` immediately if any mistake is found.
5. Update `docs/ai/decision-log.md` if a durable decision is made.
6. At completion, synchronize all tool-specific instruction files per `docs/ai/tool-sync-policy.md`.
