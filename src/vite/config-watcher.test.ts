import { EventEmitter } from "node:events"
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { AdaptvContext } from "#adaptv/vite/adaptv-context"
import { createAdaptvContext } from "#adaptv/vite/adaptv-context"
import { adaptvConfigLoaderPlugin } from "#adaptv/vite/adaptv-plugin"
import { loadAppConfig } from "#adaptv/vite/app-config-loader"

/**
 * The dev server's `adaptv.config.ts` watcher, driven through a fake server.
 *
 * A save is not a build: the dev types half a line, saves, and keeps typing. The
 * watcher used to hand `loadAppConfig`'s rejection to `void`, and a consumer's Vite
 * runs from `node_modules`, where it installs no `unhandledRejection` handler — so
 * Node's default applied and one typo in the config ended the dev server. What a
 * save that does not load must do instead: say why, in the terminal and on the
 * page, and keep serving the config that last loaded.
 */

let dir: string
let configPath: string

const usable = `
  name: "Probe",
  description: "d",
  themeColor: { light: "#eeeeec" },
  styles: "./src/styles/main.css",
  router: { routesDirectory: "./routing" },
`

async function writeConfig(source: string): Promise<void> {
  await writeFile(configPath, source)
}

function fakeServer() {
  const watcher = Object.assign(new EventEmitter(), { add: vi.fn() })
  return {
    watcher,
    ws: { send: vi.fn() },
    config: {
      logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    },
  }
}

type FakeServer = ReturnType<typeof fakeServer>

async function watch(context: AdaptvContext): Promise<FakeServer> {
  const server = fakeServer()
  const hook = adaptvConfigLoaderPlugin(context).configureServer
  if (typeof hook !== "function")
    throw new Error("no configureServer hook")
  await hook.call({} as never, server as never)
  return server
}

/**
 * Emit a change and wait until the watcher has answered it: a message to the page,
 * or a rejection nothing handled. Either ends the wait, so the unfixed watcher fails
 * on the rejection instead of timing out.
 */
async function change(
  server: FakeServer,
  file: string,
): Promise<unknown[]> {
  const escaped: unknown[] = []
  const onRejection = (reason: unknown) => escaped.push(reason)
  process.on("unhandledRejection", onRejection)
  try {
    const sent = server.ws.send.mock.calls.length
    server.watcher.emit("change", file)
    await vi.waitFor(
      () => {
        if (
          escaped.length === 0 &&
          server.ws.send.mock.calls.length === sent
        )
          throw new Error("the watcher has not answered yet")
      },
      { timeout: 5000, interval: 10 },
    )
    //one more turn, so a rejection that lands right after a send is still seen
    await new Promise((resolve) => setTimeout(resolve, 20))
  } finally {
    process.off("unhandledRejection", onRejection)
  }
  return escaped
}

const lastSent = (server: FakeServer) =>
  server.ws.send.mock.calls.at(-1)?.[0]

beforeEach(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), "adaptv-watch-")))
  configPath = path.join(dir, "adaptv.config.ts")
  await writeConfig(`export default {\n${usable}\n}\n`)
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe("adaptvConfigLoaderPlugin — a save that does not load keeps the dev server up", () => {
  it("survives a syntax error, says why, and keeps the last good config", async () => {
    const context = createAdaptvContext(dir)
    context.loaded = await loadAppConfig(dir)
    const good = context.loaded
    const server = await watch(context)

    await writeConfig(`export default {\n${usable}\n`) //the closing brace is gone
    const escaped = await change(server, configPath)

    expect(escaped).toEqual([])
    expect(lastSent(server)).toMatchObject({
      type: "error",
      err: { message: expect.stringContaining("adaptv.config.ts") },
    })
    expect(server.config.logger.error).toHaveBeenCalledOnce()
    expect(context.loaded).toBe(good)
  })

  it("survives a value the build refuses, naming the key", async () => {
    const context = createAdaptvContext(dir)
    context.loaded = await loadAppConfig(dir)
    const good = context.loaded
    const server = await watch(context)

    await writeConfig(
      `export default {\n${usable.replace('"#eeeeec"', '"red"')}\n}\n`,
    )
    const escaped = await change(server, configPath)

    expect(escaped).toEqual([])
    expect(lastSent(server)).toMatchObject({
      type: "error",
      err: {
        message: expect.stringContaining(
          "'themeColor.light' must be a hex colour like #1b1b1b, got \"red\"",
        ),
      },
    })
    expect(server.config.logger.error.mock.calls[0]?.[0]).toContain(
      "'themeColor.light' must be a hex colour",
    )
    expect(context.loaded).toBe(good)
  })

  it("reloads once the config is fixed", async () => {
    const context = createAdaptvContext(dir)
    context.loaded = await loadAppConfig(dir)
    const server = await watch(context)

    await writeConfig(`export default {\n${usable}\n`)
    await change(server, configPath)
    await writeConfig(
      `export default {\n${usable.replace('"Probe"', '"Fixed"')}\n}\n`,
    )
    const escaped = await change(server, configPath)

    expect(escaped).toEqual([])
    expect(lastSent(server)).toEqual({ type: "full-reload" })
    expect(context.loaded?.config.name).toBe("Fixed")
  })

  it("watches a module the config starts importing, and reloads on its edit", async () => {
    const context = createAdaptvContext(dir)
    context.loaded = await loadAppConfig(dir)
    const server = await watch(context)
    const helper = path.join(dir, "theme.ts")

    await writeFile(helper, `export const light = "#eeeeec"\n`)
    await writeConfig(
      `import { light } from "./theme"\nexport default {\n${usable.replace('"#eeeeec"', "light")}\n}\n`,
    )
    await change(server, configPath)
    expect(server.watcher.add.mock.calls.flat(2)).toContain(helper)

    await writeFile(helper, `export const light = "#000000"\n`)
    const escaped = await change(server, helper)

    expect(escaped).toEqual([])
    expect(lastSent(server)).toEqual({ type: "full-reload" })
    expect(context.loaded?.config.themeColor.light).toBe("#000000")
  })
})
