# CLAUDE.md — adaptv

What an agent needs before changing this repo. The docs are the source of truth; this file only
points at them and names the traps.

## What this is

A React framework plus its CLI, published (eventually) as `@arrzdev/adaptv`. It is a library: `main`
deploys nothing. `playground/` is a dev app linked against the checkout, not an example, and nothing
in `playground/` or `scripts/` ships.

## Read first

- `README.md` — the surface and the commands.
- `docs/README.md` — the doc index. Five folders, split by the kind of claim a file makes.
- `docs/decisions/register.md` — locked decisions. Do not reopen them in a PR.
- `docs/roadmap/README.md` — the single not-done list. If you ship a roadmap item, move its file out.
- `docs/design/cli-contract.md` and the `cli-ux` skill — **before any change under `bin/`**.
- `docs/DEVELOPMENT.md` — the playground loop, fresh worktrees, ports.

## Toolchain

- Node from `.nvmrc` (22). `engines` says `>=22.12`; other majors make some tests fail for reasons
  outside adaptv.
- pnpm 11 (`packageManager`). `playground/` is a **second, independent pnpm project** with its own
  lockfile; `pnpm playground:setup` installs it.
- `unzip` on `PATH` — one OTA test checks the zip with a second implementation.

## Before every commit

```bash
pnpm gate          # biome (root + playground), tsc x2, vitest, scripts/check-colour.mjs
pnpm build:check   # when you touch exports, tsdown.config.ts or anything the build emits
```

This is what the CI `gate` job (the one required check) runs; docs-only and draft PRs get a lighter
mode. The Playwright suites (`pnpm --dir playground test:e2e*`) run in `e2e.yml` only when the PR has
the `e2e` label, nightly, and weekly in full; label the PR, and run the suite you touched locally,
when a change is visual or behavioural.

## Rules

- A framework change and the playground change it forces land in the same commit.
- A fix comes with the test that fails without it.
- No retries in the Playwright configs. `update.spec.ts` on chromium is a known intermittent in the
  `sw` and `sw-spa` cells; a re-run is a human decision, never a config change.
- `exports` still points at `src/` until the dist cutover (`docs/roadmap/dist-cutover.md`). The CLI
  loads `src/` at runtime, so do not drop `src` from `files`.
- Never `wrangler deploy` the playground: its worker name is copied from another project.

## Commits and PRs

Conventional Commits, scope required, subject says the behaviour that now happens, all lowercase, no
final period: `fix(drawer): a drag begun mid-slide follows the finger`. One logical change per
commit. PR body: what was wrong and what changes, `Reproduce:`, `Verify:` with the commands you ran,
`Tested on:` / `Not tested:`. PRs target `main` and merge as squash. The full rules live in
[`CONTRIBUTING.md`](CONTRIBUTING.md); if the two disagree, `CONTRIBUTING.md` wins.
