import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { parseEnvFile } from "#env-validation/src/parser"

const dir = mkdtempSync(join(tmpdir(), "env-parser-"))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function writeEnv(contents: string): string {
  const path = join(dir, `${Math.random().toString(36).slice(2)}.env`)
  writeFileSync(path, contents)
  return path
}

describe("parseEnvFile", () => {
  it("parses simple KEY=value pairs", async () => {
    const path = writeEnv("FOO=bar\nBAZ=qux\n")
    expect(await parseEnvFile(path)).toEqual({ FOO: "bar", BAZ: "qux" })
  })

  it("skips blank lines and # comments", async () => {
    const path = writeEnv("# comment\n\nFOO=bar\n  # indented\n")
    expect(await parseEnvFile(path)).toEqual({ FOO: "bar" })
  })

  it("strips matching single or double quotes", async () => {
    const path = writeEnv(`A="quoted"\nB='single'\n`)
    expect(await parseEnvFile(path)).toEqual({ A: "quoted", B: "single" })
  })

  it("keeps '=' characters inside the value", async () => {
    const path = writeEnv("URL=postgres://u:p@h/db?x=1\n")
    expect(await parseEnvFile(path)).toEqual({
      URL: "postgres://u:p@h/db?x=1",
    })
  })

  it("returns an empty object for a missing file", async () => {
    expect(await parseEnvFile(join(dir, "nope.env"))).toEqual({})
  })
})
