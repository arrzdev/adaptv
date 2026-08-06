---
name: cli-ux
description: The adaptv CLI's output contract — read BEFORE editing anything under `bin/` (bin/adaptv.mjs, bin/lib/*.mjs) or changing what the CLI prints. Use when touching CLI output, steps/lanes/spinners, warnings, progress reporting, error messages, device pickers, or tool-log rendering; and when the owner reports the CLI output being noisy, wide, duplicated, interleaved, or "spaghetti". Also use before shipping any CLI change, for the manual verification checklist.
---

# adaptv CLI output contract

**Canonical source: [`docs/CLI-UX.md`](../../../docs/CLI-UX.md). Read it before editing `bin/`.**
Every rule there was written because the output broke it once and the owner had to report it. The
test suite cannot catch any of it — **you must run the command and look at the output.**

## The one idea

The CLI narrates the **developer's intent**, not adaptv's implementation. A dev runs
`adaptv dev ios` to get their app on a simulator. Print only what tells them how that's going, or
asks them something only they can decide. The consumer doesn't know adaptv runs on Capacitor and
TanStack (`DECISIONS.md` L20) — the output must never teach them otherwise.

**The default is SMALL.** Short, direct, few steps, from a CLOSED vocabulary of lowercase
phrases. The default is not "everything, tidied" — it is the handful of things a dev acts on.
Detail belongs in `--verbose` and nowhere else. Every rule below exists because something true
got printed *because it was true*, without asking whether the dev needed it.

## The rules, compressed

Full text + the violating output that produced each rule: `docs/CLI-UX.md`.

**Structure** — one settled line per platform covering its whole story (sub-actions render live on
that line, then vanish); one glyph per outcome (never `✖ ios` *and* `✖ ios failed — …`); never
interleave platforms in an `all` run; a step that did nothing prints nothing.

**Order** (R33) — everything adaptv can know from the dev's own files is said BEFORE the run and
stops it if it must: banner, blank line, what adaptv knew (`!` notices), blank line, the steps.
Config values it cannot use are `✖`s that exit before anything is built or served — all of them
at once. That check lives in `bin/lib/preflight.mjs`; the step that later uses the same fact
stays silent. Anything only doing the work can reveal still belongs to the step that finds it.

**Severity** — `!` means the dev may need to act; if adaptv already handled it, it's a dim note
with no glyph. Don't announce what the next thing already says (no preamble before a picker).
Errors are terse and name the fix (`missing 'appId' in adaptv.config.ts` — keys, flags and
commands are quoted with `'`, never a backtick, R43), not wrapped in
step-failure scaffolding.

**The engine** — `bin/lib/render.mjs` owns EVERY byte the CLI prints. Commands state intent
(`header`, `runLine`/`runLanes`, `addresses`, `flushNotices`, `liveWatcher`, `section`,
`check`, `spacer`, `detail`) and the engine decides how it looks; `rawOut()` is the only
exception, for `--verbose`. Need a new kind of line? **Add a primitive** — never draw it in
the command. `bin/lib/engine.test.mjs` fails the build on a direct stdout write or a second
glyph set (`✔ ✗ ⚠`). Nearly every rule in the doc exists because one idea had two
implementations and they drifted.

**Live phases** — a phase says WHAT IS HAPPENING, never WHAT IT IS HAPPENING TO: `compiling`,
never `compiling · CapacitorSplashScreen` or `gradle · parseDebugLocalResources`. No target,
task, or pod names; no camelCase identifiers. The vocabulary is CLOSED (`preparing build`,
`compiling`, `linking`, `processing resources`, `packaging`, … — full list in `docs/CLI-UX.md`
R24); map a new tool verb into it rather than inventing a phrase or passing one through. A tool
that CRASHES says nothing at all — a dump's stack and version footer are not phases (R33). The row
also SAMPLES the stream instead of following it (`nextPhase()`), so a phase holds for a beat
before another replaces it — subjects plus unthrottled updates once made one 13s build rewrite
its row 140 times. `·` separates a thing from its metadata (`adaptv · build ios`, `… · 5.0s`),
never an identifier from a phase.

**Noise** — never print adaptv's own plumbing (its base Capacitor plugins, cap internals); name
only what the dev caused. Never print absolute paths — app-root-relative only. Never exceed the
terminal width or wrap (use the ANSI-preserving `truncate` in `bin/lib/render.mjs`). Parse
xcodebuild/gradle/CocoaPods output into calm phases rather than echoing it. `--verbose` is the raw
escape hatch and must stay raw. Never take the dev's SCREEN either (R55): the app is fronted inside
the device, never by raising the simulator's desktop window — `open` gets `-g`, including the one
`native-run` makes from inside `cap run ios` (`withBackgroundSimulator` shims it onto PATH).

**Failure detail** — the reason goes inline on the failing platform's line, and it must be the most
meaningful line available (`The sandbox is not in sync with the Podfile.lock`, not `exited with code
1`). Detail appears once, dim, grouped under that platform, or only under `--verbose`. Never
truncate an error whose remaining lines carry the instructions.

## Before shipping

Run these and READ the output — `dev ios` (first run *and* warm), `preview ios`, `build all`
including a forced failure, an `all` run (interleaving), the device picker
(`rm -f .adaptv/state.json`, no `--target`), `--verbose`, and a deliberately broken
`adaptv.config.ts` (a colour that isn't hex — it must refuse before building anything).
**Watch a native build for 10s**:
if the phase text moves more than ~once a second, or you can read an identifier in it, the live
line is wrong. Then `pnpm typecheck && pnpm biome:check && pnpm test`.

Capture through a pty so live-line rendering is real:
`script -q /tmp/out.txt env TERM=xterm-256color pnpm exec adaptv <cmd>`

Stop `dev` with **SIGINT** (`pkill -INT -f "adaptv.mjs dev"`) — never SIGKILL, which skips teardown
and strands the dev ATS exception in `Info.plist`.

## When the owner reports a new output problem

Fix it **and** add the rule to `docs/CLI-UX.md` in the same commit, quoting the offending output.
The document only works if it grows every time something slips through.
