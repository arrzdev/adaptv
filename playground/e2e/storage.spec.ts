import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * Storage — the three tiers in a real browser. Every tier has unit tests, but they
 * run on happy-dom's localStorage and fake-indexeddb; nothing else proved that a
 * value survives a real reload, that the browser's `storage` event actually carries
 * a kv write into another tab, or that a refusal from a real engine is handled the
 * way the tier says. Each claim here is the documented contract, not a guess at one:
 * `docs/design/architecture.md §2` and the tier headers in `src/storage/`.
 *
 * Every test starts from an empty origin, because each gets its own browser context.
 * That is asserted rather than assumed — a leftover value would make "survives a
 * reload" pass on the previous run's write.
 *
 * Waits are on state. A reload right after a store write is only honest once the
 * write has committed, and a value on screen is not that: a write is readable from
 * memory before its transaction lands. So {@link idbValue} reads IndexedDB itself,
 * from the page, and the reload waits on it.
 */

const NOTE = "lab-storage.note"
const LARGE = "lab-storage.large"

async function open(page: Page) {
  await page.goto("/lab/storage")
  await awaitClientHandover(page)
}

async function reload(page: Page) {
  await page.reload()
  await awaitClientHandover(page)
}

const readout = (page: Page, id: string) => page.getByTestId(id)

const section = (page: Page, title: string) =>
  page.locator("section").filter({
    has: page.getByRole("heading", { name: title, exact: true }),
  })

/**
 * What adaptv's IndexedDB database holds under a key, read beside the app rather
 * than through it — so it reports what is on disk, never the tier's memory.
 *
 * Opened WITHOUT a version on purpose, and aborted if that would create the
 * database: creating it here, empty, would make the app's own open find version 1
 * already present with no object store, and the tier would silently run on memory.
 */
function idbValue(page: Page, key: string): Promise<string> {
  return page.evaluate(
    (key) =>
      new Promise<string>((resolve) => {
        const request = indexedDB.open("adaptv-store")
        request.onupgradeneeded = () => request.transaction?.abort()
        request.onerror = () => resolve("no database")
        request.onsuccess = () => {
          const db = request.result
          const get = db
            .transaction("kv", "readonly")
            .objectStore("kv")
            .get(key)
          get.onsuccess = () => {
            db.close()
            const value = get.result
            if (value === undefined) resolve("absent")
            else if (value instanceof Uint8Array)
              resolve(`${value.byteLength} bytes`)
            else
              resolve(
                `count ${value.count}, Date ${value.savedAt instanceof Date}`,
              )
          }
        }
      }),
    key,
  )
}

test.describe("kv and useKv", () => {
  test("a value survives a reload, and every reader on the key follows each write", async ({
    page,
  }) => {
    await open(page)
    await expect(readout(page, "kv-a")).toHaveText("0")
    await expect(readout(page, "kv-raw")).toHaveText("nothing")

    await page.getByRole("button", { name: "Increment from A" }).click()
    await expect(readout(page, "kv-b")).toHaveText("1")
    await page.getByRole("button", { name: "Increment from A" }).click()
    await expect(readout(page, "kv-a")).toHaveText("2")
    await expect(readout(page, "kv-b")).toHaveText("2")
    await expect(readout(page, "kv-notifications")).toHaveText("2")
    //web writes through synchronously: the browser's own storage has it already
    await expect(readout(page, "kv-raw")).toHaveText("2")

    await page
      .getByRole("button", { name: "kv.set 100 outside React" })
      .click()
    await expect(readout(page, "kv-a")).toHaveText("100")
    await expect(readout(page, "kv-b")).toHaveText("100")

    await reload(page)
    await expect(readout(page, "kv-a")).toHaveText("100")
    await expect(readout(page, "kv-b")).toHaveText("100")

    await section(page, "kv — synchronous")
      .getByRole("button", { name: "Remove the key" })
      .click()
    await expect(readout(page, "kv-a")).toHaveText("0")
    await expect(readout(page, "kv-raw")).toHaveText("nothing")
    await reload(page)
    await expect(readout(page, "kv-a")).toHaveText("0")
  })

  test("a write in one tab reaches useKv and subscribeKv in another tab", async ({
    page,
    context,
  }) => {
    const other = await context.newPage()
    await open(page)
    await open(other)
    await expect(readout(other, "kv-a")).toHaveText("0")

    await page.getByRole("button", { name: "Increment from A" }).click()
    await expect(readout(page, "kv-a")).toHaveText("1")
    await expect(readout(other, "kv-a")).toHaveText("1")
    await expect(readout(other, "kv-b")).toHaveText("1")
    await expect(readout(other, "kv-notifications")).toHaveText("1")

    //and back the other way, from outside React
    await other
      .getByRole("button", { name: "kv.set 100 outside React" })
      .click()
    await expect(readout(page, "kv-a")).toHaveText("100")
    await expect(readout(page, "kv-notifications")).toHaveText("2")

    //a remove crosses too, or the other tab keeps a value that no longer exists
    await section(page, "kv — synchronous")
      .getByRole("button", { name: "Remove the key" })
      .click()
    await expect(readout(other, "kv-a")).toHaveText("0")
  })

  test("a full localStorage keeps a kv write in memory for the session, and makes a secure write throw", async ({
    page,
  }) => {
    const uncaught: string[] = []
    page.on("pageerror", (error) => uncaught.push(String(error)))
    await open(page)
    await expect(readout(page, "secure-raw")).toHaveText("nothing")

    /*
     * Fill the origin's localStorage until nothing more fits. The quota counts keys
     * as well as values, so the fillers use the shortest keys there are and the
     * premise is probed with a 25-character key: whatever room is left is smaller
     * than that, and so smaller than the page's own prefixed keys (29 and 32).
     */
    const full = await page.evaluate(() => {
      let chunk = 1 << 20
      let index = 0
      while (chunk >= 1) {
        try {
          localStorage.setItem(index.toString(36), "x".repeat(chunk))
          index += 1
        } catch {
          chunk = Math.floor(chunk / 2)
        }
      }
      try {
        localStorage.setItem("lab-storage-quota-probe-1", "1")
        return false
      } catch {
        return true
      }
    })
    expect(
      full,
      "premise: this engine's localStorage refuses a write once full",
    ).toBe(true)

    await page.getByRole("button", { name: "Increment from A" }).click()
    //the readers take the value — the setter never throws out at the caller…
    await expect(readout(page, "kv-a")).toHaveText("1")
    await expect(readout(page, "kv-b")).toHaveText("1")
    //…while the browser's storage never got it
    await expect(readout(page, "kv-raw")).toHaveText("nothing")

    //secure fails loudly instead: a token that did not persist must say so
    await page.getByRole("button", { name: "Save", exact: true }).click()
    await expect(readout(page, "secure-outcome")).toHaveText(
      "threw QuotaExceededError",
    )
    await page.getByRole("button", { name: "Read", exact: true }).click()
    await expect(readout(page, "secure-outcome")).toHaveText("read")
    await expect(readout(page, "secure-read")).toHaveText("absent")

    expect(uncaught).toEqual([])

    //memory-only means exactly that: the session's value is gone after a reload
    await reload(page)
    await expect(readout(page, "kv-a")).toHaveText("0")
  })
})

test.describe("store and useStore", () => {
  test("a structured value survives a reload on real IndexedDB", async ({
    page,
  }) => {
    await open(page)
    await expect(readout(page, "store-a")).toHaveText("absent")
    await expect(readout(page, "store-persistent")).toHaveText("yes")

    await page.getByRole("button", { name: "Write from A" }).click()
    await expect(readout(page, "store-a")).toHaveText("1")
    await expect(readout(page, "store-a-date")).toHaveText("yes")
    //committed to disk, not just held in memory, before the reload
    await expect
      .poll(() => idbValue(page, NOTE))
      .toBe("count 1, Date true")

    await reload(page)
    await expect(readout(page, "store-a")).toHaveText("1")
    await expect(readout(page, "store-b")).toHaveText("1")
    //structured clone, not JSON: the Date came off disk a Date
    await expect(readout(page, "store-a-date")).toHaveText("yes")
    await expect(readout(page, "store-persistent")).toHaveText("yes")
  })

  test("two components on one key follow every write, remove and outside set (#131)", async ({
    page,
  }) => {
    await open(page)
    await expect(readout(page, "store-b")).toHaveText("absent")

    await page.getByRole("button", { name: "Write from A" }).click()
    await expect(readout(page, "store-a")).toHaveText("1")
    await expect(readout(page, "store-b")).toHaveText("1")

    await page.getByRole("button", { name: "Write from A" }).click()
    await expect(readout(page, "store-b")).toHaveText("2")

    await page
      .getByRole("button", { name: "store.set 100 outside React" })
      .click()
    await expect(readout(page, "store-a")).toHaveText("100")
    await expect(readout(page, "store-b")).toHaveText("100")

    await section(page, "store — asynchronous, structured")
      .getByRole("button", { name: "Remove the key" })
      .click()
    await expect(readout(page, "store-a")).toHaveText("absent")
    await expect(readout(page, "store-b")).toHaveText("absent")
  })

  test("another tab's write is not observed until this tab reads again", async ({
    page,
    context,
  }) => {
    const other = await context.newPage()
    await open(page)
    await open(other)
    await expect(readout(other, "store-a")).toHaveText("absent")

    await page.getByRole("button", { name: "Write from A" }).click()
    //premise: the value is on disk where the other tab can see it
    await expect
      .poll(() => idbValue(other, NOTE))
      .toBe("count 1, Date true")
    //and a cross-tab signal sent AFTER it has been delivered, so anything that
    //would have carried the store write had its chance first
    await page.getByRole("button", { name: "Increment from A" }).click()
    await expect(readout(other, "kv-a")).toHaveText("1")

    //documented: IndexedDB has no storage event, so nothing wakes this hook
    await expect(readout(other, "store-a")).toHaveText("absent")

    await reload(other)
    await expect(readout(other, "store-a")).toHaveText("1")
  })

  test("a write IndexedDB refuses stays readable for the session and is gone after a reload (#130)", async ({
    page,
    context,
    baseURL,
    browserName,
  }) => {
    test.skip(
      browserName !== "chromium",
      "the origin quota can only be lowered through the Chromium DevTools protocol",
    )
    /*
     * Lowered BEFORE the first navigation, and that order is the premise. Chromium's
     * IndexedDB asks the quota system for the room left once, then spends that answer
     * down write by write — so an override made after the app's boot has written
     * anything is never consulted, and the megabyte lands. Measured: a 1 MB put
     * aborts with QuotaExceededError under a 256 KB override on an origin with no
     * prior write, and commits under the same override after one small write, even
     * six seconds later.
     */
    const cdp = await context.newCDPSession(page)
    await cdp.send("Storage.overrideQuotaForOrigin", {
      origin: new URL(baseURL ?? "").origin,
      quotaSize: 256 * 1024,
    })
    await open(page)
    await expect(readout(page, "store-persistent")).toHaveText("yes")

    await page
      .getByRole("button", { name: "Write 1 MB of random bytes" })
      .click()
    //set resolves once the transaction has settled either way; only then read
    await expect(readout(page, "store-large")).toHaveText(
      / bytes$|^absent$/,
    )
    expect(
      await idbValue(page, LARGE),
      "premise: the lowered quota made IndexedDB refuse the write",
    ).toBe("absent")
    //the caller still gets its value back after the refusal…
    await expect(readout(page, "store-large")).toHaveText("1048576 bytes")
    //…and the tier says it is held only in memory
    await expect(readout(page, "store-persistent")).toHaveText("no")

    await reload(page)
    await page.getByRole("button", { name: "Read it back" }).click()
    await expect(readout(page, "store-large")).toHaveText("absent")
    await expect(readout(page, "store-persistent")).toHaveText("yes")
  })
})

test.describe("secure on the web", () => {
  test("is best-effort localStorage: not hardware-backed, readable by page script, and durable", async ({
    page,
  }) => {
    await open(page)
    await expect(readout(page, "secure-hardware")).toHaveText("no")
    await expect(readout(page, "secure-raw")).toHaveText("nothing")

    await page.getByLabel("Secret").fill("token-abc")
    await page.getByRole("button", { name: "Save", exact: true }).click()
    await expect(readout(page, "secure-outcome")).toHaveText("saved")
    //the honest part: any script on the origin reads the secret in the clear
    await expect(readout(page, "secure-raw")).toHaveText("token-abc")
    expect(
      await page.evaluate(() =>
        localStorage.getItem("adaptv:secure:lab-storage.secret"),
      ),
    ).toBe("token-abc")

    await reload(page)
    await page.getByRole("button", { name: "Read", exact: true }).click()
    await expect(readout(page, "secure-read")).toHaveText("token-abc")

    await page.getByRole("button", { name: "Remove", exact: true }).click()
    await expect(readout(page, "secure-outcome")).toHaveText("removed")
    await expect(readout(page, "secure-raw")).toHaveText("nothing")
    await page.getByRole("button", { name: "Read", exact: true }).click()
    await expect(readout(page, "secure-read")).toHaveText("absent")
  })
})

test.describe("the reset", () => {
  test("Clear everything empties all three tiers and returns every row to how the page opened", async ({
    page,
  }) => {
    await open(page)
    const kv = section(page, "kv — synchronous")
    const store = section(page, "store — asynchronous, structured")

    await kv.getByRole("button", { name: "Increment from A" }).click()
    await expect(readout(page, "kv-a")).toHaveText("1")
    await store.getByRole("button", { name: "Write from A" }).click()
    await expect(readout(page, "store-a")).toHaveText("1")
    await expect
      .poll(() => idbValue(page, NOTE))
      .toBe("count 1, Date true")
    await page
      .getByRole("button", { name: "Write 1 MB of random bytes" })
      .click()
    await expect(readout(page, "store-large")).toHaveText("1048576 bytes")
    await page.getByLabel("Secret").fill("token-abc")
    await page.getByRole("button", { name: "Save", exact: true }).click()
    await expect(readout(page, "secure-outcome")).toHaveText("saved")
    await page.getByRole("button", { name: "Read", exact: true }).click()
    await expect(readout(page, "secure-read")).toHaveText("token-abc")

    await page.getByRole("button", { name: "Clear everything" }).click()

    //the rows, as the page first drew them
    await expect(readout(page, "kv-a")).toHaveText("0")
    await expect(readout(page, "kv-b")).toHaveText("0")
    await expect(readout(page, "kv-raw")).toHaveText("nothing")
    await expect(readout(page, "store-a")).toHaveText("absent")
    await expect(readout(page, "store-b")).toHaveText("absent")
    await expect(readout(page, "store-large")).toHaveText("not read yet")
    await expect(readout(page, "secure-read")).toHaveText("not read yet")
    await expect(readout(page, "secure-raw")).toHaveText("nothing")
    await expect(readout(page, "secure-outcome")).toHaveText(
      "not attempted yet",
    )
    //and the storage itself, read beside the app
    await expect.poll(() => idbValue(page, NOTE)).toBe("absent")
    await expect.poll(() => idbValue(page, LARGE)).toBe("absent")
    expect(
      await page.evaluate(() =>
        Object.keys(localStorage).filter(
          (key) =>
            key.startsWith("adaptv:kv:") ||
            key.startsWith("adaptv:secure:"),
        ),
      ),
    ).toEqual([])
  })
})
