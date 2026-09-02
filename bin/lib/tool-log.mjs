// Reading the native toolchains' output — the two questions the CLI asks of a captured
// stream, kept pure and in one place so both are testable (`tool-log.test.mjs`):
//
//   phaseLabel(line) — WHILE it runs: what calm phrase should the live line show?
//   errorTail(lines) — WHEN it fails: which lines actually explain the failure?
//
// The motivation for the first is that xcodebuild/gradle/CocoaPods narrate themselves in
// build-system vocabulary, not human sentences: a single xcodebuild step is a verb, two
// absolute paths, an architecture and a target clause — hundreds of columns of it, several
// per second. Echoing that raw contradicts the whole renderer ("calm steps, not a raw log
// dump" — render.mjs header) and, clipped to the terminal, it degenerates into a flickering
// slice of somebody's home directory. So: recognise the verb, say what it MEANS, and show
// nothing at all for pure bookkeeping. `--verbose` is untouched — raw passthrough is its
// entire purpose.
//
// A phase names WHAT IS HAPPENING, never WHAT IT IS HAPPENING TO. The subject used to be
// appended (`compiling · CapacitorSplashScreen`), which meant the live line changed on every
// pod — 91 distinct phases and 140 rewrites in one iOS build, a strobe rather than a status.
// Dropping it costs nothing a dev acts on: a build compiles what it compiles, and anyone who
// wants the roll call has `--verbose`. It also gives iOS and Android ONE vocabulary, so the
// two platforms read as the same command instead of two tools narrating themselves.

/**
 * One row of a phase table: the shape of a line, and the phrase the live line shows for
 * it — `""` when the line is recognised and worth nothing. A function label reads the
 * match and the whole line, and answers the same way.
 * @typedef {[RegExp, string]} PhaseRow
 * @typedef {[RegExp, string | ((m: RegExpMatchArray, line: string) => string)]} PhaseRule
 */

/**
 * xcodebuild's step verbs → what they mean. First match wins, so order is significance,
 * not alphabetical. `""` means "this step is bookkeeping" — the live line keeps its last
 * real phase rather than flickering through `MkDir`/`Touch`/`WriteAuxiliaryFile`.
 * @type {PhaseRow[]}
 */
const XCODE_PHASES = [
  [
    /^(?:CompileSwift(?:Sources)?|SwiftCompile|SwiftDriver(?:JobDiscovery)?|SwiftEmitModule|EmitSwiftModule|SwiftMergeGeneratedHeaders|CompileC|CompileMetalFile)\b/,
    "compiling",
  ],
  [/^(?:CompileAssetCatalog|CompileXCAssets)\b/, "compiling assets"],
  [
    /^(?:CompileStoryboard|CompileXIB|LinkStoryboards)\b/,
    "compiling interface",
  ],
  [/^(?:Ld|Libtool|CreateUniversalBinary)\b/, "linking"],
  [/^(?:CodeSign|ProcessProductPackaging\w*)\b/, "signing"],
  [/^PhaseScriptExecution\b/, "running build script"],
  [/^GenerateDSYMFile\b/, "generating debug symbols"],
  [
    /^(?:ExtractAppIntentsMetadata|AppIntentsSSUTraining|AppIntentsNltrainingProcessor)\b/,
    "extracting app metadata",
  ],
  [
    /^(?:ProcessInfoPlistFile|CpResource|CpHeader|Copy(?:PlistFile|StringsFile|SwiftLibs|PNGFile)?|Ditto|ProcessPCH\+?)\b/,
    "processing resources",
  ],
  [
    /^(?:ComputeTargetDependencyGraph|GatherProvisioningInputs|CreateBuildDescription|Resolve Package Graph|Prepare(?: packages| build)?)\b/,
    "preparing build",
  ],
  // Bookkeeping: real steps, but naming them tells a human nothing.
  [
    /^(?:CreateBuildDirectory|MkDir|WriteAuxiliaryFile|Touch|RegisterExecutionPolicyException|RegisterWithLaunchServices|SymLink|Validate)\b/,
    "",
  ],
]

/**
 * One record from an xcodebuild destination inventory:
 *
 *     { platform:iOS, arch:arm64e, id:00008140-0016…, name:iPhone de arrz, error:iOS 26.1 is
 *       not installed. Please download and install the platform from Xcode > Settings >
 *       Components. }
 *
 * Printed whenever a destination can't be resolved, once per device it knows, ~190 columns
 * each and carrying `error:` — so it is neither a phase nor, despite the word, a line that
 * explains anything a dev acts on. `explainLaunchFailure` reads the SAME text and says what
 * it means in one sentence; the inventory itself belongs to `--verbose` (R14, R61).
 */
const DESTINATION_ENTRY = /^\{\s*platform:/
export const isDestinationEntry = (line) =>
  DESTINATION_ENTRY.test(String(line))

/**
 * Lines that are not steps at all — xcodebuild's preamble, its `note:`/`warning:`
 * asides, and the syslog spew of tools it shells out to. They pass the generic
 * prettifier (no path to give them away) but say nothing about WHERE the build is, so
 * they'd flicker the live line to a stop on a hex digest or a compiler aside.
 */
const NOT_A_PHASE = [
  /^[-\s]*(?:\S+:\s*)?(?:note|warning|remark):/i, // incl. `--- xcodebuild: WARNING:`
  /^Build (?:settings from command line|description (?:signature|path)):/i,
  /^[A-Za-z_]\w*\s*=(?:\s|$)/, // a `KEY = value` build setting (the value may be empty)
  /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+\s+\S+\[\d+:\d+\]/, // syslog-stamped subprocess
  /^(?:User defaults from|Command line invocation)/i,
  /^Computing target dependency graph/i,
  /^(?:➜|→)/, // the dependency-graph dump xcodebuild prints before building
  /^Target '[^']+' in project '/i,
  DESTINATION_ENTRY, // one record of an xcodebuild destination inventory
  /^(?:sent|received) [\d,]+ bytes|^total size is |^transfer starting:/i, // rsync stats
  /^\d+ (?:warnings?|errors?) generated/i,
  /^\/\*.*\*\/$/, // actool's `/* com.apple.actool.compilation-results */` banner
  /^Selected xcframework slice|^Ignoring --strip-bitcode/i,
  /^(?!\w+:\/\/)\S*\/\S*$/, // a bare path token (an rsync file listing), but never a URL
  /^[^\w\s]{1,3}$/, // a lone caret/bang from a compiler diagnostic's context lines
]

/**
 * A node crash dump — what a tool leaves behind when it, or a server it starts, dies on an
 * uncaught exception. A `vite build` does exactly this when a port its config pins is taken
 * (R32): the prerender step brings up its own server, the listen throws, and node prints a
 * stack sandwich ending in its own version.
 *
 * That last line is the leak. `Node.js v26.0.0` is short, path-free, prose-shaped text, so it
 * passed every other filter and BECAME the phase — the whole dump narrowed to the one line
 * that says least:
 *
 *     ⠴ web  node.js v26.0.0
 *
 * The rest of the dump only ever failed those filters by accident — a bracket in one stack
 * frame, a colon in the message, a length that happened to run long — so name the SHAPE
 * rather than trusting punctuation to keep holding. None of it is a phase (R24, R70): the
 * row keeps its last real phase and the step fails a beat later with the reason `fail()`
 * renders (`port 41740 is already in use`).
 */
const CRASH_DUMP = [
  /^Node\.js v\d/, // the version footer, printed last after any uncaught throw
  /^node:[\w./-]+:\d+$/, // `node:events:487` — where it threw, printed first
  /^\s*at\s+\S.*(?:\(|\bnode:|:\d+:\d+)/, // a V8 stack frame
  /^\s*throw\s/, // `throw er; // Unhandled 'error' event`
  /^Emitted '[^']*' event on\b/, // the banner between the two stacks
]

// The live line is a SENTENCE about what's happening. Anything carrying source-code or
// data-structure punctuation is a compiler diagnostic's context lines, a serialised build
// setting, or a shelled-out command — none of which describe a phase, and all of which
// arrive faster than they can be read. Cheaper and more durable than trying to enumerate
// every tool's incidental output.
const NOT_PROSE = /[{}[\]|^~<>\\@$#"]/

/**
 * A gradle task name → the same coarse phase vocabulary xcodebuild maps to.
 *
 * Gradle has hundreds of tasks and used to be passed through verbatim
 * (`gradle · parseDebugLocalResources`): a raw camelCase identifier, a different one every
 * few hundred ms. Matching on the verb inside the name collapses them to a handful of
 * phrases that hold still, and makes an Android build read like the iOS one.
 * @type {PhaseRow[]}
 */
const GRADLE_TASK = [
  [/lint|check|verify/i, "checking"],
  [/resource|asset|manifest|aapt|parse|merge/i, "processing resources"],
  [/compile|javac|kotlin|dex|desugar|jetify/i, "compiling"],
  [/link/i, "linking"],
  [/strip|minify|shrink|optimi|proguard|r8/i, "optimizing"],
  [/sign/i, "signing"],
  [/package|assemble|bundle|apk|aar/i, "packaging"],
  [/install/i, "installing"],
  [/clean/i, "cleaning"],
  [/download|resolve|dependenc/i, "resolving dependencies"],
]

/** A gradle task that did no work — the live line keeps its last real phase (R4). */
const GRADLE_NO_WORK = /\b(?:UP-TO-DATE|FROM-CACHE|NO-SOURCE|SKIPPED)\s*$/

/**
 * CocoaPods + gradle + Capacitor phase lines, same contract as {@link XCODE_PHASES}.
 * @type {PhaseRule[]}
 */
const TOOL_PHASES = [
  [
    /^>\s*Task\s+(:\S+)/,
    (m, line) => {
      if (GRADLE_NO_WORK.test(line)) return ""
      const task = m[1].split(":").pop()
      for (const [re, label] of GRADLE_TASK)
        if (re.test(task)) return label
      return "building"
    },
  ],
  [/^>\s*Configure project\b/, "configuring"],
  [/^Starting a Gradle Daemon/, "preparing build"],
  //Every pod prints its own `Installing X (1.2.3)`; the NAMES are the flicker, and which
  //dependency is being unpacked is not something a dev acts on.
  [/^Installing\s+[\w.+-]+\s*\(/, "installing dependencies"],
  [/^Analyzing dependencies/, "resolving dependencies"],
  [/^Downloading dependencies/, "downloading dependencies"],
  [/^Generating Pods project/, "installing dependencies"],
  [/^Integrating client project/, "installing dependencies"],
  [/^Pod installation complete/, ""],
  [/^Sending stats/, ""],
]

/**
 * The WEB bundler's own vocabulary → the same closed list xcodebuild and gradle map into.
 *
 * The native lanes were parsed from the day the renderer existed; the web lane never was,
 * so whatever the bundler said reached the row verbatim the moment it happened to read like
 * a phrase. It does:
 *
 *     ⠼ web  rendering chunks
 *     ⠧ web  computing gzip size
 *
 * Neither is a phase adaptv chose — they are a bundler narrating its own internals (R8), in
 * a vocabulary that is not R24's, on the one row a dev watches. `rendering chunks` is also
 * the exact shape R24 was written against: short, lowercase, prose, and about the tool.
 *
 * The verbs come from the bundler's reporter and are stable across its two spellings — a
 * bare message and a counted one (`rendering chunks (12)...`) — so match the VERB and let
 * the count fall away with the rest (R22):
 *
 *     vite v8.0.11 building client environment for production...  the banner
 *     transforming...✓ 3028 modules transformed.                 source → modules
 *     rendering chunks...                                        modules → output chunks
 *     computing gzip size...                                     measuring what it wrote
 *     ✓ built in 1.47s                                           the verdict
 *
 * `transforming` IS compiling and chunk rendering IS linking — a bundler runs the same two
 * steps a native toolchain does, so an `ios` build and a `web` build now narrate themselves
 * with one vocabulary instead of two (R22's whole point). The other three are bookkeeping:
 * a banner naming the tool and its version, a count, and a verdict the settled ✓ already
 * carries — all `""`, so the row keeps its last real phase.
 * @type {PhaseRow[]}
 */
const BUNDLER_PHASES = [
  [/^transforming\b/, "compiling"],
  [/^rendering chunks\b/, "linking"],
  //Not `packaging`: the bundle is already written by now and this is the reporter
  //measuring it for a table adaptv does not print. Naming it would put a bundler's own
  //accounting on the row.
  [/^computing gzip size\b/, ""],
  [/^vite v\S+ building\b/, ""], // its banner — the tool, its version, and the ✓'s job
  //Both arrive behind the reporter's own tick glyph, allowed for here as "not a word
  //character" rather than as a second copy of the glyph set (`engine.test.mjs`).
  [/^\W{0,3}\s*\d+ modules transformed\b/, ""], // a count, not a phase
  [/^\W{0,3}\s*built in \d/, ""], // the verdict; the settled row states the elapsed time
]

/**
 * The SHAPE of a bundler progress message: a lowercase clause, an optional count, and the
 * ellipsis it would animate a spinner on. Enumerating today's verbs is not enough on its
 * own — the reason `Node.js v26.0.0` became a phase (R70) is that the filters around it
 * were accidents rather than rules, and a bundler is free to add a verb in any release.
 *
 * So a message of this shape that {@link BUNDLER_PHASES} does not know maps to `building`
 * — the same answer an unrecognised gradle task gets. Suppressing it instead was the other
 * option and is worse: the row would go quiet for however long the new phase takes, and
 * nothing would ever reveal that adaptv had stopped narrating a step. `building` is true of
 * anything the bundler says here, and it is already in the vocabulary.
 */
const BUNDLER_PROGRESS = /^[a-z][a-z ]{0,38}?(?: \(\d+\))?\.\.\./

// A terminal control sequence, built without a literal escape in the source. Tools erase
// their own spinner line as they go (`ESC[2K` before `transforming...`), and that prefix
// used to hide the phase from every table below — the line survived only as far as
// `isRawToolNoise`, which drops it for the `[` it contains. Strip first, then read.
const CSI = new RegExp(
  `${String.fromCharCode(27)}\\[[0-9;?]*[a-zA-Z]`,
  "g",
)

/**
 * A calm phrase for one raw tool line, or `null` when the line isn't one this knows —
 * the caller then falls back to its generic prettifier. `""` (not null) is a deliberate
 * "show nothing": the line was recognised AND judged not worth saying.
 */
export function phaseLabel(raw) {
  const line = String(raw).replace(CSI, "").trim()
  if (!line) return ""

  for (const [re, label] of TOOL_PHASES) {
    const m = line.match(re)
    if (m) return typeof label === "function" ? label(m, line) : label
  }

  for (const [re, label] of XCODE_PHASES) {
    if (!re.test(line)) continue
    if (!label) return ""
    return label
  }

  for (const [re, label] of BUNDLER_PHASES) {
    if (!re.test(line)) continue
    return label
  }

  // xcodebuild's own banners ("** BUILD SUCCEEDED **") restate what the ✓/✖ already says.
  if (/^\*{2}.*\*{2}$/.test(line)) return ""
  if (NOT_A_PHASE.some((re) => re.test(line))) return ""
  // A dying process is not a phase — and its tail line looks more like one than the rest of
  // the dump does, which is exactly why it was the piece that got through.
  if (CRASH_DUMP.some((re) => re.test(line))) return ""
  // LAST, so every rule above gets its say first: a progress message whose verb this does
  // not know is still the bundler talking, and it may not pass through raw (R24).
  if (BUNDLER_PROGRESS.test(line)) return "building"
  return null
}

// A path anchored at the filesystem root, with at least two segments — the signature of
// tool-internal chatter. The delimiter class deliberately excludes `:`, so a URL
// (`http://localhost:5173`) is never mistaken for one; it includes quotes because the
// shelled-out commands xcodebuild echoes (rsync, ibtool) quote their arguments.
const ABSOLUTE_PATH = /(?:^|[\s"'=])\/[\w.-]+\//

/** True when a line is only fit for `--verbose`: an unrecognised, path-laden tool line. */
export const isRawToolNoise = (line) =>
  ABSOLUTE_PATH.test(String(line)) || NOT_PROSE.test(String(line))

// Lines that actually name a problem. xcodebuild/gradle print thousands of progress lines
// AFTER the real error, so a plain last-N tail buries it — prefer these when present.
// `\w*Error(?: [CODE])?:` is a crash naming its class the way Node prints one —
// `TypeError [ERR_INVALID_ARG_TYPE]: …` — and there is no word boundary before the `Error`
// in `TypeError`, so the first alternative never kept the one line that said what broke.
const ERROR_LINE =
  /(?:\berror\b[: ]|^\s*\w*Error(?:\s*\[\w+\])?:|\bfatal\b|BUILD FAILED|FAILURE:|\bfailed\b|xcodebuild: error|The sandbox is not in sync)/i
// "N errors generated" is a COUNT, not the error; keeping it would win the "first error
// line" race against the diagnostic that explains what to fix.
const NOT_ERROR = /^\s*(?:\d+\s+errors?\s+generated|0\s+error)/i
// Gradle states the cause on the lines AFTER this header, and those lines need not contain
// "error"/"failed" themselves ("> Android resource linking failed" does; "Could not find
// method compile()" does not). So a header drags its next few lines in with it.
const CAUSE_HEADER =
  /^\s*(?:\*\s*What went wrong:|The following build commands failed:)/i
const CAUSE_WINDOW = 3
// Where a `* What went wrong:` section stops: gradle's advice sections, or the verdict.
const SECTION_END =
  /^\s*(?:\*\s*(?:Try|Get more help|Exception is)|BUILD FAILED|FAILURE:)/i

// Gradle boilerplate that only restates the ✖ already on screen.
const GRADLE_BOILERPLATE =
  /^\s*(?:FAILURE:|Build failed with an exception\.|BUILD FAILED|\*\s*Try:|\*\s*Get more help)/i

/**
 * Gradle's ACTUAL cause, or null.
 *
 * Gradle reports a failure as a nested chain under `* What went wrong:`, widening from the
 * task that failed to the reason it failed:
 *
 *     * What went wrong:
 *     Execution failed for task ':app:checkDebugAarMetadata'.
 *     > Could not resolve all files for configuration ':app:debugRuntimeClasspath'.
 *        > Could not find dev.arrz.doesnot:exist:1.2.3.
 *
 * The DEEPEST `>` line is the one a dev can act on; the outer ones just name the task —
 * which the failing step already said. Taking the first error-ish line instead (what a
 * generic filter does) yields `> Task :app:checkDebugAarMetadata FAILED`, i.e. "it broke
 * where it broke". So walk to the end of the chain and report that.
 */
export function gradleCause(lines) {
  const at = lines.findIndex((l) => /^\s*\*\s*What went wrong:/i.test(l))
  if (at === -1) return null
  let deepest = null
  let fallback = null
  let pending = false
  for (let i = at + 1; i < lines.length; i++) {
    const line = String(lines[i]).trim()
    if (!line) continue
    if (GRADLE_BOILERPLATE.test(line)) break //chain over — later sections are advice
    if (line.startsWith(">")) {
      //gradle wraps long chains, which can leave a bare ">" with its message on the next
      //line; carry the marker forward instead of recording an empty cause.
      const rest = line.replace(/^>+\s*/, "")
      if (rest) deepest = rest
      else pending = true
    } else if (pending) {
      deepest = line
      pending = false
    } else if (!deepest && !fallback) fallback = line //no chain: the sentence itself
  }
  return deepest ?? fallback
}

/**
 * A taken port, in the dev's terms. Node states it as `listen EADDRINUSE: address already in
 * use 127.0.0.1:41720` — true, and unreadable — and it is by far the most common way both a
 * `vite preview` and a `vite build` die.
 *
 * The `--port` flag is deliberately NOT the fix here: the port that collides is usually not
 * vite's own. A vite config can pin ports for the things it starts (a cloudflare
 * `inspectorPort`, an HMR socket), and any second vite process for that app — a running
 * `dev`, or a build whose prerender step brings up its own server — hits them. So the fix
 * that always applies is to find the process holding it, which is also the one thing the raw
 * message doesn't help with.
 *
 * Returns `{ msg, fix }` like `explainLaunchFailure`, or null when the text isn't about a port.
 */
export function portInUse(text) {
  // Two wordings for one fact: Node's raw `EADDRINUSE … 127.0.0.1:41720` (greedy to the LAST
  // colon, so the port is captured and not an IP octet), and vite's own sentence under
  // `--strictPort`, which never says EADDRINUSE at all.
  const busy =
    String(text).match(/EADDRINUSE[^\n]*?:(\d{2,5})\b/i) ??
    String(text).match(/\bPort (\d{2,5}) is already in use/i)
  if (!busy) return null
  return {
    msg: `port ${busy[1]} is already in use`,
    fix: [
      "Usually a running 'adaptv dev', a stray 'pnpm dev', or a worker left behind by one.",
      `'lsof -nP -iTCP:${busy[1]} -sTCP:LISTEN' names it. Stop that, then run again.`,
    ],
  }
}

/**
 * The lines of a captured stream worth showing after a failure, newest last, capped at
 * `limit`. Falls back to the raw tail when nothing matched — an empty failure report is
 * worse than an irrelevant one.
 */
export function errorTail(lines, limit = 24) {
  const keep = new Set()
  lines.forEach((l, i) => {
    if (ERROR_LINE.test(l) && !NOT_ERROR.test(l)) keep.add(i)
    if (!CAUSE_HEADER.test(l)) return
    // Keep the WHOLE section, not a fixed window. Gradle nests its causes and the useful
    // one is the deepest — a 3-line window stopped one line short of
    // `> Could not find dev.arrz.doesnot:exist:1.2.3.`, so the reason a dev needs never
    // reached the report at all. Run to the section terminator instead.
    for (let j = i; j < lines.length; j++) {
      const line = String(lines[j]).trim()
      if (j > i && (SECTION_END.test(line) || (!line && j > i + 1))) break
      keep.add(j)
      if (j - i > CAUSE_WINDOW * 4) break //pathological output guard
    }
  })
  const picked = keep.size
    ? [...keep].sort((a, b) => a - b).map((i) => lines[i])
    : lines
  return picked.slice(-limit)
}
