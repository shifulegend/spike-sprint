# Config & Settings Rules
<!-- DYNAMIC FILE -->
<!-- paths: config/**, *.config.*, *.env*, schemas/**, settings/** -->

- Zero hard-coded values anywhere.
- Environment-specific values in env vars or config files.
- All configs must have safe, documented defaults.
- Config schemas validated at startup.
- New config keys documented in config files and `docs/ai/engineering-rules.md`.
- Feature flags must be config-driven.
