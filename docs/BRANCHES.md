# Branch Strategy
<!-- DYNAMIC FILE — update when branching strategy evolves -->

## Branches
| Branch    | Purpose                        | Protected |
|-----------|-------------------------------|-----------|
| `main`    | Production-ready code          | ✅ Yes    |
| `develop` | Integration branch             | ✅ Yes    |
| `feat/*`  | Feature branches               | No        |
| `fix/*`   | Bug fix branches               | No        |
| `chore/*` | Maintenance tasks              | No        |
| `ai/*`    | AI memory/instruction updates  | No        |

## Protection Rules (set in repo Settings → Branches)
- Require PR before merging to `main`
- Require at least 1 approving review
- Require status checks to pass (CI)
- Restrict force pushes
- Delete branches after merge

## Two-Repo Sync Architecture (Private → Public)
- **Source of Truth:** `shifulegend/spike-sprint-private` — all development, online/multiplayer docs, server code, feature branches, and PRs happen here.
- **Public Mirror:** `shifulegend/spike-sprint` — synced automatically from `spike-sprint-private` on pushes to `main` via `.github/workflows/sync-to-public.yml` (requires `PUBLIC_SYNC_TOKEN` secret). All online/multiplayer documents, plans, server/multiplayer modules (`01 - System Documentation/`, `02 - Implementation & Test Plans/`, `src/mp/`, `src/bridge/`, `server/`, `tests/run_m5_*`), and Drive archives are strictly excluded from public sync.
- **Local Remotes:** Point `origin` to `spike-sprint-private` and disable direct pushes to `public` (`git remote set-url --push public DISABLED`) to avoid duplicate pushes.

## Commit Convention
See `docs/ai/commit-log-guidance.md` for full commit message format.
