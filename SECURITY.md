# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.0.x (latest) | ✅ Yes |
| < 1.0 | ❌ No |

Security fixes are applied to the latest release only. Always play the most recent version at [shifulegend.github.io/spike-sprint](https://shifulegend.github.io/spike-sprint/).

---

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, use one of these private channels:

### Option 1 — GitHub Private Vulnerability Reporting (Preferred)
Use GitHub's built-in private reporting directly on this repo:
👉 [Report a vulnerability](https://github.com/shifulegend/spike-sprint/security/advisories/new)

This keeps the report confidential between you and the maintainer until a fix is released.
\n### Option 2 — GitHub Security Tab
Navigate to the **Security** tab → **Advisories** → **Report a vulnerability**.

---

## What to Include in Your Report

A useful report helps us fix things faster. Please include:

- **Description** — what is the vulnerability and what could it enable?
- **Steps to reproduce** — exact steps to trigger the issue
- **Impact** — what could an attacker do with this? (e.g. steal data, redirect users, execute code)
- **Environment** — browser, OS, and version of the game
- **Proof of concept** — screenshot, recording, or minimal reproduction if possible

---

## What to Expect

| Step | Timeline |
|------|----------|
| Acknowledgement of your report | Within **48 hours** |
| Confirmation whether it's valid | Within **5 business days** |
| Fix released (if valid) | Within **30 days** for critical issues |
| Public disclosure | After fix is released and deployed |

We'll keep you updated throughout the process and credit you in the release notes (unless you prefer to remain anonymous).

---

## Scope

### In scope
- Cross-site scripting (XSS) vulnerabilities in `index.html`
- Code that could be exploited if the game is self-hosted
- Issues in the iOS Shortcut that could expose user data
- Supply chain issues (e.g. compromised CI workflow)

### Out of scope
- Bugs that only affect gameplay (jump height, score counting, collision feel) — please use a [bug report](https://github.com/shifulegend/spike-sprint/issues/new?template=bug_report.md) instead
- Issues requiring physical access to the user's device
- Self-inflicted issues from modifying `index.html` locally
- Browser-level vulnerabilities (report those to the browser vendor)

---

## Coordinated Disclosure Policy

We follow **coordinated vulnerability disclosure**:

- Please give us a reasonable amount of time to fix the issue before any public disclosure
- We ask for **30 days** before publishing details publicly — we'll work as fast as possible
- We will not take legal action against researchers who follow this policy in good faith

---

## Safe Harbour

We consider security research conducted under this policy to be:

- Authorized and conducted in good faith
- Not in violation of any applicable law

We will not pursue civil or criminal action against researchers who discover and report vulnerabilities responsibly under this policy.

---

*This policy is inspired by [GitHub's coordinated vulnerability disclosure guidelines](https://github.blog/security/vulnerability-research/coordinated-vulnerability-disclosure-cvd-open-source-projects/) and the [OpenSSF CVD guide](https://github.com/ossf/wg-vulnerability-disclosures).*
