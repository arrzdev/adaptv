// @vitest-environment node
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, afterEach, describe, expect, it, vi } from "vitest"

/**
 * `index.mjs` in this process, rather than spawned the way `create.test.mjs` runs it.
 *
 * The spawned tests hold the real exit code; these hold every branch of the entry
 * itself, which a child process hides from coverage. The entry is a script: it reads
 * `argv` and the environment when it is imported and leaves through `process.exit`,
 * so each run re-imports it with those stubbed and `exit` turned into a throw that
 * stops it where the real one would.
 */

const dirs = []
afterAll(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true })
})
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "create-adaptv-entry-"))
  dirs.push(dir)
  return dir
}

class Exit extends Error {
  constructor(code) {
    super(`exit ${code}`)
    this.code = code
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

/** Import the entry as `<pm> create adaptv ...args` would run it, in `cwd`. */
async function run(args, cwd) {
  vi.resetModules()
  vi.stubEnv("NO_COLOR", "1")
  vi.stubEnv("npm_config_user_agent", "pnpm/11.1.1 npm/? node/v22.12.0")
  vi.stubEnv("ADAPTV_SPEC", "")
  vi.spyOn(process, "argv", "get").mockReturnValue([
    process.execPath,
    "index.mjs",
    ...args,
  ])
  //`path.resolve(name)` resolves against this
  vi.spyOn(process, "cwd").mockReturnValue(cwd)
  let stdout = ""
  let stderr = ""
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout += chunk
    return true
  })
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr += chunk
    return true
  })
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Exit(code)
  })
  let status = 0
  try {
    await import("./index.mjs")
  } catch (error) {
    if (!(error instanceof Exit)) throw error
    status = error.code
  }
  return { status, stdout, stderr }
}

describe("create-adaptv's entry", () => {
  it("creates the app, says so and names the next three commands", async () => {
    const cwd = tempDir()
    const result = await run(["my-app"], cwd)
    expect(result.status).toBe(0)
    expect(result.stderr).toBe("")
    expect(result.stdout).toBe(
      [
        "",
        "  adaptv · create my-app",
        "",
        "  ✓ created my-app",
        "",
        "    cd my-app",
        "    pnpm install",
        "    pnpm dev",
        "",
        "",
      ].join("\n"),
    )
    expect(existsSync(join(cwd, "my-app/adaptv.config.ts"))).toBe(true)
  })

  it("prints the command and exits 0 on --help, creating nothing", async () => {
    for (const flag of ["--help", "-h"]) {
      const cwd = tempDir()
      const result = await run([flag], cwd)
      expect(result.status, flag).toBe(0)
      expect(result.stdout, flag).toBe(
        "\n  adaptv · create\n\n  pnpm create adaptv <name>\n\n",
      )
      expect(readdirSync(cwd), flag).toEqual([])
    }
  })

  it("prints one ✖ that names the fix and exits 1, creating nothing", async () => {
    const cases = [
      [[], "missing app name — 'pnpm create adaptv <name>'"],
      [
        ["My App"],
        "'My App' is not a valid app name — use lowercase letters, digits and '-'",
      ],
      [["my-app", "--typescript"], "unknown option '--typescript'"],
      [["my-app", "other-app"], "one app name, not 2"],
    ]
    for (const [args, message] of cases) {
      const cwd = tempDir()
      const result = await run(args, cwd)
      expect(result.status, message).toBe(1)
      expect(result.stderr, message).toBe(`  ✖ ${message}\n\n`)
      expect(readdirSync(cwd), message).toEqual([])
    }
  })

  it("refuses a directory that already holds something, and leaves it as it was", async () => {
    const cwd = tempDir()
    mkdirSync(join(cwd, "my-app"))
    writeFileSync(join(cwd, "my-app/notes.txt"), "mine")
    const result = await run(["my-app"], cwd)
    expect(result.status).toBe(1)
    expect(result.stderr).toBe(
      "  ✖ 'my-app' already exists and is not empty\n\n",
    )
    expect(result.stdout).not.toContain("created")
    expect(readdirSync(join(cwd, "my-app"))).toEqual(["notes.txt"])
  })
})
