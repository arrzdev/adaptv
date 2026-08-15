// These tests are worth more than they look, because the bug they pin down has
// no symptom. It does not throw, it does not reject, it does not log, and it
// cannot happen in a browser or in happy-dom — the plugin is only a Proxy on a
// real device. What it does is stop, and everything downstream then looks like it
// was never asked to run.
//
// So the first test asserts the FAILURE, not the fix: it builds a plugin the way
// Capacitor builds one and shows that an ordinary `.then` never comes back. If
// that test ever starts passing quickly, the hazard is gone and this whole module
// can go with it.
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import type { PluginBox } from "#adaptv/utils/plugin-box.ts"
import { boxPlugin, NO_PLUGIN } from "#adaptv/utils/plugin-box.ts"

/**
 * A stand-in for a real Capacitor plugin: every property is a callable, and a
 * call never calls back — which is what a bridge message to a native method that
 * does not exist does.
 */
function capacitorPlugin(): object {
  return new Proxy(
    {},
    {
      get(_target, property) {
        //`registerPlugin` guards these two so React and JSON stay sane. It does
        //not guard `then`, and that is the entire bug.
        if (property === "$$typeof") return undefined
        if (property === "toJSON") return () => ({})
        return () => new Promise(() => {})
      },
    },
  )
}

/** Whatever settles first — the chain, or a 60ms timer. */
async function raceSettle(work: Promise<unknown>): Promise<unknown> {
  return Promise.race([
    work,
    new Promise((resolve) => setTimeout(() => resolve("HUNG"), 60)),
  ])
}

describe("🔴 a capacitor plugin is a thenable", () => {
  it("answers `then` with a callable, like every other property", () => {
    const plugin = capacitorPlugin() as { then?: unknown }
    expect(typeof plugin.then).toBe("function")
  })

  it("hangs for ever when a promise resolves TO one", async () => {
    //the shape every lazy plugin load reaches for first:
    //  import("…").then((mod) => mod.SomePlugin)
    const plugin = capacitorPlugin()
    const result = await raceSettle(
      Promise.resolve()
        .then(() => plugin)
        .then(() => "settled")
        .catch(() => "rejected"),
    )
    //not "rejected" — there is nothing to catch, which is why every `.catch`
    //in the original code was dead weight
    expect(result).toBe("HUNG")
  })
})

describe("the box", () => {
  it("lets the same plugin through immediately, and unchanged", async () => {
    const plugin = capacitorPlugin()
    const result = await raceSettle(
      Promise.resolve().then(() => boxPlugin<object>(plugin)),
    )
    expect(result).not.toBe("HUNG")
    expect((result as PluginBox<object>).plugin).toBe(plugin)
  })

  it("survives a second promise hop, where a bare proxy would not", async () => {
    //`await loadPlugin()` inside an async function is one more adoption point
    const plugin = capacitorPlugin()
    const load = async () => boxPlugin<object>(plugin)
    const result = await raceSettle(
      (async () => (await load()).plugin === plugin)(),
    )
    expect(result).toBe(true)
  })

  it("turns a missing export into null rather than undefined", () => {
    expect(boxPlugin(undefined).plugin).toBeNull()
    expect(boxPlugin(null).plugin).toBeNull()
    expect(NO_PLUGIN.plugin).toBeNull()
  })
})

describe("every lazy plugin load in the framework", () => {
  //The tests above prove the box works. They would all still pass if a caller
  //quietly stopped using it, so the callers are checked too — by their TYPE,
  //because a promise typed as resolving to a plugin IS the bug, written down.
  const callers = ["src/ota/updater.ts", "src/storage/secure.ts"]

  for (const file of callers) {
    const source = readFileSync(path.join(process.cwd(), file), "utf8")
    const code = source
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n")

    it(`${file} boxes its plugin`, () => {
      expect(code).toContain("boxPlugin")
      expect(code).toContain("PluginBox<")
    })

    it(`${file} never types a promise as resolving to a plugin`, () => {
      expect(code).not.toMatch(/Promise<\s*\w*Plugin\s*\|\s*null\s*>/)
    })

    it(`${file} opens the box with a destructure, not another .then`, () => {
      //`.then((box) => box.plugin)` would put the proxy straight back into the
      //position that hangs, while still type-checking and still building
      expect(code).not.toMatch(/=>\s*\w+\.plugin\b/)
    })
  }
})
