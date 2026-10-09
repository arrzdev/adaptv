import { createRequire } from "node:module"
import { act, waitFor } from "@testing-library/react"
import type { Root } from "react-dom/client"
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import { getLaunchViewportInitScript } from "#adaptv/shell/launch-viewport"
import { renderAppShell } from "#adaptv/vite/app-shell"

/*
 * The launch height through a boot with no server render: an `ssr` app served its
 * precached shell offline, every launch of a `render: "spa"` deploy.
 *
 * That boot is a fresh client root over the document (`client-entry.tsx`), and React
 * clears every attribute of `<html>` when it takes the element over, the inline
 * `style` the pre-paint script wrote `--pwa-launch-height` into included. The
 * server-rendered page hydrates instead and keeps it. So the splash, which React
 * paints in that same commit, fell back to the app's own height. On the iOS 26.1
 * simulator, an instrumented production build of the playground at #247's head,
 * installed and launched offline, put the mascot at 368pt, where its online
 * launches put it at 337pt.
 *
 * The root route here is adaptv's own, with its built-in document, because the
 * shell layout inside it is what has to put the height back.
 */

//the root client-entry boots, kept so the file can unmount it: the boot is still running
//when the test's assertion passes, and a root left mounted keeps scheduling work
const booted = vi.hoisted(() => ({ roots: [] as Root[] }))
vi.mock("react-dom/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom/client")>()
  return {
    ...actual,
    createRoot: (...args: Parameters<typeof actual.createRoot>) => {
      const root = actual.createRoot(...args)
      booted.roots.push(root)
      return root
    },
  }
})

vi.mock("#adaptv/routes/router-entry", async () => {
  const { createRoute } = await import("@tanstack/react-router")
  const { PwaSplashOverlay } = await import(
    "#adaptv/components/pwa-splash-overlay"
  )
  const { createAdaptvRouter } = await import(
    "#adaptv/shell/create-adaptv-router"
  )
  const { createRootRoute } = await import(
    "#adaptv/shell/create-root-route"
  )
  const rootRoute = createRootRoute({
    title: "Probe",
    themeColorLight: "#ffffff",
    themeColorDark: "#000000",
    splashScreenComponent: () => (
      <PwaSplashOverlay>booting</PwaSplashOverlay>
    ),
  })
  const index = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <p>the app rendered</p>,
  })
  return {
    getRouter: () =>
      createAdaptvRouter({ routeTree: rootRoute.addChildren([index]) }),
  }
})

const root = document.documentElement

/** The shell's head script, run as an iOS Home Screen app runs it: 812pt shown. */
function runLaunchScript() {
  const matchMedia = window.matchMedia
  window.matchMedia = ((query: string) => ({
    matches: query === "(display-mode: standalone)",
  })) as typeof window.matchMedia
  Object.defineProperty(window.navigator, "standalone", {
    configurable: true,
    value: true,
  })
  //happy-dom lays nothing out: every probe reads the height the page shows, and the
  //top inset probe reads it too, so innerHeight plus the inset is never a shrink
  const rect = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockReturnValue({ height: 812 } as DOMRect)
  new Function(getLaunchViewportInitScript())()
  rect.mockRestore()
  window.matchMedia = matchMedia
}

beforeEach(() => {
  vi.stubGlobal("fetch", () =>
    Promise.resolve(new Response("{}", { status: 200 })),
  )
  delete (window as { $_TSR?: unknown }).$_TSR
  window.history.replaceState(null, "", "/")
  const html = renderAppShell({
    lang: "en",
    title: "Probe",
    criticalCss: "html{background:#fff}",
    headInitScript: "",
    stylesHref: "/assets/main-abc123.css",
    entryHref: "/assets/client-def456.js",
  })
  root.innerHTML = html
    .replace(/^[\s\S]*?<html[^>]*>/, "")
    .replace(/<\/html>\s*$/, "")
    //happy-dom really fetches a `<link>`, against a server that is not running
    .replace(/<link\b[^>]*>/g, "")
  runLaunchScript()
})

afterEach(() => {
  vi.unstubAllGlobals()
  Reflect.deleteProperty(window.navigator, "standalone")
})

//client-entry boots at import, so the test has to import it, but not the graph under it:
//loaded here, under the hook's budget, that graph costs the test nothing. On a loaded 2-cpu
//host it took the whole 5s default inside the test
beforeAll(async () => {
  await Promise.all([
    import("@tanstack/react-start/client"),
    import("react-dom/client"),
    import("#adaptv/routes/router-entry"),
    import("#adaptv/shell/native-live-reload-client"),
  ])
}, 30_000)

//The boot outlives the test: the assertion passes on the splash's first commit, while the
//router is still rendering the app and the splash handoff still waits on a frame. Every
//commit of a concurrent root also leaves a passive-effects task in React's scheduler,
//which reads `window.event` when it runs. Left alone, those land after vitest has torn
//the happy-dom globals down, as `window is not defined` from `performWorkUntilDeadline`
//(a passing run whose gate fails, seen on a loaded CI runner). So the file lets the boot
//finish, unmounts the root inside `act` (the unmount's own passive task goes to act's
//queue and runs there; the splash handoff sees its cleanup and stops), then waits for
//the scheduler to run what the earlier commits left in it.
afterAll(async () => {
  await waitFor(
    () => expect(document.body.textContent).toContain("the app rendered"),
    { timeout: 4000 },
  )
  const actEnvironment = globalThis as {
    IS_REACT_ACT_ENVIRONMENT?: boolean
  }
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  act(() => {
    for (const root of booted.roots.splice(0)) root.unmount()
  })
  delete actEnvironment.IS_REACT_ACT_ENVIRONMENT
  //react-dom's own scheduler instance, which adaptv does not depend on by name. An idle
  //task runs after every task ready before it, so once it runs the queue is empty
  const scheduler = createRequire(
    createRequire(import.meta.url).resolve("react-dom/client"),
  )("scheduler") as {
    unstable_scheduleCallback: (
      priority: number,
      callback: () => void,
    ) => void
    unstable_IdlePriority: number
  }
  await new Promise<void>((resolve) =>
    scheduler.unstable_scheduleCallback(
      scheduler.unstable_IdlePriority,
      resolve,
    ),
  )
})

//one boot per file: client-entry boots at import and the module cache keeps it, so a
//second test here needs `vi.resetModules()`
describe("the launch height — a boot with no server render", () => {
  it("is on <html> when the client root inserts the splash", async () => {
    expect(root.style.getPropertyValue("--pwa-launch-height")).toBe(
      "812px",
    )

    //read when the splash is inserted: a MutationObserver callback runs in the
    //commit's own task, after its layout effects, so in a browser before a paint.
    //A restore deferred to a later task still leaves the height in place by the
    //time a plain waitFor reads it
    const atInsert: string[] = []
    const observer = new MutationObserver(() => {
      if (
        atInsert.length === 0 &&
        document.querySelector("[data-adaptv-splash]")
      )
        atInsert.push(root.style.getPropertyValue("--pwa-launch-height"))
    })
    observer.observe(document, { childList: true, subtree: true })

    await import("#adaptv/routes/client-entry")

    //the boot renders in a later task: waited for, up to the test's own budget
    await waitFor(() => expect(atInsert).toHaveLength(1), {
      timeout: 4000,
    })
    observer.disconnect()
    expect(atInsert[0]).toBe("812px")
  })
})
