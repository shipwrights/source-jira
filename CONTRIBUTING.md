# Contributing to `@shipwrights/source-jira`

Thanks for thinking about contributing! This file covers the practical stuff: how to set up, what to run before opening a PR, and what we look for in changes.

## Quick start

```bash
git clone https://github.com/shipwrights/source-jira.git
cd source-jira
npm install
npm test
```

If `npm test` is green, you're set up. The test suite uses a stub fetch — no real Jira credentials needed.

## How we work

### Branch names

| Prefix | Use for |
|---|---|
| `feat/<slug>` | New features |
| `fix/<slug>` | Bug fixes |
| `chore/<slug>` | Tooling, deps, docs, internal cleanup |
| `docs/<slug>` | Documentation-only changes |
| `test/<slug>` | Test-only changes (no production code) |

Lowercase, hyphen-separated. Keep slugs short and specific (e.g. `fix/healthcheck-401-guidance`, not `fix/bug`).

### Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

<body — what changed and why, not how>
```

Examples:
- `feat: add sprint scoping to init wizard`
- `fix(healthcheck): translate 401 into actionable guidance`
- `docs: document the .env.local precedence rule`

The first line stays under ~70 chars. The body explains *why* — readers can see the *what* in the diff.

### Pull requests

1. Fork the repo (or branch directly if you're a maintainer).
2. Create a branch following the naming convention above.
3. Write the change + tests in the same commit (or commits — they get squashed at merge).
4. Push, open a PR using the template that auto-loads.
5. CI runs `npm test` on every push. Wait for green before requesting review.
6. A maintainer reviews, asks questions, requests changes if needed.
7. On approval, the PR is squash-merged into `main` with `--rebase --delete-branch`.

### Tests

Tests are required for any code change that's not pure formatting. Tests live in `tests/` and use `node:test` plus a local `stub-fetch.mjs` helper to mock Jira responses without hitting the real API.

Useful test commands:

```bash
npm test                          # full suite
node --test tests/foo.test.mjs    # one file
```

If your change interacts with Jira's REST or Agile APIs, add a fixture under `tests/fixtures/` and a stub registration in your test — don't hit the live API from tests.

### Code style

We use plain ES modules. No formatter is enforced by CI today; match the style of the file you're editing.

## What we look for in changes

### Good PR shape

- One coherent change per PR. Mixing a refactor with a bug fix makes both harder to review.
- Tests describe behaviour, not implementation — assertions on the public surface of the source, not internal helpers.
- Doc updates land in the same PR as the behaviour they describe.
- Breaking changes to `createSource()` / CLI subcommand contracts are flagged in the PR title (`feat!:`) and explained in the body.

### Things that get pushed back

- Code that doesn't have tests.
- Renaming variables / reformatting unrelated files alongside a bug fix.
- PRs that hit the real Jira API from tests instead of using the stub fetch.
- PRs without a clear use case in the body — *why* this change, not just *what*.

### Security

If you find a security issue, please don't open a public issue. See [`SECURITY.md`](SECURITY.md) for how to report privately.

## Code of conduct

By participating, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

## Maintainer notes

Currently a single maintainer (`@dacostaaboagye`). Once a second maintainer joins, the `main` branch protection will require one approval before merge. Until then, the maintainer self-merges after CI passes and verifying their own diff.
