# adaptv — the CLI's visual language

> **This is the design system. [`CLI-UX.md`](CLI-UX.md) is the regression record.**
>
> They answer different questions. That one says *"why can't I do X"* — 44 rules, each written
> from output the owner had to report, each quoting the offending line. This one says
> *"how do I build something new that looks right"*. Read this before adding a command; read
> that one before changing one.
>
> The executable half of this document is `bin/ui/theme.mjs`. Where the two disagree, the code
> is wrong.

---

## 0. The vision

**The CLI narrates the developer's intent, not adaptv's implementation.**

Someone runs `adaptv dev ios` because they want their app on a simulator. Everything printed
either tells them how that is going, or asks them something only they can decide. Which
Capacitor command ran, which pods linked, which file was regenerated — that is adaptv's
business. The consumer does not know adaptv runs on Capacitor and TanStack (`DECISIONS.md`
L20), and the output must never teach them otherwise.

Three consequences that decide most questions before you have to think about them:

1. **The default is small.** Not "everything, tidied" — the handful of things a dev acts on.
   Every rule in `CLI-UX.md` exists because something true was printed *because it was true*,
   without anyone asking whether the dev needed it.
2. **Detail lives in `--verbose`, and nowhere else.** That is the escape hatch, and it is raw
   on purpose. If you are tempted to add a line "just in case", it belongs there.
3. **The engine decides how things look.** Commands state intent — `runLine("web", …)`,
   `flushNotices(…)`, `fail(label, reason)` — and the renderer chooses the bytes. A command
   that draws its own output is how every inconsistency in this CLI's history started, and
   `bin/lib/engine.test.mjs` fails the build for it.

---

## 1. The grid

```
··adaptv · dev ios          banner        2 spaces, always
                                          blank line between blocks
··! no 'icons' in adaptv.config.ts        notice block
                                          blank line
··✓ web  · 3.9s             a settled row 2 spaces + glyph + space + label
····local    http://…       detail        4 spaces, dim
··✓ ios  iPhone 16 Pro · 20.0s
                                          blank line
··r reload js   b rebuild app   ctrl-c stop
```

- **Body indent is 2 spaces.** Every top-level row. No exceptions.
- **Detail indent is 4 spaces**, and detail is always dim. It hangs under the row it explains.
- **Blocks are separated by exactly one blank line** — banner, notices, steps, watch row. Ask
  for it with `spacer()`, which is idempotent: two adjacent blocks each requesting breathing
  room get one line, not two. Never write `\n\n` by hand.
- **The right-hand column is metadata**, opened by ` · ` — two spaces before, one after.
  `✓ web  · 3.9s`, `✓ ios  · cached`. It is the last thing to be clipped, never the first.
- **Width is `process.stdout.columns` or 80.** Nothing may exceed it. A *live* row clips
  (`clipAnsi`); a *static page* wraps (`wrap`, `table`) — see §5.

---

## 2. Colour and glyphs

Colour is **role**, never decoration. It must survive `NO_COLOR=1` and a non-TTY pipe with no
loss of meaning — which is the test for whether you have used it as decoration.

| Role | Colour | Where |
|---|---|---|
| the brand | **magenta bold** | the word `adaptv` in the banner, once per command |
| success | **green** | `✓` |
| failure | **red** | `✖` |
| something to act on | **yellow** | `!` |
| work in progress | **cyan** | the spinner |
| everything secondary | **dim** | timings, detail, hints, descriptions, paths |
| emphasis | **bold** | a section heading, a key the dev should press, a device name |

Dim carries 35 of the ~70 colour calls in the renderer, and that ratio is the point: **the page
is mostly quiet, and the few bright things are the ones that matter.**

### The glyph set is closed

```
✓   done            ✖   failed           !   you may need to act
⠋…  working         ○   optional, absent (doctor only)
```

**Never `✔ ✗ ⚠`.** A second vocabulary is how `doctor` once ended up looking like a different
program, and `engine.test.mjs` fails the build on those three characters.

**Every notice carries `!`** — there is no glyphless second severity. A line with no glyph reads
as stray output, and the dev is left deciding whether an unmarked sentence is a problem. The
question is not "how bad is this" but "does the dev need to know". If the answer is no, it is
not printed at all.

---

## 3. Voice

- **Lowercase**, always. `compiling`, not `Compiling`. Sentence case only in help headings.
- **Name the fix, not the failure.** `missing 'appId' in adaptv.config.ts` — not
  `run failed — adaptv.config.ts needs an 'appId' for native builds`.
- **Quote a key, flag or command with `'`** — never a backtick. A backtick is markdown; it
  renders as code in this file and as a literal backtick in a terminal, which is where these
  sentences live. Quote a user-supplied *value* with `"` (i.e. `JSON.stringify`).
- **Suggest, never correct.** `— did you mean 'ios'?` and stop. Running the guess for them
  means they never learn the real syntax, and a wrong guess wastes more time than no guess.
  Say nothing when nothing is close.
- **A phase says what is happening, never what it is happening TO.** `compiling`, never
  `compiling · CapacitorSplashScreen`. The vocabulary is closed (`CLI-UX.md` R24) — map a new
  tool verb into it rather than inventing a phrase.
- **A live row never counts.** The spinner already says "alive"; a number ticking in place is
  motion carrying no new information, and it makes a calm page restless. How long it took is
  the SETTLED row's business — `✓ ios  iPhone 16 Pro · 20.0s`, once, when it is a fact.
- **A phase is a present participle, always.** `syncing`, `creating package`, `launching
  device` — never `sync`, `package`, `launch`. A bare noun reads as a command being issued, or
  as a thing rather than an activity, and it sits wrong beside `compiling` and `processing
  resources` on the very same row. The test: it has to finish the sentence *"right now adaptv
  is …"*.
- **Announce what STARTS, not what it ends in.** `cap run` builds for twenty seconds, installs,
  then launches — so the phase before it is `building app`, and `launching device` waits until
  the build has actually finished. Naming the last step first made the row read `launching
  device` through the whole compile.
- **A row only moves forward; a phase is shown once.** It holds the last phase reported, and
  silence changes nothing. Never re-show a phase the row has left — `building app → compiling →
  building app` reads as the build restarting. A row that has gone quiet on `linking` is not
  misleading; the spinner is what says it is alive.
- **Never print an absolute path.** App-root-relative only.
- **Never name adaptv's own plumbing.** Its base Capacitor plugins, its shim, its temp dirs.
  Name only what the dev caused.

---

## 4. The components

Everything the CLI can draw. If what you need is not here, **add a primitive** — do not draw it
in the command.

| Component | Looks like | Use it for | Never |
|---|---|---|---|
| **banner** `header()` | `adaptv · dev ios` | once, at the top of a command | twice; or above a command that then refuses to run |
| **notice** `flushNotices()` | `! no 'icons' in adaptv.config.ts` | something the dev may want to act on, known BEFORE the run | a fact adaptv already handled |
| **live row** `runLine()` | `⠴ web  compiling` | one unit of work with a name | naming a target, task or pod; showing a running clock |
| **lanes** `runLanes()` | one row per platform, concurrent | `all` runs — and single ones too | a different shape for one platform vs two |
| **settled row** | `✓ ios  iPhone 16 Pro · 20.0s` | the outcome of a live row | a second line restating it |
| **failure** `fail()` | `✖ ios  · <reason>` + dim detail | a step that failed | a second `✖` for the same failure |
| **address block** `addresses()` | aligned `local` / `network` | a served surface | inventing an address you did not bind |
| **detail** `detail()` | 4-space dim lines | expanding on the row above | more than ~10 lines — that is `--verbose` |
| **picker** `select()` | arrow-key list, erases itself | a choice only the dev can make | leaving no line behind when cancelled |
| **watch block** `liveWatcher()` | notice row + keys row | the live `dev` session | replacing the keys row with a notice |
| **help page** `helpPage()` | wrapped two-column | `--help` | listing a flag without saying what it is for |
| **invocation failure** `usageFail()` | `✖ …` + dim fix | a command that cannot run | dumping the whole help page |

### The two that are easy to get wrong

**Lanes never interleave.** In an `all` run, a platform's detail sits with its own row, never
after another platform's. This is structural, not a discipline: each lane owns a row.

**A live block is a block.** The watch row is really *notice + blank + keys*, and it is redrawn
and erased as a whole. Every row in it is still clipped to one physical line. Cursor arithmetic
is where this goes wrong — a redraw that rewinds to the top when it is already parked there
walks the block up the screen one row per frame, and the erase then eats the settled lines
above it. That bug shipped once; it is why the block is moving to a layout engine.

---

## 5. Live rows clip, static pages wrap

The single distinction that governs width.

- A **live row** is redrawn in place with `\r\x1b[2K`, so it must occupy exactly one physical
  row. If it wraps, every frame stacks another copy — the cascade. Use `clipAnsi`.
- A **static page** — help, an invocation error — is printed once and never redrawn. Clipping
  it would only cost the dev the end of the sentence, and the end of an error is where the
  instructions are. Use `wrap` and `table`.

`table()` degrades rather than shrinking: below ~28 columns of room for the right-hand column
it stacks the description under the name instead, because a description wrapped into a
four-character gutter is not a table, it is a column of syllables.

---

## 6. Adding a command

1. **Describe it in `bin/lib/cli-spec.mjs`** — the path, its surfaces, and every flag with a
   one-line `describe` saying what it is FOR. The parser, the help page and the suggestions all
   come from that entry; there is nowhere else to register it.
2. **Give every flag a real sentence.** `--force: force` teaches nothing. A test fails the
   build on a description shorter than 12 characters or equal to the flag's own name.
3. **Decide `common` vs `advanced`.** Advanced means *correct by default, only reached for when
   the default guessed wrong* — `--host` is the worked example.
4. **Validate values in the spec's `parse`**, not in the command. It runs before the banner,
   before the config is read, and before anything destructive happens.
5. **Print through the primitives in §4.** If you reach for `process.stdout.write`, stop —
   `engine.test.mjs` will fail, and it is right to.
6. **Say everything you already know before the run starts**, and let it stop the run if it
   must (`CLI-UX.md` R33). Anything only the work can reveal belongs to the step that finds it.
7. **Run it and look at it** — at 40 columns, at 100, with `NO_COLOR=1`, and piped. The test
   suite can check widths and glyphs; it cannot tell you the output reads badly.

---

## 7. What "good" looks like

A first `adaptv dev ios`, end to end:

```
  adaptv · dev ios

  ! ios launcher icon upscaled from 512px — add a 1024px icon

  ✓ web  · 4.6s
    local    http://localhost:41730
  ✓ ios  iPhone 16 Pro (simulator) · 19.1s

  ! config change  · press b to rebuild and see the changes

  r reload js   b rebuild app   ctrl-c stop
```

Seven lines of substance. One banner. One thing to act on, said before the work started. One
row per surface, each settling once. One live block at the bottom that never takes the keys
away. Nothing about Capacitor, nothing about pods, no absolute paths, nothing over 80 columns.

That is the whole target.
