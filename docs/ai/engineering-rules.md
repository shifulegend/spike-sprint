# Engineering Rules
<!-- Last updated: TIMESTAMP -->
<!-- DYNAMIC FILE — updated automatically by AI agents every session as applicable -->

## Modularity
- Develop to the smallest sensible unit possible.
- Prefer composition over large files, large classes, or tightly coupled modules.
- Every module must have a single, explicit responsibility.
- Prefer explicit interfaces over implicit dependencies.

## Zero Hard-Coding
- Nothing may be hard-coded unless there is a strong technical reason, documented explicitly.
- All configurable behavior lives in: config files, environment variables, schemas, feature flags, metadata, or databases.
- Treat configurability as the default design goal.
- Before implementing, inspect the repo for existing config/settings patterns and reuse them.

## Documentation
- Documentation is the backbone of the project.
- Document everything relevant, even if trivial.
- Add timestamps to documentation updates.
- Add timestamps to code comments for non-obvious decisions, risks, workarounds, or temporary constraints.

## Verification & Definition of Done
A change is done when:
- [ ] Tests pass (lint, typecheck, test, build)
- [ ] Relevant docs updated
- [ ] No hard-coded values introduced
- [ ] Change is modular and configurable
- [ ] Commit message explains what + why
- [ ] Mistake log checked and updated if applicable

## Security & Safety
- No secrets, credentials, or API keys in code or docs.
- All inputs must be validated.
- Security-sensitive areas must be documented and flagged.
- Report vulnerabilities via SECURITY.md process.
