# Development loop — the playground

**Framework-development only.** None of this ships: `playground/` and `scripts/` are not in
`package.json#files`, no source imports them, and a consumer of `@arrzdev/adaptv` never sees them.

## The commands

From the root of **any** checkout or worktree:

```bash
pnpm dev:web        pnpm preview:web        pnpm build:ios
pnpm dev:ios        pnpm preview:ios        pnpm build:android
pnpm dev:android    pnpm preview:android    pnpm build:all
pnpm dev:all        pnpm preview:all

pnpm adaptv doctor          # ad-hoc passthrough to the CLI inside the playground
pnpm playground:setup       # env + install + local D1 (runs itself on first use)
```

Explicit on purpose — there is no bare `pnpm dev`. The target is the most important word in the
command, and a default target is how you end up running the web loop for ten minutes wondering why
the simulator never changed.

## What the playground is

`playground/` is a **copy of a real app** — chopchop's `adaptv-testing` branch — vendored into this
repo, tracked in this repo's history, with its own git origin removed. It is a turbo monorepo: a
React app, a Cloudflare Workers backend, D1, auth, sync. Half of what's worth testing needs that
backend up, which is why the whole thing is here and not a hand-written demo.

Vendoring it is what makes worktrees work, and it removes every moving part the alternatives needed:

- **A worktree gets its own playground for free** — checked out with the branch, `node_modules` and
  `.adaptv/` state and all. Two worktrees migrating the same interface differently never meet.
- **The link needs no maintenance.** The app's committed `"@arrzdev/adaptv": "link:../../.."`
  resolves to the checkout it sits in, whichever worktree that is. Nothing repoints anything.
- **A framework change and the consumer change it forces land in one commit**, one diff, one review.
  Rename a prop and migrate the app in the same breath.

### It was seeded once. From here it's ours.

Seeded from chopchop `adaptv-testing`, rebased onto chopchop `main` (2026-07-26). That was a
one-time import, not a subscription: **there is no resync, and nothing here travels back.**

That matters because of what the playground is *for*. Build a new `View`, change what a primitive
accepts, split an export — the playground is where that gets used, and the app-side change is how
you find out whether the new API is any good. Those edits are the work, not scratch. Re-taking the
app from chopchop would delete exactly them, so the mechanism to do it doesn't exist.

Consequences, accepted deliberately:

- **It drifts from the real chopchop, permanently.** Fine — it's an example, kept only as honest as
  it needs to be to exercise the framework.
- **A fix that lands in the real app doesn't land here.** Copy it in if you need it.
- **The real migration happens once**, against real chopchop, when the framework is ready.

Every file under `playground/` is a normal file in this repo: edit it, commit it, review it in the
same diff as the `src/` change that made it necessary.

## How a command runs

Each `pnpm <target>` here is a one-line passthrough to the identically-named script in
`playground/`, which owns everything about starting itself:

| `pnpm …` here | → in the playground | what runs |
|---|---|---|
| `dev:web` | `turbo run dev:web` | wrangler API + `adaptv dev web` |
| `dev:ios` `dev:android` `dev:all` | `turbo run dev:<t>` | wrangler API + `adaptv dev <t> --latest` |
| `preview:*` | `turbo run preview:<t>` | wrangler API + `adaptv preview <t>` |
| `build:ios` `build:android` `build:all` | `pnpm --filter @repo/frontend run build:<t>` | env gate + `adaptv build <t>` |
| `adaptv <args>` | `pnpm run adaptv <args>` | the CLI, in the app |

`build:*` is the one that skips turbo: a native artifact needs no API, and running it directly gives
the CLI a real TTY for its progress lanes.

`dev` and `preview` panes are turbo `interactive` tasks — select the pane and press `i` to reach
adaptv's own keys (`r` reload, `b` rebuild, `Ctrl-C` stop), `Ctrl-Z` to leave. This needs a real
terminal; turbo refuses an interactive task with no TTY, so none of these run in a non-TTY shell.

**Ports are the playground's job.** Its `runDev` frees every port it owns (app *and* API) before
starting, which is what makes hopping worktrees free. The CLI must never do this: `adaptv dev`
passes `--strictPort` and fails loudly on a busy port on purpose
([bin/lib/dev-server.mjs](../bin/lib/dev-server.mjs)). A framework dev hopping worktrees wants the
old server gone; a real user wants to be told. Both are right, only one is the product.

The playground runs on **its own port block** — app `41730`, inspector `41740`, API `41830`/`41840`
— so it never fights a real chopchop dev server on `417x0`/`418x0`. Its `appId` is
`dev.arrz.projectzero`, so native installs don't collide either. Both can run at once.

## A fresh worktree

```bash
git worktree add .claude/worktrees/my-thing -b worktree/my-thing
cd .claude/worktrees/my-thing
pnpm dev:ios
```

The first `pnpm dev:*` sees no `playground/node_modules` and runs `playground:setup` itself:

1. **env** — `env/.env` files are git-ignored (secrets), so they're copied from the main checkout's
   playground, then re-stamped with this machine's current LAN IP. A machine that has never had
   them gets a clear `check:env` failure naming the key.
2. **install** — framework deps if missing, then the playground's own.
3. **migrate** — local D1 for the backend. A failure here warns rather than stops.

Both halves of the app's dev URL can go stale, and both fail the same silent way — every request
lands on something that isn't listening, which reads as "the backend is down" or, worse, as
offline-first working. So neither is left to memory: the **port** is asserted by the frontend's env
schema against `apps/backend/ports.ts` (`playground/apps/frontend/env/schema.ts`), and the **host** is
re-stamped on every `playground:setup`. This is not hypothetical — the env in the real repo had
been pointing at a port nothing bound since the block moved.

## Things worth knowing

- **`.adaptv/` is per-worktree** now, so the run cache and the remembered device are too. The first
  native run in a new worktree regenerates the native project and asks which device — that's one
  slow run, then it's cached like anywhere else.
- **Framework edits don't invalidate the app's build cache.** `fingerprint()` walks the app tree and
  skips `node_modules`; `nativeFingerprint()` hashes the capacitor config, declared deps and the
  generated native project. Neither includes framework source, so a `preview`/`build` right after a
  framework-only change can report `✓ web build · cached` and install the previous bundle. Use
  `--force` until that's fixed — it's a real bug, not just a dev-loop wrinkle.
- **The playground has its own gates** (`pnpm --dir playground typecheck` / `biome:check`). This
  repo's gates deliberately exclude it: `biome.json` ignores `**/playground`, `vitest.config.ts`
  excludes `playground/**`, and `tsconfig.json` only includes `src/`.
- **Three lines in the playground exist to survive `link:`, and removing them breaks `typecheck`.**
  Because the package exports point at `src/*.ts`, adaptv's *source* is compiled inside the app's
  program — so anything the framework resolves differently from the app becomes two types with one
  name, structurally identical and mutually unassignable:
  - `"vite": "link:../../../node_modules/vite"` in `apps/frontend/package.json` — one physical vite
    for both. `paths` can't fix this: third-party plugin `.d.ts` files resolve vite from their own
    location, which path mapping never reaches.
  - `react` / `react-dom` pinned in `apps/frontend/tsconfig.json` `paths` — same story, two
    `@types/react` copies of the same version.
  - `node_modules/@arrzdev/adaptv/src/virtual-adaptv-*.d.ts` in that tsconfig's `include` — the
    declarations for the modules adaptv's Vite plugin serves at build time. The package ships them;
    the app just has to look.

  All three go away when the package is consumed as built `.d.ts` (the deferred dist cutover).
- **Adding a command** means adding it in `playground/package.json` (plus a `turbo.json` task if it
  needs the API), then mirroring the one-line passthrough in this repo's `package.json`. The
  wrapper refuses a name the playground doesn't have, rather than failing three layers down.
