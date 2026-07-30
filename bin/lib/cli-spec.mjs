// The command surface of the adaptv CLI, as data.
//
// This file exists because the surface used to be described in FOUR places — `parseFlags`,
// `usage()`, the header comment of `bin/adaptv.mjs`, and `gen icons`' own flag whitelist — and
// they had already drifted: the header comment omitted `gen icons` entirely (all seven of its
// flags), `--margin`/`--padding`/`--background` appeared in the help prose but not its usage
// line, and `-o` was documented nowhere. That is the same "one idea, several implementations"
// failure the whole of `docs/CLI-UX.md` was written to stop, sitting in the one part of the CLI
// the doc never covered.
//
// So: one description, and everything else derived from it. The parser is built from it
// (`cli-parse.mjs`), the help page is rendered from it, the suggestions are matched against it,
// and two tests in `cli-spec.test.mjs` fail the build if the header comment or a `flags.X` read
// ever drifts away from it again.
//
// DATA ONLY. Nothing here imports commander, imports the renderer, or prints. That is what
// makes it safe for the help renderer and the parser to both depend on it without depending on
// each other.

/* =============================================================================
 * flags
 * ============================================================================= */

/**
 * A flag.
 *
 *   long      the name, without dashes — also the key it lands on in `flags`
 *   short     one letter, or null. Only for genuinely common flags (clig.dev).
 *   value     "<id>" required · "[ip]" optional · null for a boolean
 *   group     "common" | "advanced" — the two sections of a command's help
 *   describe  ONE line, present tense, saying what it is FOR. The owner's complaint was
 *             that the CLI lists flags without ever explaining them; this field is the fix,
 *             so a flag without a real sentence here is a bug.
 *   parse     optional validator, `(raw) => value`, throwing `new Error(message)` on bad
 *             input. Runs DURING parsing, so a bad value stops the command before the banner,
 *             before preflight, and before anything destructive (R33).
 */

const JSON_OUT = {
  long: "json",
  short: null,
  value: null,
  group: "advanced",
  describe:
    "one machine-readable document on stdout and nothing else — for scripts and CI",
}

const QUIET = {
  long: "quiet",
  short: null,
  value: null,
  group: "advanced",
  describe: "outcomes and failures only, none of the narration",
}

const VERBOSE = {
  long: "verbose",
  short: null,
  value: null,
  group: "advanced",
  describe: "stream the raw build output instead of the summarised steps",
}

const FORCE = {
  long: "force",
  short: null,
  value: null,
  group: "common",
  describe:
    "do the work even when nothing changed — reinstall, rebuild, re-sync",
}

const TARGET = {
  long: "target",
  short: null,
  value: "<id>",
  group: "common",
  describe: "launch on a specific device or simulator, by id",
}

const LATEST = {
  long: "latest",
  short: null,
  value: null,
  group: "common",
  describe: "reuse the last device you picked for this platform",
}

//TAKES NO VALUE. It used to accept an optional `[ip]` to pin the interface when detection
//guessed wrong, and that was the wrong shape for the question: nobody wants to look up their
//own LAN address to hand it back to the tool that is already standing on the machine. `lanIp()`
//reads it from the interfaces, skipping loopback, link-local, VPN tunnels and container
//bridges, and the run prints the URL the device will load — so a wrong guess is visible rather
//than something you pre-empt by typing an address you had to go and find.
const HOST = {
  long: "host",
  short: null,
  value: null,
  group: "advanced",
  describe:
    "serve on this machine's LAN address so a physical device can reach it. Automatic when the target is one",
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

/** A percentage flag, validated against its own range rather than silently clamped. */
const pct = (long, max, describe) => ({
  long,
  short: null,
  value: "<pct>",
  group: "advanced",
  describe,
  parse: (raw) => {
    const n = Number(raw)
    if (raw === true || !Number.isFinite(n) || n < 0 || n > max)
      throw new Error(
        `'--${long}' must be a percentage between 0 and ${max} — got ${JSON.stringify(raw === true ? "" : raw)}`,
      )
    return String(n)
  },
})

/** An image path flag — existence is checked later, by the command that reads the pixels. */
const image = (long, describe) => ({
  long,
  short: null,
  value: "<image>",
  group: "advanced",
  describe,
})

/* =============================================================================
 * commands
 * ============================================================================= */

const SURFACES = ["web", "ios", "android", "all"]

export const SPEC = {
  name: "adaptv",
  tagline: "run, preview and ship your app on web, iOS and Android",
  commands: [
    {
      path: ["doctor"],
      summary: "check your machine has what a native build needs",
      args: [],
      flags: [JSON_OUT, QUIET, VERBOSE],
    },
    {
      path: ["dev"],
      summary: "run the app with live reload, on every surface at once",
      prose: [
        "Runs until Ctrl-C, then reverts everything it changed. Press r to reload the app's JavaScript, b to rebuild and reinstall the native app.",
      ],
      args: [
        {
          name: "surface",
          required: true,
          choices: SURFACES,
          describe: "which surface to run",
        },
      ],
      flags: [TARGET, LATEST, FORCE, HOST, VERBOSE],
      passthrough: {
        token: "<vite args>",
        describe: "everything after -- is forwarded to vite",
      },
      conflicts: [
        {
          flag: "target",
          whenArg: ["all"],
          reason:
            "'--target' is per-platform and 'dev all' spans both — use '--latest', or run each platform",
        },
      ],
      examples: [
        "adaptv dev ios",
        "adaptv dev all --latest",
        "adaptv dev ios -- --port 4000",
      ],
    },
    {
      path: ["preview"],
      summary: "run the real build the way a user gets it, no live reload",
      args: [
        {
          name: "surface",
          required: true,
          choices: SURFACES,
          describe: "which surface to run",
        },
      ],
      flags: [TARGET, LATEST, FORCE, VERBOSE],
      passthrough: {
        token: "<vite args>",
        describe:
          "everything after -- is forwarded to vite (web surfaces only)",
      },
      conflicts: [
        {
          flag: "target",
          whenArg: ["all"],
          reason:
            "'--target' is per-platform and 'preview all' spans both — use '--latest', or run each platform",
        },
      ],
      examples: ["adaptv preview ios", "adaptv preview all"],
    },
    {
      path: ["build"],
      summary:
        "write the artifacts you ship: an unsigned .ipa and a debug .apk",
      prose: [
        "Signing is the one thing adaptv can't do for you. For TestFlight or the App Store, open .adaptv/ios/App/App.xcworkspace and use Xcode ▸ Product ▸ Archive.",
      ],
      //No `web`: a web build you can look at is `preview web`. Named explicitly so the error
      //can say so rather than listing the surfaces back (R7).
      args: [
        {
          name: "platform",
          required: true,
          choices: ["ios", "android", "all"],
          describe: "which platform to package",
          rejects: {
            web: "a web build is 'adaptv preview web'",
          },
        },
      ],
      flags: [
        {
          long: "output",
          short: "o",
          value: "<path>",
          group: "common",
          describe:
            "where to write the artifact (default: .adaptv/builds/)",
        },
        FORCE,
        JSON_OUT,
        QUIET,
        VERBOSE,
      ],
      examples: [
        "adaptv build ios",
        "adaptv build all -o ./dist",
        "adaptv build ios --json",
      ],
    },
    {
      path: ["gen", "icons"],
      summary: "generate every icon your app needs from a single image",
      prose: [
        "Written to the 'icons' directory named in adaptv.config.ts, or --output. That directory must be chosen: adaptv never guesses one to write into, and it REPLACES what is there, so it asks first unless you pass --yes.",
        "Every run also writes .adaptv/icons-preview.html — every icon under the mask its platform actually applies.",
        "iOS 18 shows a different icon in dark mode and when the home screen is tinted; Android 13+ recolours icons to match the wallpaper. adaptv writes all of those variants. A dark mark cannot be derived from a dark one, so --dark takes a hand-inverted image; --tinted and --monochrome likewise.",
      ],
      args: [],
      flags: [
        {
          long: "input",
          short: null,
          value: "<image>",
          group: "common",
          required: true,
          describe:
            "the png or svg to generate the whole set from (1024px+)",
        },
        {
          long: "output",
          short: "o",
          value: "<dir>",
          group: "common",
          describe:
            "write the set here instead of the 'icons' directory in adaptv.config.ts",
        },
        {
          long: "yes",
          short: null,
          value: null,
          group: "common",
          describe: "replace what is already there without asking",
        },
        image(
          "dark",
          "an inverted version, for the iOS 18 dark-mode icon",
        ),
        image(
          "tinted",
          "a greyscale version, which iOS colours on a tinted home screen",
        ),
        image(
          "monochrome",
          "a single-colour version, for Android's themed icons",
        ),
        pct(
          "margin",
          50,
          "space left around your art in every icon (default 10; 0 fills it edge to edge)",
        ),
        pct(
          "padding",
          40,
          "extra space around your art, on top of --margin",
        ),
        {
          long: "background",
          short: null,
          value: "<hex>",
          group: "advanced",
          describe:
            "the colour behind your art where an icon cannot be transparent",
          parse: (raw) => {
            if (raw === true || !HEX.test(String(raw).trim()))
              throw new Error(
                `'--background' must be a hex colour like '#0b0b0f' — got ${JSON.stringify(raw === true ? "" : raw)}`,
              )
            return String(raw).trim()
          },
        },
        VERBOSE,
      ],
      examples: [
        "adaptv gen icons --input ./mark.png",
        "adaptv gen icons --input ./mark.svg --dark ./mark-dark.png --yes",
      ],
    },
  ],
  /**
   * Commands that used to exist. Kept as data so the message is one entry rather than an arm
   * of the dispatch switch, and so `suggest()` never proposes them as a correction.
   */
  retired: [
    {
      path: ["run"],
      reason:
        "'run' was split into 'dev' and 'preview' — live reload is dev; a static build you install is preview",
      suggest: (rest) =>
        `adaptv dev ${rest[0] && rest[0] !== "web" ? rest[0] : "ios"}`,
    },
  ],
}

/* =============================================================================
 * derivations — all pure
 * ============================================================================= */

/** Every command's path as a display string: `["gen","icons"]` → `"gen icons"`. */
export const pathKey = (p) => p.join(" ")

/** The command whose path is `p`, or null. */
export function commandAt(p) {
  const key = pathKey(p)
  return SPEC.commands.find((c) => pathKey(c.path) === key) ?? null
}

/**
 * The command an argv begins with, and what is left over. `gen icons` is two words, so the
 * longest match wins — otherwise `gen` would match nothing and `icons` would look positional.
 */
export function matchCommand(argv) {
  for (const len of [2, 1]) {
    const cmd = commandAt(argv.slice(0, len))
    if (cmd) return { cmd, rest: argv.slice(len) }
  }
  return { cmd: null, rest: argv }
}

/** Every flag a command accepts. */
export const flagsFor = (cmd) => cmd?.flags ?? []

/** The top-level command words, for the unknown-command suggestion. */
export const commandNames = () => SPEC.commands.map((c) => c.path[0])

/** `--target <id>` / `--latest` / `-o, --output <path>` — how a flag is written in help. */
export function flagSyntax(f) {
  const name = f.short ? `-${f.short}, --${f.long}` : `--${f.long}`
  return f.value ? `${name} ${f.value}` : name
}

/**
 * The synopsis line(s) for a command — the bracket syntax shown under an error and at the top
 * of its help. Emitted UNWRAPPED; the renderer wraps with a hanging indent so a narrow
 * terminal never loses the tail (R44).
 */
export function usageLines(cmd) {
  const parts = [SPEC.name, ...cmd.path]
  for (const a of cmd.args)
    parts.push(a.required ? `<${a.choices.join("|")}>` : `[${a.name}]`)
  for (const f of cmd.flags)
    parts.push(f.required ? flagSyntax(f) : `[${flagSyntax(f)}]`)
  if (cmd.passthrough) parts.push(`[-- ${cmd.passthrough.token}]`)
  return [parts.join(" ")]
}

/**
 * Damerau-Levenshtein distance — how many single-character edits (insert, delete, substitute,
 * or transpose two ADJACENT characters) turn `a` into `b`.
 *
 * Transposition is the one that matters here and is why this is not plain Levenshtein: the
 * typos people actually make are `--forse` for `--force` and `biuld` for `build`, which plain
 * Levenshtein scores as 2 (the same as two unrelated edits) and this scores as 1.
 */
export function distance(a, b) {
  const m = a.length
  const n = b.length
  //`d[i][j]` = the distance between the first i of `a` and the first j of `b`.
  const d = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) =>
      i === 0 ? j : j === 0 ? i : 0,
    ),
  )
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost,
      )
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + cost)
    }
  }
  return d[m][n]
}

/**
 * The candidates close enough to `input` to be worth proposing — best first, at most two.
 *
 * Deliberately conservative. A wrong "did you mean" is worse than none: it sends the dev to
 * try something that was never going to work, and clig.dev's rule is to suggest rather than
 * correct precisely so they keep learning the real syntax. So the threshold scales with the
 * length of what they typed, and a token that resembles nothing gets no clause at all.
 */
export function suggest(input, candidates) {
  const word = String(input).replace(/^-+/, "").toLowerCase()
  if (!word) return []
  const limit = word.length <= 4 ? 1 : word.length <= 6 ? 2 : 3
  return candidates
    .map((c) => {
      const bare = String(c).replace(/^-+/, "").toLowerCase()
      //A prefix counts as close regardless of how much is missing: someone who typed `--mono`
      //meant `--monochrome`, and edit distance alone scores that 6 and says nothing.
      const d = bare.startsWith(word) ? 0 : distance(word, bare)
      return { c, d }
    })
    .filter((x) => x.d <= limit)
    .sort((a, b) => a.d - b.d || (a.c < b.c ? -1 : 1))
    .slice(0, 2)
    .map((x) => x.c)
}

/** `'--force'` / `'--force' or '--host'` — the tail of a did-you-mean clause. */
export function orList(items) {
  const q = items.map((i) => `'${i}'`)
  return q.length <= 1
    ? (q[0] ?? "")
    : `${q.slice(0, -1).join(", ")} or ${q.at(-1)}`
}
