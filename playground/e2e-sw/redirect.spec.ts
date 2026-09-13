import { expect, test } from "@playwright/test"
import {
  bootControlled,
  engineReportsServiceWorker,
  navigateInIsolation,
  RENDER,
  ROUTE,
  workerState,
} from "./sw"

/*
 * A navigation that answers with a redirect, with the worker in the path.
 *
 * This is the shape of "you are not signed in" — the single most common thing an
 * SSR app does — and the worker sits in front of every one of them. It is also
 * the shape with a specific, well-known way to break: a fetch handler that
 * returns a response with `redirected === true` for a navigation makes the
 * browser refuse the whole document with
 *
 *   Response served by service worker has redirections
 *
 * ...and the user gets a dead tab, not a login page. Nothing about it is visible
 * in a build; it only appears once a real browser follows a real 3xx.
 *
 * What keeps adaptv on the right side of it is one character: `serveNavigation`
 * fetches the REQUEST, not the URL. A navigation request carries
 * `redirect: "manual"`, so a 3xx comes back as an opaqueredirect that the browser
 * follows itself, and `redirected` is never set. Rewriting that as `fetch(url)` —
 * which reads like a harmless simplification, and is the form most snippets use —
 * silently turns every redirect in the app into a broken navigation.
 *
 * That rewrite is why there is a THIRD test here. MEASURED: with preload on,
 * `fetch(url)` breaks nothing, because `io.fetch()` is never reached — the
 * preload has already resolved and `serveNavigation` returns it. The fallback
 * fetch is dead code in Chromium and in Safari 15.4+... and it is what
 * **Firefox** runs on every single navigation, having no navigation preload at
 * all, along with every Safari before 15.4. So the one path where this bug is
 * reachable is the one path a green two-engine suite says nothing about. The
 * third test turns preload off for one navigation to walk it.
 *
 * `/sw-probe-redirect` throws a router redirect in `beforeLoad`, which under
 * `ssr` is a real `307` + `Location` from the server, and under `spa` is the
 * client router doing it after the shell boots. Two different mechanisms, one
 * URL, and the same thing has to be true of both.
 */
const REDIRECT = "/sw-probe-redirect"

test.describe(`redirects (render: ${RENDER})`, () => {
  test("a redirect lands on its target before a worker exists", async ({
    page,
  }) => {
    //The control. Without it, a green test below is equally consistent with a
    //fixture that never redirected in the first place — and with `spa` in the
    //mix, "the server 307s" is not even true on every run of this file.
    const response = await page.goto(REDIRECT, {
      waitUntil: "domcontentloaded",
    })
    //Read before the client router moves the URL, while it is still the document
    //this visit booted from.
    const serverRedirected = response?.request().redirectedFrom() != null
    const bootstrapped = /\$_TSR/.test((await response?.text()) ?? "")
    await expect
      .poll(() => new URL(page.url()).pathname, {
        message: `${REDIRECT} did not reach ${ROUTE} with NO service worker involved — the fixture is broken, not the worker`,
      })
      .toBe(ROUTE)

    //WHICH mechanism got it there, because a server that renders spa navigations
    //satisfies the poll above just as well. That is the host the spa suite used
    //to run on: every first visit was a server render, so the static shell's own
    //boot, and the client redirect this file claims for spa, never ran before a
    //worker took over. Soft, so a host that does both reports both.
    if (RENDER === "spa") {
      expect
        .soft(
          serverRedirected,
          "the origin answered with a 3xx — a static spa host has no router, so the client never redirected",
        )
        .toBe(false)
      expect
        .soft(
          bootstrapped,
          "the first document carries the server bootstrap ($_TSR) — it was rendered by a server, not the static shell",
        )
        .toBe(false)
    } else {
      expect(
        serverRedirected,
        "no 3xx from the server — ssr redirects in the response, before any client code",
      ).toBe(true)
    }
  })

  test("...and still lands there with the worker serving navigations", async ({
    page,
    browserName,
  }) => {
    await bootControlled(page)

    //Preload is the half that makes this worth asserting rather than assuming:
    //it is the browser's own request, handed to the worker as a promise, and it
    //is where a followed redirect would arrive from if one ever did.
    const state = await workerState(page)
    expect(
      state.controlled,
      "not controlled — this would be measuring the plain browser",
    ).toBe(true)
    if (RENDER === "ssr")
      expect(
        state.preloadEnabled,
        "preload off in an ssr build — the redirect below no longer travels the path this test exists to cover",
      ).toBe(true)

    const result = await navigateInIsolation(page, REDIRECT)
    //A refused redirect fails the navigation outright, so `ok: false` IS the
    //symptom — surface the browser's own reason rather than a bare boolean.
    expect(
      result.ok ? "ok" : `navigation failed: ${result.reason}`,
      "the navigation died with the worker in the path",
    ).toBe("ok")
    if (!result.ok) return

    expect(result.url, `${REDIRECT} did not reach ${ROUTE}`).toBe(ROUTE)
    expect(
      result.isAppDocument,
      "landed on the target but the document is not the app",
    ).toBe(true)
    if (engineReportsServiceWorker(browserName))
      expect(
        result.fromServiceWorker,
        "the worker declined the navigation, so this run proved nothing about it",
      ).toBe(true)
  })

  //`spa` navigations never reach the network, so there is no fallback fetch to
  //walk — the shell answers and the client router redirects from there, which is
  //what the test above already covers in that mode.
  test.describe(() => {
    test.skip(
      () => RENDER !== "ssr",
      "no network fetch in a spa navigation — nothing to cover",
    )

    test("...and on a browser with no navigation preload", async ({
      page,
    }) => {
      await bootControlled(page)

      //Preload is a property of the REGISTRATION and can be turned off from the
      //page, which is the only way to reach `serveNavigation`'s fallback fetch in
      //an engine that supports preload. It is exactly the state Firefox is
      //permanently in. adaptv re-enables it on the next activate, so this does
      //not leak into another test.
      const disabled = await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.ready
        if (!registration.navigationPreload) return false
        await registration.navigationPreload.disable()
        return !(await registration.navigationPreload.getState()).enabled
      })
      expect(
        disabled,
        "could not turn preload off, so the fallback fetch was not the path under test",
      ).toBe(true)

      const result = await navigateInIsolation(page, REDIRECT)
      expect(
        result.ok ? "ok" : `navigation failed: ${result.reason}`,
        "the navigation died on the no-preload path — this is what Firefox and Safari < 15.4 do on EVERY navigation",
      ).toBe("ok")
      if (!result.ok) return

      expect(result.url, `${REDIRECT} did not reach ${ROUTE}`).toBe(ROUTE)
      expect(result.isAppDocument, "the document is not the app").toBe(
        true,
      )
    })
  })
})
