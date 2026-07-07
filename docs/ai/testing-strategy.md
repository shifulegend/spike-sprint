# Testing Strategy
<!-- DYNAMIC FILE — updated by AI agents as testing patterns evolve -->
<!-- Last updated: TIMESTAMP -->

## Philosophy
- Tests are first-class code — same quality bar as production code.
- One test per behavior.
- Tests must be deterministic and fast.
- Flaky tests must be fixed immediately and logged in `mistakes.md`.

## Test Types
| Type        | Tool    | Location      | When to run |
|-------------|---------|--------------|-------------|
| Unit        | TODO    | `tests/unit` | Every commit |
| Integration | TODO    | `tests/integration` | Every PR |
| E2E         | TODO    | `tests/e2e`  | Before release |

## Commands
```bash
# Run all tests
TODO

# Run with coverage
TODO

# Run specific file
TODO
```

## Coverage Targets
- Unit: ≥ 80% line coverage
- Critical paths: 100%

## Regression Policy
- Every bug fix must include a regression test.
- Log the bug in `docs/ai/mistakes.md` before writing the fix.
