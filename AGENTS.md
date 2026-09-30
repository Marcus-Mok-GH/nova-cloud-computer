# AGENTS.md

Instructions for AI agents working in this repository.

## Git workflow

- For **minor changes** — typo fixes, small copy tweaks, one-line fixes, doc updates, formatting — commit and **push directly to `main`**. Do not open a PR.
- For **everything else** — new features, refactors, behavior changes, anything touching multiple files or systems — **create a branch and open a pull request**. Do not push directly to `main`.

### Rules

- Push directly only if you can describe the change in a single sentence and it is low-risk. Otherwise, open a PR.
- Always use a PR if the change is destructive, touches CI/CD config, dependencies, auth, or production behavior.
- When in doubt, open a PR.
- Follow the existing commit message style (check `git log`).
- Never push directly to `main` on someone else's behalf unless explicitly asked.
- Remember, create a PR for complex changes, including for complicated backend changes, but if it's a simple frontend change, just push it directly.

## Commit and PR attribution

- Never add author or co-author lines, `Generated with ...` footers, emoji signatures, or any other agent/tool attribution to commit messages or pull request descriptions.
- A commit message (and PR description) should describe the change and nothing else.
