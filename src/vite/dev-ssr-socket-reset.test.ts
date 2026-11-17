// @vitest-environment node
import { readFileSync, realpathSync } from "node:fs"
import type { Server } from "node:http"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import type { Plugin } from "vite"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  devSsrSocketResetResend,
  resendOnSocketReset,
} from "#adaptv/vite/dev-ssr-socket-reset.ts"

//nitro's own dependency tree, not a copy: the pooled agent under test is the
//module-level one inside the httpxy that env-runner proxies the SSR worker with
const nitroDir = dirname(fileURLToPath(import.meta.resolve("nitro/vite")))
const envRunnerDir = realpathSync(join(nitroDir, "../../env-runner"))
const { proxyFetch } = (await import(
  pathToFileURL(
    join(realpathSync(join(envRunnerDir, "../httpxy")), "dist/index.mjs"),
  ).href
)) as {
  proxyFetch: (addr: string, input: Request) => Promise<Response>
}

let server: Server | undefined
afterEach(async () => {
  const open = server
  if (!open) return
  open.closeAllConnections()
  await new Promise((resolve) => open.close(resolve))
  server = undefined
})

/**
 * The SSR worker at the moment its keep-alive timer fires: the first request on a
 * socket is answered, the next one sent on that same pooled socket is reset. On
 * a real server this needs the two to cross within a tick; here it is every time.
 */
async function workerClosingIdleSockets() {
  const served = new WeakSet<object>()
  let resets = 0
  server = createServer((req, res) => {
    if (served.has(req.socket) && resets === 0) {
      resets++
      req.socket.resetAndDestroy()
      return
    }
    served.add(req.socket)
    res.end("<div data-adaptv-screen></div>")
  })
  await new Promise<void>((resolve) =>
    server?.listen(0, "127.0.0.1", resolve),
  )
  const { port } = server.address() as AddressInfo
  const addr = `http://127.0.0.1:${port}`
  return {
    fetch: (input: Request | string | URL) =>
      proxyFetch(addr, input as Request),
    page: () => new Request(`${addr}/`),
    resets: () => resets,
  }
}

describe("resendOnSocketReset", () => {
  it("a page requested on a socket the worker just reset is the app, not a 500", async () => {
    //TUD-5881: `GET /` sent on a pooled socket the worker was closing failed with
    //`read ECONNRESET`, and Vite answered the navigation with its error overlay
    const worker = await workerClosingIdleSockets()
    const first = await worker.fetch(worker.page())
    expect(await first.text()).toContain("data-adaptv-screen")

    //the upstream path alone: the reused socket's reset is the request's error
    await expect(worker.fetch(worker.page())).rejects.toMatchObject({
      code: "ECONNRESET",
    })
    expect(worker.resets()).toBe(1)
  })

  it("re-sends it once on a fresh socket", async () => {
    const worker = await workerClosingIdleSockets()
    const fetch = resendOnSocketReset(worker.fetch)
    await (await fetch(worker.page())).text()
    const second = await fetch(worker.page())
    expect(worker.resets()).toBe(1)
    expect(second.status).toBe(200)
    expect(await second.text()).toContain("data-adaptv-screen")
  })

  const reset = () =>
    Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" })

  it("never repeats a POST: a server function could run twice", async () => {
    const fetch = vi.fn().mockRejectedValue(reset())
    await expect(
      resendOnSocketReset(fetch)(
        new Request("http://x/_server", { method: "POST", body: "{}" }),
      ),
    ).rejects.toMatchObject({ code: "ECONNRESET" })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it("leaves any other error, and a second reset, to Vite's error page", async () => {
    const other = vi.fn().mockRejectedValue(new Error("render threw"))
    await expect(
      resendOnSocketReset(other)(new Request("http://x/")),
    ).rejects.toThrow("render threw")
    expect(other).toHaveBeenCalledTimes(1)

    const twice = vi.fn().mockRejectedValue(reset())
    await expect(
      resendOnSocketReset(twice)(new Request("http://x/")),
    ).rejects.toMatchObject({ code: "ECONNRESET" })
    expect(twice).toHaveBeenCalledTimes(2)
  })
})

describe("devSsrSocketResetResend", () => {
  const configure = (environments: Record<string, unknown>) => {
    const plugin = devSsrSocketResetResend("nitro")
    // biome-ignore lint/suspicious/noExplicitAny: calling a Vite hook outside Vite
    ;(plugin.configureServer as any)({ environments })
    return plugin
  }

  it("wraps the fetch of Nitro's dev runner, in dev only", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("read ECONNRESET"), {
          code: "ECONNRESET",
        }),
      )
      .mockResolvedValue(new Response("ok"))
    const runner = { fetch }
    const plugin: Plugin = configure({ nitro: { devServer: runner } })
    expect(plugin.apply).toBe("serve")
    expect(runner.fetch).not.toBe(fetch)
    expect(
      await (await runner.fetch(new Request("http://x/"))).text(),
    ).toBe("ok")
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it("does nothing without a Nitro dev environment", () => {
    expect(() => configure({})).not.toThrow()
  })

  it("wraps the call Nitro's dev middleware renders every page through", () => {
    //the pinned nitro proxies a page as `nitroEnv.dispatchFetch(req)`, which is
    //`this.devServer.fetch(request)`; a bump that moves it would leave the wrap
    //above on a function nothing calls
    const source = readFileSync(
      join(nitroDir, "_build/vite.dev.mjs"),
      "utf8",
    )
    expect(source).toContain("return this.devServer.fetch(request)")
    expect(source).toContain("await nitroEnv.dispatchFetch(req)")
  })
})
