# adaptv — the CLI output contract

> **Read this before changing anything under `bin/`.** Every rule here exists because the output
> broke it once and the owner had to report it. They are not style preferences — they are the
> contract the CLI's output is held to, and a change that violates one is a regression even if
> every test passes.
>
> The tests can't catch these. **You must run the command and look at the output.**

---

## 0. The one idea

**The CLI narrates the developer's intent, not adaptv's implementation.**

A dev runs `adaptv dev ios` because they want their app on a simulator. Everything printed either
tells them how that is going, or asks them for something only they can decide. Anything else —
which Capacitor command ran, which pods were linked, which internal file was regenerated — is
adaptv's business, not theirs. The consumer does not know adaptv runs on Capacitor and TanStack
(`DECISIONS.md` L20); the output must never teach them otherwise.

`bin/lib/render.mjs` states the intent in its header: *"rendered as calm steps instead of a raw
log dump."* Hold every change to that.

**The default is SMALL.** Steps are short, direct and few, drawn from a closed vocabulary of
lowercase phrases. The default output is not "everything, tidied" — it is the handful of things
a dev acts on. Anyone who wants the full stream has `--verbose`, and that is the *only* place
detail belongs. Every time this file has grown a rule, the cause was the same: something true
was printed because it was true, without asking whether the dev needed it.

---

## 1. Structure

**R1 — One line per platform.** A platform's entire story is ONE settled line: scaffolding, sync,
build, install, launch. Not a `prepare ios` line and then an `ios` line. Sub-actions render live
*on that line* and vanish; only the outcome settles.
> Violated by: a standalone `✓ ios native project (first run) 2.9s` step above the `ios` line.
> If work has to happen before the line could exist, render it transiently and bill its time to
> the line (`transient` + `offsetMs` in `render.mjs`).

**R2 — One glyph per outcome.** A failure gets exactly one `✖`. Never settle a lane with `✖ ios`
and then print `✖ ios failed — …` underneath.

**R3 — Never interleave platforms.** In an `all` run, a platform's failure detail must sit with
its own line, never after another platform's. Collect and group; don't emit as you go.
> Violated by: `✖ ios` / `✓ android` / `✖ ios failed — …`.
>
> Consequence, deliberate and easy to mistake for a bug: `runLanes` re-orders the **final** frame
> so failures are the bottom rows (successes first, stable within each group). A failing lane may
> print dim detail under itself, and that is only possible when nothing follows it. Live rows keep
> their original order — reshuffling mid-run would be noise.

**R20 — One platform is not a different rendering.** `build ios`, `build android` and
`build all` are the same command with a different argument, so they must produce the same
shape: shared work (the web bundle, the dev server) as its own line, then ONE line per
platform. A single platform is a one-lane run, never a separate code path that exposes
internals as top-level steps.
> Violated by all three at once:
> ```
> adaptv  build ios          adaptv  build android      adaptv  build all
> ! ios: no logo.png …       ! android: no logo.png …   ! ios: no logo.png …
> ✓ package  …ipa · 6.7s     ✓ sync  281ms              ! android: no logo.png …
>                            ✓ package  …apk · 2.6s     ✓ ios  …ipa · 5.0s
>                                                       ✓ android  …apk · 727ms
> ```
> Three shapes for one command. Worse, `sync` was a top-level step whose line appears only
> on a cache MISS — so whether `build android` showed it depended on which platform you had
> built last, which reads as a bug in the build rather than a cache doing its job. The fix is
> structural, not cosmetic: `single` and `all` now share one `runLanes` call, so they cannot
> drift again. Sub-actions render on the lane and vanish (R1).

**R21 — An app-level fact is stated once.** Something true of the whole app — an icon source,
a config key — is discovered once per platform, and must not be printed once per platform or
prefixed with a platform that has nothing to do with it.
> Violated by: `! ios: no ./assets/logo.png …` immediately followed by
> `! android: no ./assets/logo.png …`. One missing file, reported as two problems, neither of
> which is about iOS or Android. `flushNotices()` in `render.mjs` dedupes, and every command
> shares it rather than keeping its own copy of the loop.
>
> That warning also broke R5: adaptv kept the existing launcher icons and carried on, so
> there is nothing to do — it is a dim note. The `@capacitor/assets` one stays a `!`, because
> there a `logo.png` IS present and is being silently ignored, which only the dev can fix.

**R4 — A step that did nothing prints nothing.** A sub-10ms no-op must not print `✓ … 5ms`.
Only surface a step when it genuinely took time or the dev needs to know it happened.

---

## 2. Severity

**R5 — `!` (warning) means the dev may need to act.** If adaptv already handled it and there is
nothing to do, it is a dim note with no glyph (`log.info`), not a warning.
> Violated by: `! ios: removed a leftover dev ATS exception …` — adaptv added it, adaptv removed
> it, nothing to do. Contrast with ATS that adaptv did *not* add: that one stays `!`, because only
> the dev can decide about it before App Review.

**R6 — Don't announce what the next thing already says.** No preamble for an interactive prompt.
> Violated by: `! android: no cached device yet — pick one (it'll be remembered).` immediately
> above a picker whose header reads *"Choose a android device"*.

**R7 — Errors are terse and name the fix.** `missing \`appId\` in adaptv.config.ts` — not
`run failed — adaptv.config.ts needs an \`appId\` for native builds.` A user error is not a crash:
render it as a plain one-liner and exit, never wrapped in step-failure scaffolding.

---

## 3. Noise

**R8 — Never print adaptv's own plumbing.** Framework-owned work is invisible; only work the dev
caused is named.
> Violated by: `inject 13 adaptv plugin pods → pod install`. adaptv's base plugins are plumbing.
> A plugin the dev registered in `adaptv.config.ts` *is* theirs — name only those
> (`linking plugins · device`).

**R9 — Never print absolute paths.** Artifact and file paths are app-root-relative.
> Violated by: `✓ android /Users/arrz/Documents/Github/project-zero/apps/front…`.
> Want: `✓ android .adaptv/app-debug.apk`.

**R10 — Never exceed the terminal width, never wrap.** `compose()` in `render.mjs` clips the dim
right-hand detail; `clipAnsi()` clips a whole pre-coloured row (both preserve ANSI codes). A
settled line's elapsed time is passed as `compose`'s `keep` argument so the *detail* yields width
to it — a long artifact path or failure reason must never be what pushes `· 12.4s` off the row.

**R11 — Parse tool output; don't echo it.** xcodebuild / gradle / CocoaPods lines are enormous and
path-laden. Map them to calm phases (`compiling`, `linking`, `signing`, `gradle · assembleDebug`)
in `bin/lib/tool-log.mjs` — a pure, unit-tested table, so a new tool verb is one row, not a rewrite.
Unrecognised lines keep the last known phase or are hard-truncated — they never widen the display.
> Violated by: `ios ProcessInfoPlistFile /Users/arrz/…/DerivedData/27DF…/Info.plist /Users/arrz/…/
> ResourceBundle-CapacitorCordova-Info.plist (in target 'CapacitorCordova-CapacitorCordova' from
> project 'Pods')`. One real xcodebuild build streamed **2147 distinct such values, the longest
> 29 847 columns**; the same build now yields 82, the longest 62. Two heuristics carry most of it:
> a line with an absolute path is tool-internal by construction, and the live line is a *sentence* —
> anything with source-code punctuation (`{}[]|^~<>@$#"`) is a compiler diagnostic's context, not a
> phase.

**R22 — A phase says WHAT IS HAPPENING, never WHAT IT IS HAPPENING TO.** `compiling`, not
`compiling · CapacitorSplashScreen`. No target names, no task names, no pod names, no
camelCase identifiers of any kind — those are the tool narrating itself.
> Violated by: `compiling · Capacitor`, `processing resources · CapacitorCordova`,
> `linking · CapacitorStatusBar`, `gradle · parseDebugLocalResources`,
> `installing pods · CapacitorHaptics`.
>
> The subject is what made the line move: one iOS build produced **91 distinct phases and
> rewrote the row 140 times in 13s, the longest 56 columns** — a strobe, not a status. Naming
> the pod also answers a question nobody asked; a build compiles what it compiles. Dropping it
> gave **12 phases, longest 24 columns**, and one shared vocabulary for iOS and Android, so the
> two platforms read as the same command instead of two tools talking about themselves.

**R23 — The live line SAMPLES the stream; it does not follow it.** A phase holds the row for
`PHASE_DWELL_MS` before another may replace it, and the row then adopts whatever is current at
that moment — never a backlog. `nextPhase()` in `render.mjs` is that rule, pure and tested.
> Even with R22 applied, xcodebuild alternates compiling↔processing resources as it walks the
> pods: still **105 rewrites in 13s (~8/sec)**. Sampling brings the same build to **17 (~1.3/sec)**.
> Nothing is hidden — a phase too short to read was never information, and `--verbose` is
> untouched.

**R24 — The phase vocabulary is CLOSED.** A new tool verb is mapped into the existing list; it
does not get a new phrase invented for it, and it never passes through raw. The whole list:
> `preparing build` · `configuring` · `resolving dependencies` · `downloading dependencies` ·
> `installing dependencies` · `compiling` · `compiling assets` · `compiling interface` ·
> `linking` · `processing resources` · `running build script` · `generating debug symbols` ·
> `extracting app metadata` · `checking` · `optimizing` · `signing` · `packaging` ·
> `installing` · `cleaning` · `building`
>
> An unrecognised gradle task maps to `building`, not to its own name. If a genuinely new
> activity appears, add ONE phrase here and to the tables in `tool-log.mjs` — the list staying
> short is the point, and it is what keeps iOS and Android speaking the same language.

**R25 — `·` separates a thing from its metadata.** `adaptv · build ios`,
`✓ ios  .adaptv/ChopChop.ipa · 5.0s`, `· cached`. It is never used to bolt an identifier onto
a phase — that was R22's bug wearing a separator.

**R12 — `--verbose` is the raw escape hatch.** It streams unfiltered tool output. Every rule in
§3 applies to the calm path only; never "fix" noise by making `--verbose` quieter.

---

## 4. Failure detail

**R13 — The reason goes inline on the failing line**, as the most meaningful line available —
`The sandbox is not in sync with the Podfile.lock`, not `exited with code 1`. Extract it (`error:`,
`BUILD FAILED`, gradle's `* What went wrong:`) rather than taking the last N lines of chatter;
`errorTail()` in `bin/lib/tool-log.mjs` owns that choice and is unit-tested.
> A compiler locator is not the reason. `/Users/…/AppDelegate.swift:54:32: error: cannot convert
> value of type 'String' to specified type 'Int'` inline is 100+ columns of which the first 60 are
> a path — clipped, the dev learns nothing. Split it: the message goes on the ✖ line, a short
> `at AppDelegate.swift:54:32` goes on the dim line under it.

**R14 — Detail appears once**, dim, grouped under that platform — or only under `--verbose`.
Never a second glyph, never a raw dump in the calm path.
> Violated by gradle: `✖ android  > Task :app:checkDebugAarMetadata FAILED` followed by a
> seven-line block (`FAILURE:` / `Build failed with an exception.` / `* What went wrong:` / …).
> Two faults at once — the reason named the task rather than the cause, and the cause
> (`Could not find dev.arrz.doesnot:exist:1.2.3.`) had been cut from the tail entirely by a
> fixed 3-line capture window. Gradle nests causes and the **deepest** `>` line is the
> actionable one; `gradleCause()` in `bin/lib/tool-log.mjs` walks to it, and `errorTail()`
> keeps the whole `* What went wrong:` section rather than a fixed window.

**R16 — One failure, one `✖` — even when it arrives as two errors.** A single fault can
surface twice: the dev server rejects with a friendly *"port 41720 is already in use …"*
while Node separately emits a raw `EADDRINUSE` on the socket. An outer catch that reports
the second one prints a duplicate glyph carrying the ugly text.
> Violated by: `✖ server  port 41720 is already in use — …` immediately followed by
> `✖ dev  listen EADDRINUSE: address already in use 127.0.0.1:41720`.
> Because the two are different error objects, marking the error can't connect them — the
> flag is run-scoped (`anyFailurePrinted()` in `render.mjs`), and outer catches stay silent
> once anything has rendered a `✖`. The CLI exits on its first failure, so that's the
> honest question to ask.

**R15 — Never truncate an error the dev needs.** A filter that keeps the first error line and drops
the rest can swallow the actual instructions.
> Violated by: `bin/lib/dev-server.mjs` filtering subprocess output line-by-line on keywords, which
> printed `"sets 1 key that adaptv no longer reads:"` and dropped the migration steps that followed.

**R17 — Never offer a key that cannot act.** A hint is a promise. `r`/`b` are NATIVE actions
(relaunch the app on the device, reinstall the binary); on `dev web` their handlers return
immediately, so listing them made a working CLI look frozen — the dev presses the key the CLI
just advertised and nothing happens.
> Violated by: `✓ watching · r reload js  b rebuild app  ctrl-c stop` on `adaptv dev web`.
> Two conditions gate every key: does it mean anything for THIS target, and can it be read at
> all (`keysAvailable()` — raw mode needs a TTY). Hours were spent hunting a phantom
> input-forwarding bug that was only ever this.

**R18 — Say nothing at the end that the steps already said.** On success there is no closing
summary: every step line already names its device or artifact. A FAILURE keeps its line — that
is the command's verdict, and for `all` it is the only place that says more than one platform
went wrong.
> Removed: `✓ launched · 4s`, `✓ artifacts ready · 7s`, and the `✓ watching` prefix on the
> watcher row (it is just the keys now; the spinner already says "working").

**R19 — Addresses come from the server, never from inference.** Print the network URL only when
Vite reports one, dim under the settled line. adaptv binds the LAN only when a physical device
needs it, so a computed `http://<lan-ip>:<port>` would often point at nothing — the same lie as
a dead key.
> Want:
> ```
> ✓ server  http://localhost:41710 · 2.0s
>     network  http://192.168.1.25:41710
> ```

---

## 4b. The engine

**R26 — `render.mjs` is the ENGINE; nothing else writes to stdout.** Commands describe INTENT
(`header`, `runLine`/`runLanes`, `addresses`, `flushNotices`, `liveWatcher`, `section`,
`check`, `spacer`, `detail`); the engine decides what that looks like. `rawOut()` is the one
exception, for `--verbose` passthrough (R12).
> Violated by: `preview web` printing its own `ctrl-c stop` (dim, glued to the row above)
> while `dev` got a bold, spaced one from `liveWatcher()`; and `doctor` printing its own
> banner with `✔`/`○` instead of `✓`/`✖` — the command you run when something is already
> wrong was also the one that looked like a different program.
>
> This is the fault behind nearly every rule in this file: two implementations of one idea,
> drifting. **`bin/lib/engine.test.mjs` enforces it** — no `process.stdout.write` /
> `console.log` outside the engine, and no second glyph vocabulary (`✔ ✗ ⚠`) anywhere. A
> document cannot catch this; a test can. If you need a new kind of line, ADD A PRIMITIVE to
> the engine — never draw it in the command.

**R27 — A served app's addresses are a block, not a suffix.** Aligned, labelled, one per row:
> ```
> ✓ web  · 2.0s
>     local    http://localhost:41710
>     network  http://192.168.1.25:41710
> ```
> Violated by: `✓ server  http://localhost:41710 · 2.0s` with `network …` hanging under it —
> one address labelled, the other not, and the row growing with the port. The row is `web`,
> the same name the platform lanes use, because that is what is being served. The elapsed
> time always reads `· 2.0s` so a row whose detail moved into the block still matches its
> neighbours.

## 5. Before you ship a CLI change

Tests do not cover any of this. Run it and read it:

- [ ] `adaptv dev ios` — **first run** (`rm -rf .adaptv/ios`) and a warm run
- [ ] `adaptv preview ios` and `adaptv build all` — including a genuine **failure** (force one)
- [ ] an `all` run, to check platforms don't interleave
- [ ] the **device picker** path (`rm -f .adaptv/devices.json`, no `--target`)
- [ ] `--verbose` still streams raw output
- [ ] no line wraps at a normal terminal width
- [ ] **watch a native build for 10s** — if the phase text moves more than about once a second,
      or you can read an identifier in it, R22/R23 are broken
- [ ] `adaptv preview web` and `adaptv preview all` — the web server must come up and STAY up
- [ ] `adaptv doctor` — same banner and glyphs as every other command
- [ ] `pnpm typecheck && pnpm biome:check && pnpm test`

Capture output through a pty so live-line rendering behaves as in a real terminal:
`script -q /tmp/out.txt env TERM=xterm-256color pnpm exec adaptv <cmd>`

Stop `dev` runs with **SIGINT** (`pkill -INT -f "adaptv.mjs dev"`), never SIGKILL — SIGKILL skips
teardown and strands the dev ATS exception in `Info.plist`.

---

## 6. Adding rules

When the owner reports an output problem, **add the rule here in the same commit as the fix**,
with the violating output quoted. That is what stops it recurring — this file only works if it
grows every time something slips through.
