/*
 * Records a real adaptv CLI session as raw ANSI for the landing page's terminals.
 *
 *   node website/scripts/capture-cli.ts dev-web   # adaptv dev web --host
 *   node website/scripts/capture-cli.ts build-web # adaptv build web
 *
 * It runs the command under `script` in an 80x24 pty in playground/apps/frontend, stops
 * recording once the session has settled, and writes src/content/captures/<name>.ansi.
 * The only change to the stream: every LAN or public IPv4 reads 192.168.1.24. `script`'s
 * own "Script started/done" lines are not part of the session and are left out.
 */
import { spawn } from "node:child_process"
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const SESSIONS = {
  // a dev server never exits: the session is settled once the keys row is drawn
  "dev-web": { args: "dev web --host", settled: /ctrl-c/ },
  "build-web": { args: "build web", settled: null },
} as const

const name = process.argv[2] as keyof typeof SESSIONS
const session = SESSIONS[name]
if (!session) {
  console.error(`usage: capture-cli.ts ${Object.keys(SESSIONS).join(" | ")}`)
  process.exit(1)
}

const website = join(dirname(fileURLToPath(import.meta.url)), "..")
const app = join(website, "../playground/apps/frontend")
const bin = join(app, "node_modules/.bin/adaptv")
if (!existsSync(bin)) {
  console.error("run `pnpm playground:setup` first")
  process.exit(1)
}
const raw = join(tmpdir(), `adaptv-capture-${name}.raw`)
writeFileSync(raw, "")

const child = spawn(
  "script",
  ["-qfc", `stty rows 24 cols 80; ${bin} ${session.args}`, raw],
  { cwd: app, stdio: "ignore" },
)

// once settled, keep what was written up to that moment and stop the session
let cut = -1
const poll = setInterval(() => {
  const text = readFileSync(raw, "utf8")
  if (cut < 0 && session.settled?.test(text)) {
    setTimeout(() => {
      cut = readFileSync(raw).length
      child.kill("SIGTERM")
    }, 300)
    cut = 0
  }
}, 100)

child.on("exit", () => {
  clearInterval(poll)
  let bytes = readFileSync(raw)
  if (cut > 0) bytes = bytes.subarray(0, cut)
  const text = bytes
    .toString("utf8")
    .replace(/^Script started[^\n]*\n/, "")
    .replace(/\r?\nScript done[^\n]*\n?$/, "")
    .replace(
      /\b(?!127\.0\.0\.1\b)(?!0\.0\.0\.0\b)\d{1,3}(\.\d{1,3}){3}\b/g,
      "192.168.1.24",
    )
  const out = join(website, "src/content/captures", `${name}.ansi`)
  writeFileSync(out, text)
  rmSync(raw)
  console.log(`wrote ${out} (${text.length} chars)`)
})
