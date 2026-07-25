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
 * xcodebuild's step verbs → what they mean. First match wins, so order is significance,
 * not alphabetical. `""` means "this step is bookkeeping" — the live line keeps its last
 * real phase rather than flickering through `MkDir`/`Touch`/`WriteAuxiliaryFile`.
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
  /^\{\s*platform:/, // the destination list printed with "multiple matching destinations"
  /^(?:sent|received) [\d,]+ bytes|^total size is |^transfer starting:/i, // rsync stats
  /^\d+ (?:warnings?|errors?) generated/i,
  /^\/\*.*\*\/$/, // actool's `/* com.apple.actool.compilation-results */` banner
  /^Selected xcframework slice|^Ignoring --strip-bitcode/i,
  /^(?!\w+:\/\/)\S*\/\S*$/, // a bare path token (an rsync file listing), but never a URL
  /^[^\w\s]{1,3}$/, // a lone caret/bang from a compiler diagnostic's context lines
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

/** CocoaPods + gradle + Capacitor phase lines, same contract as {@link XCODE_PHASES}. */
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
 * A calm phrase for one raw tool line, or `null` when the line isn't one this knows —
 * the caller then falls back to its generic prettifier. `""` (not null) is a deliberate
 * "show nothing": the line was recognised AND judged not worth saying.
 */
export function phaseLabel(raw) {
  const line = String(raw).trim()
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

  // xcodebuild's own banners ("** BUILD SUCCEEDED **") restate what the ✓/✖ already says.
  if (/^\*{2}.*\*{2}$/.test(line)) return ""
  if (NOT_A_PHASE.some((re) => re.test(line))) return ""
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
const ERROR_LINE =
  /(?:\berror\b[: ]|\bfatal\b|BUILD FAILED|FAILURE:|\bfailed\b|xcodebuild: error|The sandbox is not in sync)/i
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
