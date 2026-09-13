import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { describe, expect, it } from "vitest"

/*
 * `native-live-reload-client.ts` subscribes to the dev server's own
 * `vite:ws:disconnect` event as the exact signal for a dropped HMR channel, and
 * leans on the server's client to poll and reload by itself after it. Both are
 * facts about the served client script, not about adaptv, so this test reads that
 * script and pins them: if a dev-server upgrade stops emitting the event from its
 * close listener, or stops reloading after one, the recovery loses a trigger and
 * this is where it shows.
 */
const require = createRequire(import.meta.url)
const clientPath = join(
  dirname(require.resolve("vite/package.json")),
  "dist/client/client.mjs",
)
const client = readFileSync(clientPath, "utf8")

describe("the dev server's client, as the live-reload recovery relies on it", () => {
  it("emits vite:ws:disconnect from its socket's close listener, whatever the close code", () => {
    const close = client.indexOf('socket.addEventListener("close"')
    expect(close).toBeGreaterThan(-1)
    const handler = client.slice(
      close,
      client.indexOf("onDisconnection()", close),
    )
    expect(handler).toContain('event: "vite:ws:disconnect"')
    //the Vite 5 guard that swallowed a clean close is what the mirror socket was
    //written against; it must not come back unnoticed
    expect(handler).not.toContain("wasClean")
  })

  it("polls the server and reloads the document on that event by itself", () => {
    const at = client.indexOf('payload.event === "vite:ws:disconnect"')
    expect(at).toBeGreaterThan(-1)
    const block = client.slice(at, at + 400)
    expect(block).toContain("waitForSuccessfulPing(")
    expect(block).toContain("location.reload()")
  })
})
