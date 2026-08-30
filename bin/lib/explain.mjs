/**
 * Putting a failure into words — the ONE place it happens.
 *
 * Lived in `bin/adaptv.mjs` until it leaked `@tanstack/start-server-core` onto a `✖` line
 * (CLI-UX R8). It is pure text in and text out, and it could not be tested where it was:
 * `adaptv.mjs` runs the CLI on import, so nothing could hold this to a rule. Here it can be,
 * and `explain.test.mjs` holds it to the opacity boundary using real captured tool output.
 */
import path from "node:path"
import { explainLaunchFailure } from "./native.mjs"
import { namesPlumbing, withoutPlumbing } from "./opacity.mjs"
import { gradleCause, isDestinationEntry, portInUse } from "./tool-log.mjs"

/** How much captured tool output a failed line expands into — enough to name the problem,
 *  not a log dump (that's `--verbose`). Generous rather than tight: the lines are already
 *  filtered to the ones that explain the failure, and cutting a diagnostic off mid-
 *  instructions is the one failure mode worse than a few lines too many (CLI-UX R15). */
const DETAIL_LINES = 10
// ANSI escape (ESC = char 27), built without a literal control char in the source. Tool
// output arrives coloured, and a reason rendered inline has to measure as what it prints.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g")

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
 * be told about.
 */
export function explainFailure(label) {
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
      return {
        reason: safe,
        //Deduped: the tail of a server that answered the warm's probes carries the SAME stack
        //once per request, and three identical 200-column lines under one ✖ is not detail.
        detail: [
          ...new Set([...withoutPlumbing(detail), ...authored]),
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

    const lines = String(err?.tail ?? "")
      .split("\n")
      .map((l) => l.replace(ANSI, "").trim())
      .filter(Boolean)
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
    const errors = lines.filter((l) => /\berror\s*:/i.test(l))
    const picked = errors.length ? errors : lines
    if (picked.length === 0)
      return settle({
        reason: String(err?.message ?? err).split("\n")[0],
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
          .slice(0, DETAIL_LINES)
          .map(shortenLocator),
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
  // no locator — strip any `<tool>: error:` prefix and keep the sentence.
  return {
    message: raw.replace(/^.*?\berror\s*:\s*/i, "") || raw,
    where: "",
  }
}

/** Same idea for a detail line: keep the filename, drop the directories. */
export const shortenLocator = (l) => l.replace(/^\/\S*\//, "")
