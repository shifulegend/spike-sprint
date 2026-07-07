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

## Commit Convention
See `docs/ai/commit-log-guidance.md` for full commit message format.
