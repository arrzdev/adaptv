# CLAUDE.md — adaptv

What an agent needs before changing this repo. The docs are the source of truth; this file only
points at them and names the traps.

## What this is

A React framework plus its CLI, published (eventually) as `adaptv`. It is a library. A merge to
`main` deploys only the website (`adaptv.tudu.dev`, `website.yml`); the board allowed that site to
deploy continuously from `main` with no staging. An npm publish (a `v*` tag, `publish.yml`) is a
production release: it needs the board's OK for that release, asked by the CEO with the list of
user-visible changes. `playground/` is a dev app linked against the checkout, not an example, and nothing
in `playground/` or `scripts/` ships.

## Read first

- `README.md` — the surface and the commands.
- `docs/README.md` — the doc index. Five folders, split by the kind of claim a file makes.
- `docs/decisions/register.md` — locked decisions. Do not reopen them in a PR.
- `docs/roadmap/README.md` — the single not-done list. If you ship a roadmap item, move its file out.
- `docs/design/cli-contract.md` and the `cli-ux` skill — **before any change under `bin/`**.
- `docs/DEVELOPMENT.md` — the playground loop, fresh worktrees, ports.

## Toolchain

- Node from `.nvmrc` (22). `engines` says `>=22.15`; other majors make some tests fail for reasons
  outside adaptv.
- pnpm 11 (`packageManager`). `playground/` is a **second, independent pnpm project** with its own
  lockfile; `pnpm playground:setup` installs it.
- Two TypeScripts. `typescript` (5.9.3) is the compiler API that tsdown's `.d.ts` build and a few
  tests import; TypeScript 7 has no JS API. `typescript-7` (an npm alias of `typescript@7.0.2`)
  runs `pnpm typecheck` (root and `website/`) through `node_modules/typescript-7/bin/tsc`. Do not
  re-add `baseUrl` to a tsconfig: 7 removed it.
- `unzip` on `PATH` — one OTA test checks the zip with a second implementation.

## Before every commit

```bash
pnpm gate          # biome (root + playground), tsc x2, vitest, check:wrangler-envs, check-colour, build:check
pnpm build:check   # alone: tsdown + scripts/verify-dist.mjs (structure, publint, attw)
```

This is what the CI `gate` job (the one required check) runs; docs-only PRs get a lighter mode.
The repo is public, so the PR check is GitHub Actions (`ci.yml`), not a local gate script.
Open every PR as a **draft**: `gate` is skipped on drafts. Run `pnpm gate` locally and mark the PR
ready once, when it is green; that runs the full gate. Each push to a ready PR runs it again, so push
to a ready PR only what you want merged.

Browser suites in CI (`e2e.yml`, never required): the `e2e` label on a PR runs the five PR suites
(`test:e2e`, `:plain`, `:sw`, `:sw:spa`, `:sw:prompt`) on chromium, and the same runs nightly on
`main` with `:stress` on chromium beside it (dispatch with `scope=nightly` to run that set on a
branch); `e2e-full` (every suite × chromium + webkit, weekly or on demand) runs before a release.
The WebKit and Android smokes run on demand or when their own files change. Before marking ready a
PR that touches runtime or service-worker code (or anything visual or behavioural), run the specs
you touched locally on chromium and paste the result in the PR's `Verify:` section, or add the `e2e`
label.

## Rules

- A framework change and the playground change it forces land in the same commit.
- A fix comes with the test that fails without it.
- No retries in the Playwright configs; a re-run is a human decision, never a config change.
  `update.spec.ts` on chromium used to fail about 1 run in 3–8 in the `sw` cells. The cause was the
  launch-apply posting `SKIP_WAITING` while the page was still loading (`docs/design/rendering.md`
  §3.4). If it fails again, treat it as a regression of that path, not as a flake.
- `exports` and `files` point at `dist/`. The playground and the website run the built framework
  (`scripts/ensure-dist.mjs` rebuilds it when `src/` changed), and their typechecks read
  `dist/*.d.mts`, so run `pnpm build` first. In a checkout the CLI still loads `src/`.
- Never `wrangler deploy` the playground: it is a dev app, not a deploy unit. The only deploy is the
  website, through `website.yml`.

## Commits and PRs

Conventional Commits, scope required, subject says the behaviour that now happens, all lowercase, no
final period: `fix(drawer): a drag begun mid-slide follows the finger`. One logical change per
commit. PR body: what was wrong and what changes, `Reproduce:`, `Verify:` with the commands you ran,
`Tested on:` / `Not tested:`. PRs target `main` and merge as squash. The full rules live in
[`CONTRIBUTING.md`](CONTRIBUTING.md); if the two disagree, `CONTRIBUTING.md` wins.

## Running e2e on the shared host

Several suites share one machine, so run e2e only through the `test:e2e*` scripts of `playground/` and `website/` (`scripts/e2e-lock.sh`), never `playwright test` directly.
- Layout: unit tests sit next to the code in `src/` and `bin/` (vitest, `pnpm test`); browser specs in `playground/e2e` (main, `plain`, `stress` configs), `playground/e2e-sw` (worker configs) and `website/e2e`. One spec: `pnpm --dir playground test:e2e e2e/smoke.spec.ts --project chromium` (the filter is a regex: `smoke.spec.ts` also matches `capabilities-smoke.spec.ts`).
- Known flakes: none open. `wheel-column.spec.ts` timed out on a loaded host; its settle wait now allows 10 s.
- The lock gives each suite one of `e2e_max` slots (read from the company `capacity.json`, 1 when it is missing) and waits up to `E2E_LOCK_WAIT` seconds (900), then exits 75.
- Outside CI it also exports a distinct free port for every unset port variable and prints them with the slot. Ports in this repo: E2E_APP_PORT, used by every playground config unless its own variable (E2E_PORT, E2E_SW_PORT, ...) is set; defaults 41730-41780. A port you set yourself is kept; CI sets its own (317xx, below the runner's ephemeral range).
- A suite always boots its own servers. A server already on a port is reused only with `E2E_REUSE=1`.
- `bash scripts/test/e2e-lock.test.sh` tests the lock.
