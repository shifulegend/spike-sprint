# Change Trace
<!-- DYNAMIC FILE — updated by AI agents after each meaningful implementation sub-step -->
<!-- Newest entries first -->

## Entry Template
```
### [TIMESTAMP] — <Change Title>
- **What Changed**: 
- **Why**: 
- **Affected Areas**: 
- **Related Commit**: 
- **Risks / Follow-ups**: 
```

---

### [2026-07-15 23:32 IST] — Add subtle play-count beacon + CI hardening
- **What Changed**: Added `ANALYTICS_ENABLED`/`ANALYTICS_NAMESPACE`/`ANALYTICS_KEY` constants and a `trackPlay()` function to `index.html`, called from the `startBtn` and `restartBtn` click handlers (fires a `fetch` GET to `api.countapi.xyz`, no UI change). Updated `.github/workflows/ci.yml`'s Playwright smoke test to ignore console errors whose `location.url` points at the analytics host, so a third-party outage can't fail CI while real game-code errors still do. Updated `docs/ai/architecture.md` and `docs/ai/project-overview.md` to reflect the new (first-ever) external integration.
- **Why**: User asked to see GitHub download/play stats; GitHub provides none for a Pages-hosted static site, so a lightweight play counter was the only way to actually answer that. User explicitly chose a no-signup counter service over GoatCounter/Plausible, and asked to keep it "very subtle" (no visible UI).
- **Affected Areas**: `index.html` (analytics block + two call sites), `.github/workflows/ci.yml` (console-error filter), `docs/ai/architecture.md`, `docs/ai/project-overview.md`, `docs/ai/decision-log.md`.
- **Related Commit**: See commit on `claude/github-stats-downloads-4dbkrf` around 2026-07-15 23:32 IST
- **Risks / Follow-ups**: Verified locally with Playwright (both with the analytics host reachable and fully blocked) that the smoke test passes either way and gameplay is unaffected. Not yet verified against a real, unblocked network path to `api.countapi.xyz` (this sandbox's outbound proxy denies unlisted hosts) — worth a manual check of `https://api.countapi.xyz/get/shifulegend-spike-sprint/plays` after a real play to confirm the counter is actually incrementing in production.

### [2026-07-08 02:50 IST] — Full repo audit: fixed CI and documentation drift
- **What Changed**: Replaced stub `.github/workflows/ci.yml` with a working Playwright smoke test; filled in TODO/TIMESTAMP placeholders in `.github/copilot-instructions.md` and `docs/ai/engineering-rules.md`; backfilled `docs/ai/decision-log.md` with 4 real decisions already referenced by `architecture.md`; backfilled `docs/ai/mistakes.md` with the CI failure and doc-drift findings; rewrote `docs/ai/testing-strategy.md` to describe the actual Playwright approach instead of a generic TODO stub.
- **Why**: User requested a full audit for discrepancies/misrepresentations across the repo (title, docs, everything) and asked for all CI errors to be fixed. Found and corrected 5 distinct sync/drift issues.
- **Affected Areas**: `.github/workflows/ci.yml`, `.github/copilot-instructions.md`, `docs/ai/engineering-rules.md`, `docs/ai/decision-log.md`, `docs/ai/mistakes.md`, `docs/ai/testing-strategy.md`
- **Related Commit**: See commit history on `main` around 2026-07-08 02:50 IST
- **Risks / Follow-ups**: Should verify the new CI workflow produces a green run on the next push; consider extending the Playwright smoke test to cover bush/pit/barrel collision scenarios in future CI runs, not just start/score/jump.
