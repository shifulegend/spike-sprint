---
applyTo: "config/**,*.config.*,*.env*,schemas/**,settings/**"
---
# Config & Settings Instructions
<!-- DYNAMIC FILE -->

- No hard-coded values anywhere in the codebase.
- All environment-specific values must live in env vars or config files.
- All configs must have safe, documented defaults.
- Config schemas must be validated at startup.
- New config keys must be documented in the relevant config file and in `docs/ai/engineering-rules.md`.
- Feature flags must be config-driven, not code-driven.
