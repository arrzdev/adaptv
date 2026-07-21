// Child-process execution for the branded CLI.
//
// The old CLI shelled out with `stdio: "inherit"`, so vite/cap/gradle/xcode/pod
// dumped their raw logs straight to the terminal. Here we CAPTURE instead: every
// line is streamed to an `onLine` sink (the listr task's spinner sub-line) and
// buffered, so on success the noise stays hidden and on failure we surface only the
// tail. `--verbose` pipes the same lines through unfiltered (the caller wires the
// verbose renderer). → plan Part 4.
import { spawn } from "node:child_process"

/** Keep at most this many lines buffered for the failure tail (bounds memory). */
const MAX_BUFFER = 800
/** How many trailing lines to show when a step fails. */
const TAIL_LINES = 24

/**
 * Run a command with captured stdout+stderr. Each non-empty line is forwarded to
 * `onLine` (for the live spinner line) and buffered. Resolves on exit 0; rejects
 * with an Error carrying `.tail` (the last {@link TAIL_LINES} lines) otherwise.
 */
export function exec(command, args, { cwd, env, onLine } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    })
    const buffer = []
    const consume = (chunk) => {
      for (const raw of chunk.toString().split("\n")) {
        const line = raw.replace(/\r/g, "").trimEnd()
        if (line.trim() === "") continue
        buffer.push(line)
        if (buffer.length > MAX_BUFFER) buffer.shift()
        onLine?.(line)
      }
    }
    child.stdout.on("data", consume)
    child.stderr.on("data", consume)
    child.on("error", (err) => {
      err.tail = failureTail(buffer)
      reject(err)
    })
    child.on("close", (code) => {
      if (code === 0) return resolve()
      const err = new Error(
        `${command} ${args.join(" ")} exited with code ${code}`,
      )
      err.tail = failureTail(buffer)
      reject(err)
    })
  })
}

// Lines that actually name the problem (xcodebuild/gradle/pod). Tools like
// xcodebuild print thousands of "SwiftCompile …" progress lines AFTER the real
// error, so a plain last-N tail buries it — prefer the error lines when present.
const ERROR_LINE =
  /(?:\berror\b[: ]|\bfatal\b|BUILD FAILED|FAILURE:|\bfailed\b|xcodebuild: error)/i
const NOT_ERROR = /^\s*(?:\d+\s+errors?\s+generated|0\s+error)/i

/** Build the failure tail: the error lines if any, else the last {@link TAIL_LINES}. */
function failureTail(buffer) {
  const errors = buffer.filter(
    (l) => ERROR_LINE.test(l) && !NOT_ERROR.test(l),
  )
  const picked = errors.length ? errors : buffer
  return picked.slice(-TAIL_LINES).join("\n")
}

/**
 * Run a command purely to collect its stdout (e.g. `cap run --list --json`). Never
 * rejects — returns `{ stdout, stderr, code }` so the caller decides what a non-zero
 * exit means.
 */
export function capture(command, args, { cwd, env } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (b) => {
      stdout += b
    })
    child.stderr.on("data", (b) => {
      stderr += b
    })
    child.on("error", () => resolve({ stdout, stderr, code: 1 }))
    child.on("close", (code) =>
      resolve({ stdout, stderr, code: code ?? 1 }),
    )
  })
}
