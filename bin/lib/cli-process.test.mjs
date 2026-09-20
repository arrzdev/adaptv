// @vitest-environment node
import { spawn } from "node:child_process"
import { createPrivateKey, createPublicKey } from "node:crypto"
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { GLYPH } from "../ui/theme.mjs"
import { SPEC, usageLines } from "./cli-spec.mjs"
import { namesPlumbing } from "./opacity.mjs"

/**
 * The CLI as a PROCESS: exit codes, which stream a sentence lands on, and what prints first.
 *
 * Every other `bin/lib` suite calls a function, or reads `bin/adaptv.mjs` as text. None of them
 * ever ran it, so the contract a shell script or CI job actually depends on was unpinned: that a
 * mistyped command exits 2 rather than 1, that its `✖` goes to stderr so `> out.json` stays
 * clean, and that no banner escapes ahead of a refusal. A regression in `main().catch` or in the
 * order `main()` sets the output mode would leave every unit test green.
 *
 * So these spawn `node bin/adaptv.mjs` for real: piped (non-TTY), stdin closed, a clean env,
 * and a throwaway cwd. Nothing here may reach a dev server, a build, a device or the network —
 * every case is either answered by the parser, is a command (`--version`, `--help`, `keys`,
 * `doctor`) that only reads the machine, or is a `build web` that fails before it produces
 * anything, on the repo's own bundler.
 *
 * OPACITY. Every capture, on both streams, goes through `opacity.mjs` inside `cli()`: the CLI
 * must never name TanStack or Capacitor to the dev (R8), and a sentence made "more helpful" is
 * exactly how that rule broke before.
 *
 * TIMEOUTS. Each case is a cold `node` start plus, for `keys` and `doctor`, an esbuild bundle of
 * one of adaptv's own modules; `doctor` also asks four toolchain binaries for their versions.
 * That is ~1s for a case and ~2s for `doctor` on an idle machine, and several times that under
 * the load a full `pnpm test` puts on it — so each case carries its own 30s ceiling (60s for
 * `doctor`) rather than the suite-wide 5s, which was sized for in-process tests.
 */

const require = createRequire(import.meta.url)
const ENTRY = path.join(process.cwd(), "bin/adaptv.mjs")
const VERSION = JSON.parse(
  readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
).version
const PROCESS_TIMEOUT_MS = 30_000
const DOCTOR_TIMEOUT_MS = 60_000

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g")
const plain = (s) => s.replace(ANSI, "")
/** Wrapped help rows collapse back into the sentence the spec wrote. */
const flat = (s) => plain(s).replace(/\s+/g, " ").trim()

const dirs = []
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})
const scratch = () => {
  const d = mkdtempSync(path.join(tmpdir(), "adaptv-cli-process-"))
  dirs.push(d)
  return d
}

/**
 * The lines of a capture that name TanStack, Capacitor or Cordova (`opacity.mjs`, R8). Checked
 * on EVERY run by `cli()` itself, so no case can forget it and a `-t` filter cannot skip it.
 * The base64 body of a PEM is left out: it is random bytes, and a key that happens to spell
 * `cordova` is not a leak.
 */
function plumbingLines(text) {
  const leaks = []
  let inPem = false
  for (const line of plain(text).split("\n")) {
    if (/^-----BEGIN /.test(line)) inPem = true
    else if (/^-----END /.test(line)) inPem = false
    else if (!inPem && namesPlumbing(line)) leaks.push(line)
  }
  return leaks
}

/**
 * Run the CLI to completion. The env is PATH + HOME only: PATH because `doctor` looks tools up
 * on it, HOME because it is where the Android SDK default lives. No CI, no NO_COLOR, no COLUMNS
 * leaking in from whoever runs the suite.
 *
 * A child that outlives the ceiling gets SIGINT, never SIGKILL — if a regression ever let one of
 * these through to a live command, SIGINT is the signal that runs its teardown.
 */
function cli(
  args,
  { cwd = scratch(), timeout = PROCESS_TIMEOUT_MS - 5_000 } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [ENTRY, ...args], {
      cwd,
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.setEncoding("utf8").on("data", (d) => {
      stdout += d
    })
    child.stderr.setEncoding("utf8").on("data", (d) => {
      stderr += d
    })
    const timer = setTimeout(() => child.kill("SIGINT"), timeout)
    child.on("error", reject)
    child.on("close", (code, signal) => {
      clearTimeout(timer)
      const leaks = [
        ...plumbingLines(stdout).map((l) => `[stdout] ${l}`),
        ...plumbingLines(stderr).map((l) => `[stderr] ${l}`),
      ]
      if (leaks.length > 0)
        reject(
          new Error(
            `'adaptv ${args.join(" ")}' named the engines:\n${leaks.join("\n")}`,
          ),
        )
      else resolve({ args, cwd, code, signal, stdout, stderr })
    })
  })
}

/**
 * An invocation fault: exit 2 (`EX_USAGE`), the whole block on stderr, stdout untouched — and
 * the `✖` is the first thing on the page, with no banner or notice ahead of it.
 */
function expectUsageFault(run) {
  expect(run.code, run.stderr).toBe(2)
  expect(run.stdout).toBe("")
  const lines = plain(run.stderr)
    .split("\n")
    .filter((l) => l.trim())
  expect(lines[0]?.trim().startsWith(GLYPH.fail), run.stderr).toBe(true)
  expect(plain(run.stderr)).not.toMatch(/adaptv\s+·/)
}

describe("--version", () => {
  it(
    "is one bare line on stdout and exits 0, for both spellings",
    async () => {
      const runs = await Promise.all([cli(["--version"]), cli(["-v"])])
      for (const r of runs) {
        expect(r.code).toBe(0)
        //Data, not a page: no banner, no colour, no indent — a script captures it as is.
        expect(r.stdout).toBe(`${VERSION}\n`)
        expect(r.stderr).toBe("")
      }
    },
    PROCESS_TIMEOUT_MS,
  )
})

describe("--help", () => {
  it(
    "lists every command in the spec with its summary, and exits 0",
    async () => {
      const [help, bare, word] = await Promise.all([
        cli(["--help"]),
        cli([]),
        cli(["help"]),
      ])
      expect(help.code).toBe(0)
      expect(help.stderr).toBe("")
      const page = flat(help.stdout)
      expect(page).toContain(SPEC.tagline)
      for (const cmd of SPEC.commands)
        expect(page).toContain(`${cmd.path.join(" ")} ${cmd.summary}`)
      //Bare `adaptv` and `adaptv help` answer with the same page, not an error.
      for (const r of [bare, word]) {
        expect(r.code).toBe(0)
        expect(r.stdout).toBe(help.stdout)
        expect(r.stderr).toBe("")
      }
    },
    PROCESS_TIMEOUT_MS,
  )

  it(
    "gives every command its own page with the spec's usage line, and exits 0",
    async () => {
      const runs = await Promise.all(
        SPEC.commands.map((cmd) => cli([...cmd.path, "--help"])),
      )
      SPEC.commands.forEach((cmd, i) => {
        const r = runs[i]
        expect(r.code, cmd.path.join(" ")).toBe(0)
        expect(r.stderr).toBe("")
        const page = flat(r.stdout)
        expect(page).toContain(cmd.summary)
        for (const line of usageLines(cmd)) expect(page).toContain(line)
      })
    },
    PROCESS_TIMEOUT_MS,
  )

  it(
    "answers a command that has a required flag instead of refusing it",
    async () => {
      //`icons` requires `--input`; `--help` must still explain it, not demand it.
      const r = await cli(["icons", "--help"])
      expect(r.code).toBe(0)
      expect(r.stderr).toBe("")
      expect(flat(r.stdout)).toContain("--input <image>")
    },
    PROCESS_TIMEOUT_MS,
  )
})

describe("an invocation that cannot run exits 2, on stderr, before any banner", () => {
  it(
    "an unknown command, with and without a suggestion",
    async () => {
      const [nothingClose, typo] = await Promise.all([
        cli(["xyzzy"]),
        cli(["biuld", "ios"]),
      ])
      expectUsageFault(nothingClose)
      expect(plain(nothingClose.stderr)).toContain(
        "unknown command 'xyzzy'",
      )
      expect(plain(nothingClose.stderr)).not.toContain("did you mean")
      expectUsageFault(typo)
      expect(plain(typo.stderr)).toContain(
        "unknown command 'biuld', did you mean 'build'?",
      )
    },
    PROCESS_TIMEOUT_MS,
  )

  it(
    "an unknown flag, named against the command it was given to",
    async () => {
      const [doctorFlag, keysFlag] = await Promise.all([
        cli(["doctor", "--bogus"]),
        //`--json` is not one of `keys`' flags even though it is one of `doctor`'s.
        cli(["keys", "ota", "--json"]),
      ])
      expectUsageFault(doctorFlag)
      expect(plain(doctorFlag.stderr)).toContain(
        "unknown flag '--bogus' for 'doctor'",
      )
      expectUsageFault(keysFlag)
      expect(plain(keysFlag.stderr)).toContain(
        "unknown flag '--json' for 'keys'",
      )
    },
    PROCESS_TIMEOUT_MS,
  )

  it(
    "an unknown flag under --json still speaks on stderr and leaves stdout empty",
    async () => {
      //The mode is set only after parsing succeeds, so a script piping stdout into a JSON
      //parser gets an empty stream and a code, never half a page.
      const r = await cli(["doctor", "--json", "--bogus"])
      expectUsageFault(r)
    },
    PROCESS_TIMEOUT_MS,
  )

  it(
    "a flag combination the spec forbids",
    async () => {
      const [dev, preview] = await Promise.all([
        cli(["dev", "all", "--target", "x"]),
        cli(["preview", "all", "--target", "x"]),
      ])
      for (const [r, cmd] of [
        [dev, "dev all"],
        [preview, "preview all"],
      ]) {
        expectUsageFault(r)
        expect(flat(r.stderr)).toContain(
          `'--target' is per-platform and '${cmd}' spans both`,
        )
      }
    },
    PROCESS_TIMEOUT_MS,
  )

  it(
    "a missing or unknown argument, and a flag value out of range",
    async () => {
      const [missing, unknown, range] = await Promise.all([
        cli(["keys"]),
        cli(["dev", "iso"]),
        cli(["icons", "--input", "a.png", "--margin", "99"]),
      ])
      expectUsageFault(missing)
      expect(plain(missing.stderr)).toContain("'keys' needs a kind: 'ota'")
      expectUsageFault(unknown)
      expect(plain(unknown.stderr)).toContain(
        "unknown surface 'iso' for 'dev', did you mean 'ios'?",
      )
      expectUsageFault(range)
      expect(plain(range.stderr)).toContain(
        "'--margin' must be a percentage between 0 and 50",
      )
    },
    PROCESS_TIMEOUT_MS,
  )

  it(
    "passthrough to a command that forwards nothing",
    async () => {
      const r = await cli(["build", "web", "--", "--port", "4000"])
      expectUsageFault(r)
      expect(plain(r.stderr)).toContain(
        "'build' forwards nothing after '--'",
      )
    },
    PROCESS_TIMEOUT_MS,
  )

  it(
    "an ip after --host, with a fix that is itself a command that runs",
    async () => {
      const r = await cli(["dev", "ios", "--host", "192.168.1.5"])
      expectUsageFault(r)
      const err = plain(r.stderr)
      expect(err).toContain("'--host' takes no address")
      //The fix keeps the surface they typed. `adaptv dev --host` would only be refused again,
      //for the missing surface.
      expect(err).toContain("drop the ip: 'adaptv dev ios --host'")
    },
    PROCESS_TIMEOUT_MS,
  )
})

/** The two PEM blocks in a page, in the order printed. */
const pems = (s) =>
  plain(s).match(
    /-----BEGIN ([A-Z ]+)-----\n[A-Za-z0-9+/=\n]+?-----END \1-----/g,
  ) ?? []

describe("keys ota", () => {
  it(
    "prints a public and a private key that parse and belong together, and writes nothing",
    async () => {
      const cwd = scratch()
      const r = await cli(["keys", "ota"], { cwd })
      expect(r.code, r.stderr).toBe(0)
      expect(r.stderr).toBe("")
      const [pub, priv, ...extra] = pems(r.stdout)
      expect(extra).toEqual([])
      //Public first; the private half goes out LAST (see `genOtaKeys`).
      expect(pub).toMatch(/^-----BEGIN PUBLIC KEY-----/)
      expect(priv).toMatch(/^-----BEGIN PRIVATE KEY-----/)
      const publicKey = createPublicKey(pub)
      const privateKey = createPrivateKey(priv)
      //What the native verifiers accept (`isUsableOtaPublicKey`).
      expect(publicKey.asymmetricKeyType).toBe("rsa")
      expect(privateKey.asymmetricKeyType).toBe("rsa")
      //A PAIR, not two keys: the private half's public half is the one printed.
      expect(
        createPublicKey(privateKey).export({
          type: "spki",
          format: "pem",
        }),
      ).toBe(publicKey.export({ type: "spki", format: "pem" }))
      //adaptv keeps no copy — not in the app, not in `.adaptv/`.
      expect(readdirSync(cwd)).toEqual([])
    },
    PROCESS_TIMEOUT_MS,
  )

  it(
    "still prints the key pair under --quiet, because the pair IS the outcome",
    async () => {
      const cwd = scratch()
      const r = await cli(["keys", "ota", "--quiet"], { cwd })
      expect(r.code, r.stderr).toBe(0)
      expect(r.stderr).toBe("")
      const [pub, priv, ...extra] = pems(r.stdout)
      expect(extra).toEqual([])
      expect(() => createPublicKey(pub)).not.toThrow()
      expect(() => createPrivateKey(priv)).not.toThrow()
      //Quiet drops the narration around the keys, never the keys.
      expect(plain(r.stdout)).not.toContain("commit this")
      expect(readdirSync(cwd)).toEqual([])
    },
    PROCESS_TIMEOUT_MS,
  )
})

describe("doctor", () => {
  it(
    "--json is one document with a stable top-level shape, and nothing else on stdout",
    async () => {
      const [json, human] = await Promise.all([
        cli(["doctor", "--json"], { timeout: DOCTOR_TIMEOUT_MS - 5_000 }),
        cli(["doctor"], { timeout: DOCTOR_TIMEOUT_MS - 5_000 }),
      ])
      const lines = json.stdout.split("\n").filter(Boolean)
      expect(lines).toHaveLength(1)
      const doc = JSON.parse(lines[0])
      //Whether THIS run passes is not up to the test. `cli()` hands the child only PATH and
      //HOME, so ANDROID_HOME and JAVA_HOME never reach it, and doctor's fallbacks for both
      //are macOS paths: on a Linux runner the Android SDK and JDK rows are red even with an
      //SDK installed, and a red required row fails the run. What is held is that the code,
      //`ok` and `error` tell one story, and that `error` names exactly the rows that failed.
      expect(json.code, json.stderr).toBe(doc.ok ? 0 : 1)
      expect(Object.keys(doc)).toEqual([
        "ok",
        "command",
        "version",
        "notices",
        "steps",
        "result",
        ...(doc.ok ? [] : ["error"]),
      ])
      if (!doc.ok)
        expect(doc.error.labels).toEqual(
          doc.steps
            .filter((s) => !s.ok && !s.optional)
            .map((s) => s.label),
        )
      expect(doc.command).toBe("doctor")
      expect(doc.version).toBe(VERSION)
      expect(typeof doc.ok).toBe("boolean")
      expect(Array.isArray(doc.notices)).toBe(true)
      expect(Array.isArray(doc.steps)).toBe(true)
      for (const step of doc.steps) {
        expect(typeof step.label).toBe("string")
        expect(typeof step.ok).toBe("boolean")
      }
      //The one row every machine that can run this suite passes.
      expect(doc.steps.find((s) => s.label === "node")?.ok).toBe(true)
      //And the human page is the same run, rendered: it exits the same way.
      expect(human.code, human.stderr).toBe(json.code)
      expect(plain(human.stdout)).toMatch(/adaptv\s+·\s+doctor/)
    },
    DOCTOR_TIMEOUT_MS,
  )
})

/** Every path under `dir`, relative and sorted: what a run left in the app it was handed. */
function tree(dir) {
  return readdirSync(dir, { recursive: true })
    .map((p) => String(p))
    .sort()
}

/**
 * A throwaway app `build web` fails on before it produces anything, and the paths it holds.
 *
 * With `origin` it publishes updates and declares no key to verify them with, so `build web`
 * refuses through `fail()` before a bundle is built. Without it, the web build runs and fails on
 * the missing `index.html`, and its row settles in `runLine`. That build is the repo's own vite,
 * reached through the app's `node_modules/.bin` the way a consumer's is: with no local bin the CLI
 * falls back to `npx --yes vite`, which is the network.
 */
function failingApp({ origin = false } = {}) {
  const cwd = scratch()
  writeFileSync(
    path.join(cwd, "adaptv.config.ts"),
    `export default {
  appId: "dev.example.quiet",
  name: "Quiet",
  styles: "./main.css",
  router: {},
  themeColor: { light: "#ffffff" },${origin ? '\n  origin: "https://updates.example.com",' : ""}
}
`,
  )
  writeFileSync(path.join(cwd, "main.css"), "")
  if (!origin) {
    const vite = path.join(
      path.dirname(require.resolve("vite/package.json")),
      "bin/vite.js",
    )
    mkdirSync(path.join(cwd, "node_modules/.bin"), { recursive: true })
    writeFileSync(
      path.join(cwd, "node_modules/.bin/vite"),
      `#!/bin/sh\nexec "${process.execPath}" "${vite}" "$@"\n`,
      { mode: 0o755 },
    )
  }
  return { cwd, before: tree(cwd) }
}

/** The elapsed time a settled row carries, which is the one byte two runs cannot share. */
const untimed = (s) => s.replace(/· \d+(\.\d+)?m?s/g, "· <time>")

describe("a step that fails through fail()", () => {
  it(
    "still says so under --quiet: the row and its fix on stderr, exactly as the page has them",
    async () => {
      const apps = [
        failingApp({ origin: true }),
        failingApp({ origin: true }),
      ]
      const [human, quiet] = await Promise.all([
        cli(["build", "web"], { cwd: apps[0].cwd }),
        cli(["build", "web", "--quiet"], { cwd: apps[1].cwd }),
      ])
      expect(human.code, human.stderr).toBe(1)
      const err = plain(human.stderr)
      expect(err).toMatch(new RegExp(`^ {2}${GLYPH.fail} channel {2}· `))
      expect(err).toContain("run 'adaptv keys ota'")
      //R46: `--quiet` keeps outcomes and failures. It exited 1 with both streams empty, because
      //the row was written at step level and the mode dropped it before it reached stderr.
      expect(quiet.code).toBe(1)
      expect(quiet.stdout).toBe("")
      //Byte for byte the block the dev reads on the page, fix line included: quiet drops the
      //narration around a failure, never the failure or what to do about it.
      expect(quiet.stderr).toBe(human.stderr)
      //Refused before anything was built: both apps are as they were handed over.
      for (const app of apps) expect(tree(app.cwd)).toEqual(app.before)
    },
    PROCESS_TIMEOUT_MS,
  )

  it(
    "under --json is the document on stdout and the same block on stderr, quiet or not",
    async () => {
      const apps = [0, 1, 2].map(() => failingApp({ origin: true }))
      const [human, json, both] = await Promise.all([
        cli(["build", "web"], { cwd: apps[0].cwd }),
        cli(["build", "web", "--json"], { cwd: apps[1].cwd }),
        cli(["build", "web", "--json", "--quiet"], { cwd: apps[2].cwd }),
      ])
      for (const r of [json, both]) {
        expect(r.code, r.stderr).toBe(1)
        const lines = r.stdout.split("\n").filter(Boolean)
        expect(lines).toHaveLength(1)
        const doc = JSON.parse(lines[0])
        expect(doc.ok).toBe(false)
        expect(doc.error).toMatchObject({
          kind: "step-failed",
          label: "channel",
        })
        //stderr always speaks (R46), and adding `--quiet` to `--json` must not take that away.
        expect(r.stderr).toBe(human.stderr)
      }
      for (const app of apps) expect(tree(app.cwd)).toEqual(app.before)
    },
    PROCESS_TIMEOUT_MS,
  )
})

describe("a build that fails in its own row", () => {
  it(
    "still says so under --quiet: the settled row and its fix, as the page has them",
    async () => {
      const apps = [failingApp(), failingApp()]
      const [human, quiet] = await Promise.all([
        cli(["build", "web"], { cwd: apps[0].cwd }),
        cli(["build", "web", "--quiet"], { cwd: apps[1].cwd }),
      ])
      expect(human.code, human.stdout).toBe(1)
      const rows = human.stdout.split("\n")
      const bad = rows.findIndex((l) =>
        plain(l).startsWith(`  ${GLYPH.fail} web  `),
      )
      expect(bad, human.stdout).toBeGreaterThan(-1)
      //The page's block from the `✖` down, minus the blank line that closes the command.
      const block = `${rows
        .slice(bad)
        .filter((l) => l !== "")
        .join("\n")}\n`
      //A fix under the row, so the case holds the detail as well as the row.
      expect(plain(block)).toContain("index.html")
      //R46's second bullet, on the path every `--quiet` run takes: off a TTY the row settled at
      //step level, and a build that did not build exited 1 with both streams empty.
      expect(quiet.code).toBe(1)
      expect(untimed(quiet.stdout)).toBe(untimed(block))
      //One failure, one `✖` (R2): the row owns the report, so the command's catch says nothing
      //more on either stream, in either mode.
      expect(human.stderr).toBe("")
      expect(quiet.stderr).toBe("")
      for (const app of apps) expect(tree(app.cwd)).toEqual(app.before)
    },
    PROCESS_TIMEOUT_MS,
  )
})
