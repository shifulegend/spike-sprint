# Change Trace
<!-- DYNAMIC FILE — updated by AI agents after each meaningful implementation sub-step -->
<!-- Newest entries first -->

## Entry Template
### 2026-11-24 — v2.0 Release (Steps 1–4 Completed)
- Implemented `BASE_MODE`/`MODES` registry, atomic spawners, story hook, opt-in lore card, and reversible responsive zoom floor (Step 1).
- Implemented Hero mode 3 inline-SVG buttons (Pit, Bush, Purple Hero), shared deterministic cooldown with refill-wipe animation and tweakable `cooldownScale: 0.75`, Havoc / Min Havoc HUD, and `VILLAGE SAVED!` end screen (Step 2).
- Embedded trained `[21, 64, 64, 5]` DQN RL bot (`RL_WEIGHTS_B64`) with step-level `no-op` key-release fix (Step 3).
- Verified 24/24 automated tests (10 legacy non-regression + 14 Hero/RL/cooldown checks) and synced repo + Drive documentation (Step 4).

```
### [TIMESTAMP] — <Change Title>
- **What Changed**: 
- **Why**: 
- **Affected Areas**: 
- **Related Commit**: 
- **Risks / Follow-ups**: 
```

---

### [2026-07-08 02:50 IST] — Full repo audit: fixed CI and documentation drift
- **What Changed**: Replaced stub `.github/workflows/ci.yml` with a working Playwright smoke test; filled in TODO/TIMESTAMP placeholders in `.github/copilot-instructions.md` and `docs/ai/engineering-rules.md`; backfilled `docs/ai/decision-log.md` with 4 real decisions already referenced by `architecture.md`; backfilled `docs/ai/mistakes.md` with the CI failure and doc-drift findings; rewrote `docs/ai/testing-strategy.md` to describe the actual Playwright approach instead of a generic TODO stub.
- **Why**: User requested a full audit for discrepancies/misrepresentations across the repo (title, docs, everything) and asked for all CI errors to be fixed. Found and corrected 5 distinct sync/drift issues.
- **Affected Areas**: `.github/workflows/ci.yml`, `.github/copilot-instructions.md`, `docs/ai/engineering-rules.md`, `docs/ai/decision-log.md`, `docs/ai/mistakes.md`, `docs/ai/testing-strategy.md`
- **Related Commit**: See commit history on `main` around 2026-07-08 02:50 IST
- **Risks / Follow-ups**: Should verify the new CI workflow produces a green run on the next push; consider extending the Playwright smoke test to cover bush/pit/barrel collision scenarios in future CI runs, not just start/score/jump.
