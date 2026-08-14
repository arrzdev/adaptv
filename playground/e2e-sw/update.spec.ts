import { expect, test } from "@playwright/test"
import { bootControlled, deploy, RENDER } from "./sw"

/*
 * The update flow, against a real second build.
 *
 * This is the highest-stakes path in the whole worker and the last one that had
 * no coverage. Everything else here fails loudly in a browser; a broken update
 * fails SILENTLY and PERMANENTLY — users keep the old worker, the old worker keeps
 * serving the old precache, and no deploy can reach them again. There is no
 * remote fix for it, which is the entire reason it is worth a rebuild mid-suite.
 *
 * Three things have to hold, and the second is the one that looks like a bug:
 *   1. a new build is NOTICED                            (`/sw.js` bytes changed)
 *   2. it is NOT applied in the session that found it    (deliberate — §3.4)
 *   3. it IS applied at the next launch, and sweeps      (`serviceWorkerUpdate: "auto"`)
 */

//A cache the sweep MUST take: adaptv's own `static-` bucket, carrying a build tag
//that is not the one the new worker was stamped with.
const STALE = "static-e2e-previous-build"
//...and one it must NOT, because adaptv did not create it. Deleting a bucket it
//does not own breaks whatever did — another app on the origin, a third-party
//worker, or Workbox's own bookkeeping. This is the control for the assertion
//above: without it, "the stale one is gone" is equally consistent with a sweep
//that deletes everything it can see.
const FOREIGN = "acme-analytics-v1"

test.describe(`update flow (render: ${RENDER})`, () => {
  test("a deploy is noticed, held, then applied at the next launch", async ({
    page,
  }, testInfo) => {
    //a full production build runs inside this test
    test.setTimeout(300_000)

    await bootControlled(page)
    await page.evaluate(
      async ([stale, foreign]) => {
        await caches.open(stale)
        await caches.open(foreign)
      },
      [STALE, FOREIGN],
    )

    //Unique per run, not per project. Both engines run this file against whatever
    //the previous one left on disk, and a *repeat* run would otherwise redeploy
    //the tag already there — a byte-identical worker, no update to detect, and a
    //failure at step 1 that looks like the update flow broke.
    deploy(
      `e2e-update-${testInfo.project.name}-${Date.now()}`,
      testInfo.config.rootDir,
    )

    /* 1 — noticed ------------------------------------------------------------ */
    await page.reload({ waitUntil: "load" })
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const registration =
              await navigator.serviceWorker.getRegistration()
            return !!registration?.waiting
          }),
        {
          timeout: 30_000,
          message:
            "no worker reached `waiting` after a deploy — the browser never saw new bytes at /sw.js (updateViaCache, or a stale build)",
        },
      )
      .toBe(true)

    /* 2 — held --------------------------------------------------------------- */
    //A worker that finishes installing DURING a session is left alone on purpose:
    //activating it prunes the running build's precache out from under a live
    //module graph, so the page's next lazy import 404s at cache AND origin, and
    //the reload that follows takes unsaved state with it. The stale cache still
    //being here is the proof the new worker has not activated.
    const cachesDuringSession = await page.evaluate(() => caches.keys())
    expect(
      cachesDuringSession,
      "the new worker activated mid-session — it must wait for a launch",
    ).toContain(STALE)

    /* 3 — applied at the next launch ----------------------------------------- */
    //`commit`, not `load`: adaptv applies the waiting worker and then reloads the
    //page ITSELF, so waiting for load here races that second navigation and
    //surfaces as "interrupted by another navigation" — a false failure that reads
    //exactly like a regression. Everything real is asserted by the poll below.
    await page.reload({ waitUntil: "commit" })

    //One poll for all four facts, because they are only meaningful TOGETHER: a
    //cache list read before the new worker activates is just the old worker's,
    //and would report a working sweep as broken. (It did, once — an earlier
    //`waitForFunction` never awaited its async predicate, took the returned
    //Promise as truthy, and returned on the spot.)
    //
    //`registration.active.state` is deliberately NOT one of them. MEASURED: in
    //Playwright's WebKit a skip-waiting'd worker reports `activating` forever,
    //while every `activate` handler has demonstrably finished — the sweep ran, the
    //page is controlled, and a SECOND deploy still installs and sweeps on top of
    //it. Waiting on that state hangs the test for 60s on a worker that is doing
    //its job. REAL iOS Safari reports `activated` here, so it is a Playwright
    //artifact and not an engine one — either way, what is asserted below is what
    //the worker DID, which every engine agrees on. → RENDERING.md §3.7

    //Wrapped so a failure can say WHY. The four booleans below establish that the
    //update did not take; none of them says which half stalled, and this is the
    //one spec where "flaky, re-ran it, green" is not an acceptable place to stop —
    //a real intermittent here means some fraction of users sit on a stale build
    //for an extra launch, with nothing observable anywhere.
    try {
      await expect
        .poll(
          async () => {
            try {
              const state = await page.evaluate(async () => {
                const registration =
                  await navigator.serviceWorker.getRegistration()
                return {
                  //the waiting worker was taken, not left for a later launch
                  waitingApplied: !!registration && !registration.waiting,
                  controlled: !!navigator.serviceWorker.controller,
                  cacheNames: await caches.keys(),
                }
              })
              return {
                waitingApplied: state.waitingApplied,
                controlled: state.controlled,
                //...and the proof it was the NEW worker that activated: nothing else
                //runs a sweep after the cache was planted
                sweptPreviousBuild: !state.cacheNames.includes(STALE),
                keptForeignCache: state.cacheNames.includes(FOREIGN),
              }
            } catch {
              //adaptv reloads the page itself once the new worker takes over, which
              //destroys the execution context mid-evaluate. That is the event being
              //waited for, not an error.
              return { waitingApplied: false }
            }
          },
          {
            timeout: 60_000,
            message:
              "after a launch with a worker waiting: `waitingApplied` false = the update never took and users are stuck on the old build with no remote fix; `sweptPreviousBuild` false = every deploy leaks a full set of runtime caches until the quota errors; `keptForeignCache` false = the sweep deleted a cache adaptv does not own",
          },
        )
        .toEqual({
          waitingApplied: true,
          controlled: true,
          sweptPreviousBuild: true,
          keptForeignCache: true,
        })
    } catch (failure) {
      //`installing` non-null here would mean the browser was still working and the
      //timeout was simply short; `waiting` non-null with an `activated` controller
      //means the launch-apply branch did not fire, which is a product bug;
      //`redundant` anywhere means an update check discarded a worker mid-flight.
      const forensics = await page
        .evaluate(async () => {
          const registration =
            await navigator.serviceWorker.getRegistration()
          const describe = (worker: ServiceWorker | null) =>
            worker ? { state: worker.state, url: worker.scriptURL } : null
          return {
            installing: describe(registration?.installing ?? null),
            waiting: describe(registration?.waiting ?? null),
            active: describe(registration?.active ?? null),
            controller: describe(navigator.serviceWorker.controller),
            caches: await caches.keys(),
          }
        })
        .catch((error) => ({ unreadable: String(error) }))
      throw new Error(
        `${failure instanceof Error ? failure.message : String(failure)}\n\nworker at the moment of failure:\n${JSON.stringify(forensics, null, 2)}`,
        { cause: failure },
      )
    }
  })
})
