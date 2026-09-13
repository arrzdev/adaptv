# adaptv — the CLI output contract

> **Read this before changing anything under `bin/`.** Every rule here exists because the output
> broke it once and the owner had to report it. They are not style preferences — they are the
> contract the CLI's output is held to, and a change that violates one is a regression even if
> every test passes.
>
> The tests can't catch these. **You must run the command and look at the output.**
>
> **A rule's number is its identifier.** Code comments, tests and the skill cite rules by
> number and nothing else, so a number may be defined exactly once and a new rule takes the
> next one at the end of the range — never a gap, never a number a deleted rule left behind.
> `bin/lib/rule-numbers.test.mjs` fails the build on a number defined twice, a hole in the
> range, or a citation anywhere in the repo of a number this file does not define.
>
> **Building something NEW rather than changing something old?** Start with
> [`docs/design/cli-visual.md`](../design/cli-visual.md) — the design system: the grid, the colour and glyph roles,
> the component inventory, and the checklist for adding a command. This file is the record of
> what has already gone wrong; that one is how to not need it.

---

## 0. The one idea

**The CLI narrates the developer's intent, not adaptv's implementation.**

A dev runs `adaptv dev ios` because they want their app on a simulator. Everything printed either
tells them how that is going, or asks them for something only they can decide. Anything else —
which Capacitor command ran, which pods were linked, which internal file was regenerated — is
adaptv's business, not theirs. The consumer does not know adaptv runs on Capacitor and TanStack
(`docs/decisions/register.md` L20); the output must never teach them otherwise.

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
> Also violated by a row that renders its own ✖ without SAYING so. `wasReported(err)` is how a
> command's outer catch knows to stay quiet, and `runLine` only marked it on the non-TTY path —
> so in a real terminal one failure printed twice, under two labels, with the same fix under
> each:
> ```
> ✖ web  port 7171 is already in use · 3.1s
>     Usually a running 'adaptv dev', a stray 'pnpm dev', or a worker left behind by one.
> ✖ dev  port 7171 is already in use
>     Usually a running 'adaptv dev', a stray 'pnpm dev', or a worker left behind by one.
> ```
> Whichever branch draws the ✖ owns the report, on every path it can take.
>
> And by a row given no `explain` at all. `build web` ran its bundle through `runLine` without one,
> so the row settled on the raw message — an absolute path, clipped to the width — and the
> command's catch then printed the calm reason as a second ✖ under it:
> ```
> ✖ web  /Users/arrz/Documents/Github/adaptv/.claude/worktrees/playgro… · 280ms
> ✖ web  · Build failed with 1 error:
>     [UNRESOLVED_IMPORT] Error: Could not resolve './definitely-missing-module' in vite.config.ts
> ```
> A settled row takes `explain`, and its catch asks `wasReported` before it says anything.
>
> And by a reason that brought its own mark. The native runner behind `dev ios` narrates its
> steps with a glyph of its own, writes the verdict on the failed one BEFORE the tool's output,
> and the verdict says `failed` — so the tail kept it and the pick took it first:
> ```
> ✖ ios  ✖ Running xcodebuild - failed! · 41.2s
> ```
> A runner's verdict (`✖ … - failed!`, and `✔ … in 3.21ms` for the step that passed before it)
> restates the row's own outcome, like `** BUILD FAILED **`, so `explain.mjs` drops it from the
> candidates. When nothing else in the tail says a word, the step it names is still the reason
> (`✖ ios  xcodebuild failed`), and its mark is not.

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
shape: shared work rendered the same way in each (the dev server settles a line; the native
web bundle renders transiently — R28), then ONE line per platform. A single platform is a
one-lane run, never a separate code path that exposes internals as top-level steps.
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
> Only the platform prefix and the repetition were wrong there — both messages keep their `!`
> (R5): one says the launcher icon is Capacitor's stock art, the other says a `logo.png` IS
> present and is being silently ignored. Neither is something adaptv can fix.
>
> The test is whether the FACT is app-level, not whether the code that found it runs per
> platform. A missing icon directory is one fact and gets stated once; "the source is too small"
> is genuinely per-platform (1024px iOS vs 432px Android) and *earns* its prefix — see R7b. The
> rule is against a platform label that carries no information, not against platform labels.

**R4 — A step that did nothing prints nothing.** A sub-10ms no-op must not print `✓ … 5ms`.
Only surface a step when it genuinely took time or the dev needs to know it happened.

**R33 — Everything adaptv already knows is said before the run starts, and stops it if it
must.** A command reads the config and the dev's assets FIRST, says what it found, and only
then builds, serves or installs anything. The output is three blocks with a blank line between
them: the banner, what adaptv knew, the run.
```
  adaptv · preview all

  ! ios launcher icon upscaled from 512px — add a 1024px icon
  ! android launcher icon is opaque — add one with a transparent background

  ✓ web  · 4.6s
    local  http://localhost:41730
  ✓ ios  iPhone 16 Pro (simulator) · 19.1s
```
> Violated by exactly that run with the two `!`s **under** `✓ web`, in the middle of the
> lanes: the icons are source art the build does not change, so both sentences were true
> before the command started, and the dev read them halfway through work already done with
> them. They landed there because they were *returned by the branding step* — the code
> printed them where it happened to learn them, and `dev` looked correct only by accident of
> preparing the platforms before the dev server came up. The fix is a **preflight**
> (`bin/lib/preflight.mjs`): what can be known from the icon directory alone is computed
> there, printed under the banner, and the branding step goes silent (R18).
>
> The same rule decides a bad config. An illegal value must not survive into a build:
> ```
>   adaptv · build android
>
>   ✖ 'themeColor.light' must be a hex colour like #1b1b1b — got "eeeeec"
>   ✖ 'splashMaskMode' must be preferences, system, light or dark — got "auto"
> ```
> Nothing is built, nothing is served, and every problem is listed at once — a config fixed
> one line per run is worse than a list. These used to be SILENT: an unparseable colour fell
> back to white and an unknown mode to `preferences`, so the app shipped with a setting the
> dev wrote and adaptv ignored. Guessing is the bug; saying so is the fix.
>
> What preflight may NOT do is guess at work: a compile error, a device that won't boot, an
> ATS exception in a plist that has to exist first — those belong to the step that finds
> them. The test is whether the answer was already sitting in a file the dev wrote.

**R34 — A command that destroys the dev's work ASKS, and a command that cannot ask REFUSES.**
`icons` overwrites every file in the icon directory. When there is something to lose it
prompts; when there is nothing there it asks nothing (R4); and when there is no TTY at all it
**names the flag** instead of guessing:
```
  adaptv · gen icons

  replace 27 icons in ./public/favicons (your 'icons' dir)?
  › replace them
    cancel
  ↑↓ move   ↵ select   esc cancel
```
```
  adaptv · gen icons

  ✖ ./public/favicons (your 'icons' dir) is not empty — pass --yes to replace it
```
> The prompt's own header carries the fact, so there is no `!` line above it repeating it (R6),
> and it is `confirm()` in `render.mjs` — built on `select` so the two share one look and one
> self-erase, not a second picker drawn in the command (R26).
>
> **It also says where the path came from.** `./public/favicons has 27 icons — replace them?`
> names a directory without saying why adaptv picked it, and the answer — `icons` in
> `adaptv.config.ts` — is in a file the dev may not have open. A prompt that is about to destroy
> files has to be answerable from the prompt. `--output` needs no such suffix: they just typed it.
>
> The same reasoning made a missing destination an `✖` rather than a default: files landing in a
> directory nobody named is a surprise found afterwards, so the destination must have been
> chosen. The READ path later had to agree — see R38.
> ```
>   ✖ nowhere to write — set 'icons' in adaptv.config.ts, or pass --output <dir>
> ```
>
> The non-TTY branch is the rule's real content. `select` answers for the dev when it can't
> prompt, which is right for a device picker (any simulator will do — so it takes the first
> simulator or emulator, a physical device only when nothing else is listed, and remembers
> nothing for `--latest`) and catastrophic here — it would answer *yes* on the dev's behalf,
> silently, in the one situation where nobody is watching. `confirm` returns `null` there
> instead, and the caller turns it into the `✖` above.
>
> **The gate is about the dev's FILES, never their taste.** `icons` first shipped refusing
> to generate from a source under 1024px, on the theory that a generator run is deliberate and
> should be held to a standard. That is a different rule wearing this one's clothes, and it was
> wrong: a 512px logo is a real answer for someone prototyping, and blocking them teaches only
> that the tool is in the way. What the source costs them is a `!` under the banner, before the
> prompt, while cancelling is still free — and the run proceeds:
> ```
>   adaptv · gen icons
>
>   ! source is 400px — every icon is upscaled from it (1024px is ideal)
>   ! source has no flat background — the mask will crop its edges
>
>   ✓ icons  12 files → ./public/favicons · 72ms
>       preview  .adaptv/icons-preview.html
> ```
> Only bytes adaptv genuinely cannot decode stay an `✖`, because then there is no set to make.
>
> The preview sheet is written on **every** run rather than behind a `--preview` flag, and that
> is the other half of warning instead of refusing: `the mask will crop its edges` is a
> sentence, and the sheet is the only place the dev can SEE it happen. Behind a flag it was a
> review step only someone who already knew to look would find.
>
> Both warnings narrowed once the generator got better, and that is the rule working rather than
> bending: a `!` has to describe what adaptv will ACTUALLY do. "no transparency" fired for every
> opaque source until `measureArtwork` learned to lift a mark off a flat background — after which
> it was warning about the case it had just fixed. What is left fires only when the background
> genuinely cannot be isolated, which is the only case the dev still has to act on.

---

## 2. Severity

**R5 — Every notice carries the `!`. There is no glyphless severity.** The question a notice has
to pass is not *how bad is this* but **does the dev need to know** — and if the answer is no, it
is not printed at all (R4). Anything adaptv does say gets the mark.
> Violated by: `no ./assets/logo.png — using the launcher icons already in the project.` printed
> bare, with no glyph, in the middle of a `preview all`. There is no such thing as "information
> you should know, without an icon": an unmarked sentence reads as stray output, and leaves the
> dev working out for themselves whether it was a problem. It is also not true that adaptv
> "handled it" — the app ships Capacitor's stock icon, which only the dev can fix.
>
> This *reverses* an earlier version of R5 (a glyphless `log.info` note for things adaptv had
> already handled). What survives from it is the other half: the leftover-dev-ATS message, which
> adaptv both added and removed, is now printed **not at all** rather than printed quietly.
> Contrast with ATS that adaptv did *not* add: that one stays a `!`, because only the dev can
> decide about it before App Review.

**R6 — Don't announce what the next thing already says.** No preamble for an interactive prompt.
> Violated by: `! android: no cached device yet — pick one (it'll be remembered).` immediately
> above a picker whose header reads *"which android device?"*.

**R7 — Errors are terse and name the fix.** `missing 'appId' in adaptv.config.ts` — not
`run failed — adaptv.config.ts needs an 'appId' for native builds.` A user error is not a crash:
render it as a plain one-liner and exit, never wrapped in step-failure scaffolding.

**R35 — An error about the INVOCATION names the argument the dev actually typed, and shows the
shape.** A wrong command line is the one failure where the dev is looking straight at their own
input and cannot see what is wrong with it. Say which token is the problem, what was expected
instead, and put the usage line dim underneath.
> Violated by `icons`, reported by the owner:
> ```
> $ adaptv icons --target ./public/favicons/android-chrome-512.png
>
>   adaptv · gen icons
>
>   ✖ missing image — adaptv icons <image>
> ```
> The command plainly contains an image, so "missing image" reads as a bug in adaptv. What
> happened is that `parseFlags` turns any `--foo` into `flags.foo = true` and *swallows the
> value after it*, so an unvalidated flag is not merely ignored — it eats the positional
> argument. Validating the flags says both things at once, and names what was expected, because
> a typo is only obvious next to the right spelling:
> ```
>   ✖ unknown flag "--target" for gen icons
>       adaptv icons --input <image>  [--out <dir>] [--yes]
>         tuning:  [--margin <pct>] [--padding <pct>] [--background <hex>]
> ```
> **The same message for every unknown flag, `--target` included.** The first fix gave it a
> special case — `` `--target` is a device id — `icons` takes the image positionally `` —
> on the theory that it is the predictable wrong guess and deserved a precise answer. The owner
> rejected it, correctly: *"porque é que a explicação do erro está a dar leak do `--target` que
> é uma coisa específica de outro comando?"* A dev generating icons has no reason to learn what
> `--target` means on `dev`, and adaptv narrating its own flag vocabulary is the plumbing R8
> keeps out of the output. What they need is that this command doesn't take it, and what it does
> — which the usage block under the `✖` already says.
>
> The usage line is for errors about the SHAPE of the command, not every bad value. A path that
> doesn't exist gets `✖ no such image: ./nope.png` and nothing else: they typed an image in the
> right place, so the shape is not the fix and printing it answers a question nobody asked (R6).

**R36 — A wrapper around the CLI adds NOTHING to its output.** `pnpm dev:ios` and
`pnpm adaptv …` go through `scripts/playground.mjs`, which is a passthrough — so the run must
look exactly like the run, and a failure must end where the `✖` ends.
> Violated by one mistyped flag, reported by the owner as *"se nada foi gerado porque aparece
> ali tanta porcaria?"*:
> ```
>   ✖ unknown flag "--target" — expected --padding, --background or --yes
>       adaptv icons <image>  [--padding <pct>] [--background <hex>] [--yes]
> undefined
> /Users/arrz/…/playground/apps/frontend:
>  ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command failed with exit code 1: adaptv icons …
>  ELIFECYCLE  Command failed with exit code 1.
> ```
> Five lines nobody wrote, under a CLI whose whole contract is that a user error is ONE terse
> line (R7) — including the app's absolute path (R9) and the command re-quoted argument by
> argument. Two causes, both ours:
> - `playground/package.json` used `pnpm --filter @repo/frontend exec`, which takes pnpm's
>   **recursive** exec path and reports a failure as a multi-package summary — the stray
>   `undefined`, the package header, and `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL`. There is exactly
>   one package here, so `--dir apps/frontend` is the same thing without the summary.
> - `playground.mjs` spawned `pnpm run <script>`; `pnpm run --silent` drops the script echo and
>   the `ELIFECYCLE` line. It suppresses pnpm's lifecycle reporter, **not** the process it
>   starts, so every byte the CLI writes still comes through.
>
> The outermost layer is the invocation itself (`pnpm adaptv …` echoing its own script and
> exiting `[ELIFECYCLE]`) and belongs to pnpm, not to adaptv — `pnpm --silent adaptv …` is the
> quiet form. Everything inside that is adaptv's to keep clean.

**R69 — An explicit flag outranks a measurement, or it is not a flag.** `gen icons` measures the
colour behind the mark and repaints it on the slots that cannot carry transparency. `--background
<hex>` was documented as overriding that colour and did not: `slotPlan` read
`artwork.background ?? background`, so the measurement won and the flag was a silent no-op in the
ONLY case anyone reaches for it — a source that HAS a background whose colour they want changed.
Passing it changed nothing and said nothing.
> ```
> $ adaptv gen icons --input logo.png --background "#ff0000"
>   ✓ icons  15 files → ./public/favicons · 127ms      # still #1e7a4f
> ```
> A measurement is adaptv being smart on the dev's behalf; a flag is the dev answering the
> question themselves. The answer wins. The same run now says which colour it read, so the
> measurement is visible before it is disagreed with — and the notice goes silent once
> `--background` is passed, because it is answering a question the dev already answered.
> ```
>   ! background #1e7a4f lifted off the mark — --background overrides
> ```
> Generally: every tuning flag must be checked against the path it claims to control, with a
> value that would be indistinguishable from the default if it were ignored. `--background
> #ffffff` on a white-backed logo proves nothing.

**R38 — A notice never names a path the dev did not write.** `icons` used to fall back to
`./public/favicons` for reading, so an app that configured nothing still got the art sitting
there — and the notice for an app with none named that directory back:
> ```
> ! no icons in ./public/favicons
> ```
> The dev had never written that path. Worse, the fallback made the rule adaptv claimed to have
> — *no icons dir configured ships adaptv's mark* — one it did not actually have: commenting the
> key out resolved to the same directory, the same manifest, the same launcher icons. Reported as
> icons that would not update on `dev`, in the app AND on the web.
>
> Two situations reach the default mark and they have different fixes, so they get different
> sentences — an empty directory is filled, an absent key is set:
> ```
> ! no icons in ./public/favicons
> ! no 'icons' in adaptv.config.ts
> ```
> The general rule is R7 (name the fix), and the general lesson is the fallback rather than the
> wording: a default that silently resolves to a real directory makes the config key look
> ignored. `icons` already refused to guess where to WRITE (R34); the read path now refuses
> to guess where to READ, and the two finally describe the same framework.

**R43 — Quote a config key, flag or command with `'`, never a backtick.** A backtick is markdown
punctuation: it renders as code in this file and as a literal backtick in a terminal, which is
where these sentences actually live.
> ```
> ✖ `themeColor.light` must be a hex colour like #1b1b1b — got "midnightblue"     ← was
> ✖ 'themeColor.light' must be a hex colour like #1b1b1b — got "midnightblue"     ← is
> ```
> Owner's call, and it applies to every printed string, not only the config errors: key names,
> `--flags`, and commands the dev is told to run (`'adaptv dev ios'`, `'pnpm install'`,
> `'lsof -nP -iTCP:41730 -sTCP:LISTEN'`). Source comments and this document keep backticks —
> they are read as markdown, so the convention is right there and wrong on a terminal.
>
> The apostrophe in a possessive sits next to it happily enough:
> `'icons' must be a path to the app's icon directory`.

**R42 — A notice states the fact, not adaptv's reaction to it.** Both default-mark notices used
to explain what adaptv would do about the missing art:
> ```
> ! no icons in ./public/favicons — shipping adaptv's default mark
> ! no 'icons' in adaptv.config.ts — shipping adaptv's default mark
> ```
> Half of each row is adaptv narrating its own fallback. The dev acts on the missing art; what
> adaptv substitutes meanwhile is its business (R8), and the clause nearly doubled a row that has
> to survive a narrow terminal without being clipped (R31). Reported by the owner as wanting just
> `! no 'icons' in adaptv.config.ts`.
>
> Both were shortened, not just the one reported: they are two shapes of one fact, and leaving
> one with the clause and one without is precisely the drift this file exists to stop. The two
> sentences still differ where it matters — the fix (R38).
>
> The consequence accepted here is that neither row says the app still gets a real icon. That is
> the right trade only because the mark is visible the moment the app launches; a notice whose
> consequence is INVISIBLE still has to state it.

**R39 — There is ONE answer to "is this config usable", and a run that loses it ends.** R33 says
a config value adaptv cannot use stops the command before it builds anything. That has to be the
same answer at minute forty as at second zero. The `b` key briefly had a softer one — it kept the
last good config, refused the rebuild, and said so on the watch row:
> ```
>   ! not rebuilt · 'themeColor.light' must be a hex colour like #1b1b1b — got "midnightblue"
> ```
> The reasoning was that killing a live session over a half-typed file is expensive — a dev
> server and every attached device, gone. But what it actually bought was a session that kept
> serving an app built from a config the file on disk no longer contained, with one `!` on a row
> the dev may not be looking at, and only the FIRST problem named where startup lists them all.
> Two answers to one question is how the two halves of a command drift apart.
>
> So `b` now prints every error and exits non-zero, exactly as startup does. What makes that
> affordable is that it is not a kill: the teardown runs first — dev server stopped, `adb
> reverse` cleared, the iOS ATS exception reverted, the lock released — so it ends as cleanly as
> ctrl-c. The unwinding happens BEFORE the errors print, because the watch row redraws every
> 80ms and would otherwise overwrite them.
>
> `r` is untouched: it reloads the running app's JS and never reads the config, so it has no
> opinion to be wrong about.

**R40 — Competing notices MERGE rather than take turns.** `dev` has two things that can go
stale: the native project, and `adaptv.config.ts` plus the icon art it points at. Letting the
newer one win drops the config half exactly when both are true — the sync a config edit implies
is itself what rewrites the native tree — so the causes combine into one sentence:
> ```
>   ! config change  · press b to rebuild and see the changes
>   ! native change · ios  · press b to rebuild and see the changes
>   ! config + native change · ios, android  · press b to rebuild and see the changes
> ```
> The action is identical in all three; naming the cause is what tells the dev whether adaptv
> saw the edit they just made. Which is the point — editing the config used to produce no notice
> at all, because the only fingerprint being polled folds in `ADAPTV_CAPACITOR_CONFIG`, an env
> var nothing re-stamps until something rebuilds. Reported as commenting `icons` out and watching
> nothing happen.

**R54 — A change to adaptv's OWN source notices a RESTART, not a rebuild.** R40's action is
identical for config and native because `press b` applies both. adaptv's own `bin/` is the
exception: a running `adaptv dev` loaded those modules at startup, so `b` reruns the build with the
old logic still in memory — offering it would be the same lie the `keys` guard prevents, a key that
does nothing. So this cause wins the row with its own action:
> ```
>   ! adaptv source change  · restart to apply
> ```
> It only ever fires with a `link:`ed adaptv (framework development) — an installed adaptv's `bin/`
> cannot change mid-session, so a real consumer never sees it. It exists because a merged
> edge-to-edge fix looked broken until the CLI was restarted: the running `dev` still held the
> pre-fix generator and said nothing. Polled off `cliSourceFingerprint`, `.test.mjs` excluded.

**R41 — A notice is added to the live block, never swapped in for something still true.** The
watch row used to be one row with one slot, so a pending notice REPLACED the keys — the moment
adaptv had something to say, `r`/`b`/`ctrl-c` disappeared, including the very key the notice was
telling the dev to press:
> ```
>   ! config change   · press b to rebui
> ```
> Reported by the owner as *"trocaste as actions"* — you swapped out the actions. The keys row is
> the one row that is never not relevant, so the block now grows instead: the notice takes its
> own row above, and the keys stay put underneath.
> ```
>   ✓ ios  iPhone 16 Pro (simulator) · 20.0s
>
>   ! config change  · press b to rebuild and see the changes
>
>   r reload js   b rebuild app   ctrl-c stop
> ```
> An HMR burst animates the bottom row while the notice holds above it, rather than the two
> taking turns. The general rule is that a live block is a BLOCK: it is redrawn as a whole, every
> row still clipped to one physical line (R31), and it is erased as a whole. Cursor arithmetic is
> where this goes wrong — a redraw that rewinds to the top when it is already parked there walks
> the block one row up the screen per frame, and the erase then eats the settled lines above it.

**R44 — A live row CLIPS; a static page WRAPS.** R10/R31 keep a live row to exactly one physical
line, because a row redrawn with `\r\x1b[2K` must occupy exactly one — a wrapped row erases only
its last line and walks the block up the screen. A **help page and an invocation error are printed
once and never redrawn**, so the same rule would buy them nothing and cost them their tail:
> ```
>   Usage
>     adaptv dev [surface] [--target <id>] [--latest] [--host] [--fo…    ← clipped: the flags are gone
>
>   Usage
>     adaptv dev [surface] [--target <id>] [--latest] [--host]
>       [--force] [-- <vite args>]                                      ← wraps, hanging indent
> ```
> The two halves are the same argument as **R15** (never truncate an error whose remaining lines
> carry the instructions) — a synopsis whose flags fall off the right edge on a narrow terminal is
> exactly that failure, and a fix hint is worse. So the engine keeps **two** width policies and
> they are not interchangeable: `clipAnsi` is for rows, and `wrap`/`table`/`lineBlock` are for
> pages, with `hang: 2` so a folded line sits under its own first word rather than under the
> left margin.
>
> Enforced at `bin/lib/render.mjs` — the `static pages` block, and `lineBlock`. **This is the one
> place in the CLI where exceeding one line is correct**, so a future "nothing may wrap" tidy-up
> would silently re-break both help and errors.
>
> *(Written up 2026-08-30. The rule shipped in the Ink rewrite and both call sites cited "R44"
> from the start, but the entry itself was never added here — so for a month the code pointed at
> a rule number this document did not have. Recovered from the two call sites, which were the only
> surviving statement of it.)*

**R45 — A phase is a present participle.** The row says what is happening RIGHT NOW, so it
reads as an activity, not as a command or a thing:
> ```
>   ⠴ ios  sync            ← was
>   ⠴ ios  syncing         ← is
> ```
> `report("sync")` and `report("package")` were bare nouns sitting on the same row as
> `compiling` and `processing resources`, and they read as an instruction being issued rather
> than work being done. `package` was a duplicate of `packaging` on top of that — R24's list
> already had the right word. The test is whether it finishes *"right now adaptv is …"*.
>
> This had a second cost, which is how it was found. `prettyLine` filters what BUILD TOOLS
> print, and one of its rules drops a lone verb — correct for gradle, and it silently ate
> adaptv's own single-word phases. The row then sat on `preparing` for the whole of `cap sync`.
> A deliberate phase is now recognised by name (`OWN_PHASES` in `bin/ui/theme.mjs`) and passes
> through untouched; the participle rule keeps that list honest.

**R46 — A machine mode is a mode of the ENGINE, not a branch in every command.** `--json` and
`--quiet` are enforced in `out()`, which every primitive already funnels through, so no command
carries an `if`:
> ```
> $ adaptv build ios --quiet
>   ✓ ios  .adaptv/builds/ChopChop.ipa · 1.6s
>
> $ adaptv build ios --json
> {"ok":true,"command":"build ios","version":"0.1.0","notices":[],"steps":[],
>  "result":{"build":{"ios":".adaptv/builds/ChopChop.ipa"}}}
> ```
> Three rules the first attempt got wrong, each found by running it:
>
> - **`--json` replaces the PAGE, not the diagnostics.** Silencing every stream left a failing
>   run with no document to parse AND nothing to read. stderr always speaks; a failure also
>   emits the document, with `ok:false` and a structured `error`.
> - **A settled row is an OUTCOME, not narration**, so `--quiet` keeps it. Levelling it as a
>   step made `--quiet` print nothing at all, which is not quiet, it is broken.
> - **A prompt has no machine answer.** Taking the default would pick a device, or overwrite an
>   icon set, for a script that never agreed to either — so both refuse and name the flag that
>   makes the question unnecessary.
>
> It also forced something overdue: `check()` printed `doctor`'s matrix and returned nothing, so
> the one thing a script would ever want from that command existed nowhere but the terminal. A
> command has to RETURN its results before a second renderer can exist.
>
> The settled-row mistake came back in a second shape. `keys ota` printed its PEMs through
> `rawOut`, the `--verbose` escape hatch, which is levelled as a step, so:
> ```
> $ adaptv keys ota --quiet
> $ echo $?
> 0
> ```
> Nothing on either stream, a clean exit, and a key pair adaptv keeps no copy of, gone. Bytes
> that ARE the outcome go through `verbatim()`, which prints unwrapped at result level;
> `cli-process.test.mjs` spawns the command and parses both keys out of the quiet page.

**R37 — A command that did nothing SAYS it did nothing.** A prompt erases itself on the way out
— that is the point of it — but erasing the prompt must not also erase the fact that it was
answered. Every exit has a last line.
> Violated by cancelling `icons`, reported by the owner as *"quando a pessoa cancela algo
> deve aparecer… isto está muito vazio"*:
> ```
>   adaptv · gen icons
>
>   ! source is 512px — every icon is upscaled from it (1024px is ideal)
>
>
> ~/…/adaptv ❯
> ```
> The banner, a warning about a source that was then never used, and a bare shell prompt. The
> dev cannot tell whether the command ran, crashed, or is still thinking — and the one thing
> they wanted to know is whether their icons are still there:
> ```
>   ! cancelled — ./public/favicons is unchanged
> ```
> `!`, not a glyph of its own. A deliberate "no" is not a failure — a `✖` reads as adaptv
> scolding the dev for an answer it asked for — and not a success, so `✓` would claim work that
> did not happen. It is something they need to know, which is exactly what the `!` is for (R5),
> and it names the DIRECTORY because the thing they just protected is the thing worth confirming
> is intact.
>
> Both ways out say it. The deliberate `cancel` option is the command's, and **Ctrl-C is the
> engine's** — `select` erases and exits `130` from inside `render.mjs`, so the caller never gets
> a chance to speak. It prints there instead, which fixes the same silence behind the device
> picker, where aborting had always dropped straight to the shell.

**R7b — A warning about the dev's ASSETS names what's wrong with the asset, never what adaptv
would have needed.** The launcher icon is the whole worked example, and it says exactly three
things — all of them about the art in `icons`, none of them fireable by a set that is fine:
> ```
> ! no icons in ./public/favicons
> ! ios launcher icon upscaled from 512px — add a 1024px icon
> ! android launcher icon is opaque — add one with a transparent background
> ! web manifest's largest icon is 96px — a PWA needs 192px
> ```
> Violated by `./assets/logo.png needs @capacitor/assets — pnpm add -D @capacitor/assets`: a
> `!` telling the dev to install adaptv's own image toolchain, for a Capacitor package they are
> not supposed to know exists (R8, DECISIONS L20). adaptv owns that now; if it can't render an
> icon that is adaptv's problem, and the line says only what the dev sees — `could not brand the
> launcher icon on this platform`.
>
> The first line is the one that changed shape twice. It used to say *"add one to brand the
> launcher icon"* while the app silently shipped **Capacitor's** stock art — a `!` that named a
> fix without admitting what the current state was. adaptv has its own mark now, so the line
> says which logo is on the home screen; it keeps the `!` because an app wearing someone else's
> logo is not something adaptv "handled" (R5). It is also the one warning here that is
> **app-level** (R21): it was briefly returned per platform from `resolveLauncherSource`, which
> meant a `dev web` run — no platforms, and the same wrong logo in the tab, the manifest and
> the install prompt — said nothing at all. It lives in `iconWarnings` now, stated once.
>
> The rest each pass the "does the dev need to know" test (R5) *and* stay silent on
> a good set: a lone 1024px transparent `icon.png` trips none of them, because it is genuinely
> the best source adaptv can be handed. A warning every project sees teaches devs to ignore the
> `!`. Note also that these are NOT uniformly app-level: the missing-directory line is one fact
> and `flushNotices` dedupes it across an `all` run, while the size bar really does differ per
> platform (1024px iOS, 432px Android), so that one names its platform and stands alone.

---

## 3. Noise

**R8 — Never print adaptv's own plumbing.** Framework-owned work is invisible; only work the dev
caused is named.
> Violated by: `inject 13 adaptv plugin pods → pod install`. adaptv's base plugins are plumbing.
> A plugin the dev registered in `adaptv.config.ts` *is* theirs — name only those
> (`linking plugins · device`).

**R8b — A tool's own words are not automatically fit to print, and "make the error better" is
how R8 breaks.** The engines narrate themselves by name; anything that lifts text out of captured
tool output and onto the screen must pass the opacity boundary FIRST. It is `bin/lib/opacity.mjs`
now — `namesPlumbing()`, one-way (it can only suppress), enforced by `opacity.test.mjs` and
`explain.test.mjs` over real captured output. A doc rule was not enough: this was violated by a
change whose entire purpose was to make a failure more helpful.
> Violated by: `✖ web  Cannot find module 'tanstack-start-injected-head-scripts:v'` with
> `at @tanstack/start-server-core/dist/esm/router-manifest.js` under it. Both halves were
> *technically* the most meaningful lines available (R13) and both taught the consumer the one
> thing the architecture spends its whole budget hiding, at the moment they were most likely to
> go and search for it.
>
> The shape of the fix generalises. A fault inside the engines is **adaptv's**, and adaptv owns
> its plumbing out loud but never by name — the same move R7b makes with `could not brand the
> launcher icon on this platform`. So the `✖` falls back to the thrower's own sentence, and the
> dim block carries the fact and the ACTION:
> ```
>   ✖ web  the app did not render · 33.2s
>       every request to http://localhost:41730 answered 500 for 30s.
>       a module adaptv needs could not be resolved. Reinstall dependencies, then run again.
> ```
> The dev's OWN error is untouched by any of this — `✖ web  Cannot find module './lib/totals'`
> prints in full, because that one is theirs. Opacity is not a gag; it is a boundary, and the
> test suite asserts both sides of it.
>
> Two vectors, both closed: `explainFailure` (which is why it moved out of `adaptv.mjs` — that
> file runs the CLI on import, so nothing could ever test it), and `prettyLine`'s generic
> fallback, where an unrecognised `Compiling CapacitorSplashScreen.swift` was one lowercase pass
> from being the live row. NOT hidden: `vite`, `gradle`, `xcodebuild`, `pod`. The contract names
> those out loud already (R24 has `gradle · assembleDebug`), they cost real diagnostic value, and
> none of them says anything about how adaptv is built.

**R71 — A report row the dev cannot act on part by part is ONE row, and `--verbose` is where
its parts are named.** `doctor` answers one question: can this machine build my app, and if not
what do I install? Every other row in it is something the dev owns and fixes one at a time —
node, the Android SDK, a JDK, Xcode, their icon directory — and naming each one is how they act
on it. adaptv's own install is not that: the native command adaptv drives and the native modules
it ships are adaptv's dependencies, resolved from adaptv's package root and absent from the
consumer's `package.json` entirely. The dev did not choose them, cannot install one of them, and
has a single remedy for any of them. One fact, one action, one line — R8b's move, applied to
adaptv's own authored rows rather than to text lifted out of a tool: adaptv owns its plumbing out
loud, never by name.
> Violated by: twelve of `doctor`'s thirty-one lines, every one of them the engine's package
> name, under a heading that said out loud whose they were.
> ```
>   ✓ capacitor cli  · 8.4.2
>
>   Plugins (shipped by adaptv; the consumer installs none)
>   ✓ @capacitor/app
>   ✓ @capacitor/browser
>   … nine more
> ```
> Want, in `Core`, beside `node`:
> ```
>   ✓ adaptv's own install  · complete
> ```
> and when it is broken, ONE `✖` carrying the action — not a red row per part and then a `!`
> repeating the count, which is two announcements of one outcome:
> ```
>   ✖ adaptv's own install  · incomplete
>       Reinstall with 'pnpm install'.
>       Run with '--verbose' to list what is missing.
> ```
> **A diagnostic that hid what was broken would be worse than one that named a vendor**, and this
> hides nothing the dev could have acted on: the row says the install is the problem, the first
> line says what to do, and the second says where the rest is. Under `--verbose` that second line
> goes (R6 — the list is already on the screen) and the names appear, `MISSING` marked. That is
> the ONE surface in the CLI where the engines may be named, and it is exactly the surface
> whoever is debugging adaptv rather than an app is already on.
>
> The decision this replaced is worth stating so it is not re-made: the section was NOT dropped
> in favour of printing only failures. A dev runs `doctor` because something is already wrong,
> and a check that says nothing when it passes cannot be told apart from a check that never ran.

**R9 — Never print absolute paths.** Artifact and file paths are app-root-relative.
> Violated by: `✓ android /Users/arrz/Documents/Github/project-zero/apps/front…`.
> Want: `✓ android .adaptv/builds/app-debug.apk`.
>
> A tool's words are held to it too. The failure pick lifts the line that explains the failure,
> and xcodebuild explains a failure by naming files:
> ```
> ✖ ios  Unable to load contents of file list: '/Users/arrz/…/chopchop/.adaptv/ios/App/Pods/…
>     PhaseScriptExecution [CP]\ Embed\ Pods\ Frameworks /Users/arrz/Library/Developer/Xcode/DerivedData/App-gqzb…/Script-9592….sh (in target 'App' from project 'App')
> ```
> `withoutAbsolutePaths` in `explain.mjs` runs over every reason and detail line: a path under
> the app root becomes relative (`.adaptv/ios/App/Pods/…`), and a path on disk outside it —
> DerivedData, the home directory, Xcode — is cut to its file name, since those directories are
> the machine's. "On disk" means it starts from a real top-level directory: a macOS root
> (`/Users`, `/Library`, `/Applications`, …) always, and a Linux root (`/home`, `/var`, `/dev`,
> …) only when its first two segments exist on the machine, since `/home/feed/3` is as likely a
> route as a file. Slash-led text that is not a file is the dev's own and stays whole:
> `Failed to load url /src/routes/cart.tsx`, `No route matched /products/featured/42`, an API
> path, a regex. Cutting those to a last segment printed `No route matched 42`, a false sentence.

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
>
> **The rule covers the WEB lane too, and for a long time it did not.** Only the native toolchains
> were ever parsed; `build web`, `preview` and the SPA build the native targets install all
> handed the bundler's stdout straight to the row, so anything that happened to read like a
> phrase became one:
> ```
>   ⠼ web  rendering chunks
>   ⠧ web  computing gzip size
> ```
> That is a bundler narrating its own internals (R8) in a vocabulary that is not this one,
> and it is the exact shape R24 exists for: short, lowercase, prose, and about the tool.
> `transforming` IS compiling and rendering chunks IS linking — a bundler runs the same two
> steps a native toolchain does — so they map to `compiling` and `linking`, and an `ios`
> build and a `web` build now narrate themselves with one vocabulary. Its bookkeeping goes
> quiet: the banner naming the tool and its version, the module count, `computing gzip size`
> (measuring a bundle it has already written), and `built in 1.47s`, which is what the
> settled ✓ says. `BUNDLER_PHASES` in `tool-log.mjs`.
>
> Enumerating today's verbs is not the whole rule, for the reason R70 gives: filters that are
> accidents rather than rules eventually let something through. A progress message the table
> does not know — a lowercase clause, an optional count, the ellipsis it animates a spinner on
> — maps to `building`, the same answer an unrecognised gradle task gets. Suppressing it was
> the other option and is worse: the row would go quiet for as long as the new phase takes and
> nothing would ever say that adaptv had stopped narrating a step.

**R70 — A crash dump is never a phase.** When a tool dies rather than fails — an uncaught
exception, a stack trace, a signal — none of what it prints on the way out is a status. The row
holds its last real phase until the step settles and states the reason.
> Violated by `adaptv build android` when the port `ports.ts` pins was taken, so vite's
> prerender step could not bind it (R32). The tail of node's dump became the live phase:
> ```
>   ⠴ web  node.js v26.0.0
> ```
> A phase leak is normally an identifier (R22) or a listing (R24). This one is the opposite:
> `Node.js v26.0.0` is short, path-free, prose-shaped text, so it passed every filter written to
> catch tool chatter — and it says less than any line in the dump it came from. The rest of that
> dump *was* already silent, but by a bracket in one stack frame, a colon in another and a length
> that ran long — accidents, not rules, so which line reached the row was luck. `CRASH_DUMP` in
> `tool-log.mjs` names the shape instead: the footer, the frames, the `throw`, the re-emit banner.
>
> The failure loses nothing by going quiet here. A beat later the row settles into the sentence a
> dev can act on (R13), which is where a dying process belongs:
> ```
>   ✖ web  · port 41740 is already in use
> ```

**R25 — `·` separates a thing from its metadata.** `adaptv · build ios`,
`✓ ios  .adaptv/builds/ChopChop.ipa · 5.0s`, `· cached`. It is never used to bolt an identifier onto
a phase — that was R22's bug wearing a separator.

**R31 — Every row's right-hand side starts at the same column, so a row with nothing before its
metadata OPENS with the `·`.** `✓ web  · 3.9s`, `✓ ios  · cached` — and a `✖` that carries no
elapsed time does the same: `✖ web  · <reason>`. A row that DOES have content before the metadata
keeps the dot where it belongs (`✓ ios  ChopChop.ipa · 5.0s`, `✖ android  gradle said X · 12.0s`);
a second one would put two dots on one line.
> Violated by `fail()`, whose reason started one column to the left of every neighbour — so a
> surface that settled and then failed read ragged:
> ```
>   ✓ web  · 3.9s
>   ✖ web  listen EADDRINUSE: address already in use 127.0.0.1:41720
> ```
> `settled()` and `skip()` had this right; `fail()` was the one shape that didn't, which is the
> usual tell that one idea has two implementations (R26).
>
> The sweep for the rest of it found two more, both the same shape:
> - `check()` — every `doctor` row (`✓ node  v26.0.0`, `✓ JDK  /…/jbr/Contents/Home`). `doctor`
>   is the command a dev opens when something is *already* wrong, so it is the worst one to have
>   looking like a different program — the same reason it was made to share this glyph set.
> - the watcher's pending-rebuild row, which padded BOTH sides of its dot
>   (`! main.swift changed  ·  press b to rebuild`) where every settled row pads two before and
>   one after. A row that hand-spaces its own separator will drift from the ones that don't.
>
> Audited and correct as they are: the live phase row (`⠋ ios  compiling` — the phase sits in the
> content column the artifact/reason later settles into), `addresses()` and `detail()` (indented
> sub-blocks under a row, not rows), and the non-TTY pending marker (`  · web`), whose dot is in
> the GLYPH column standing in for the ✓/✖ that follows, not a separator.

**R12 — `--verbose` is the raw escape hatch.** It streams unfiltered tool output. Every rule in
§3 applies to the calm path only; never "fix" noise by making `--verbose` quieter. **The raw
write comes FIRST in `report()`, above the phase gate** — a filter that runs before it is a
filter on the raw path.
> Violated by `report()` in BOTH `runLine` and `runLanes`, which read
>
>     const pretty = prettyLine(line)
>     if (!pretty) return          ← returns before the verbose write
>     pending = pretty
>     if (verbose) out(`    ${c.dim(line)}\n`)
>
> so every line R24 suppresses was suppressed from `--verbose` too. `adaptv build web
> --verbose` in the playground printed **6** dim lines against a 329-line `vite build` stream —
> no bundle listing, no chunk-size warning, no SSR build, none of the tool banners:
>
>     ⠿ ·  web
>         [2Ktransforming...
>         rendering chunks...
>         transforming...
>         rendering chunks...
>         [2Ktransforming...
>         rendering chunks...
>     ✓ web  .output/public · 4.1s
>
> `build ios --verbose` printed **50** against xcodebuild's 336, and `** BUILD SUCCEEDED **`
> was one of the lines it dropped. Moving the write above the early return makes both streams
> the tool's own, line for line. R10's width rule does not apply here: this is §3, and §3 is
> the calm path.

**R55 — Never take the dev's screen. Show the device; don't raise its window.** A run puts the app
in front *inside* the device and stops there. Which desktop window has the keyboard is the dev's,
and a build they started so they could keep working is the worst moment to take it from them.
> Reported as: the iOS Simulator jumping to the foreground on every `dev ios` / `preview ios` /
> `build ios`, and again on every `r` reload — mid-keystroke, in the editor, several times a
> minute. The Android emulator never did this, so the same command behaved like two different
> tools depending on the platform.
>
> Two causes, both `open` without `-g`. adaptv's own was easy (`open -a Simulator` after a
> launch → `ensureDeviceWindow`, which now passes `-g`: the window still *exists*, for a device
> booted headlessly with `simctl boot`, but it opens behind whatever is in front). The other is
> inside a dependency: Capacitor's `cap run ios` shells out to `native-run`, which runs
> `open <Xcode>/Applications/Simulator.app --args -CurrentDeviceUDID <udid>` verbatim, with no
> flag to turn it off. `native-run` spawns `open` by NAME, so adaptv puts a one-line `open` of its
> own at the front of that subprocess's PATH (`withBackgroundSimulator`, scoped to `cap run`'s
> env alone — it cannot leak into the dev's shell). It adds `-g` to the Simulator call and passes
> every other `open` through untouched.
>
> Android is untouched and always was: no `.app` to `open`, and neither adb nor the emulator
> expose a "raise this window" command — only OS-specific window-manager hacks that need extra
> permissions and don't exist uniformly across the Linux/Windows hosts Android dev also runs on.
> The fix made iOS behave the way Android already did, which is the direction that rule points.

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
>
> A syscall is not the reason either. A `.adaptv/android` copied by something that drops file
> modes leaves `gradlew` without its exec bit, nothing runs, so there is no tail to pick from,
> and the row was Node's own message:
> ```
> ✖ android  spawn /Users/arrz/…/chopchop/.adaptv/android/gradlew EACCES · 3ms
> ✖ android  spawn ./gradlew EACCES · 1.2s          ← the same file, through the native runner
> ```
> adaptv owns that file, so every prepare gives the bit back (`restoreGradleWrapperMode`) and
> the failure mostly stops existing. When the restore cannot happen, `notExecutable` says what
> is wrong with the file and the action that still works:
> ```
> ✖ android  .adaptv/android/gradlew is not executable · 3ms
>     Delete .adaptv/android and run again. adaptv regenerates it.
> ```

**R14 — Detail appears once**, dim, grouped under that platform — or only under `--verbose`.
Never a second glyph, never a raw dump in the calm path.
> Violated by gradle: `✖ android  > Task :app:checkDebugAarMetadata FAILED` followed by a
> seven-line block (`FAILURE:` / `Build failed with an exception.` / `* What went wrong:` / …).
> Two faults at once — the reason named the task rather than the cause, and the cause
> (`Could not find dev.arrz.doesnot:exist:1.2.3.`) had been cut from the tail entirely by a
> fixed 3-line capture window. Gradle nests causes and the **deepest** `>` line is the
> actionable one; `gradleCause()` in `bin/lib/tool-log.mjs` walks to it, and `errorTail()`
> keeps the whole `* What went wrong:` section rather than a fixed window.

**R61 — A tool's inventory is not a diagnosis, and the dev's own screen must be answered.**
When xcodebuild cannot resolve a destination it answers with every destination it knows — one
~190-column brace record per device, each carrying `error:`, which is exactly the shape
`errorTail()` keeps. So the dim block under the `✖` stopped being sentences and became a data
structure, while the line the build actually failed on said only that a specifier missed.
> Violated by `preview ios` on a machine whose Xcode was missing the iOS platform:
> ```
>   ✖ ios  Unable to find a destination matching the provided destination… · 3.6s
>     { platform:iOS, arch:arm64e, id:00008140-001615581A10801C, name:iPhone de arrz, error:iOS 26.1 is not installed. Please download and install the platform from Xcode > Settings > Components. }
>     { platform:iOS, id:dvtdevice-DVTiPhonePlaceholder-iphoneos:placeholder, name:Any iOS Device, error:iOS 26.1 is not installed. Please download and install the platform from Xcode > Settings > Components. }
> ```
> Three faults in five lines. The reason clipped mid-phrase and named a *specifier*, which is
> not a thing the dev typed. The detail was two identical records of a device they had not
> chosen — and the one fact worth having (`iOS 26.1 is not installed`) was buried at column
> 100 of both. And it contradicted adaptv's own picker, which had listed six working
> simulators seconds earlier: the list comes from the simulator service and was right, while
> a *build* needs a platform Xcode installs separately and can be missing while every
> simulator on the machine still boots. Nothing on screen said so, so the CLI read as broken.
>
> The records must stay in the TAIL — the reason is written nowhere else, and
> `explainLaunchFailure()` reads it from there. What changed is what prints: one sentence
> (`Xcode is missing the iOS 26.1 platform`), a fix that is a command
> (`'xcodebuild -downloadPlatform iOS'`), and a line answering the question the dev is left
> holding (*the simulators still boot without it. Only building needs it, which is why they
> were listed*). `isDestinationEntry()` in `bin/lib/tool-log.mjs` names the shape;
> `explain.mjs` drops it from the detail so a future rewording cannot dump it again.
> `--verbose` is untouched.

**R64 — A block that spans more than one line is separated from what follows; single lines are
not.** A step that hangs anything under it — addresses, dim detail — is a GROUP, and a group has
to end somewhere the eye can see. Steps with nothing under them read fine back-to-back and stay
that way; the blank line is earned by having sub-lines, not by being a step.
> Reported from `dev all`. Three faults, one shape:
> ```
>   ✓ web  · 4.9s
>     local    http://localhost:41730
>     network  http://192.168.1.23:41730
>   ✓ ios  iPhone 16 Pro (simulator) · 41.7s      ← runs straight into the addresses
>   ✓ android  Pixel 10 (emulator) · cached · 365ms
>
>   ! adaptv source change  · press b to rebuild and see the changes
>   r reload js   b rebuild app   ctrl-c stop     ← the notice sits ON the actions
> ```
> and, from a `dev all` that had to ask:
> ```
>     network  http://192.168.1.6:41730
>   Choose a android device                       ← a whole prompt glued to a sub-line
> ```
> The engine owns it, not the call sites: a command says a step settled, never that a blank line
> is now due (R26). `render.mjs` remembers that the last thing printed was a sub-line and closes
> that group before the next top-level row — a step, a `!`, a lane block, the watcher. A picker
> is a group in its own right (question, rows, key hint), so it opens with the same gap whatever
> came before it.
>
> **A blank row has to be a real row.** The watch block had always composed itself as
> `[notice, "", keys]`, and the blank never reached the terminal: Ink measures a
> `<Text></Text>` as no rows at all. The tests missed it because their screen helper filtered
> blank lines out before asserting — so the one row the block was wrong about was the one row
> that could not be seen. `" "` is a row; `""` is not.

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
> Violated a second way by a thrower, not a filter: a three-sentence `new Error(…)` with no
> `detail` is ONE line to the renderer, so `runLine` clipped the whole diagnosis to
> `✖ web  dev server at http://localhost:41730 is…`. A reason is a phrase; anything after the
> first clause belongs in `detail`. An error that knows more than one sentence's worth carries
> the rest as `err.fix`, which `explainFailure` files dim underneath.

**R56 — Never state a cause you did not check.** A probe that returns a boolean cannot tell
"nothing answered" from "the app answered 500", so the one sentence written for both asserted the
wrong one and sent the dev after a process that did not exist. If the code cannot distinguish the
causes, either distinguish them or describe only what was observed.
> Violated by the dev server's warm probe. A stale `playground/node_modules` left a TanStack
> `start-server-core` too old for the vite plugin beside it; every SSR request threw
> a missing virtual module on every SSR request, the server answered 500 for the full 30s, and
> the CLI said:
> ```
>   ✖ web  dev server at http://localhost:41730 is… · 33.0s
> ```
> — clipped from *"…isn't responding. Another process is likely using that port."* The port was
> ours. `warmDevServer` now returns a verdict (`unreachable` | `error` + status | `thin`), and the
> port advice is attached ONLY to the two verdicts it can be true for.

**R57 — A stream nobody is reading is a stream that is lying to you.** When a subprocess's output
has no sink yet, the CLI is blind for exactly as long as that lasts — and startup is when things
break. Capture from the first byte; wire the live consumer up later if you must.
> Same failure as R56, and the reason it was unexplainable rather than merely misworded. Vite had
> already written the real cause to its own stderr, but `dev`'s `onDevLine` is not assigned until
> the watch phase ~500 lines later, so `onLine: (l) => onDevLine?.(l)` discarded every line the
> server produced while starting and warming. A rolling `devLog` now records from the moment the
> server spawns and becomes the failing error's `tail`, which is why the ✖ can name the module.

**R58 — Detail is deduplicated by MEANING, not by string.** One fault repeated with different
prefixes is still one fault, and three copies of a 200-column line under a `✖` is not detail.
> Violated on the way to fixing R56: a server that answered 30s of probes logged its stack once
> per request, and Node files the same sentence under `cause:` beneath the `Error:` it explains,
> so the first fix printed the same 200-column store path three times. Detail lines are now
> compared through `toolErrorParts` and dropped when they mean what the `✖` already says. The
> first fix ALSO split `Cannot find module 'x' imported from '<absolute path>'` like a compiler
> locator (R13) and put the importer's package on the dim line — see R8b for why that half was
> wrong, and why the importer is now dropped entirely.

**R59 — Every wait the dev can notice has a row, and every wait has a ceiling.** A stretch of the
run with no live line reads as "nothing else is going to happen", and an unbounded wait on a
platform service turns that into a hang the dev can only escape with ctrl-c. Resolving the device
was the last such stretch: the web row settled, and the CLI then sat inside the device listing —
prefetch included — with nothing on screen until the picker appeared.
> Reported as `adaptv dev ios` producing this and then stopping, with no simulator ever opening:
> ```
>   adaptv · dev ios
>   ✓ web  · 4.0s
>     local    http://localhost:41730
>     network  http://192.168.1.7:41730
> ```
> The owner read it as web being the only service that ran. The cause was outside adaptv — macOS's
> `simdiskimaged` had wedged, so `simctl` never returned — but "a platform daemon stopped
> answering" is a state a dev machine reaches, and the CLI owns what it says while it happens. The
> listing now runs under a transient row (`looking for devices`) and `capture()` takes a
> `timeoutMs`, so a service that has stopped answering fails the platform with a reason and the
> command that fixes it instead of waiting forever. The row is DEFERRED by 400ms: a listing is
> normally 176-279ms, and mounting a region for that long is a blip, not information.

**R60 — A picker row must carry whatever tells it apart from its neighbours.** Options are
disambiguated by data, never by position. `select` has always accepted a `hint`, and `devices.mjs`
has always passed one — the picker simply never drew it, which stayed invisible while exactly one
runtime was installed.
> With iOS 18.0 and 26.1 both installed, the list was pairs of identical rows:
> ```
>       iPhone 16 Pro (simulator)
>     › iPhone 16 Pro (simulator)
>       iPhone 17 Pro (simulator)
> ```
> The hint is dim, follows the label behind a `·` (R25), and stays dim on the highlighted row —
> it is metadata about the device, not part of its name. A device with nothing to disambiguate it
> gets no hint rather than a filler one.
>
> **And both platforms must state the same KIND of fact.** Upstream they do not — the field is
> spelled `iOS 26.1` on one side and `API 34` on the other, a version beside an SDK level, which
> is not what the dev chose the device by. `API 34` is printed as `Android 14`. Two things were
> only found by running it: the iOS string already carries its platform, so decorating it printed
> `· iOS iOS 26.1`; and levels now arrive with a minor part (`API 36.1`, and a real emulator here
> reporting `API 37.1`), so the MAJOR names the release. A level with no entry keeps its own
> spelling — an unrecognised one still tells two rows apart, and inventing a version number for a
> release adaptv has never seen would be worse than saying less.

**R62 — One row per device. A repeat is not a choice.** The device listing walks the installed
runtimes and collects each one's devices, and two runtimes can share an identifier — so the same
simulator is collected twice and offered twice.
> Reported after `xcodebuild -downloadPlatform iOS` installed iOS 26.1 build 23B86 next to the
> 23B80 already there. Both call themselves `com.apple.CoreSimulator.SimRuntime.iOS-26-1` (even
> `simctl list devices` prints two `-- iOS 26.1 --` sections, the first empty), and the picker
> became 59 rows for 36 devices:
> ```
>       iPhone 16 Pro (simulator) · iOS 18.0
>       iPhone 16 Pro (simulator) · iOS 26.1
>     › iPhone 16 Pro (simulator) · iOS 26.1
> ```
> Worse than the ambiguity R60 fixed, and not fixable the same way. There, two rows meant two
> devices and a hint could separate them; here both rows carry the same NAME, the same version
> **and the same id**, so no hint can exist and either pick is the same pick. The dev is left
> asking what the difference is when there is none. `dedupeTargets()` in `bin/lib/devices.mjs`
> keys on id and keeps the first, so the listing's own order stands.

**R63 — A picker shows a window, not a list.** Six rows at a time, with a dim count of what is
hidden above and below. The dev scrolls inside the window; the question and the key hint stay on
screen the whole time.
> With two iOS runtimes installed the picker drew all 36 simulators — a 38-line block, taller
> than a terminal pane, so `Choose a ios device` scrolled off the top and the dev arrowed through
> a wall of names with nothing on screen saying what was being asked.
> ```
>   Choose a ios device
>
>     › iPhone 16 Pro (simulator) · iOS 18.0
>       iPhone 16 Pro Max (simulator) · iOS 18.0
>       iPhone 16 (simulator) · iOS 18.0
>       iPhone 16 Plus (simulator) · iOS 18.0
>       iPhone 14 Pro (simulator) · iOS 18.0
>       iPhone SE (3rd generation) (simulator) · iOS 18.0
>       ↓ 8 more
>     ↑↓ move · ↵ select · esc cancel
> ```
> The window is **sticky**: it holds still while the cursor moves inside it and follows only
> when the cursor would leave, so the rows being read do not move. Recentring on the cursor
> every keypress scrolls on every press and leaves nothing fixed to read against.
> `scrollTo()` in `bin/ui/live.mjs` is that arithmetic, and it is pure so it can be tested
> without a terminal.
>
> **Both marker lines are drawn whenever the list is windowed** — blank when that end holds
> nothing, as above. Drawing a marker only when it has a count changes the block's height at
> either end of the list, and every row jumps a line under a cursor that never moved. A list
> that FITS gets no markers at all: `confirm()` is a two-option `select`, and a reserved blank
> under every yes/no would be a line adaptv prints for nothing.

**R65 — A picker is drawn on the SAME grid as everything else.** It is a list of rows in the
body of the page, not a widget with a layout of its own. Four things put it off that grid at
once, and all four are the general rule rather than the picker's own taste:
> ```
>   Choose a ios device
>
>     › iPad (10th generation) (simulator) · iOS 18.0
>       iPad (10th generation) (simulator) · iOS 26.1
>       iPad (A16) (simulator) · iOS 26.1
>       ↓ 29 more
>     ↑↓ move · ↵ select · esc cancel
> ```
> — **the cursor was not in the glyph column.** `›` sat where a label goes and every device name
> started two columns to the right of every `✓ web` on the page. The cursor IS that row's glyph.
> — **the hints rode on the label,** so `· iOS 26.1` landed at a different column on all 36 rows
> and the one fact that tells two rows apart was the hardest thing there to scan. The CLI already
> aligns a list's right-hand side (`addresses()` pads its keys, `doctor` lays out a table).
> `hintColumn()` in `bin/ui/live.mjs` is that width, and it gives up — ragged, rather than
> wrapped — when an aligned row would not fit the terminal.
> — **the metadata opened with one space,** where every other row in the CLI opens with two and
> a `·` (R31).
> — **the keys were flat dim text.** `↑↓` and `↵` are pressable, and `theme.mjs` names those two
> characters as the example of `ROLE.key`; the watch block has always drawn `r reload js   b
> rebuild app   ctrl-c stop` that way. This was the one place in the CLI where a key you can
> press did not look like one.
>
> The question is lowercase and ends in `?`, which is the voice `confirm()` already asks in
> (`replace 27 icons in ./public/favicons?`). `Choose a ios device` was also the only line of
> adaptv's output with an article it could not get right.
> ```
>   which ios device?
>
>   › iPad (10th generation) (simulator)  · iOS 18.0
>     iPad (10th generation) (simulator)  · iOS 26.1
>     iPad (A16) (simulator)              · iOS 26.1
>     ↓ 29 more
>   ↑↓ move   ↵ select   esc cancel
> ```

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

**R30 — A command that gives up early prints ONE `✖` and LEAVES.** The verdict footer R18 keeps
is for a run that reached its lanes and has more than one outcome to total up. When the command
aborts before that — the shared web bundle didn't build, no platform could be prepared — there is
exactly one thing that went wrong, its `✖` is already on screen, and a closing line can only say
it again. And having given up, the command must **exit**: a run that launched nothing may not hold
the terminal.
> Violated by `preview all` when the bundle build failed:
> ```
>   ✓ web  · 3.6s
>       local  http://localhost:41710
>   ✖ web  listen EADDRINUSE: address already in use 127.0.0.1:41720
>
>   nothing was rebuilt or launched · 3s
>
>   ctrl-c stop
> ```
> Two faults from one shape. The footer restated the `✖` above it, and `pipeline()` reported
> the abort by *returning*, so `preview all` went on to hand the terminal to the watcher —
> offering `ctrl-c stop` for work that never started, one line under a sentence saying nothing
> had started. The abort now returns `{ ran: false }`, the caller stops the server it started
> and exits 1, and the output ends at the `✖`. A run that DID reach the devices still holds:
> the web surface is up and worth using even when a platform failed.

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
>
> Blank lines are the engine's too. Each block closes with one (`header`, `flushNotices`, a
> finished command) and the next opens after one, so at every seam two of them ask for the
> same gap — `spacer()` is therefore idempotent, and a run with nothing to warn about starts
> where a run with two `!`s does. Commands never count blank lines to compensate.

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
>
> Also violated by the line that block REPLACED, left behind in `dev`:
> ```
> ✓ web  · 5.5s
>     local    http://localhost:41710
>     network  http://192.168.1.25:41710
>     network  http://192.168.1.25:41710
> ```
> `addresses()` already printed the network row; a leftover `detail("network  …")` further
> down the command printed it again. When a block primitive takes over a fact, DELETE the
> old print — an address that appears twice reads as two servers.

**R28 — The web surface is called `web`, everywhere, and settles exactly once.** Not
`web build`, not `web bundle (first run)` — one surface, one name, in every command that
touches it. A bundle built so that something *else* can ship (the `cap sync` copy in `dev`,
the native lineage in `build`/`preview`) is a SUB-ACTION: it renders live under the same
`web` label and is erased, never settled (R1). Only a web surface the dev can actually open
settles a `✓ web` line.
> Violated by: `preview web` printing `✓ web` while `preview all` printed `✓ web build` for
> the same idea — and by `dev ios` on a first run printing `✓ web bundle (first run)` above a
> later `✓ web` for the dev server. Three names, and in `preview all` two settled `web` rows
> for two different things. Making the shared bundle transient is what lets the name be the
> same in all three: there is never more than one settled `web` line to collide with.

**R29 — In an `all` run, `web` goes FIRST.** The web bundle is the app's own JavaScript, so a
broken bundle fails there in seconds instead of after two native builds; and the surfaces stay
one uninterrupted block under one banner.
> Violated by:
> ```
> adaptv · preview all
>   no ./assets/logo.png — using the launcher icons already in the project.
>   ✓ ios      iPad (10th generation) (simulator) · 12.9s
>   ✓ android  Pixel 10 (emulator) · 6.4s
>
>   ✓ web  · 4.1s
>       local  http://localhost:41710
> ```
> `web` last, and behind a blank line — the closing gap of the native run — so it read like a
> second command that had somehow started on its own. The web server now comes up first and
> stays up while the devices build; the terminal is handed to the watcher only once every
> surface has settled. A command composed of two halves passes `embedded: true` to the inner
> one so the banner and the closing gap belong to the command, not to a half of it.

**R32 — Nothing starts SERVING until every build has finished.** R29 puts `web` first, and the
obvious reading of it — start the server, then build the rest — is wrong. A command may run more
than one vite build (`preview all` builds the web lineage and the capacitor one), and a build
cannot run while a server for the same app is up: a vite config is free to PIN ports for what it
starts (a `cloudflare({ inspectorPort })`, an HMR socket), and the second process cannot bind
them. It doesn't even take a long-running server in the config — TanStack's prerender step starts
its own `vite preview` inside the build to crawl the routes. So: build, build, *then* serve.
> Violated by:
> ```
> adaptv · preview all
>
>   ✓ web  · 4.0s
>     local  http://localhost:41710
>   ✖ web  · listen EADDRINUSE: address already in use 127.0.0.1:41720
> ```
> Reported as "the web server appears running in 41710 correctly but this error appears wtf" —
> which is exactly what it says. Two settled `web` rows for two different things (R28): the ✓ is
> the server, which was fine and stayed up; the ✖ is the native bundle's build, killed by a port
> **the dev never chose and adaptv never mentions** — it belongs to a plugin in their own
> `vite.config.ts`, and the run above is the only thing that ever puts two vite processes on one
> app. Ordering is the fix; `pipeline`'s `onBundleReady` hook is where the server now starts, and
> `✓ web` still lands above the device lanes because the build row is transient either way.
>
> The wording is the other half. `listen EADDRINUSE: address already in use 127.0.0.1:41720` is
> Node's sentence, not adaptv's: it names an address, a port and no action (R13). One explainer
> (`portInUse` in `tool-log.mjs`) now says `port 41720 is already in use` for the dev server, the
> preview server and a build alike, with what to do underneath — the dev-server copy used to
> offer `-- --port <n>`, advice that cannot work when the busy port is a plugin's pinned one.

**R47 — Take a live region down with ERASE, then unmount. Never the other way round.** Ink keeps
its last frame on screen when it unmounts, by design — right for a UI that IS the output, wrong
for every region adaptv mounts, all of which are transient. After unmounting there is nothing
left to clear, so the region survives and whatever prints next lands underneath it. The order
was got wrong twice, in two components, and the two failures looked nothing alike:
> ```
>   ⠴ web  preparing
>   ✓ web  · 6.4s
>   ⠙ ios  launching device
>   ✓ ios  iPhone 16 Pro (simulator) · cached · 419ms
> ```
> In `liveRows` the spinner rows stayed and every step appeared twice. In the watch block
> nothing looked wrong at all — the surviving block silently pushed the screen down by its own
> height, and `rewindLines` (which counts back a FIXED number of rows so `r`/`b` redraw the
> platform lines in place) landed that many rows short and rebuilt underneath its own history:
> ```
>   ✓ ios  iPhone 16 Pro (simulator) · cached · 366ms
>   ✓ ios  iPhone 16 Pro (simulator) · reloaded · 369ms
>   ✓ ios  iPhone 16 Pro (simulator) · 21.4s
>   ✓ android  Pixel 10 (emulator) · 6.1s
> ```
> One `eraseRegion(app)` in `bin/ui/live.mjs`, used by every region, so there is one place to be
> right. Any cursor arithmetic elsewhere on the page depends on it.
>
> **A component must not unmount ITSELF.** The third time this broke, the call order at the erase
> was already correct — the picker had simply answered a keypress with Ink's `useApp().exit()`,
> which unmounts, so the region was gone (and its height forgotten) before `eraseRegion` ran and
> erased nothing. Every answered question stayed on screen, stacked above the run it had started:
> ```
>   Choose a ios device
>       iPad (10th generation) (simulator)
>     › iPhone 16 Pro (simulator)
>     ↑↓ move · ↵ select · esc cancel
>   Choose a android device
>     › Pixel 10 (emulator)
>     ↑↓ move · ↵ select · esc cancel
>   ⠏ ios  linking plugins
>   ⠏ android  building app
> ```
> A keypress RESOLVES A PROMISE and nothing else — no `exit()`, and no state push either, since a
> re-render after the take-down redraws the list. The region is still mounted when `eraseRegion`
> reaches it, which is the only state from which it can be erased.
>
> **And nothing may be left PENDING when the erase runs**, which is the same failure arriving
> from the other side. Ink's frame-rate cap (`maxFps`, 30 by default) defers a render into a
> trailing timer, and `unmount()` re-renders — so a region whose last two updates landed inside
> one frame had its pending frame painted back over the screen the erase had just cleared, and
> then forgotten, where nothing can ever erase it again:
> ```
>   ⠹ ios  linking                                  ← repainted by unmount, AFTER the erase
>   ✓ ios  iPhone 16 Pro (simulator) · 21.4s
> ```
> Two `phase()` calls a few ms apart before the step returns reproduce it — an ordinary sequence
> when a tool's last line arrives just before its command exits — and it leaked on 20 runs out of
> 20 through a pty. Every region mounts with the shared `REGION` options (`maxFps: 0`), so no
> render is ever outstanding. The cap was never doing the pacing anyway: phases are SAMPLED
> rather than followed (R24), the bus drops an update that changes nothing, and the spinner has
> its own clock. It paced nothing that wasn't paced already, and made the erase racy.
>
> Note what this costs to test: an erase is a frame with no text in it, so "the last frame is the
> screen" says *empty* whether the region went away or is still there, and the first version of
> this test passed against the bug. `bin/ui/live.test.mjs` replays the frames — erases included —
> and asserts on what is LEFT.

**R48 — A live row only moves FORWARD. A phase is shown once.** The row shows the last phase
reported and silence changes nothing; it never returns to a phase it has left, because going
back says the work is being redone. There was an idle fallback — after `IDLE_MS` of quiet the
row dropped to a per-lane `idle` label rather than freeze on a stale tool line — and on every
native build it read as a restart:
> ```
>   ⠴ ios  building app        ← the pause before xcodebuild speaks
>   ⠴ ios  compiling
>   ⠴ ios  building app        ← quiet again
>   ⠴ ios  processing resources
>   ⠴ ios  building app
> ```
> A first fix made that label track the current stage instead of a constant. It cured the case
> where it was an outright lie (`building app` during the silent install) and did nothing about
> the repetition, which was the complaint — so the fallback is gone entirely. A frozen `linking`
> is not misleading: the spinner is what says the row is alive, and the last thing the tool said
> is the most specific true statement available.
> ```
>   syncing → installing dependencies → building app → compiling → launching device
> ```
> Honesty is now the CALLER's job, which is the other half of this. `cap run` builds, installs,
> then launches, and `report("launching device")` before it named the last step first — so the
> row claimed to be launching through twenty seconds of compiling. **Announce what STARTS**, and
> announce again when the work actually changes.

**R49 — A prop Ink does not know is dropped in SILENCE. Check the bytes on a pty.** The whole
live layer rendered flat white for the entire Ink port — no cyan spinner, no yellow `!`, no dim
phase — because the roles carried `{ ink: "cyan" }` and the components spread that into
`<Text>`, which takes `color`. `dim` was wrong the same way; Ink's prop is `dimColor`:
> ```
> before   ⠋ ios  compiling                      ← no escapes at all
> after    \x1b[36m⠋\x1b[39m ios  \x1b[2mcompiling\x1b[22m
> ```
> It looked deliberate rather than broken, because `bold` IS a real prop and came through, so
> the rows were merely flat. **The unit tests cannot catch this**: chalk fixes its colour level
> from the real stdout when it is imported, and a fake stdout is not a terminal — so under
> vitest Ink strips every colour whatever the props say, and an assertion there measures the
> harness. `scripts/check-colour.mjs` runs the components under a pty and greps the bytes; run
> it after touching `theme.mjs` or any component's props.

**R50 — Never suggest the word that was just typed, and never make a namespace a command.**
`adaptv gen` answered:
> ```
>   ✖ unknown command 'gen' — did you mean 'gen'?
> ```
> Two faults in one line. `commandNames()` returns `path[0]`, so the two-word `gen icons`
> contributed the candidate `gen` and `suggest()` matched it at distance 0. And `gen` was a
> namespace the dev could type but not run, which is a command that exists only to fail.
> `gen icons` is now **`adaptv icons`**: there was only ever one thing to generate, so the
> namespace bought nothing. `suggest()` also drops an exact match outright, so the next
> two-word command cannot bring the suggestion bug back.
>
> It first shipped with a `retired` table that answered `'gen icons' was renamed. Try 'adaptv
> icons'`. That came straight back out. **adaptv has never been published** — `private: true`,
> no tag, nothing on npm — so no install anywhere carries the old spelling, and the migration
> path was ceremony for a consumer who does not exist. Write one with the first release. Until
> then a renamed command is simply unknown, and the rule generalises: back-compat machinery
> before there is anything to be compatible with is dead code that reads as caution.

**R51 — `where` is a TRAILING clause. It cannot open a sentence.** `renderFault` builds
`where = " for 'dev'"` for the tail of a did-you-mean, and two branches used it as the subject:
> ```
>   ✖ for 'dev' does not take '192.168.1.5'
>   ✖ for 'icons' needs '--input': the png or svg to generate the whole set from
> ```
> Both now name the command directly. Fixed once in `excess-args` and missed in `missing-flag`,
> which is the usual shape of this: the same helper misused in every branch that borrowed it.

**R52 — The step that can PROVE the app runs first.** A run is ordered by what each step tells
the dev, not by what the next step happens to need. `dev all` scaffolded the native projects
before it started Vite, so a first run showed this, and only this, for **81 seconds**:
```
  adaptv · dev all

  ⠴ ios  installing pods
```
> One platform, no web surface, nothing yet known about whether the app even compiles — and
> then `android` alone after it, because the scaffolding loop is sequential. Measured on a real
> first run: started 01:14:00, `.adaptv/ios` finished 01:15:21, `.adaptv/android` at 01:15:24,
> dev server after that.
>
> It was in that order for a reason, which is the part worth remembering: the dev server has to
> decide whether to bind `0.0.0.0` before it starts, that was decided by asking whether a
> physical device was in play, and every way of asking runs `cap run <platform> --list`, which
> refuses until the native project exists. A cheap question at the front of the run had quietly
> made the most expensive step a prerequisite of the cheapest one. The fix is to stop asking:
> any native run binds for the LAN, which was already documented as harmless (a simulator
> reaches the app on localhost either way), and Vite now comes up first. Captured through a pty
> on a real first run (`rm -rf .adaptv/ios .adaptv/android`):
> ```
>     0.7s  adaptv · dev all
>     1.0s  ⠋ web  preparing
>     7.9s  ✓ web  · 7.1s
>             local    http://localhost:41730
>             network  http://192.168.1.25:41730
>     7.9s  ⠋ ios  preparing            ← the native work starts against a server already proved
>    12.4s  ⠋ android  preparing
>    15.6s  ⠋ ios  syncing / ⠋ android  syncing      ← lanes, concurrent
>    57.5s  ✓ ios  iPhone 16 Pro (simulator) · 46.4s
> ```
> The cost is stated rather than hidden: a simulator-only `dev` listens on the LAN too, and the
> address block says so. When a dependency like that forces a bad order, question the
> dependency — reordering around it just moves the wait somewhere else.
>
> Scaffolding is still SEQUENTIAL across platforms (`ios` at 7.9s, `android` at 12.4s), which is
> the remaining half of this. Only the lanes below it are concurrent.

**R53 — A URL that arrives in a second chunk is still the URL.** Vite prints `Local:` and
`Network:` as one write, and `startDevServer` matched both against the single `data` event that
carried `Local:`. When the pipe split them the promise had already resolved, `networkUrl` stayed
null on a server that WAS bound to `0.0.0.0`, and the address block silently lost a row:
```
  ✓ web  · 6.9s
    local  http://localhost:41730          ← and nothing for the phone on the same Wi-Fi
```
> Intermittent, which is the tell — the same command printed the `network` row on one run and
> not the next. It matches the accumulated output now, and when adaptv asked to bind every
> interface it gives the second line one 250ms beat before settling for what it has. R52 is what
> made this urgent: `--host` used to be the rare physical-device case and is now every native
> run, so a row that goes missing one run in five goes missing in front of everyone.

**R66 — Name the directory the command WROTE, never the one it usually writes.** `adaptv build
web` reported the SPA/native lineage's directory after an SSR build that had not touched a byte
of it:
```
  adaptv · build web

  ✓ web  .adaptv/web · 4.2s      ← it wrote .output/public, and .adaptv/web still held a
                                   bundle from before the config was edited
```
> Twenty minutes of debugging went into the wrong directory, and the same constant was ALSO
> handed to `writeChannel`, so the update channel was written where no deploy uploads it —
> "published" in the CLI's report, 404 on every installed device. Where a build lands is not
> adaptv's to assume: `render: "ssr"` is assembled into `.output/public`, `render: "spa"` into
> `dist/client`, and only the Capacitor lineage into `.adaptv/web`. The build writes down where
> it wrote (`src/vite/build-stamp.ts`) and the CLI reads it back. When there is no stamp the
> line carries no location at all — a location is a fact, and a plausible one is worse than
> none, because it is the plausible one the dev goes and looks in.

**R67 — A phase adaptv chose for itself is a REGISTERED phrase, or it is nothing.** `prettyLine`
is a filter for what xcodebuild, gradle and the bundler print, and adaptv's own words only
survive it by being in `OWN_PHASES` (`bin/ui/theme.mjs`). Eight call sites reported a phrase that
was not in that set, and every one of them rendered as the empty string — the live row held its
previous phase and adaptv went quiet through a step it was performing:
```
  ⠴ ios  preparing        ← said for the whole of `cap add` + CocoaPods, minutes of it;
                            the step was reporting `scaffolding native project (first run)`
  ⠴ web  preparing        ← said through the dev server's whole settle;
                            the step was reporting `<url> · warming`
```
> Each was erased by a different rule written for a build tool, which is why none of them looked
> like one bug: `archiving` is a lone verb; `packaging .ipa` names a file; `<url> · warming`
> has a `:` and a `/`; `scaffolding native project (first run)` has parentheses;
> `migrated ./ios → .adaptv/ios` has two paths. R45 added `OWN_PHASES` for exactly this failure
> — its own note says the filter "swallowed adaptv's own words" — and the mechanism shipped
> without these being brought into the set.
>
> **Three more survived by luck**, which is the half of the rule that matters. `looking for
> devices`, `reading the published manifest` and `writing the channel` were outside `OWN_PHASES`
> and reached the row through the filter's last-ditch escape hatch for an unrecognised tool line
> (it starts with a participle, so it is probably a phase). They are on screen today and any
> rewording would have deleted them silently. They are registered now — added to `OWN_PHASES`
> with this rule, which is the only way a phrase may be added: **never one without the other.**
>
> The fix for the rest was to REWORD, not to widen the set. `packaging .ipa` and `archiving` are
> both `packaging`, the word the Android branch already says for the same work. The dev server's
> settle is `starting server`, the word `preview` already says, with the URL back where it
> belongs (its address block, R27). The SPA build is `building app`. A first-run scaffold is
> `preparing · first run` — the phase every row already opens on, with R25 metadata carrying
> the only part the dev cannot see.
>
> **Two of the eight were never phases at all** and no rewording could make them so: a legacy
> `./ios` that adaptv moved, and a configured plugin that is not installed. Both are facts the
> dev keeps after the row is gone, so neither is flashed at a live row. The migration is a `!`
> notice, pushed through the `warnings` channel `preparePlatforms` drains (R33) — it is only
> knowable by looking at the directory, so the step that finds it is its right home.
>
> **The plugin has since moved again, and further — see R68.** A `!` in the notice channel was
> still the wrong home for it: nothing about it needs a native project, and it is not a run
> that merely comes out worse.
>
> `building SPA (ADAPTV_TARGET=capacitor)` was also a **flat R8 violation** — it named the
> engine underneath, in a string bound for the dev's terminal. It never reached one only because
> `prettyLine` was deleting it for the parentheses. A second bug was the only thing keeping the
> first one off screen, and `opacity.test.mjs` could not see it because it tests what reaches
> the row, not what a call site asks for.
>
> Enforced by `bin/lib/own-phases.test.mjs`: it walks every `report()` call site in `bin/`,
> requires the argument to be a plain literal (a template means a path, a URL or a package name
> is being interpolated into a phase — R22), and fails on any whose head is not in `OWN_PHASES`.
> It also fails on a register entry that is a bare noun (R45) or that nothing reports any more.

**R68 — A plugin the dev listed and never installed is an `✖` before the run, on the runs that
use it.** It reached the terminal three ways before it reached the right one. It started at
`report()`, where `prettyLine` erased every byte (R67). It became a `!` in the `warnings`
channel — which was still wrong twice over:

>   1. **It was found in the wrong place.** `injectIosPluginPods` and
>      `injectAndroidPluginProjects` discovered it half-way through a run, with a native
>      project already scaffolded. Whether a package named in the dev's own config resolves
>      is answerable from the dev's own files: no project, no build, no device. R33's test is
>      "was the answer already sitting in a file the dev wrote", and this one was.
>   2. **It was the wrong severity.** `plugins` lists native capabilities the app is going to
>      call. A name that resolves to nothing is declared into no Podfile, no
>      `capacitor.settings.gradle` and no plugin registry — the build succeeds, and the app
>      rejects the very call the entry was written for, on a device, as "plugin is not
>      implemented". That is not a run that comes out worse; it is a run that cannot produce
>      what was asked for. R39 allows one answer to "is this config usable", and a `!` is the
>      softer second answer it already threw out for the `b` key.
>
> It also said one app-level fact **twice**: each injector pushed its own prefixed copy, so
> `build all` printed `ios: plugin '…'` and `android: plugin '…'` for a fact that has no
> platform (R21) — the two share one resolver, and it takes no platform argument. And the old
> sentence ended `, so it was skipped`, which is adaptv narrating its own fallback (R42).
>
> ```
>   adaptv · build android
>
>   ✖ 'plugins' names '@capacitor/camera', which is not installed. Install it, or remove the entry.
> ```
>
> **It is silent on a web-only run**, and that is not a second answer. `preflight` is given the
> command's native platforms and gets `[]` for `dev web` / `build web` / `preview web`;
> `plugins` reaches the native injectors and no web code path. So the rule is scoped, not
> softened: every run that would consume the value refuses, every run that would not says
> nothing. Making it unconditional would stop `dev web` runs with no stake in the plugin, and
> a `!` there would be a native-only sentence on every web command, true and unactionable (R6).
> `iconWarnings` already splits on the same seam — launcher art per platform, the manifest
> half for everyone.
>
> `bin/lib/preflight.mjs` imports the injectors' own `pkgDirResolver` rather than asking the
> question a second way, so what preflight refuses and what a build would silently drop are one
> set by construction. The injectors now skip an unresolvable name in silence: the run never
> gets there with one, and `capSync` calls them from inside a lane where a second sentence
> would be the same fact, out of order (R18).

## 5. Before you ship a CLI change

Tests do not cover any of this. Run it and read it:

- [ ] `adaptv dev ios` — **first run** (`rm -rf .adaptv/ios`) and a warm run
- [ ] `adaptv preview ios` and `adaptv build all` — including a genuine **failure** (force one)
- [ ] a tool that **crashes** rather than fails (occupy the port `ports.ts` pins, then
      `adaptv build android`) — the row must hold its last phase, never show the dump (R70)
- [ ] an `all` run, to check platforms don't interleave
- [ ] the **device picker** path (`rm -f .adaptv/state.json`, no `--target`)
- [ ] a deliberately broken `adaptv.config.ts` (a colour that isn't hex) — every command must
      refuse under the banner, before it builds or serves anything (R33)
- [ ] add a `plugins` entry naming a package that is not installed — `build ios`, `build
      android` and `preview all` each refuse under the banner with ONE `✖`, and `dev web` /
      `build web` run to completion without a word about it (R68)
- [ ] a **first-run scaffold** (`rm -rf .adaptv/ios`) — the row must say `preparing · first
      run`, not sit on `preparing` (R67)
- [ ] `--verbose` still streams raw output
- [ ] keep typing in the editor through an `adaptv dev ios` build and through an `r` reload — the
      Simulator's window may appear, but it must never take the keyboard (R55). Worth doing with
      the Simulator not running at all, which is when `open` would activate it
- [ ] no line wraps at a normal terminal width
- [ ] **watch a native build for 10s** — if the phase text moves more than about once a second,
      or you can read an identifier in it, R22/R23 are broken
- [ ] `adaptv preview web` and `adaptv preview all` — the web server must come up and STAY up
- [ ] `adaptv doctor` — same banner and glyphs as every other command, `Core` carries ONE row for
      adaptv's own install (R71), and no row anywhere names an engine. Then `doctor --verbose`,
      where the names must appear. Break the install to see the `✖` (add a package name that
      cannot resolve to adaptv's own `package.json` `dependencies` — the row is derived from it,
      never from a list in `bin/`): one red row, and no blank line opens up between the next
      heading and its first row
- [ ] `adaptv icons --input <image>` into an **empty** dir, then again into the **populated** one —
      the confirm appears, erases itself on choice, `--yes` skips it, and piping it (no TTY)
      without `--yes` exits `1` on the terse `✖` (R34)
- [ ] `icons` from a **dark mark on a light background** — one `!` naming `--dark`, and the
      set is generated anyway; then pass `--dark <image>` and it goes quiet (R34)
- [ ] `icons` from a **small, opaque** source — two `!`s under the banner, and the set is
      generated anyway; then from a big transparent one — **no** `!` at all (R34)
- [ ] `gen icons --target <image>`, `gen icons --pading 10 <image>`, and `icons` with no
      argument at all — each names the token that is wrong and shows the usage line (R35)
- [ ] `gen icons --input <image>` in an app whose config has **no `icons` key** — it refuses and
      names both ways to fix it, rather than writing into `./public/favicons` (R34)
- [ ] **cancel** the overwrite prompt, and separately **Ctrl-C** it — each ends on a line saying
      nothing was written, never on a bare shell prompt (R37). Same for the device picker.
- [ ] an app with **no icons at all** (`mv public/favicons /tmp`) — the `!` fires ONCE under the
      banner on `dev web` as well as on a native run (R21), and the app wears adaptv's mark
      rather than Capacitor's
- [ ] edit `adaptv.config.ts` **during** a `dev` run — the notice appears within ~3s on its own
      row, with the `r`/`b`/`ctrl-c` row still underneath it (R41); touch a file in the `icons`
      dir for the same notice, and change something native too to see the two merge (R40).
      Save a source file while it is showing: the bottom row animates, the notice holds
- [ ] Ctrl-C while a notice is showing — the whole block is erased, and the settled platform
      lines above it are still there (the block is redrawn and erased as a whole, R41)
- [ ] press **`b`** — the app is rebuilt from the CURRENT config, launcher icons included, and
      it still live-reloads afterwards (the dev server URL survives the config re-stamp)
- [ ] make the config invalid, then press **`b`** — every error prints, the process exits
      non-zero, and teardown ran: `.adaptv/ios/App/App/Info.plist` has no
      `NSAppTransportSecurity` left in it (R39)
- [ ] SIGKILL a `dev ios` run, then start another one — the stranded ATS exception is healed at
      prepare rather than adopted, and reverted again on a clean exit
- [ ] `pnpm typecheck && pnpm biome:check && pnpm test`

Capture output through a pty so live-line rendering behaves as in a real terminal:
`script -q /tmp/out.txt env TERM=xterm-256color pnpm exec adaptv <cmd>`

`pnpm gate` runs biome, typecheck, the suite and the colour probe as ONE command that exits
non-zero. Run it bare. Piping it (`pnpm gate | grep Tests`) reports **grep's** exit code, not
the gate's — that is how a commit went in on this branch while a test was red.

Stop `dev` runs with **SIGINT** (`pkill -INT -f "adaptv.mjs dev"`), never SIGKILL — SIGKILL skips
teardown and strands the dev ATS exception in `Info.plist`.

---

## 6. Adding rules

When the owner reports an output problem, **add the rule here in the same commit as the fix**,
with the violating output quoted. That is what stops it recurring — this file only works if it
grows every time something slips through.
