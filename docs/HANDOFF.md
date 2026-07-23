# Handoff — nativ native dev-loop work

You are picking up a multi-session effort on **nativ**, a framework that wraps
Capacitor + Vite + TanStack Start/Router so a consumer app runs natively on iOS and
Android with hot reload, without ever touching Capacitor by hand. Package name:
`@arrzdev/nativ`.

Read this whole file first, then `docs/DEV-LOOP-REVIEW.md` (same dir) — that review
is your actual work queue. This file is the operating manual around it.

---

## 1. Where things stand

Five PRs (#3–#7) are **merged into `main`** (`origin/main` @ `ae33fc9`). Together they
built the native live-reload dev loop:

- **#3** live-reload: one Vite dev server, iOS + Android WebViews attached to it,
  hot-reloading. Includes the HMR reconnect watchdog and the `fs.allow` fix.
- **#4** branded "dev server offline" screen + mid-session reconnect.
- **#5** `capacitor.config.json` treated as a git-ignored build artifact; iOS ATS
  leftover healing.
- **#6** run cache — skip rebuild/reinstall when nothing native changed (~12s → ~1s).
- **#7** `r` to rebuild on demand, native-change detection, quieter output,
  in-place line redraw, and "don't relaunch an app that's already running".

The merged state is verified: 514 tests, biome clean, typecheck clean, and a real
`run all` on both platforms (cached launch ~960ms, config reverts on teardown).

**The next phase is NOT new features — it's paying down debt** now that the failure
modes are finally understood. Several mechanisms were built mid-discovery and solve a
symptom rather than a cause. `docs/DEV-LOOP-REVIEW.md` enumerates them with priority.

---

## 2. ⚠️ Local `main` has uncommitted user WIP — do not touch it

The user's checkout at `/Users/arrz/Documents/Github/nativ` (branch `main`) has ~14
modified + 3 new files (status-bar, drawer, scroll-view, safe-area, etc.) that are
NOT part of this work. **Three of them collide** with what was merged:
`biome.json`, `src/vite/capacitor-config.ts`, `src/vite/capacitor-config.test.ts`.

So `git pull` on their local main will conflict — that's the user's call to
reconcile, not yours. **Always branch your worktree from `origin/main`, never from
the local `main` working tree.** Never run git commands that mutate the root
checkout.

---

## 3. Getting a clean working setup

```bash
# from the repo root
git fetch origin
git worktree add -b worktree/<your-feature> .claude/worktrees/<your-feature> origin/main
cd .claude/worktrees/<your-feature>
pnpm install                     # required — worktrees don't share node_modules

# point the disposable playground app at YOUR worktree so edits are testable:
ln -sfn "$PWD" /Users/arrz/Documents/Github/nativ/.project-zero/chopchop/apps/frontend/node_modules/@arrzdev/nativ
```

The **playground** is `/Users/arrz/Documents/Github/nativ/.project-zero/chopchop/apps/frontend`
— a disposable copy of a real app, symlinked to whichever nativ worktree you're
testing. Edit its files freely to exercise HMR, but **revert any edits when done**
(it's git-tracked under the chopchop repo). Its `nativ.config.ts` appId is
`dev.arrz.chopchop`.

Gates (run all three before committing):
```bash
pnpm biome:check      # 1 pre-existing noUnusedVariables warning is expected, ignore it
pnpm typecheck
pnpm test             # expect 514 passing
```

There are several stale merged-branch worktrees (native-live-reload,
native-dev-offline, native-config-artifact, native-run-cache, native-rebuild-key,
native-dx-review). All merged; safe to `git worktree remove` if they clutter, but
ask the user first.

---

## 4. Environment (this machine, right now)

- **iOS Simulator**: iPhone 16 Pro, udid `27DF56D5-CE71-4E64-BF48-24A586C9A64C`,
  booted. Shares the host loopback, so `localhost:7171` just works.
- **Android**: TWO emulators — `emulator-5554` (AVD `Pixel_10`, has the app) and
  `emulator-5556` (AVD `Pixel_7`, idle). The two-emulator setup matters: it caught
  real bugs (bare `adb` is ambiguous with >1 device; `--target` is an AVD *name*,
  not a serial). Android reaches the host via `adb reverse tcp:7171`, NOT the LAN IP.
- **adb**: `~/Library/Android/sdk/platform-tools/adb` — `export PATH="$HOME/Library/Android/sdk/platform-tools:$PATH"` at the top of shell commands.
- **Ports**: Vite `7171`, cloudflare/workerd inspector `9220`. Only ONE `nativ run`
  at a time (the cloudflare vite plugin pins 9220).
- **Run the CLI directly** (there's no global bin): 
  `cd <playground> && node <your-worktree>/bin/nativ.mjs run all --latest`
  (`--latest` reuses cached device picks, so no interactive prompt).

The iOS Simulator + Android tools are available to you. Screenshot to verify:
`xcrun simctl io <udid> screenshot out.png` and `adb -s emulator-5554 exec-out
screencap -p > out.png`, then Read the PNG. **Verify visually — don't trust log
lines alone for "it rendered".**

---

## 5. The testing discipline (non-negotiable — the user is emphatic about this)

These are dev-loop mechanics; a regression is invisible until it wastes an afternoon.
**Nothing lands without the full matrix, on BOTH platforms:**

1. fresh `run all` → both render (screenshot, not just logs)
2. edit a visible string → both hot-reload (screenshot shows the change)
3. hot reload still works after the app is relaunched
4. kill the dev server mid-session, then navigate in-app → offline screen appears
   (Android especially — it used to show Chrome's `ERR_CONNECTION_REFUSED`)
5. server comes back → app reconnects itself (offline → live)
6. run cache: second run is `· cached` and fast; `--force`, a `--port` change, a
   native change, and app-deleted-from-device each force a real rebuild
7. teardown (SIGTERM/Ctrl-C) reverts `capacitor.config.json` to `server: NONE`
8. no false native-change notices during normal HMR

**Objective checks beat eyeballing.** Examples that caught real bugs:
- offline vs live by screenshot BYTE SIZE (~56KB offline, ~170KB/377KB live, ~20KB = black)
- "did the app restart?" by **PID** (`adb shell pidof <appId>` / `simctl spawn <udid>
  launchctl list | grep <appId>`) — unchanged PID = no restart
- "did the cache hit?" by the `· cached` tag + sub-second timing
- config reverted: `python3 -c "import json;print(json.load(open('capacitor.config.json')).get('server'))"`

Always leave the tree clean: kill the run, revert playground edits, confirm config
reverted.

---

## 6. Hard-won facts (don't re-derive these — they cost days)

**iOS / WKWebView**
- WKWebView can't hydrate TanStack Start SSR → native dev must be SPA. The framework
  forces `render:spa` via `NATIV_DEV_NATIVE=1` (nativ-plugin.ts).
- WKWebView closes the HMR socket *cleanly* on idle/suspend; Vite's client does
  `if (wasClean) return` and never reconnects. This is the entire reason the
  hand-rolled watchdog exists (`src/shell/native-live-reload-client.ts`).
- If the WebView attaches DURING Vite's dep re-optimize (its `full-reload`), WKWebView
  drops the socket for good. `warmDevServer` waits for the server to go quiet BEFORE
  launching, to avoid that window. This is why "build before starting the server" is a
  BAD idea — see the review doc §A and the git history of #7's seamless-launch commit.

**Android / Capacitor**
- Capacitor does NOT inject `window.Capacitor` into an errorPath page on Android
  (`Bridge.loadWebView` scopes `addDocumentStartJavaScript` to the appUrl origin and
  nulls the local-server injector). So the offline page can't use `CapacitorHttp` or
  hide the splash there. Worked around by: CLI forces `SplashScreen.launchAutoHide`
  (so the OS clears the splash) and `server.androidScheme:"http"` (so the offline
  page's origin is cleartext and a plain `fetch` probe works).
- `adb reverse` is GLOBAL to the adb server — any other run's teardown wipes it. Hence
  the 4s re-assert keeper (which the review wants to replace with an instance lock).
- `cap run` resets `adb reverse` during install, so the reverse is (re)asserted AFTER
  cap run, then the app relaunched.
- `--target` is an AVD name (`Pixel_10`), not a serial (`emulator-5554`) —
  `androidSerialForTarget` translates. Two emulators makes forgetting this a bug.

**Capacitor errorPath**
- `server.errorPath` only fires on MAIN-FRAME load failures (`isForMainFrame()`), and
  in practice not even reliably mid-session. So the offline screen at COLD START is
  errorPath; the MID-SESSION case (server dies, you navigate, a lazy chunk fails) is
  handled by the client watchdog navigating to the offline page itself. The watchdog
  must react FAST (~0.6s) — a 6s grace lost the race to the user's next tap and the
  browser error page committed, destroying the recovery JS.
- The earlier "errorPath renders black" dead end was actually the app's
  `launchAutoHide:false` splash sitting on top of a correctly-rendered page.

**Dev server / fs.allow**
- The cloudflare vite plugin runs the app's SSR in workerd and 500s on EVERY request
  if it can't read the app's generated `.nativ/routeTree.gen.ts`. That happens when
  nativ is linked from OUTSIDE the app workspace (a worktree). The `nativ:fs-allow`
  plugin must APPEND to `server.fs.allow` in `configResolved` (returning it from
  `config()` REPLACES Vite's default and re-breaks it). Symptom is a misleading "port
  in use" warm failure. Fixed, but know it.

`docs/capacitor-internals.md` and the memory files below have more.

---

## 7. Memory files (persist across sessions — read them)

At `/Users/arrz/.claude/projects/-Users-arrz-Documents-Github-nativ/memory/`:
- `MEMORY.md` — the index (loaded automatically each session)
- `ios-wkwebview-hmr-warm-server.md` — the WKWebView HMR saga + fixes
- `nativ-offline-dev-screen.md` — offline screen mechanism, Android bridge limitation,
  the fast-handoff timing lesson
- `nativ-fs-allow-append.md` — the fs.allow append-vs-replace bug
- `android-pwa-system-bars-os-locked.md` — unrelated PWA system-bar notes

Update these when you learn something non-obvious; don't record what the code/git
already says.

---

## 8. What to do next (from `docs/DEV-LOOP-REVIEW.md`)

The two items that change how much code exists, do these first:

- **C — single-instance lock** (`.nativ/` pidfile with port + dev URL). Removes a
  whole failure class: lets the 4s `adb reverse` keeper go, turns the port-9220
  collision into a clear error, and makes teardown only remove the mapping it owns.
  Highest value-per-line. Nothing built yet.
- **A — replace the hand-rolled HMR socket with Vite's `vite:ws:disconnect` event.**
  Vite 8 emits it and the close listener stays attached after open, so it *should*
  fire on the WKWebView clean-close path — but that's the exact path the proxy was
  built for, so PROVE it on device (reproduce the deaf state:
  `lsof -nP -iTCP:7171 | grep -c com.apple` = 0 while the server still serves) before
  deleting the ~227-line proxy + `wsToken` regex.

Then the smaller ones: **D** (`relaunchAndroidApp` still hits every emulator — apply
the serial fix), **F** (dedupe the `OFFLINE_PAGE` constant), **H** (offline page
reconnects on any HTTP answer incl. 500 — tighten to 2xx/3xx), **I** (`r` means
native-rebuild here but JS-reload in Expo — split into reload vs rebuild), **B**
(unify the two fingerprint hashing strategies — measure web-tree hash cost first).

Do ONE at a time, each as its own worktree/PR stacked or off main, each fully
stress-tested. Don't batch.

Pre-existing, separately: a React hydration mismatch fires on every boot (shell has
the splash div, client renders a Suspense fallback); `pipeline("run", …)` is dead
code that's most of a future `preview` command; the `dev`/`preview`/`build` command
split with `.dev` app identifiers is unbuilt (and interacts with the run cache key).

---

## 9. Working-style notes

- **Backgrounding a `nativ run`**: launch it with `run_in_background: true` on the Bash
  tool and poll a logfile. The CLI installs SIGINT/SIGTERM/SIGHUP handlers; `kill
  -TERM <pid>` tears down cleanly and reverts config. A broad `kill -9` once took out
  the adb daemon — be surgical.
- **Driving the CLI's interactive keys** (`r`, ctrl-c): needs a real pty. `expect`
  scripts using `sleep` silently fail to deliver keystrokes (they don't drain the pty);
  a Python `pty`-based harness is reliable — there's a working one at
  `scratchpad/pty_drive.py` from the last session if it survived, else write one that
  drains continuously and disables `OCRNL`/`ONLCR`. Verify key handling at the byte
  level (cursor sequences) rather than trusting a rendered capture.
- Android takes ~15–20s to actually paint with both emulators up (GPU tile-memory
  pressure) — looks black briefly on first launch; not a bug, wait.
- Clean up strays between runs: `lsof -tiTCP:7171,9220 | xargs kill; pkill -f
  "nativ.mjs run"; pkill -f "node_modules/.bin/vite"`. Orphaned cloudflare `workerd`
  processes from other projects may exist — only kill ones under `chopchop`.

Good luck. The review doc is the map; this file is the compass.
