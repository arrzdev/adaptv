import { expect, test } from "@playwright/test"
import { bootControlled, workerState } from "./sw"

/*
 * The worker exists, installs, and precached the app.
 *
 * This is the floor. Everything else in this suite assumes it, and until now
 * nothing in CI asserted it at all — the SW only exists in a BUILD, and the main
 * e2e harness drives dev, where adaptv destroys it on purpose.
 */

test.describe("registration", () => {
  test("registers, activates and controls the page", async ({ page }) => {
    await bootControlled(page)
    const state = await workerState(page)
    expect(state.controlled).toBe(true)
    expect(state.active).toBe("activated")
  })

  test("precaches the whole app, including the shell", async ({
    page,
  }) => {
    await bootControlled(page)
    const state = await workerState(page)

    //"Install downloads the whole app" is the design (§3.2) — it is what makes an
    //installed PWA navigate like the native build. A precache that quietly shrank
    //to a handful of entries is an app that is fast only sometimes, and nothing
    //else here would notice.
    expect(state.precachedCount).toBeGreaterThan(50)

    //The navigation route BINDS to the shell. A build where it is missing from
    //the manifest produces a worker that either falls through to the browser's
    //error page (ssr) or throws `non-precached-url` and never installs (spa).
    const shell = state.precached.filter((url) =>
      /adaptv-shell\.html|\/index\.html/.test(url),
    )
    expect(
      shell,
      `no app shell among ${state.precachedCount} entries`,
    ).not.toHaveLength(0)
  })

  test("precaches exactly the icons the page and the manifest link", async ({
    page,
  }) => {
    await bootControlled(page)
    const state = await workerState(page)

    //Under `spa` the shell's head has no icon links: the client writes them
    //after `load`, so a read straight after `bootControlled` can see none and
    //count only the manifest's. Wait for the head the client renders
    await expect
      .poll(
        () =>
          page
            .locator(
              'head link[rel~="icon"], head link[rel="apple-touch-icon"]',
            )
            .count(),
        { message: "the head never linked an icon", timeout: 20_000 },
      )
      .toBeGreaterThan(0)

    //What the web surfaces point at, read off the served app rather than from a
    //list: the head's icon links and the shipped manifest's `icons`.
    const linked = await page.evaluate(async () => {
      const head = [
        ...document.querySelectorAll<HTMLLinkElement>(
          'link[rel~="icon"], link[rel="apple-touch-icon"]',
        ),
      ].map((link) => new URL(link.href).pathname)
      const manifest = (await (await fetch("/manifest.json")).json()) as {
        icons: Array<{ src: string }>
      }
      const icons = manifest.icons.map(
        (icon) => new URL(icon.src, location.href).pathname,
      )
      return [...new Set([...head, ...icons])].sort()
    })
    expect(linked, "the page links no icons at all").not.toHaveLength(0)

    //Every precached file in the directories those links live in. The icon
    //directory sits inside `public/`, so the glob reaches all of it — including
    //the native launcher sources (the 1024px master, the iOS 18 dark and tinted
    //appearances, Android's monochrome layer) that no browser ever requests.
    //Exact equality both ways: a linked icon missing is a broken offline icon,
    //an extra one is install bytes for nothing. → docs/design/rendering.md §3.2
    const iconDirs = new Set(
      linked.map((pathname) =>
        pathname.slice(0, pathname.lastIndexOf("/")),
      ),
    )
    const precachedIcons = state.precached
      .map((url) => new URL(url).pathname)
      .filter((pathname) =>
        iconDirs.has(pathname.slice(0, pathname.lastIndexOf("/"))),
      )
      .sort()
    expect(precachedIcons).toEqual(linked)
  })

  test("precaches no route DOCUMENT — that would be a cross-user leak", async ({
    page,
  }) => {
    await bootControlled(page)
    const state = await workerState(page)

    //Cache Storage is keyed by URL and scoped per-ORIGIN, not per-user, so an SSR
    //document in there is served to whoever asks next. The glob deliberately has
    //no `html` in it and the shell is added BY NAME; this asserts that property
    //of the shipped manifest rather than trusting the glob to stay that way.
    //→ docs/decisions/register.md B5/B25, docs/design/rendering.md §3.2
    const documents = state.precached
      .map((url) => new URL(url).pathname)
      .filter((pathname) => pathname.endsWith(".html"))
      .filter(
        (pathname) => !/adaptv-shell\.html|\/index\.html/.test(pathname),
      )
    expect(documents, "a route document reached the precache").toEqual([])
  })
})
