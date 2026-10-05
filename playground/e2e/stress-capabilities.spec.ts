import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { capabilitiesUrl } from "./support/framework"
import { awaitClientHandover } from "./support/hydrated"

/*
 * Capabilities under concurrency — fifty calls at once into clipboard, share,
 * haptics and the notification permission, on both engines, and every
 * capability page under a CPU slowed four times on Chromium.
 *
 * The contracts, from each module's header: `writeClipboardText`,
 * `requestNotifyPermission` and `share` (bar a caller error) never reject;
 * fifty concurrent calls therefore all SETTLE, and they settle on the same
 * answer, because the platform's state did not change between them. `share`
 * rejects only for a real caller error — `NotAllowedError` outside a user
 * gesture, `InvalidStateError` while a sheet is already up — and reads a
 * user's cancel (`AbortError`) as `"dismissed"`. `haptics` on the web is a 200 ms
 * cooldown over `navigator.vibrate`, so a burst is one pulse. On the web every
 * one of these takes the "not installed" fallback, which is the path stressed.
 *
 * The calls go to the capability modules the app itself imports, through the
 * `/capabilities` entry at the URL the dev server serves it at
 * (`support/framework.ts`).
 */

type Settled = { status: "fulfilled" | "rejected"; value: unknown }

/** Fifty concurrent calls, each settled and serialised for the assertion. */
async function settleAll(page: Page, body: string): Promise<Settled[]> {
  const url = await capabilitiesUrl(page)
  return page.evaluate(
    async ([url, body]) => {
      const mod = await import(/* @vite-ignore */ url)
      const call = new Function("mod", "index", body) as (
        mod: unknown,
        index: number,
      ) => Promise<unknown>
      const results = await Promise.allSettled(
        Array.from({ length: 50 }, (_, index) =>
          Promise.resolve().then(() => call(mod, index)),
        ),
      )
      return results.map((result) =>
        result.status === "fulfilled"
          ? { status: result.status, value: result.value }
          : {
              status: result.status,
              value:
                result.reason instanceof Error
                  ? result.reason.name
                  : String(result.reason),
            },
      )
    },
    [url, body] as const,
  )
}

const distinct = (results: Settled[]) =>
  Array.from(
    new Set(results.map((r) => `${r.status}:${JSON.stringify(r.value)}`)),
  )

test.describe("Capabilities under concurrency", () => {
  test("fifty clipboard writes at once all settle on one answer, and the clipboard holds one of them", async ({
    page,
    browserName,
  }) => {
    if (browserName === "chromium") {
      await page
        .context()
        .grantPermissions(["clipboard-read", "clipboard-write"])
    }
    await page.goto("/lab/clipboard")
    await awaitClientHandover(page)

    const results = await settleAll(
      page,
      "return mod.writeClipboardText('stress ' + index)",
    )
    expect(results.every((r) => r.status === "fulfilled")).toBe(true)
    expect(distinct(results)).toHaveLength(1)
    if (browserName === "chromium") {
      //the premise for the read: the writes really landed
      expect(results[0].value).toBe("ok")
      const read = await page.evaluate(
        async (url) => {
          const mod = await import(/* @vite-ignore */ url)
          return mod.readClipboardText()
        },
        await capabilitiesUrl(page),
      )
      expect(read.status).toBe("ok")
      expect(read.text).toMatch(/^stress \d+$/)
    }
  })

  test("fifty shares at once settle together — unsupported, dismissed, shared, or all rejected for a caller error", async ({
    page,
  }) => {
    await page.goto("/lab/share")
    await awaitClientHandover(page)
    const target = { title: "stress", text: "fifty at once" }
    const call = `return mod.share(${JSON.stringify(target)})`

    const sheet = await page.evaluate(
      () => typeof navigator.share === "function",
    )
    const engine = await settleAll(page, call)
    if (!sheet) {
      //headless Chromium has no navigator.share: the not-installed fallback,
      //fifty times
      expect(distinct(engine)).toEqual(['fulfilled:"unsupported"'])
    } else {
      //WebKit's headless sheet resolves at once, and the Web Share spec rejects
      //every call made while one is in progress with InvalidStateError. All
      //fifty are issued in one microtask checkpoint, so exactly one is the
      //sheet and forty-nine are the engine's own refusal — a caller error the
      //capability passes through, by contract, rather than a value
      const outcomes = engine.map(
        (r) => `${r.status}:${JSON.stringify(r.value)}`,
      )
      expect(
        outcomes.filter((o) => o === 'fulfilled:"shared"'),
      ).toHaveLength(1)
      expect(
        outcomes.filter((o) => o === 'rejected:"InvalidStateError"'),
      ).toHaveLength(49)
    }

    const stub = (page: Page, mode: "abort" | "refuse" | "resolve") =>
      page.evaluate((mode) => {
        const nav = navigator as { share?: unknown; canShare?: unknown }
        let calls = 0
        nav.canShare = () => true
        nav.share = () => {
          calls += 1
          if (mode === "resolve") return Promise.resolve()
          return Promise.reject(
            new DOMException(
              mode,
              mode === "abort" ? "AbortError" : "NotAllowedError",
            ),
          )
        }
        ;(window as { __shareCalls?: () => number }).__shareCalls = () =>
          calls
      }, mode)
    const calls = (page: Page) =>
      page.evaluate(
        () =>
          (window as { __shareCalls?: () => number }).__shareCalls?.() ??
          -1,
      )

    await stub(page, "abort")
    const dismissed = await settleAll(page, call)
    expect(await calls(page), "the premise: the stub was the share").toBe(
      50,
    )
    expect(distinct(dismissed)).toEqual(['fulfilled:"dismissed"'])

    await stub(page, "refuse")
    const refused = await settleAll(page, call)
    expect(await calls(page)).toBe(50)
    expect(distinct(refused)).toEqual(['rejected:"NotAllowedError"'])

    await stub(page, "resolve")
    const shared = await settleAll(page, call)
    expect(await calls(page)).toBe(50)
    expect(distinct(shared)).toEqual(['fulfilled:"shared"'])
  })

  test("fifty haptic impacts in one burst are one pulse on the web", async ({
    page,
  }) => {
    await page.goto("/lab/haptics")
    await awaitClientHandover(page)
    const pulses = await page.evaluate(
      async (url) => {
        const mod = await import(/* @vite-ignore */ url)
        let pulses = 0
        Object.defineProperty(navigator, "vibrate", {
          configurable: true,
          value: () => {
            pulses += 1
            return true
          },
        })
        if (!mod.haptics.isSupported())
          throw new Error("the stub did not take")
        for (let index = 0; index < 50; index += 1)
          mod.haptics.impact("medium")
        for (let index = 0; index < 50; index += 1) mod.haptics.selection()
        return pulses
      },
      await capabilitiesUrl(page),
    )
    expect(pulses).toBe(1)
  })

  test("fifty permission requests at once all settle on the same state", async ({
    page,
  }) => {
    await page.goto("/lab/notifications")
    await awaitClientHandover(page)
    const present = await page.evaluate(() => "Notification" in window)
    if (present) {
      //the prompt is stubbed to hold every request until the test releases it
      //with "denied". The capability then re-reads the state through the
      //Permissions API rather than trusting the prompt's own answer (its
      //header says why: the two disagree under automation), so the query is
      //stubbed to agree with the prompt once it has answered
      await page.evaluate(() => {
        let calls = 0
        let answered: PermissionState = "prompt"
        let release: ((value: NotificationPermission) => void) | null =
          null
        const gate = new Promise<NotificationPermission>((resolve) => {
          release = resolve
        })
        Notification.requestPermission = () => {
          calls += 1
          return gate
        }
        navigator.permissions.query = () =>
          Promise.resolve({ state: answered } as PermissionStatus)
        const seam = window as {
          __notify?: { calls: () => number; release: () => void }
        }
        seam.__notify = {
          calls: () => calls,
          release: () => {
            answered = "denied"
            release?.("denied")
          },
        }
      })
    }
    const pending = settleAll(page, "return mod.requestNotifyPermission()")
    if (present) {
      await expect
        .poll(
          () =>
            page.evaluate(
              () =>
                (
                  window as { __notify?: { calls: () => number } }
                ).__notify?.calls() ?? -1,
            ),
          { message: "the premise: every request reached the prompt" },
        )
        .toBe(50)
      await page.evaluate(() =>
        (
          window as { __notify?: { release: () => void } }
        ).__notify?.release(),
      )
    }
    const results = await pending
    expect(results.every((r) => r.status === "fulfilled")).toBe(true)
    const answers = distinct(results)
    expect(answers).toHaveLength(1)
    //the one prompt answered "denied", and every request read that answer
    expect(answers).toEqual([
      present ? 'fulfilled:"denied"' : 'fulfilled:"unavailable"',
    ])
  })
})

const PAGES = [
  ["/lab/share", "Share"],
  ["/lab/compose", "Compose"],
  ["/lab/print", "Print"],
  ["/lab/clipboard", "Clipboard"],
  ["/lab/app-info", "App info"],
  ["/lab/device", "Device"],
  ["/lab/locale", "Locale"],
  ["/lab/orientation", "Orientation"],
  ["/lab/keep-awake", "Keep awake"],
  ["/lab/filesystem", "Filesystem"],
  ["/lab/speech", "Speech"],
  ["/lab/privacy-screen", "Privacy screen"],
  ["/lab/screen-reader", "Screen reader"],
  ["/lab/notifications", "Notifications"],
  ["/lab/app-state", "App state"],
  ["/lab/back-chain", "Back chain"],
  ["/lab/browser", "Browser"],
  ["/lab/geolocation", "Geolocation"],
  ["/lab/haptics", "Haptics"],
  ["/lab/native-theme", "Native theme"],
  ["/lab/battery", "Battery"],
  ["/lab/motion", "Motion"],
  ["/lab/network", "Network"],
  ["/lab/status-bar", "Status bar"],
  ["/lab/hooks", "Standalone hooks"],
] as const

test.describe("Capabilities under a slow CPU", () => {
  test("every capability page mounts with no uncaught error at a quarter of the speed", async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName !== "chromium",
      "CPU throttling is a CDP emulation",
    )
    //twenty-five cold routes at a quarter of the speed: each first transform
    //is the dev server's, each boot is the throttled engine's. The handover
    //gate keeps its own 20 s per page; this is the budget for all of them
    test.setTimeout(240_000)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 })

    const errors: string[] = []
    page.on("pageerror", (error) =>
      errors.push(`uncaught: ${error.message}`),
    )
    page.on("console", (message) => {
      if (message.type() === "error") {
        errors.push(`console.error: ${message.text()}`)
      }
    })
    for (const [route, title] of PAGES) {
      await page.goto(route)
      await awaitClientHandover(page)
      await expect(
        page.getByRole("heading", { level: 1, name: title }),
      ).toBeVisible()
    }
    expect(errors).toEqual([])
  })
})
