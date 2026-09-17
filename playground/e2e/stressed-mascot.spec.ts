import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"
import { expectImagePainted } from "./support/painted"

/*
 * The stressed mascot is a file (`illustrations/stressed-mascot.svg`), rendered
 * through an `<img>` on the 404 and in the tasks list's stressed empty state.
 *
 * It used to be 368 inline `<path>`s in a component, and because the not-found
 * screen is a static import of the root route, those 130 KB of JS were in the
 * initial closure of EVERY page. What a file can get wrong that inline art could
 * not is covered here, on the dev server: the server and the client must agree on
 * its URL (React reports the mismatch in dev), the file must load and paint, and
 * both call sites must still reach it. That the art stays OUT of the initial JS
 * needs a production build and lives in `e2e-sw/not-found-art.spec.ts`.
 */

const NOT_FOUND = "/lab/definitely-not-a-route"
const MASCOT = 'img[src*="stressed-mascot"]'

test("a server-rendered 404 hydrates cleanly and paints its mascot", async ({
  page,
}) => {
  const errors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })
  page.on("pageerror", (error) => errors.push(error.message))

  await page.goto(NOT_FOUND)
  const home = page.getByRole("link", { name: /back home/i })
  //the hydration gate is vacuous on the 404 (no splash, see support/hydrated.ts),
  //so wait for React itself: hydration attaches its fiber to the server's node
  await expect
    .poll(
      () =>
        home.evaluate((el) =>
          Object.keys(el).some((key) => key.startsWith("__reactFiber$")),
        ),
      { message: "React never hydrated the 404", timeout: 20_000 },
    )
    .toBe(true)

  await expectImagePainted(page.locator(MASCOT), "the 404 mascot")
  expect(
    errors.filter((text) =>
      /hydrat|did not match|didn't match/i.test(text),
    ),
    "the server and the client rendered the 404 differently",
  ).toEqual([])
})

test("a client-side 404 paints the same mascot file the server renders", async ({
  page,
  request,
}) => {
  const html = await (await request.get(NOT_FOUND)).text()
  const serverSrc = html.match(
    /<img[^>]*src="([^"]*stressed-mascot[^"]*)"/,
  )?.[1]
  expect(
    serverSrc,
    "the server-rendered 404 has no mascot <img>",
  ).toBeTruthy()

  await page.goto("/lab/screens")
  await awaitClientHandover(page)
  await page.getByRole("link", { name: /client navigation/i }).click()

  const mascot = page.locator(MASCOT)
  await expectImagePainted(mascot, "the client-rendered 404 mascot")
  expect(await mascot.getAttribute("src")).toBe(serverSrc)
})

test("the tasks list's stressed empty state paints the mascot", async ({
  page,
}) => {
  await page.goto("/")
  await awaitClientHandover(page)

  //the stressed state is "tasks exist, none of them archived, archived view":
  //make one task, then open the archive
  await page.getByRole("button", { name: "Create task" }).click()
  await page
    .getByRole("textbox", { name: "Task description" })
    .fill("a task for the mascot")
  await page.getByRole("button", { name: "Add task" }).click()
  await expect(
    page.getByRole("textbox", { name: "Task description" }),
    "the create drawer did not close",
  ).toBeHidden()
  await expect(
    page.getByRole("button", {
      name: "a task for the mascot",
      exact: true,
    }),
  ).toBeVisible()
  await page.getByRole("button", { name: /^0 archived$/ }).click()

  //THE PREMISE: this is the stressed state, not the error state that draws the
  //same mascot
  await expect(
    page.getByText("You got things to do, go finish them!"),
  ).toBeVisible()
  await expectImagePainted(
    page.locator(MASCOT).locator("visible=true"),
    "the stressed empty-state mascot",
  )
})
