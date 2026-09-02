import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  appConfigFingerprint,
  cliSourceFingerprint,
  fingerprint,
} from "./fingerprint.mjs"

// The staleness notice on `dev`'s watch row rests entirely on this hash. Every case below is
// an edit a dev makes mid-session that leaves the INSTALLED app wrong — the symptom being a
// terminal that says nothing at all, which is how commenting `icons` out got reported.

const app = (config = 'export default { icons: "./icons" }') => {
  const root = mkdtempSync(path.join(tmpdir(), "adaptv-fp-"))
  writeFileSync(path.join(root, "adaptv.config.ts"), config)
  mkdirSync(path.join(root, "icons"))
  return root
}

// mtime resolution is coarse enough that a rewrite inside the same millisecond can hash the
// same; stamp it forward explicitly so the test asserts the rule, not the clock.
const writeArt = (root, name, body, secondsAhead = 0) => {
  const file = path.join(root, "icons", name)
  writeFileSync(file, body)
  if (secondsAhead) {
    const t = Date.now() / 1000 + secondsAhead
    utimesSync(file, t, t)
  }
}

describe("appConfigFingerprint — did the dev change something the running app already baked in?", () => {
  it("moves when adaptv.config.ts is edited (the whole point — nativeFingerprint cannot see the file at all)", () => {
    const root = app()
    const config = { icons: "./icons" }
    const before = appConfigFingerprint(root, config)
    writeFileSync(
      path.join(root, "adaptv.config.ts"),
      'export default { icons: "./icons", name: "renamed" }',
    )
    expect(appConfigFingerprint(root, config)).not.toBe(before)
  })

  it("moves when the launcher art is edited, which is read at generateAssets time and never lands in the config", () => {
    const root = app()
    const config = { icons: "./icons" }
    writeArt(root, "icon-512.png", "original")
    const before = appConfigFingerprint(root, config)
    writeArt(root, "icon-512.png", "redrawn-art", 5)
    expect(appConfigFingerprint(root, config)).not.toBe(before)
  })

  it("moves when art is added or removed, not only when an existing file changes", () => {
    const root = app()
    const config = { icons: "./icons" }
    writeArt(root, "icon-512.png", "a")
    const before = appConfigFingerprint(root, config)
    writeArt(root, "maskable-512.png", "b")
    expect(appConfigFingerprint(root, config)).not.toBe(before)
  })

  it("is stable when nothing changed, so the notice fires once rather than every 3s poll", () => {
    const root = app()
    const config = { icons: "./icons" }
    writeArt(root, "icon-512.png", "a")
    expect(appConfigFingerprint(root, config)).toBe(
      appConfigFingerprint(root, config),
    )
  })

  it("has nothing to watch when `icons` is unset — there is no fallback directory (resolveIconSet)", () => {
    const root = app("export default {}")
    writeArt(root, "icon-512.png", "ignored")
    // Same hash with the art present and the key absent: the art is genuinely not an input.
    const withoutKey = appConfigFingerprint(root, {})
    writeArt(root, "another.png", "also-ignored", 5)
    expect(appConfigFingerprint(root, {})).toBe(withoutKey)
  })

  it("still distinguishes unsetting `icons`, because the config file's own text is hashed", () => {
    const root = app()
    writeArt(root, "icon-512.png", "a")
    const configured = appConfigFingerprint(root, { icons: "./icons" })
    writeFileSync(path.join(root, "adaptv.config.ts"), "export default {}")
    expect(appConfigFingerprint(root, {})).not.toBe(configured)
  })

  it("survives a missing config file and a missing icon dir rather than throwing into the poll", () => {
    const root = mkdtempSync(path.join(tmpdir(), "adaptv-fp-"))
    expect(() =>
      appConfigFingerprint(root, { icons: "./nope" }),
    ).not.toThrow()
  })
})

describe("cliSourceFingerprint — did adaptv's OWN source change under a running dev?", () => {
  // A fake `bin/` tree, since the real one is the module under test's own directory.
  const bin = (files) => {
    const root = mkdtempSync(path.join(tmpdir(), "adaptv-cli-"))
    mkdirSync(path.join(root, "lib"))
    for (const [name, body] of Object.entries(files))
      writeFileSync(path.join(root, name), body)
    return root
  }
  // Same-size rewrites can hash equal within one mtime tick — stamp forward so the test asserts
  // the rule, not the clock (as `writeArt` does above).
  const stamp = (root, rel, secondsAhead = 5) => {
    const t = Date.now() / 1000 + secondsAhead
    utimesSync(path.join(root, rel), t, t)
  }

  it("moves when a generator source is edited — the whole point, since a linked-adaptv edit is otherwise invisible", () => {
    const root = bin({
      "adaptv.mjs": "// entry",
      "lib/native.mjs": "export const a = 1",
    })
    const before = cliSourceFingerprint(root)
    writeFileSync(path.join(root, "lib/native.mjs"), "export const a = 2")
    stamp(root, "lib/native.mjs")
    expect(cliSourceFingerprint(root)).not.toBe(before)
  })

  it("ignores .test.mjs edits — a test change is no runtime behaviour, so it must not nag for a restart", () => {
    const root = bin({
      "lib/native.mjs": "x",
      "lib/native.test.mjs": "old",
    })
    const before = cliSourceFingerprint(root)
    writeFileSync(
      path.join(root, "lib/native.test.mjs"),
      "a much longer, different test body",
    )
    stamp(root, "lib/native.test.mjs")
    expect(cliSourceFingerprint(root)).toBe(before)
  })

  it("is stable when nothing changed, so the restart notice fires once rather than every 3s poll", () => {
    const root = bin({ "adaptv.mjs": "// entry", "lib/native.mjs": "x" })
    expect(cliSourceFingerprint(root)).toBe(cliSourceFingerprint(root))
  })
})

describe("fingerprint — did anything the web bundle is built FROM change?", () => {
  const tree = () => {
    const root = mkdtempSync(path.join(tmpdir(), "adaptv-web-"))
    mkdirSync(path.join(root, "src"))
    mkdirSync(path.join(root, ".output", "server"), { recursive: true })
    writeFileSync(path.join(root, "src", "app.tsx"), "export const a = 1")
    writeFileSync(path.join(root, ".output", "server", "index.mjs"), "v1")
    return root
  }

  it("ignores `.output/` — the SSR build is one lineage's output, never the other's input (L14), and `build web` rewrites it every run", () => {
    const root = tree()
    const before = fingerprint(root)
    writeFileSync(
      path.join(root, ".output", "server", "index.mjs"),
      "v2, rather longer, as a rebuilt server bundle is",
    )
    writeFileSync(path.join(root, ".output", "nitro.json"), "{}")
    expect(fingerprint(root)).toBe(before)
  })

  it("moves when a source file changes — the reason the walk exists", () => {
    const root = tree()
    const before = fingerprint(root)
    const file = path.join(root, "src", "app.tsx")
    writeFileSync(file, "export const a = 2")
    const t = Date.now() / 1000 + 5
    utimesSync(file, t, t)
    expect(fingerprint(root)).not.toBe(before)
  })
})
