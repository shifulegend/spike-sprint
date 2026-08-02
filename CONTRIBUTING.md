# Contributing to Spike Sprint 🎮

First off — thanks for taking the time to contribute! ❤️

All types of contributions are welcome, whether you're fixing a bug, suggesting a new obstacle, improving the README, or just spreading the word. Read the relevant section below before diving in — it'll make things smoother for everyone.

> Don't have time to contribute code? No worries! There are other easy ways to show support:
> - ⭐ Star the repo
> - 🎮 Share the [live game](https://shifulegend.github.io/spike-sprint/) with friends
> - 🐛 Report a bug you found
> - 💡 Suggest a fun new game mechanic

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [I Have a Question](#i-have-a-question)
- [Reporting Bugs](#reporting-bugs)
- [Suggesting Enhancements](#suggesting-enhancements)
- [Your First Contribution](#your-first-contribution)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Commit Style](#commit-style)
- [Pull Request Process](#pull-request-process)

---

## Code of Conduct

This project follows a simple rule: **be kind**. Treat everyone with respect. Harassment, insults, or exclusionary behaviour will not be tolerated.

---

## I Have a Question

Before opening an issue, check if an existing [Issue](https://github.com/shifulegend/spike-sprint/issues) already covers your question.

If not, [open a new issue](https://github.com/shifulegend/spike-sprint/issues/new) and include:
- What you were trying to do
- What you expected vs. what actually happened
- Browser and OS (e.g. Chrome 125 on macOS)

---

## Reporting Bugs

A good bug report means we can reproduce and fix it fast. Please include:

- **Steps to reproduce** — exactly what you did
- **Expected behaviour** — what should have happened
- **Actual behaviour** — what actually happened
- **Browser + OS** — e.g. Safari 17 on iOS 17
- **Screenshot or screen recording** — if visual, a picture is worth 1000 words

> Please check the [open issues](https://github.com/shifulegend/spike-sprint/issues) first — someone may have already reported it.

---

## Suggesting Enhancements

Got an idea for a new obstacle, mechanic, or visual effect? Open an issue and describe:

- **The idea** — what would it look/feel like?
- **Why it fits** — does it match the game's vibe (pixel runner, single-file, zero deps)?
- **Any concerns** — performance, complexity, scope?

We're especially interested in ideas that stay true to the spirit of the project: **no build tools, no dependencies, pure canvas fun**.

---

## Your First Contribution

Not sure where to start? Look for issues tagged:

- `good first issue` — small, well-scoped, great for first-timers
- `bug` — known breakage that needs fixing
- `enhancement` — agreed-on feature ready to be built

If you want to work on something, comment on the issue first so we can avoid duplicate effort.

---

## Development Setup

No build tools. No package manager. Seriously.

```bash
# 1. Fork and clone the repo
git clone https://github.com/YOUR_USERNAME/spike-sprint.git
cd spike-sprint

# 2. Open the game
open index.html   # macOS
xdg-open index.html  # Linux
# Or just drag index.html into any browser
```

That's it. The entire game lives in `index.html`. Edit it, refresh the browser, see changes instantly.

**Recommended:** Use Chrome or Firefox for testing. The game targets modern browsers with Canvas 2D support.

---

## Making Changes

1. **Fork** the repo and create a branch:
   ```bash
   git checkout -b fix/barrel-speed-glitch
   # or
   git checkout -b feat/double-jump
   ```

2. **Make your changes** in `index.html` (or docs/screenshots if updating docs)

3. **Test manually** — open `index.html`, play through a few runs, check:
   - No JS errors in the browser console
   - Collision detection still feels fair
   - Score tracking works correctly
   - Game works on mobile (tap to jump)

4. **Keep it single-file** — do not add external dependencies, npm packages, or build steps. The zero-dependency constraint is intentional.

---

## Commit Style

Use clear, conventional commit messages:

```
fix: barrel collision detection off by one pixel
feat: add double-jump mechanic with cooldown
docs: update README gameplay section
style: improve player sprite shading
```

Format: `type: short description` (present tense, lowercase, no period)

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

---

## Pull Request Process

1. Make sure your branch is up to date with `main`
2. Open a PR with a clear title and description:
   - What changed and why
   - How to test it
   - Screenshots/GIF if it's a visual change
3. Link any related issue (e.g. `Closes #12`)
4. Wait for review — we'll try to respond within a few days
5. Address feedback, push updates, and we'll merge when it's ready 🎉

---

Thanks again for contributing — every bug report, idea, and PR makes the game better! 🕹️
