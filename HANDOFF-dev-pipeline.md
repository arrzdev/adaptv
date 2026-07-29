# Handoff — one end-to-end pipeline for `dev`, and a `dev` that notices its own staleness

A working note, committed only so a session starting in any worktree can find it. It describes
work that has NOT been done. **Delete this file in the PR that lands the work.**

## Start here

Repo: `adaptv`, a private cross-platform React framework (Capacitor underneath, which the
consumer must never learn — `DECISIONS.md` L20).

Worktree used for the previous work:
`/Users/arrz/Documents/Github/adaptv/.claude/worktrees/adaptv-icon-generation-15dda3`

Branch state right now:

- `main` has PR #21 merged (`ad30232`) — the whole icon feature.
- Branch **`fix/icons-config-key-drives-the-set`**, pushed, **no PR opened yet**, 2 commits:
  - `77dd4c0` — the `icons` config key drives the set; no silent `./public/favicons` fallback.
  - `c181e3b` — `b` re-reads the config and re-derives the native assets.

**This handoff's work is a NEW PR.** Decide with the owner whether it branches off
`fix/icons-config-key-drives-the-set` (it builds directly on `c181e3b`) or off `main` after
that one merges. Branching off the fix branch is the honest option — the work below rewrites
code `c181e3b` just touched.

Read before touching `bin/`: **`docs/CLI-UX.md`** (rules R1–R38) and the `cli-ux` skill. The
test suite cannot catch output regressions — you must run the commands and look.

---

## What the owner asked for

Verbatim intent, three parts:

> "da forma que eu penso nisso a nossa 'engine' devia ter um 'build' que corre sempre config
> check, manifest generation etc etc etc… launch, cap sync cap run etc… end-to-end"

> "se eu mudar a config e der rebuild e tiver errado apesar de a dev já estar a correr antes a
> cli devia dar exit (kill the process) e mostrar o erro que a config está incorreta"

> "a cli (dev) devia detetar quando a config ou algo nativo mudou e colocar um aviso na UI da
> cli que a pessoa tem de dar rebuild para ver as changes"

### 1. ONE pipeline, run end-to-end, every time

Today there are **two** implementations of "get this app onto a device", and they have already
drifted:

| | `dev` | `preview` / `build` |
|---|---|---|
| where | inline in `runDev`, `bin/adaptv.mjs` ≈619–1140 | `pipeline()`, `bin/adaptv.mjs` ≈1149 |
| config check | `preflight()` ≈619 | `preflight()` at the call site |
| capacitor env | `setCapacitorConfigEnv` ≈631 | ≈1113 |
| web bundle | `buildWeb` only if `_shell.html` is missing | always a vite build |
| scaffold | `prepareOne` ≈654 | `prepareOne` ≈1256 |
| **native identity** | **separate loop ≈858**, after the picker | **inside `prepareOne` ≈1265** |
| assets | `generateAssets` ≈662 | `generateAssets` ≈1271 |
| ATS heal | not done | done, iOS only ≈1273 |
| sync + run | `launchOne` ≈878 | inside `pipeline` |

That split is exactly the failure mode `docs/CLI-UX.md` keeps warning about — *"nearly every
rule in the doc exists because one idea had two implementations and they drifted"*.

**Why this is worth attacking now, rather than filed as tidying.** The owner proposed it from
first principles ("a nossa engine devia ter um build que corre sempre… end-to-end"), and the
history backs it: the split has already shipped a bug, and the shape of that bug is the one this
refactor makes impossible.

`b` did not re-run `generateAssets` — so a rebuild produced an app with the launcher icons of
the run it started in. Not because anyone decided a rebuild should skip the icons, but because
`generateAssets` lives in `prepareOne`, which is in the OTHER half of `dev`'s own flow from
`launchOne`, which is what `b` calls. Nobody wrote that rule; the seam did. The fix in `c181e3b`
patched the symptom — it added `generateAssets` back into `launchOne` — and left the seam, so
the next thing that gets added to one half and not the other fails the same silent way.

Be accurate about scope when arguing this: the OTHER recent bug, the `icons` config key having
no effect, was **not** caused by the split. That one was a single line
(`config.icons ?? "./public/favicons"`) in `resolveIconSet`, fixed in `77dd4c0`. One bug from
the seam, not two. The case rests on the table above, not on a body count.

There is a second, quieter instance of the same shape already in the tree, and it is worth
reading as confirmation rather than as a separate task. `healDevAtsLeftover` runs in
`pipeline`'s `prepareOne` and in nothing `dev` does. `dev` is the command that CREATES the
leftover — it patches an `NSAllowsArbitraryLoads` exception into `Info.plist` and reverts it on
teardown, so a SIGKILLed run strands it. And a subsequent `dev` will not clean it up, because
`patchIosAts` (`bin/lib/live-reload.mjs` ≈94) opens with:

```js
if (original.includes("NSAppTransportSecurity")) return null
```

It sees the leftover, treats it as the app's own, patches nothing and registers no revert. The
session still works — the stale exception happens to be exactly what live-reload needed — so
nothing looks wrong, and the plist stays dirty until someone happens to run `preview` or
`build`. Shipping `NSAllowsArbitraryLoads` is a real hole and something App Review asks about.
Same shape as the `b` bug: a step that exists in one half of a duplicated flow and not the
other, failing silently. Verify this before acting on it — it is read from the source, not
reproduced.

The forward-looking half of the argument is the strongest. None of the drift in the table is
*decided*: `patchNativeIdentity` runs before the picker in `dev` and inside `prepareOne` in
`pipeline` for no stated reason. Every future change to the launch sequence has to be made
twice, correctly, by someone who knows there are two places to make it. That is a tax on every
subsequent PR, and it is paid in bugs that appear in only one command — which is the hardest
kind to notice, because the other command still works.

**The target:** one function that runs the whole sequence — config check → capacitor env →
manifest/assets → native identity → sync → build → install → launch — with the differences
between `dev`, `preview`, `build` and a `b` rebuild expressed as *parameters*, not as separate
code. `dev` startup and `b` must call the same thing, so a rebuild cannot be a subset of a
fresh run ever again.

Watch out for the parts that are genuinely different and must stay so:

- `dev` serves from vite and only needs a placeholder bundle in `CAP_WEB_DIR`; `preview`/`build`
  need a real one. This is a parameter, not a reason for a second pipeline.
- `dev` patches an ATS exception into `Info.plist` and reverts it on teardown;
  `preview`/`build` *heal* a leftover one (`healDevAtsLeftover`). The patch/revert asymmetry is
  real and must stay. `dev` never HEALING is not — see the ATS note above.
- `dev` and `preview` share the `.dev` install identity; `build` uses the release id.
- The live-reload launch cache (`runCache.run[key]`, `launchOne` ≈889) is `dev`-only.

### 2. A config that cannot be used KILLS the run — even mid-session

This **reverses a decision made in `c181e3b`**, deliberately, at the owner's instruction. Do not
re-litigate it; implement it.

`c181e3b` added `reloadConfig` (`bin/adaptv.mjs` ≈236), the non-exiting sibling of `preflight`:
on a bad config it keeps the last good one, refuses the rebuild, and shows
`! not rebuilt · <problem>` on the watch row. The reasoning was that killing a live session with
a dev server and attached devices over a half-typed file is expensive.

The owner wants the opposite, and it is the more consistent rule: **`dev` should treat config
validity exactly the way startup does — print the errors and exit.** A running session whose
config no longer parses is serving something that does not match the file on disk, and that is a
worse state than being dropped back to the shell. It also means there is one answer to "is this
config usable", not two.

So:

- `reloadConfig`'s non-exiting branch goes away, or `preflight` itself becomes reusable mid-run.
- On exit, run the normal teardown (`teardown()`, the SIGINT handlers, the ATS revert) — a hard
  exit that strands the dev ATS exception in `Info.plist` is the bug `cli-ux` warns about.
- Errors print through `log.error` + `spacer()` like `preflight` does, all of them at once
  (R33), and the process exits non-zero.
- Decide and document what `r` (reload) does in the same situation — `r` does not rebuild, so
  arguably it is untouched. Say which, in the commit.

### 3. `dev` tells you when it has gone stale

There is already half of this: a 3s poll (`bin/adaptv.mjs` ≈1103) diffs `snapshotNativeFp` and
calls `watcher.notice("native change · ios, android")`, which the live row renders as

```
  ! native change · ios  · press b to rebuild
```

(the `· press b to rebuild` suffix is baked into `liveWatcher` in `bin/lib/render.mjs` ≈370.)

Missing: **`adaptv.config.ts` itself is not watched.** `nativeFingerprint` folds in
`ADAPTV_CAPACITOR_CONFIG`, but that env var is only re-stamped when something re-runs
`setCapacitorConfigEnv` — so editing the config file changes nothing the poll can see. That is
why commenting `icons` out produced no notice at all.

What to add:

- Watch `adaptv.config.ts` (and whatever it imports, if that is cheap — otherwise just the file)
  and raise the same kind of notice: `config change · press b to rebuild`.
- Consider whether an icon-directory change deserves one too. The art is read at
  `generateAssets` time, so editing a PNG in `icons` is invisible until a rebuild — the same
  class of staleness.
- Keep the existing rule that adaptv **never rebuilds behind the dev's back** (a reinstall costs
  ~15s and drops app state). The notice is the whole feature; the rebuild stays manual.
- One notice slot exists today (`notice` is a single string in `liveWatcher`). If config and
  native change at once, decide whether they merge into one line or the newer wins. One row,
  one line, clipped to terminal width (R31, and the "cascade" comment in `render.mjs`).

---

## Constraints you cannot skip

- **`bin/lib/render.mjs` owns every byte printed.** `bin/lib/engine.test.mjs` fails the build on
  a direct stdout write or a second glyph set. Need a new kind of line? Add a primitive.
- **Glyphs are `✓ ✖ !` only.** Not `✔ ✗ ⚠`. A `⚠︎` in a JSDoc comment has tripped this before.
- **R33** — everything adaptv can know from the dev's own files is said BEFORE the run, and
  stops it if it must.
- **R5** — every notice carries `!`. There is no glyphless second severity.
- **Live phases** come from a closed vocabulary (R24) and never name a target, task or pod.
- Messages stay on one row, app-root-relative paths only, never absolute.
- **When the owner reports an output problem, add the rule to `docs/CLI-UX.md` in the same
  commit, quoting the offending output.** The last rule added was R38.

Gate before shipping: `pnpm typecheck && pnpm biome:check && pnpm test` (1053 tests green as of
`c181e3b`).

---

## Verifying this — read carefully, there are traps

The playground app is `playground/apps/frontend`. Its `node_modules/@arrzdev/adaptv` is a
**symlink to the worktree root**, so a `dev` session runs your edited code — **but only from the
moment it starts**. A session already running has the old `adaptv.mjs` in memory; it must be
restarted to pick up a change. This wasted a verification round last session.

Traps hit last session, all real:

1. **The owner runs their own `dev all --latest` session in this playground.** It holds
   `playground/apps/frontend/.adaptv/dev.lock`, so a second `dev` in the same app refuses with
   `✖ another dev server is already running (pid N)`. **Check `pgrep -fl "adaptv.mjs dev"`
   before doing anything.**
2. **Never `pkill -f "adaptv.mjs dev"`.** That pattern matches the owner's session and killed it
   once. Kill only PIDs you started, by exact pid.
3. **A live run in one worktree breaks every other worktree's CLI** (ports). Same check applies.
4. `playground/apps/frontend/public/favicons` is **committed art**. `gen icons` overwrites it.
   Restore with `git checkout -- playground/apps/frontend/public/favicons && git clean -fdq`.
5. The owner edits `playground/apps/frontend/adaptv.config.ts` by hand to test (commenting
   `icons` in and out). **Leave their working-tree state alone**, or say plainly that you changed
   it.
6. `src/vite/route-tree-opacity.test.ts` flakes on a 5s watcher timeout right after
   `biome:fix`. Always passes on re-run. Not your bug.

Capture live-line rendering through a pty, or you are not seeing what the dev sees:

```bash
script -q /tmp/out.txt env TERM=xterm-256color pnpm exec adaptv dev ios --latest
```

Stop `dev` with **SIGINT**, never SIGKILL — SIGKILL skips teardown and strands the dev ATS
exception in `Info.plist`.

**Driving the `b` key** needs a pty; a plain pipe will not do, `onKeys` uses raw mode. A working
python driver (`pty.openpty()` + `os.write(master, b"b")`) was written last session and left at
the scratchpad path below; rewrite it if it is gone. The `b` keypress path was **never verified
live** for `c181e3b` — the owner's session held the lock and the simulator. **Verifying it is
part of this work.** A booted `iPhone 16 Pro` simulator and a `Pixel_10` emulator are the
remembered devices in `.adaptv/state.json`.

What to prove, end to end:
- edit `adaptv.config.ts` mid-`dev` → the CLI raises `! config change · press b to rebuild`
- press `b` → the app is rebuilt from the CURRENT config, icons included
- make the config invalid, press `b` → the errors print and the process exits non-zero, with
  teardown having run (check `Info.plist` has no leftover `NSAppTransportSecurity`)

---

## Suggested order

1. **Extract the pipeline first, change no behaviour.** Get `dev` startup, `preview` and `build`
   onto one function with the differences as parameters, keeping output byte-identical. Verify
   by capturing `dev ios`, `preview ios`, `build all` before and after and diffing.
2. **Point `b` at it.** The `b` rebuild becomes "run the pipeline again", which deletes the class
   of bug where a rebuild is a subset of a fresh run.
3. **Make a bad config exit**, with teardown. Delete the `reloadConfig` non-exiting branch.
4. **Watch the config file** and raise the notice.
5. **Update `docs/CLI-UX.md`** with whatever rules fall out — at minimum the one behind #3
   (a session whose config no longer parses does not keep running).

Steps 1–2 are the substance; 3–4 are small once the pipeline is one thing.

---

## Files you will spend your time in

- `bin/adaptv.mjs` — `preflight` ≈195, `reloadConfig` ≈236, `runDev` ≈619+, `launchOne` ≈878,
  `launchAll` ≈962, `rebuild` ≈1010, `reload` ≈1064, the key handler ≈1093, the native-change
  poll ≈1103, `pipeline` ≈1149.
- `bin/lib/native.mjs` — `generateAssets` ≈504, `nativeDir` ≈44, `capSync`, `capRun`,
  `patchNativeIdentity`, `healDevAtsLeftover`.
- `bin/lib/fingerprint.mjs` — `fingerprint` (web, mtime-based) and `nativeFingerprint`
  (content-based); read the comments, the difference is load-bearing.
- `bin/lib/render.mjs` — `liveWatcher` ≈345 (the `notice` slot), `onKeys`, `flushNotices` ≈152.
- `bin/lib/preflight.mjs` — `configErrors`, `iconWarnings`, `inspect`.
- `docs/CLI-UX.md` — the contract. R38 is the newest rule.

Scratchpad from the previous session (may be cleaned up):
`/private/tmp/claude-501/-Users-arrz-Documents-Github-adaptv--claude-worktrees-adaptv-icon-generation-15dda3/18d304f9-6323-4e0c-9788-bc43b22635c9/scratchpad`

---

## One open thread, unrelated to the above

`assets/adaptv-mark.svg` is still a **placeholder** — the right shape and the right pipeline, not
the brand. The owner said they would supply the real art. Swapping it means replacing that file
and regenerating `assets/default-icons/`; the recipe is in `assets/default-icons/README.md`.
