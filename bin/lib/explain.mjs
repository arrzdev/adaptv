/**
 * Putting a failure into words — the ONE place it happens.
 *
 * Lived in `bin/adaptv.mjs` until it leaked `@tanstack/start-server-core` onto a `✖` line
 * (`docs/design/cli-contract.md` R8). It is pure text in and text out, and it could not be tested where it was:
 * `adaptv.mjs` runs the CLI on import, so nothing could hold this to a rule. Here it can be,
 * and `explain.test.mjs` holds it to the opacity boundary using real captured tool output.
 */
import { existsSync } from "node:fs"
import path from "node:path"
import { ADAPTV_DIR } from "./adaptv-dir.mjs"
import { explainLaunchFailure } from "./native.mjs"
import { namesPlumbing, withoutPlumbing } from "./opacity.mjs"
import {
  gradleCause,
  isDestinationEntry,
  portInUse,
  serverBoundary,
} from "./tool-log.mjs"

/** How much captured tool output a failed line expands into — enough to name the problem,
 *  not a log dump (that's `--verbose`). Generous rather than tight: the lines are already
 *  filtered to the ones that explain the failure, and cutting a diagnostic off mid-
 *  instructions is the one failure mode worse than a few lines too many (`docs/design/cli-contract.md` R15). */
const DETAIL_LINES = 10
// ANSI escape (ESC = char 27), built without a literal control char in the source. Tool
// output arrives coloured, and a reason rendered inline has to measure as what it prints.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g")
// A line that names an error by its class, the way Node prints a crash: `TypeError: …`,
// `TypeError [ERR_INVALID_ARG_TYPE]: …`, `Error: …`, with or without a `[tag]` in front. The
// generic `error:` test wants a word boundary before `error`, which `TypeError` has not got,
// so a crash inside the web build lost the ✖ line to the trailer above it
// (`error during build:`) — a line that says nothing.
const NAMED_ERROR = /^(?:\[\w+\]\s*)?\w*Error(?:\s*\[\w+\])?\s*:/
// A task runner's verdict on one of its own steps, the way the native CLI adaptv drives writes
// it: `✖ Running xcodebuild - failed!`, or `✔ Copying web assets in 3.21ms` for a step that
// passed before the one that did not (`×`/`√` on Windows). It carries `failed`, so the tail
// keeps it, and it arrives BEFORE the tool's own output, so it was the first line the generic
// pick below reached — and the row rendered as `✖ ios  ✖ Running xcodebuild - failed!`, two
// failure marks and nothing a dev can act on (R2). It is a restatement of the ✖, like
// `** BUILD FAILED **`. Char codes rather than the marks themselves: the glyph set is the
// engine's alone (R26, `engine.test.mjs`), and these belong to the tool.
const RUNNER_MARKS = String.fromCharCode(0x2714, 0x2716, 0x221a, 0xd7)
const TASK_VERDICT = new RegExp(
  `^[${RUNNER_MARKS}]\\s+(.+?)\\s+(?:-\\s+failed!|in\\s+[\\d.]+\\s*(?:s|ms|\u03bcs))$`,
  "u",
)
// A tool log's level tag, `[error] Command error. …`. On the ✖ line adaptv is the one speaking.
const LOG_TAG = /^\[(?:error|warn|info|debug|success)\]\s*/i

/**
 * Describe a failure the way the renderer wants it: a concise `reason` shown INLINE on
 * that step's own `✖ <label>` line, plus `detail` lines dim underneath. This is the ONLY
 * place a failure is put into words — every step/lane carries its own outcome, so nothing
 * prints a second `✖ <label> failed — …` afterwards (that duplicated the glyph and, for
 * `all`, separated a platform's reason from its line by the other platform's).
 *
 * A recognised cause wins (iOS signing, an unavailable device, Developer Mode off, …):
 * its message is the reason and its fix steps are the detail. Otherwise the first line of
 * the captured tail is — for xcodebuild/gradle `err.message` is only "exited with code
 * 65", while `err.tail` is already filtered down to the lines that name the error.
 *
 * Whatever it settles on then passes the opacity boundary (`opacity.mjs`): a tool's own words
 * are not automatically fit to print, because the tools ARE the thing the consumer must not
 * be told about. And every path in it is made relative to `appRoot` — the directory the CLI
 * runs in, which is the app root by definition (`bin/adaptv.mjs`) — or cut to its file name
 * when it lies outside, because a tool's words are no more exempt from R9 than adaptv's.
 * @param {string} label
 * @param {string} [appRoot]
 */
export function explainFailure(label, appRoot = process.cwd()) {
  return (err) => {
    // Fix steps the THROWER authored, when it knew something the text can't show — the dev
    // server's warm probe knows an HTTP status, and no amount of reading its output reveals
    // one. They go last, under whatever the tail explains: what happened, then what to do.
    const authored = Array.isArray(err?.fix) ? err.fix : []
    /**
     * Settle a candidate reason + detail into what actually prints.
     *
     * The reason is the interesting half. A tail line that names plumbing cannot be shown and
     * cannot be blanked either — the `✖` has to say SOMETHING — so it falls back to the
     * thrower's own sentence, which is adaptv's words about adaptv's failure and is always
     * safe. That fallback is why `devServerUnhealthy` and friends must keep writing a real
     * sentence into `new Error(...)` even when they expect the tail to win.
     */
    const settle = ({ reason, detail }) => {
      const safe = namesPlumbing(reason)
        ? String(err?.message ?? err).split("\n")[0]
        : reason
      //Relative AFTER the plumbing test, never before: a store path names the engine in its
      //directories, and cutting it to a file name first would hide that from the test.
      const rel = (line) => withoutAbsolutePaths(line, appRoot)
      return {
        reason: rel(safe),
        //Deduped: the tail of a server that answered the warm's probes carries the SAME stack
        //once per request, and three identical 200-column lines under one ✖ is not detail.
        detail: [
          ...new Set([...withoutPlumbing(detail), ...authored].map(rel)),
        ].slice(0, DETAIL_LINES),
      }
    }
    const text = `${err?.message ?? ""}\n${err?.tail ?? ""}`
    const known = explainLaunchFailure(label, text)
    if (known) return settle({ reason: known.msg, detail: known.fix })
    // A taken port is not a build error and its tail explains nothing: the useful lines are
    // a Node stack, and the one line that matters (`EADDRINUSE … :41720`) names a port the
    // dev never chose. Same sentence wherever it surfaces — a build, or the server itself.
    const busy = portInUse(text)
    if (busy) return settle({ reason: busy.msg, detail: busy.fix })
    const locked = notExecutable(text)
    if (locked) return settle({ reason: locked.msg, detail: locked.fix })
    //adaptv's refusal of a server function or route: the rows ARE the detail, and none of
    //them says "error", so the generic pick below would drop every one
    const boundary = serverBoundary(text)
    if (boundary)
      return settle({ reason: boundary.msg, detail: boundary.fix })

    const captured = String(err?.tail ?? "")
      .split("\n")
      .map((l) => l.replace(ANSI, "").trim().replace(LOG_TAG, ""))
      .filter(Boolean)
    // The step the runner says failed, kept for the one case where nothing else in the tail
    // says anything: then `xcodebuild failed` is still more than the spawn's own message.
    const failedTask = captured
      .map((l) => l.match(TASK_VERDICT))
      .find((m) => m?.[0].endsWith("failed!"))?.[1]
    const lines = captured
      .filter((l) => !TASK_VERDICT.test(l))
      // `** BUILD FAILED **` & friends only restate the ✖ that's already printing.
      .filter((l) => !/^\*{2}.*\*{2}$/.test(l))
      // xcodebuild answers an unresolvable destination with its whole inventory of
      // ineligible ones — a ~190-column brace record per device, each carrying `error:`, so
      // `errorTail` keeps every one and they became the entire dim block under the ✖. The
      // recognisers above read this same text and say what it MEANS; the records themselves
      // are a data structure, not a sentence, and are for `--verbose` (R61).
      .filter((l) => !isDestinationEntry(l))
    // Gradle never says `error:` — it nests the cause under `* What went wrong:`, so the
    // generic pass below would settle for `> Task :app:… FAILED` (the task, not the cause).
    // Ask the gradle-aware extractor first; the boilerplate it skips is exactly what was
    // being dumped as a 7-line block under the ✖.
    const gradle = gradleCause(lines)
    if (gradle)
      return settle({
        reason: gradle,
        detail: lines
          .filter(
            (l) =>
              /^\s*Execution failed for task/i.test(l) &&
              !l.includes(gradle),
          )
          .slice(0, 1),
      })
    // `exec` narrows the tail to error-ISH lines, but the ones that actually say `error:`
    // are what a dev reads; the rest are trailers ("The following build commands failed:").
    const errors = lines.filter(
      (l) => /\berror\s*:/i.test(l) || NAMED_ERROR.test(l),
    )
    const picked = errors.length ? errors : lines
    if (picked.length === 0)
      return settle({
        reason: failedTask
          ? taskFailed(failedTask)
          : String(err?.message ?? err).split("\n")[0],
        detail: [],
      })
    const { message, where } = toolErrorParts(picked[0])
    return settle({
      reason: message,
      detail: [
        where && `at ${where}`,
        // One fault can reach here several times wearing a different prefix each time — a
        // server that answered 30s of probes logs its stack once per request, and Node files
        // the SAME sentence under `cause:` beneath the `Error:` it explains. Compare what a
        // line MEANS, not how it is spelled, or the dim block is one sentence three times,
        // each 200 columns of store path (violating both R14 and the no-absolute-paths rule).
        ...picked
          .slice(1)
          .filter((l) => toolErrorParts(l).message !== message)
          .slice(0, DETAIL_LINES),
      ].filter(Boolean),
    })
  }
}

/**
 * Split a compiler/tool error into what to say and where. clang/swift/gradle prefix the
 * message with an ABSOLUTE `file:line:col: error:` locator — long enough on its own to
 * overflow the line and push the actual message off the end, which is how the reason
 * became unreadable. So the message goes INLINE (it's what's read first) and a short
 * `file:line:col` goes on the dim line under it.
 */
export function toolErrorParts(raw) {
  const m = raw.match(
    /^(\S+?):(\d+)(?::(\d+))?:\s*(?:fatal\s+)?error:\s*(.+)$/i,
  )
  if (m)
    return {
      message: m[4],
      where: `${path.basename(m[1])}:${m[2]}${m[3] ? `:${m[3]}` : ""}`,
    }
  // Node/Vite's ESM resolution failure is the same shape wearing different clothes: the
  // sentence is short and the ABSOLUTE importer path behind it is 90+ columns, so the whole
  // thing clipped to `Cannot find module 'x' imported fro…`. Split it the same way.
  //
  // The importer is NOT carried over. It was, briefly, as the package it belonged to — which
  // is how `at @tanstack/start-server-core/dist/esm/router-manifest.js` reached a user's
  // terminal. A resolution failure inside the toolchain has no locator a consumer may see, and
  // one inside their own code already says so in the message.
  const esm = raw.match(
    /^(?:.*?\berror:\s*)?(Cannot find (?:module|package) '[^']+')\s+imported from\s+'?(\S+?)'?$/i,
  )
  if (esm) return { message: esm[1], where: "" }
  // no locator — strip the `<tool>: error:` or `TypeError [CODE]:` prefix and keep the
  // sentence. A `[adaptv]` tag goes too: it marks the line as adaptv's inside a tool's own
  // log, and on the ✖ line adaptv is already the one speaking.
  const message = (
    NAMED_ERROR.test(raw)
      ? raw.replace(NAMED_ERROR, "")
      : raw.replace(/^.*?\berror\s*:\s*/i, "")
  )
    .replace(/^\s*\[adaptv\]\s*/, "")
    .trim()
  return { message: message || raw, where: "" }
}

/**
 * A program that could not be started because it is not executable, in the dev's terms.
 *
 * Node says `spawn <file> EACCES`, and that is all it says: no tail, since nothing ran to write
 * one. The gradle wrapper is where it happens — a project directory copied or unzipped by
 * something that drops file modes leaves `gradlew` without its exec bit — and it reaches the
 * page two ways, by its absolute path from `build android` and as `./gradlew` from the native
 * runner, which spawns it from inside `.adaptv/android`. Either way the row read
 * `spawn … EACCES`: a syscall, an errno, and no action.
 *
 * adaptv restores the wrapper's bit on every prepare (`restoreGradleWrapperMode`), so reaching
 * this for a file adaptv generated means that restore could not happen, and regenerating the
 * project is the action that still works. For anything else, the mode is the dev's to set.
 *
 * Returns `{ msg, fix }` like `portInUse`, or null when the text is not about this.
 * @param {string} text
 */
export function notExecutable(text) {
  //Lazy to the errno, not `\S+`: Node does not quote the path, and an app under
  //`My Apps` or iCloud's `Mobile Documents` has a space in it.
  const spawned = String(text).match(/\bspawn\s+(.+?)\s+EACCES\b/)
  if (!spawned) return null
  const file =
    spawned[1] === "./gradlew"
      ? `${ADAPTV_DIR}/android/gradlew`
      : spawned[1]
  const project = file.match(
    new RegExp(`(?:^|/)(${ADAPTV_DIR.replace(".", "\\.")}/[^/]+)/`),
  )?.[1]
  return {
    msg: `${file} is not executable`,
    fix: project
      ? [`Delete ${project} and run again. adaptv regenerates it.`]
      : ["Make it executable ('chmod +x'), then run again."],
  }
}

/**
 * A runner's step title as the phrase a ✖ carries: `Running xcodebuild` → `xcodebuild failed`,
 * `Updating iOS plugins` → `updating iOS plugins failed`. `Running` goes because the row
 * already says a step ran; the rest is lowercased at its head only, so `iOS` keeps its case.
 */
const taskFailed = (task) => {
  const what = task.replace(/^Running\s+/i, "")
  return `${what.charAt(0).toLowerCase()}${what.slice(1)} failed`
}

/**
 * One character of a path as tools print it: anything but whitespace and the punctuation that
 * ends a path in a sentence — quotes, brackets, a `:` before a line number — with xcodebuild's
 * escaped space (`Target\\ Support\\ Files`) kept inside it.
 */
const PATH_CHAR = String.raw`(?:\\ |[^\s"'\`()[\]{}<>,:;\\])`
// The directories an absolute path on disk starts from. A slash-led token that does not start
// with one is not a file on this machine: a dev server's module id (`/src/routes/cart.tsx`), a
// route (`/products/featured/42`), an API path, a regex literal. Those are the dev's words about
// their own app, and cutting them to a last segment turned `No route matched /products/featured/42`
// into `No route matched 42`, which is false (R56).
// macOS's own roots name nothing else a dev would write, so a path under one is cut on any
// machine, which keeps a Mac tool's output reading the same when a test runs on Linux CI.
const MAC_ROOTS = "Users|Library|Applications|System|Volumes|private"
// Linux's roots are ordinary words (`/home/feed/3`, `GET /dev/tools/1`), so a path under one is
// cut only when its first two segments are a directory on this machine: `/home/runner` is, a
// route's `/home/feed` is not.
const LINUX_ROOTS =
  "var|tmp|opt|usr|home|etc|dev|bin|sbin|root|mnt|nix|snap"
// An absolute path on disk, where a path can start: the head of the line, after whitespace, a
// quote, `=` or an opening bracket, or a `file://` URL. `//` inside any other URL is preceded
// by `:`, which is none of those, so `http://localhost:41730/` survives.
const ABSOLUTE_PATH = new RegExp(
  String.raw`(^|[\s"'\`=([]|file:\/\/)(\/(?:(${MAC_ROOTS})|${LINUX_ROOTS})\/${PATH_CHAR}+)`,
  "g",
)
/** Whether `/<root>/<name>` exists, asked once per prefix. @type {Map<string, boolean>} */
const onDisk = new Map()
/** @param {string} p a path under one of LINUX_ROOTS */
function startsOnDisk(p) {
  const prefix = p.split("/").slice(0, 3).join("/").replaceAll("\\ ", " ")
  if (prefix.endsWith("/")) return false
  if (!onDisk.has(prefix)) onDisk.set(prefix, existsSync(prefix))
  return onDisk.get(prefix)
}

/**
 * R9 for text adaptv did not write. xcodebuild names the file it could not read and the script
 * phase that failed by their absolute paths, and those lines are exactly the ones a failure is
 * explained with:
 *
 *     Unable to load contents of file list: '/Users/arrz/app/.adaptv/ios/App/Pods/…' …
 *     PhaseScriptExecution … /Users/arrz/Library/Developer/Xcode/DerivedData/App-gqzb…/Script-95.sh
 *
 * A path under the app root becomes app-root-relative (`.adaptv/ios/App/Pods/…`), which is how
 * every artifact row names a file; a path on disk outside it — DerivedData, the home directory,
 * Xcode itself — is cut to its file name, because the directories are the machine's, not the
 * app's. Only a path that starts from a real top-level directory counts as one, and under a
 * Linux root only when its first two segments exist here: slash-led text that is not on disk
 * (a module id, a route, a regex) is the dev's and is left whole. Text only ever loses
 * directories here: a URL, a `file:line:col` locator and every word around a path are left as
 * they were.
 * @param {string} line
 * @param {string} [appRoot]
 */
export function withoutAbsolutePaths(line, appRoot) {
  let s = String(line ?? "")
  const root = String(appRoot ?? "").replace(/\/+$/, "")
  //Textual, not tokenised: a path under the app root keeps its tail even when that tail has
  //an unescaped space in it (`Target Support Files`), which no token rule could span.
  if (root)
    s = s.split(`file://${root}/`).join("").split(`${root}/`).join("")
  return s.replace(ABSOLUTE_PATH, (whole, lead, p, macRoot) =>
    macRoot || startsOnDisk(p)
      ? `${lead === "file://" ? "" : lead}${path.basename(p)}`
      : whole,
  )
}
