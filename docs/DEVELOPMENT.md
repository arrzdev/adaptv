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
pnpm playground:setup       # install (runs itself on first use)
```

Explicit on purpose — there is no bare `pnpm dev`. The target is the most important word in the
command, and a default target is how you end up running the web loop for ten minutes wondering why
the simulator never changed.

## Verifying autonomously — the simulators are right here

Everything needed to verify a change on real targets is in this repo. There is **no external
harness**, and no "native can't be tested here": the iOS Simulator and the Android emulator on this
machine are driven by the commands above.

- `pnpm dev:web` — the PWA path in a browser: real `visualViewport`, the predictive keyboard-height
  cache, the web inset fallbacks.
- `pnpm dev:ios` / `pnpm dev:android` — the app on the local simulator / emulator: the real OS
  keyboard, the native inset/height path, splash, edge-to-edge.

Reach for these to verify anything native, keyboard, inset, or splash — not only unit tests. A
`/lab/*` page self-reports a verdict you can screenshot, so one run is the whole report
(`AUTONOMOUS-UI-TESTING.md`). Two caveats worth internalising: `dev`/`preview` are turbo
**interactive** tasks and refuse a non-TTY shell (run them in a real terminal), and after a
framework-only edit pass `--force` or the fingerprint installs the previous bundle (see
`## Things worth knowing`). When something genuinely needs a physical device (a hardware-keyboard
quirk, a specific OEM), say *that* — not that it can't be run at all.

## What the playground is

`playground/` is a **frontend-only app** — seeded from chopchop's `adaptv-testing` branch — vendored
into this repo, tracked in this repo's history, with its own git origin removed. It is a turbo
monorepo, but every part of it runs in the browser: a React app, a local-first data layer over
IndexedDB, and a `/lab/*` page per component, capability and framework behaviour.

It has no backend, no database and no accounts. It used to carry a Cloudflare Workers API, D1, auth
and sync; none of it was exercising adaptv, and all of it had to be up before anything could be
tested. Sign-in survives only as a UI facade that always fails — the fields, the drawer and the
autofocus are what the keyboard, inset and drawer behaviour are tested against, and the auth was
never the point.

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
| `dev:web` | `turbo run dev:web` | `adaptv dev web` |
| `dev:ios` `dev:android` `dev:all` | `turbo run dev:<t>` | `adaptv dev <t> --latest` |
| `preview:*` | `turbo run preview:<t>` | `adaptv preview <t>` |
| `build:ios` `build:android` `build:all` | `pnpm --filter @repo/frontend run build:<t>` | `adaptv build <t>` |
| `adaptv <args>` | `pnpm run adaptv <args>` | the CLI, in the app |

`build:*` is the one that skips turbo: running it directly gives the CLI a real TTY for its
progress lanes.

`dev` and `preview` panes are turbo `interactive` tasks — select the pane and press `i` to reach
adaptv's own keys (`r` reload, `b` rebuild, `Ctrl-C` stop), `Ctrl-Z` to leave. This needs a real
terminal; turbo refuses an interactive task with no TTY, so none of these run in a non-TTY shell.

**Ports are the playground's job.** Its `runDev` frees every port it owns before starting, which is
what makes hopping worktrees free. The CLI must never do this: `adaptv dev`
passes `--strictPort` and fails loudly on a busy port on purpose
([bin/lib/dev-server.mjs](../bin/lib/dev-server.mjs)). A framework dev hopping worktrees wants the
old server gone; a real user wants to be told. Both are right, only one is the product.

The playground runs on **its own port block** — app `41730`, inspector `41740` — so it never fights
a real chopchop dev server on `417x0`. Its `appId` is
`dev.arrz.projectzero`, so native installs don't collide either. Both can run at once.

## A fresh worktree

```bash
git worktree add .claude/worktrees/my-thing -b worktree/my-thing
cd .claude/worktrees/my-thing
pnpm dev:ios
```

The first `pnpm dev:*` sees no `playground/node_modules` and runs `playground:setup` itself. It has
one step — **install**: framework deps if missing, then the playground's own.

That is the whole of it because the app reads no environment. There is no `env/.env` to copy from
the main checkout and no local database to migrate, so the two failure modes that used to live here
— a dev URL whose port or LAN IP had gone stale, silently pointing every request at something that
wasn't listening — cannot happen. Both used to need a guard (an env-schema port assertion and a LAN
re-stamp on every setup); neither guard exists now, because neither problem does.

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
  - `node_modules/@arrzdev/adaptv/src/**/virtual-adaptv-*.d.ts` in that tsconfig's `include` — the
    declarations for the modules adaptv's Vite plugin serves at build time. The package ships them;
    the app just has to look.

  All three go away when the package is consumed as built `.d.ts` (the deferred dist cutover).
- **Adding a command** means adding it in `playground/package.json` (plus a `turbo.json` task if it
  needs the API), then mirroring the one-line passthrough in this repo's `package.json`. The
  wrapper refuses a name the playground doesn't have, rather than failing three layers down.
