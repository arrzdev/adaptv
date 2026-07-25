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

---

## 5. Before you ship a CLI change

Tests do not cover any of this. Run it and read it:

- [ ] `adaptv dev ios` — **first run** (`rm -rf .adaptv/ios`) and a warm run
- [ ] `adaptv preview ios` and `adaptv build all` — including a genuine **failure** (force one)
- [ ] an `all` run, to check platforms don't interleave
- [ ] the **device picker** path (`rm -f .adaptv/devices.json`, no `--target`)
- [ ] `--verbose` still streams raw output
- [ ] no line wraps at a normal terminal width
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
