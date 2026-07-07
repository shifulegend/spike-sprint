# Commit Log Guidance
<!-- DYNAMIC FILE — update if commit conventions improve -->

## Principles
- Every small sub-step gets its own commit.
- Commits must be the smallest reviewable coherent unit.
- Commit message must explain both WHAT changed and WHY.

## Format
```
<type>(<scope>): <short imperative summary>

<body: what changed and why, assumptions made, risks noted>

Refs: #<issue> (if applicable)
```

## Types
| Type       | When to use |
|------------|-------------|
| `feat`     | New feature or capability |
| `fix`      | Bug fix |
| `docs`     | Documentation only |
| `refactor` | Code restructure, no behavior change |
| `config`   | Configuration, env, schema changes |
| `test`     | Tests added or updated |
| `chore`    | Build, tooling, dependency updates |
| `ai`       | AI instruction/memory file updates |

## Examples
```
feat(auth): add token refresh on 401 response

Tokens were expiring mid-session with no recovery. Added interceptor
that attempts one silent refresh before propagating the error.

Refs: #42
```

```
ai(memory): update mistakes.md with null-config assumption error

Identified that agent assumed config always exists. Added prevention
rule to validate config presence before any read operation.
```
