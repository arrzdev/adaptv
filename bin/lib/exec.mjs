// Child-process execution for the branded CLI.
//
// The old CLI shelled out with `stdio: "inherit"`, so vite/cap/gradle/xcode/pod
// dumped their raw logs straight to the terminal. Here we CAPTURE instead: every
// line is streamed to an `onLine` sink (the listr task's spinner sub-line) and
// buffered, so on success the noise stays hidden and on failure we surface only the
// tail. `--verbose` pipes the same lines through unfiltered (the caller wires the
// verbose renderer). → plan Part 4.
import { spawn } from "node:child_process"
import { StringDecoder } from "node:string_decoder"
import { errorTail } from "./tool-log.mjs"

/**
 * The error a failed step rejects with. `tail` is the captured output that explains it,
 * already narrowed to the lines that do; `fix` is what the thrower knew that no output
 * shows — an HTTP status, a flag to pass. `explain.mjs` reads both to word the ✖.
 * @typedef {Error & { tail?: string, fix?: string[] }} CliError
 */

/** Keep at most this many lines buffered for the failure tail (bounds memory). */
const MAX_BUFFER = 800
/** How many trailing lines to show when a step fails. */
const TAIL_LINES = 24
/**
 * A single line this long is no longer a line, and holding it is no longer bounded, so it
 * is released as one. Nothing a build tool writes on purpose comes near it; what does is a
 * tool dumping a minified bundle or a binary blob with no terminator in sight.
 */
const MAX_PENDING = 64 * 1024

/**
 * Turn a stream of arbitrary chunks into a stream of LINES.
 *
 * A pipe hands over whatever bytes happened to have arrived, so a chunk boundary falls
 * wherever the kernel put it — mid-line and mid-character. `chunk.toString().split("\n")`
 * treated both as real breaks:
 *
 *     "The sandbox is not in " + "sync with the Podfile.lock\n"
 *       →  "The sandbox is not in"  and  "sync with the Podfile.lock"
 *
 * which is the single most load-bearing line in the whole failure path (R30 quotes it by
 * name): the reason a step failed arrived as two half-sentences, neither of which the tail
 * picker can recognise, and `trimEnd()` had already eaten the space that would have let
 * them be rejoined. The same boundary through the middle of a UTF-8 sequence produced two
 * replacement characters where a `─` had been.
 *
 * So: a `StringDecoder` holds an incomplete character until its remaining bytes arrive, and
 * everything after the last terminator is held until the next one does. `end()` releases
 * whatever is left, because a tool's final line often has no newline after it at all.
 *
 * `\r` terminates a line as well as `\n`. It always DID vanish (progress redraws are not
 * lines the CLI wants to keep), but as a mid-line strip rather than a break — and once
 * chunk boundaries stop flushing, a tool that redraws one progress row with `\r` and never
 * emits a newline would otherwise accumulate its entire run in memory and report nothing.
 *
 * Per STREAM, never shared: stdout and stderr arrive independently, and one buffer between
 * them would splice the tail of one tool's line onto the head of the other's.
 */
export function lineReader(emit) {
  const decoder = new StringDecoder("utf8")
  let pending = ""
  const release = (line) => {
    const text = line.trimEnd()
    if (text.trim() !== "") emit(text)
  }
  return {
    push(chunk) {
      pending += decoder.write(chunk)
      const parts = pending.split(/\r\n|[\r\n]/)
      //everything after the LAST terminator is not a line yet
      pending = parts.pop() ?? ""
      for (const part of parts) release(part)
      if (pending.length > MAX_PENDING) {
        release(pending)
        pending = ""
      }
    },
    end() {
      pending += decoder.end()
      if (pending !== "") release(pending)
      pending = ""
    },
  }
}

/**
 * Run a command with captured stdout+stderr. Each non-empty line is forwarded to
 * `onLine` (for the live spinner line) and buffered. Resolves on exit 0; rejects
 * with an Error carrying `.tail` (the last {@link TAIL_LINES} lines) otherwise.
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, onLine?: (line: string) => void }} [opts]
 */
export function exec(command, args, { cwd, env, onLine } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    })
    const buffer = []
    const take = (line) => {
      buffer.push(line)
      if (buffer.length > MAX_BUFFER) buffer.shift()
      onLine?.(line)
    }
    const readers = [lineReader(take), lineReader(take)]
    child.stdout.on("data", (chunk) => readers[0].push(chunk))
    child.stderr.on("data", (chunk) => readers[1].push(chunk))
    //The last line a tool writes is very often the one that says why it failed, and very
    //often has no newline after it. Both streams are closed by the time either of these
    //fires, so nothing can arrive after the flush.
    const flush = () => {
      for (const r of readers) r.end()
    }
    child.on("error", (/** @type {CliError} */ err) => {
      flush()
      err.tail = failureTail(buffer)
      reject(err)
    })
    child.on("close", (code) => {
      flush()
      if (code === 0) return resolve()
      /** @type {CliError} */
      const err = new Error(
        `${command} ${args.join(" ")} exited with code ${code}`,
      )
      err.tail = failureTail(buffer)
      reject(err)
    })
  })
}

/** Build the failure tail — which lines explain it is `tool-log.mjs`'s job (and tested there). */
const failureTail = (buffer) => errorTail(buffer, TAIL_LINES).join("\n")

/**
 * Run a command purely to collect its stdout (e.g. `cap run --list --json`). Never
 * rejects — returns `{ stdout, stderr, code }` so the caller decides what a non-zero
 * exit means.
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, timeoutMs?: number }} [opts]
 */
export function capture(command, args, { cwd, env, timeoutMs } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    let timedOut = false
    //SIGKILL, not SIGTERM: the case this exists for is a child wedged inside a synchronous
    //XPC call to a platform daemon that never replies, and a polite signal it is not in a
    //position to handle leaves the CLI waiting exactly as long as it was already waiting.
    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true
          child.kill("SIGKILL")
        }, timeoutMs)
      : null
    timer?.unref?.()
    const done = (result) => {
      if (timer) clearTimeout(timer)
      resolve({ ...result, timedOut })
    }
    //Decoded by the stream, not by `+`: concatenating a Buffer calls `toString()` on that
    //chunk alone, so a character straddling a chunk boundary became two replacement
    //characters — in, among other things, the JSON device inventory this exists to read.
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (b) => {
      stdout += b
    })
    child.stderr.on("data", (b) => {
      stderr += b
    })
    child.on("error", () => done({ stdout, stderr, code: 1 }))
    child.on("close", (code) => done({ stdout, stderr, code: code ?? 1 }))
  })
}
