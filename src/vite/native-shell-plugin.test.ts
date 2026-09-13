import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import type { IncomingMessage, ServerResponse } from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { NATIVE_SHELL_ENDPOINT } from "#adaptv/shell/native-shell"
import {
  adaptvNativeShellPlugin,
  adaptvNativeShellPlugins,
  NATIVE_SHELLS_ENV,
  nativeShellMiddleware,
} from "#adaptv/vite/native-shell-plugin"

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0))
    rmSync(d, { recursive: true, force: true })
})

function shellsFile(expected: unknown): string {
  const dir = mkdtempSync(path.join(tmpdir(), "adaptv-shells-"))
  dirs.push(dir)
  const file = path.join(dir, "dev-shells.json")
  if (expected !== undefined)
    writeFileSync(
      file,
      typeof expected === "string" ? expected : JSON.stringify(expected),
    )
  return file
}

/** One request through the middleware; what it answered, or that it passed. */
function ask(
  handler: ReturnType<typeof nativeShellMiddleware>,
  url: string,
) {
  const headers: Record<string, string> = {}
  let body = ""
  let passed = false
  const res = {
    statusCode: 0,
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value
    },
    end(chunk: string) {
      body = chunk
    },
  }
  handler(
    { url } as IncomingMessage,
    res as unknown as ServerResponse,
    () => {
      passed = true
    },
  )
  return {
    passed,
    status: res.statusCode,
    headers,
    json: body ? JSON.parse(body) : null,
  }
}

describe("the dev server's native-shell answer", () => {
  it("answers the verdict for the id the client sends, read from the CLI's file", () => {
    const handler = nativeShellMiddleware(
      shellsFile({ ios: "ios-aaaa1111", android: null }),
    )
    expect(
      ask(handler, `${NATIVE_SHELL_ENDPOINT}?id=ios-aaaa1111`).json,
    ).toEqual({ verdict: "match" })
    expect(
      ask(handler, `${NATIVE_SHELL_ENDPOINT}?id=ios-bbbb2222`).json,
    ).toEqual({ verdict: "stale" })
    expect(
      ask(handler, `${NATIVE_SHELL_ENDPOINT}?id=android-cccc3333`).json,
    ).toEqual({ verdict: "pending" })
    expect(ask(handler, `${NATIVE_SHELL_ENDPOINT}?id=`).json).toEqual({
      verdict: "stale",
    })
  })

  it("re-reads the file on every request, because the CLI decides after the server is up", () => {
    const file = shellsFile({ ios: null })
    const handler = nativeShellMiddleware(file)
    const url = `${NATIVE_SHELL_ENDPOINT}?id=ios-aaaa1111`
    expect(ask(handler, url).json).toEqual({ verdict: "pending" })
    writeFileSync(file, JSON.stringify({ ios: "ios-aaaa1111" }))
    expect(ask(handler, url).json).toEqual({ verdict: "match" })
  })

  it("makes a client wait when the file is missing or unreadable — never reconnect", () => {
    const url = `${NATIVE_SHELL_ENDPOINT}?id=ios-aaaa1111`
    expect(
      ask(nativeShellMiddleware(shellsFile(undefined)), url).json,
    ).toEqual({ verdict: "pending" })
    expect(
      ask(nativeShellMiddleware(shellsFile("{ half")), url).json,
    ).toEqual({ verdict: "pending" })
  })

  it("is readable from the offline screen's origin and never cached", () => {
    const res = ask(
      nativeShellMiddleware(shellsFile({ ios: null })),
      `${NATIVE_SHELL_ENDPOINT}?id=ios-aaaa1111`,
    )
    expect(res.status).toBe(200)
    expect(res.headers["content-type"]).toBe("application/json")
    expect(res.headers["cache-control"]).toBe("no-store")
    expect(res.headers["access-control-allow-origin"]).toBe("*")
  })

  it("passes every other request through untouched", () => {
    const handler = nativeShellMiddleware(shellsFile({ ios: null }))
    expect(ask(handler, "/").passed).toBe(true)
    expect(ask(handler, `${NATIVE_SHELL_ENDPOINT}x`).passed).toBe(true)
    expect(ask(handler, `/src${NATIVE_SHELL_ENDPOINT}`).passed).toBe(true)
  })

  it("logs a shell once per verdict change, not once per poll", () => {
    const file = shellsFile({ ios: null })
    const log = vi.fn()
    const handler = nativeShellMiddleware(file, log)
    const url = `${NATIVE_SHELL_ENDPOINT}?id=ios-aaaa1111`
    ask(handler, url)
    ask(handler, url)
    ask(handler, url)
    writeFileSync(file, JSON.stringify({ ios: "ios-aaaa1111" }))
    ask(handler, url)
    expect(log.mock.calls.map((c) => c[0])).toEqual([
      "[adaptv] native shell ios-aaaa1111: pending",
      "[adaptv] native shell ios-aaaa1111: match",
    ])
  })

  it("exists on the dev server only", () => {
    expect(adaptvNativeShellPlugin("/nowhere").apply).toBe("serve")
  })

  it("is registered only for a native dev run that named its file", () => {
    const native = {
      ADAPTV_DEV_NATIVE: "1",
      [NATIVE_SHELLS_ENV]: "/x.json",
    }
    expect(adaptvNativeShellPlugins("web", native)).toHaveLength(1)
    //`dev web` and a bare dev server
    expect(adaptvNativeShellPlugins("web", {})).toEqual([])
    expect(
      adaptvNativeShellPlugins("web", { [NATIVE_SHELLS_ENV]: "/x.json" }),
    ).toEqual([])
    expect(
      adaptvNativeShellPlugins("web", { ADAPTV_DEV_NATIVE: "1" }),
    ).toEqual([])
    //the native bundle has no dev server of its own
    expect(adaptvNativeShellPlugins("capacitor", native)).toEqual([])
  })
})
