# The Playwright estate

**Four configs, two spec directories, 41 specs. This page says which suite proves what, and the
handful of rules that keep the estate honest.**

Everything lives in `playground/` — its own pnpm project — and runs from the repo root:

```bash
pnpm --dir playground test:e2e            # the main suite: 35 specs, dev server
pnpm --dir playground test:e2e:sw:all     # all three worker suites, built output
```

---

## 1. The four suites

| Suite | Config | Specs | Serves | Port |
|---|---|---|---|---|
| **Main** | `playwright.config.ts` | `e2e/` — 35 | `vite` (dev) | `41730` (`E2E_PORT`) |
| **Worker, `ssr`** | `playwright.sw.config.ts` | `e2e-sw/`, minus `update-prompt` | **build → `vite preview`** | `41750` (`E2E_SW_PORT`) |
| **Worker, `spa`** | `playwright.sw-spa.config.ts` | same | **build → static host** (`e2e-sw/static-host.mjs`), `ADAPTV_RENDER=spa` | `41760` (`E2E_SW_SPA_PORT`) |
| **Worker, `prompt`** | `playwright.sw-prompt.config.ts` | `update-prompt.spec.ts` only | **build → preview**, `ADAPTV_SW_UPDATE=prompt` | `41770` (`E2E_SW_PROMPT_PORT`) |

Every suite runs two projects: **chromium** (Desktop Chrome) and **webkit** (`iPhone 13` device
descriptor). WebKit here is the desktop engine, **not a real device** — escalate device-only quirks
to the iOS Simulator rather than loosening a WebKit assertion.

## 2. Why the worker suites are separate builds, not extra projects

Three reasons, each of which was a bug first:

1. **The main suite cannot test the worker at all.** It drives `vite` in dev, where adaptv actively
   *destroys* any service worker ([`../design/rendering.md`](../design/rendering.md) §3.1). Everything
   the worker does therefore ships untested by it — which is exactly how the navigation denylist
   drifted from its own documentation, with nothing in CI able to tell them apart.
2. **`spa` is not optional coverage.** Under `ssr` a navigation reaches the network whatever the
   worker decides, so a worker that wrongly claims `/whitepaper.pdf` still returns a PDF and the suite
   stays green. Under `spa` the same worker answers it from the precache with the app shell's HTML,
   **online**. The bug that prompted the suite was only ever visible there.
3. **The update policy is compiled in.** `virtual:adaptv/pwa-register` bakes `auto` vs `prompt` to a
   constant, so a build is one or the other and no test can switch. `update.spec.ts` asserts a
   waiting worker *is* applied at launch; `update-prompt.spec.ts` asserts it is *not*. They are
   mutually exclusive by construction, which is why each config carries a `testIgnore`/`testMatch`.

The `spa` build is a separate **config**, not a second project, because the two modes are separate
builds of the same app directory — concurrent projects would clobber each other's generated output.

## 3. The rules

### 3.1 No retries. Anywhere.

`retries: 0` in all four configs, and this is load-bearing.

> CI used to get one retry, and every timing-sensitive `describe` carried `retries: 2` on top of it.
> That is how a **hydration race** which failed the first test of every cold run stayed filed as
> "load flake" for as long as it did. A retried test still reports green, so the signal was gone.

The worker suite has a **known intermittent** — `update.spec.ts` on Chromium, roughly **1 run in
3–5**, not root-caused, where the waiting worker never applies and a later reload hangs. A single CI
retry is precisely what would turn that into a green run and delete the only evidence it is still
there. → [`../roadmap/README.md`](../roadmap/README.md)

Paired with that: `trace: "retain-on-failure"`, **not** `"on-first-retry"` — with no retries there is
never a first retry to trace on, so every failure would land with no trace at all.

### 3.2 One port value, and never reuse a server you did not build

The port is written **once** and used for both the URL under test and the server the config boots. It
used to be written twice, and `reuseExistingServer` turns that into a silent **wrong-app run**: every
worktree defaults to `41730`, so if a sibling worktree has a dev server up, Playwright happily reuses
it and every assertion is measured against a different checkout. It presents as mass "element not
found" on routes that plainly exist — which reads as a broken app.

Running two worktrees at once? Move the port with the env vars in the table. Do not kill a
neighbour's session.

The worker configs set `reuseExistingServer: false` unconditionally: **a server already up is a
server built from unknown source**, and that suite exists to catch exactly that staleness. Their
`webServer.command` is `build && vite preview` for the same reason — `vite preview` serves whatever is
on disk, so without the build a green run can be measuring the previous commit's worker.

The `spa` suite serves its build with `e2e-sw/static-host.mjs` instead of `vite preview`, because the
preview renders every navigation on the server whatever `render` the build was: a first visit came
back as a server render carrying the `$_TSR` bootstrap, and a router redirect as a server `307`, so
the static shell's own boot never ran before a worker took over. The host answers a file that exists,
then the `_redirects` rule the build emits, then `404.html`, reading the disk on every request.

### 3.3 The main suite runs plain `vite`, not the CLI

`webServer.command` was once `pnpm --filter @repo/frontend dev` — **a script that does not exist**
(the frontend has `dev:web`/`dev:ios`/…, never a bare `dev`), so the harness could never boot its own
server and every run died with "Process from config.webServer exited early". It only worked when a dev
server happened to be up, which `reuseExistingServer` quietly papered over.

It now runs plain `vite`: `dev:web` is the adaptv CLI wrapper, which owns an interactive TUI, a
single-instance lock and native launchers — none of which a headless browser needs, and all of which
fight a process manager. `vite.config.ts` still supplies the adaptv plugin, so the app under test is
the real one.

### 3.4 The worker suites are serial

`fullyParallel: false`, `workers: 1`. Registrations are per-context so tests do not share worker
state — but they **do** share one preview server, and several of them take it offline.

> ⚠︎ **Do not `pkill` a running worker suite.** `deploy()` builds *inside* the test, so killing it
> mid-run leaves a build rewriting `.output` underneath the next run.

## 4. Writing a spec here

- **Touch is not mouse.** A gesture test drives CDP touch events; `mouse.wheel` measures a different
  code path and will not exercise the press/gesture engine.
- **`waitForFunction` does not await an async predicate.** An `async` callback returns a *Promise*,
  which is truthy, so the wait resolves immediately and the next read measures the **old** state.
  Keep the predicate synchronous.
- **Do not add a warm-up tap.** A setup that taps to warm up leaves Chromium unable to claim the next
  swipe as a scroll, and the test then blames the press engine.
- **A dead-looking component is usually CORS or touch emulation**, not the component.
- **WebKit starts CSS animations a frame early** — `currentTime` ≈ 17 ms on the first observable
  frame where Chromium reports 0.0. Scope the assertion to the engine; do not loosen it for both.
- **Assert on a quartile, not the worst frame.** A per-frame motion assertion is usually measuring a
  statistic the fix and the regression share. Print both distributions before choosing the threshold.

## 5. What this estate does not cover

**CI runs one of the four suites, on one engine**: the main config's **chromium** project, on every
PR and push to `main`, with the HTML report and traces uploaded when it fails. Its **webkit** project
and all three worker suites run only where someone runs them, which is why the Chromium worker wedge
in §3.1 is still caught only by hand. Why chromium alone is recorded as **O11a**, and whether the
native matrix can run in CI at all is still open as **O11b**
([`../roadmap/open-questions.md`](../roadmap/open-questions.md)).

Anything that needs a real device — motion feel, the OS keyboard, splash timing, edge-to-edge system
bars — is owed to a device ladder and tracked in
[`../roadmap/owed-device-verification.md`](../roadmap/owed-device-verification.md). A happy-dom test
must never stand in for one.

→ [`testing.md`](testing.md) for the six-target discipline these suites sit inside.
