// Does the live layer actually EMIT its colours?
//
// It did not, for the whole Ink port. The roles carried `{ ink: "cyan" }`, the components
// spread that into `<Text>`, and Ink silently drops props it does not know — so there was no
// cyan spinner, no yellow `!`, no dim phase. `dim` was wrong the same way (Ink's prop is
// `dimColor`). Both failures are invisible in code review and invisible to the unit tests,
// because chalk fixes its colour level from the REAL stdout at import time and a fake stdout
// is not a terminal: under vitest Ink strips every colour regardless, so an assertion there
// measures the harness.
//
// So this runs the components under a pty and greps the bytes. Ground truth or nothing.
//
//   node scripts/check-colour.mjs
import { spawnSync } from "node:child_process"
import { readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
)
const probe = path.join(root, ".adaptv-colour-probe.mjs")
const log = path.join(root, ".adaptv-colour-probe.txt")

writeFileSync(
  probe,
  `const { liveRows } = await import("${root}/bin/ui/live.mjs")
const { inkWatcher } = await import("${root}/bin/ui/watch.mjs")
const b = liveRows(["ios"]); b.phase("ios", "compiling")
await new Promise(r => setTimeout(r, 250)); b.stop()
const w = inkWatcher({ keys: false })
await new Promise(r => setTimeout(r, 250)); w.stop()
process.exit(0)
`,
)

//`script` is how you get a pty without a dependency, but its arguments are NOT portable, and
//this runs on two platforms now — a dev's mac and CI's ubuntu. util-linux wants
//`-c "<cmd>" <file>`; BSD/macOS has neither `-c` nor `-e` and wants `<file> <cmd> <args>`.
//So try both forms, preferred one first, rather than trusting a platform check to have
//guessed right: the wrong form captures nothing, and "captured nothing" would print as
//"the live layer is rendering flat" — the one failure this script must never invent.
//It also flakes occasionally, hence more than one round.
const COMMAND = `TERM=xterm-256color node ${probe}`
const UTIL_LINUX = ["-q", "-e", "-c", COMMAND, log]
const BSD = ["-q", log, "/bin/sh", "-c", COMMAND]
const FORMS =
  process.platform === "linux" ? [UTIL_LINUX, BSD] : [BSD, UTIL_LINUX]

let out = ""
for (let i = 0; i < 6 && !out; i++) {
  //a form `script` rejects leaves no file, but never read one a previous form wrote:
  //a partial capture would be graded as a missing colour.
  rmSync(log, { force: true })
  spawnSync("script", FORMS[i % FORMS.length], { stdio: "ignore" })
  try {
    out = readFileSync(log, "utf8")
  } catch {
    out = "" //no typescript file: that form is not the one this `script` speaks
  }
}

const ESC = String.fromCharCode(27)
const has = (code) => out.includes(`${ESC}[${code}m`)
const EXPECT = [
  ["36", "cyan — the spinner (ROLE.busy) and a pressable key (ROLE.key)"],
  ["2", "dim — the phase and every label (ROLE.quiet)"],
  ["1", "bold — a key, a heading (ROLE.key, ROLE.strong)"],
]
const missing = EXPECT.filter(([code]) => !has(code))
for (const [code, what] of EXPECT)
  console.log(`  ${has(code) ? "✓" : "✖"} \\x1b[${code}m  ${what}`)

spawnSync("rm", ["-f", probe, log])
if (!out) {
  console.error(
    "\n  could not capture a pty with either `script` form — is `script` installed?",
  )
  process.exit(2)
}
if (missing.length) {
  console.error(
    `\n  the live layer is rendering flat. Check the prop NAMES in bin/ui/theme.mjs against
  Ink's <Text>: it takes 'color', 'dimColor', 'bold' — anything else is dropped in silence.`,
  )
  process.exit(1)
}
console.log("\n  the roles reach the terminal.")
