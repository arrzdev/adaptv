# Contributing to adaptv

Thanks for helping. This file says where things are; it does not repeat them.

## Before you start

- **Report a bug or propose a feature** with an issue, using the template. Security problems are not
  issues: see [`SECURITY.md`](SECURITY.md).
- **Read the docs index,** [`docs/README.md`](docs/README.md). Each folder holds one kind of claim,
  and a change that alters a claim updates the file that makes it.
- **Check the roadmap and the register.** Planned work is in
  [`docs/roadmap/`](docs/roadmap/README.md); locked decisions, open questions and known bugs are in
  [`docs/decisions/register.md`](docs/decisions/register.md). A change against a locked decision
  starts as an issue, not a PR.
- **Changing the CLI?** Read [`docs/design/cli-contract.md`](docs/design/cli-contract.md) first.

## The development loop

[`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) covers setup, the playground, the `dev`/`preview`/`build`
commands per target, fresh worktrees and ports. Node and pnpm versions come from `.nvmrc` and
`package.json#packageManager`.

## The gate

Run `pnpm gate` before every commit. It is everything the CI `gate` job runs. CI also runs the
playground's Playwright suites on Chromium and WebKit; run the specs your change touches locally
(see `DEVELOPMENT.md`).

## Commits and pull requests

- **Branch:** `<type>/<short-topic>`, lowercase, words joined with `-` (`fix/drawer-drag`).
- **Commit and PR title:** [Conventional Commits](https://www.conventionalcommits.org/), saying the
  behaviour that now holds rather than the activity: `fix(drawer): a drag begun mid-slide follows the
  finger`, not `fix: update drawer code`. Types: `feat`, `fix`, `test`, `docs`, `chore`,
  `refactor`, `ci`, `perf`. Lowercase, no final period. `git log` has many examples.
- **One logical change per commit.** A fix comes with the test that fails without it. Do not mix a
  refactor with a fix.
- **Commit body:** short prose: why it was wrong, what changes, which tests cover it.
- **PR body:** fill in the [template](.github/pull_request_template.md). PRs are squash-merged.
- Add a line under `Unreleased` in [`CHANGELOG.md`](CHANGELOG.md) when users of adaptv would notice the
  change.
