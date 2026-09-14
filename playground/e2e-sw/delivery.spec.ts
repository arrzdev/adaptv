import { expect, test } from "@playwright/test"
import { RENDER } from "./sw"

/*
 * The server hands out the two files the worker is made of.
 *
 * Below the floor `registration.spec.ts` stands on, and asked of the server
 * rather than the browser, so a failure names the file instead of timing out
 * waiting for a controller. It is the assertion that tells the node server apart
 * from preview: the built server serves static files from a table it baked, and
 * the worker and the shell used to be written after it (`deploy-server.ts`).
 */

const SHELL = RENDER === "spa" ? "/index.html" : "/adaptv-shell.html"

test.describe(`delivery files (render: ${RENDER})`, () => {
  test("/sw.js is served as JavaScript", async ({ request }) => {
    const response = await request.get("/sw.js")
    expect(response.status()).toBe(200)
    //a browser refuses to register a worker served with any other type
    expect(response.headers()["content-type"]).toMatch(
      /^(text|application)\/javascript/,
    )
    //A browser checks for a new worker against its HTTP cache, so a long-lived or
    //immutable `/sw.js` stalls every update behind it. The node server bakes
    //`immutable` for `/assets/`, and the worker must stay out of that rule.
    const cacheControl = response.headers()["cache-control"] ?? ""
    expect(cacheControl).not.toContain("immutable")
    expect(Number(/max-age=(\d+)/.exec(cacheControl)?.[1] ?? 0)).toBe(0)
    //and it is this build's worker, bound to this build's shell
    const worker = await response.text()
    expect(worker).toContain(`"url":"${SHELL.slice(1)}"`)
    //The worker is written after the build copied `public/`, and its precache
    //has to see those files. `deploy-server.ts` leans on the server build
    //copying them before its environment starts; if that order ever moved, the
    //precache would drop them in silence while every page still loaded.
    expect(worker).toContain('"url":"favicons/android-chrome-192.png"')
  })

  test(`${SHELL}, the shell the worker binds to, is served`, async ({
    request,
  }) => {
    const response = await request.get(SHELL)
    expect(response.status()).toBe(200)
    expect(response.headers()["content-type"]).toContain("text/html")
  })
})
