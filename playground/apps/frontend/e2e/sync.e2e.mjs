import { chromium } from "playwright"

//two isolated browser profiles = two devices sharing one backend. drives the
//real offline-first data layer (window.synqDebug, the same code the UI calls)
//and asserts on the real rendered DOM, proving shared sync end-to-end.

const APP = process.env.APP_URL ?? "http://localhost:7373/"
const RUN = Date.now().toString(36)
const T_UI = `ui-create-${RUN}`
const T_DEL = `to-delete-${RUN}`
const T_KEEP = `persist-${RUN}`
const T_M = `merge-${RUN}`
const T_M2 = `merge-renamed-${RUN}`

let passed = 0
let failed = 0
const ok = (m) => {
  passed++
  console.log(`  ✓ ${m}`)
}
const bad = (m) => {
  failed++
  console.log(`  ✗ ${m}`)
}

async function boot(context, label) {
  const page = await context.newPage()
  page.on("pageerror", (e) =>
    console.log(`[${label} pageerror] ${e.message}`),
  )
  await page.goto(APP, { waitUntil: "domcontentloaded" })
  await page.waitForFunction(() => !!window.synqDebug, null, {
    timeout: 30000,
  })
  await page
    .getByRole("button", { name: "Create task" })
    .waitFor({ state: "visible", timeout: 30000 })
  return page
}

const sync = (page) => page.evaluate(() => window.synqDebug.runSync())
const list = (page) => page.evaluate(() => window.synqDebug.list())
const idOf = (page, title) =>
  page.evaluate(
    (t) =>
      window.synqDebug.list().then((rows) => {
        const found = rows.find((r) => r.title === t)
        return found ? found.$id : null
      }),
    title,
  )

async function seesText(page, text, timeout = 10000) {
  try {
    await page
      .locator(`text=${JSON.stringify(text)}`)
      .first()
      .waitFor({ state: "visible", timeout })
    return true
  } catch {
    return false
  }
}

async function gone(page, text, timeout = 10000) {
  try {
    await page
      .locator(`text=${JSON.stringify(text)}`)
      .first()
      .waitFor({ state: "detached", timeout })
    return true
  } catch {
    return (
      (await page.locator(`text=${JSON.stringify(text)}`).count()) === 0
    )
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  try {
    const A = await boot(ctxA, "A")
    const B = await boot(ctxB, "B")
    ok("both profiles booted the app")

    console.log("\nScenario 1 — create on A via real UI propagates to B")
    await A.getByRole("button", { name: "Create task" }).click()
    await A.getByLabel("Task description").fill(T_UI)
    await A.getByRole("button", { name: "Add task" }).click()
    if (await seesText(A, T_UI)) ok("A: created via UI (optimistic)")
    else bad("A: not shown after UI create")
    await sync(A)
    await sync(B)
    if (await seesText(B, T_UI)) ok("B: pulled A's todo")
    else bad("B: did NOT receive A's todo")

    console.log("\nScenario 2 — checking on B propagates to A")
    const idB = await idOf(B, T_UI)
    await B.evaluate(
      (id) => window.synqDebug.updateTodoChecked(id, true),
      idB,
    )
    await sync(B)
    await sync(A)
    if (await gone(A, T_UI))
      ok("A: todo left active list (checked synced)")
    else bad("A: still active after B checked it")
    const aRow = (await list(A)).find((r) => r.title === T_UI)
    if (aRow?.checked === true) ok("A: data converged checked=true")
    else bad("A: data did not converge checked=true")

    console.log("\nScenario 3 — delete on A propagates to B")
    await A.evaluate(
      (t) => window.synqDebug.createTodo({ title: t }),
      T_DEL,
    )
    await sync(A)
    await sync(B)
    if (await seesText(B, T_DEL)) ok("B: received to-delete todo")
    else bad("B: did not receive to-delete todo")
    const delId = await idOf(A, T_DEL)
    await A.evaluate((id) => window.synqDebug.deleteTodo(id), delId)
    await sync(A)
    await sync(B)
    if (!(await list(B)).some((r) => r.title === T_DEL))
      ok("B: deletion converged (data)")
    else bad("B: deleted todo still present")
    if (await gone(B, T_DEL)) ok("B: deleted todo removed from DOM")
    else bad("B: deleted todo still in DOM")

    console.log("\nScenario 4 — offline-first persistence across reload")
    await A.evaluate(
      (t) => window.synqDebug.createTodo({ title: t }),
      T_KEEP,
    )
    await sync(A)
    await A.reload({ waitUntil: "domcontentloaded" })
    await A.waitForFunction(() => !!window.synqDebug, null, {
      timeout: 30000,
    })
    if (await seesText(A, T_KEEP))
      ok("A: persisted across reload (IndexedDB)")
    else bad("A: lost after reload")

    console.log(
      "\nScenario 5 — concurrent edits to different fields converge",
    )
    await A.evaluate((t) => window.synqDebug.createTodo({ title: t }), T_M)
    await sync(A)
    await sync(B)
    const mId = await idOf(B, T_M)
    await A.evaluate(
      (a) => window.synqDebug.updateTodoDetails(a.id, { title: a.t }),
      { id: mId, t: T_M2 },
    )
    await B.evaluate(
      (id) => window.synqDebug.updateTodoChecked(id, true),
      mId,
    )
    await sync(A)
    await sync(B)
    await sync(A)
    await sync(B)
    const merged = (r) => r && r.title === T_M2 && r.checked === true
    if (merged((await list(A)).find((r) => r.$id === mId)))
      ok("A: converged with BOTH edits (title + checked)")
    else bad("A: did not converge")
    if (merged((await list(B)).find((r) => r.$id === mId)))
      ok("B: converged with BOTH edits (title + checked)")
    else bad("B: did not converge")

    console.log(
      "\nScenario 6 — a brand-new profile pulls existing shared data",
    )
    const ctxC = await browser.newContext()
    const C = await boot(ctxC, "C")
    await sync(C)
    if (await seesText(C, T_KEEP)) ok("C: new device pulled shared todo")
    else bad("C: new device did not see shared todo")
    await ctxC.close()
  } finally {
    await browser.close()
  }
  console.log(`\nRESULT: ${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error("E2E crashed:", e)
  process.exit(2)
})
