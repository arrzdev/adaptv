import type { Page } from "@playwright/test"

/*
 * The URL the dev server serves adaptv's `/capabilities` entry at, so a spec can reach the
 * same module instances the app runs (the gesture arbiter, the back chain, the capability
 * calls) with a dynamic `import()` in the page.
 *
 * The playground links the checkout, so the dev server serves the framework at one `/@fs`
 * URL per file, and the browser keeps one module per URL. The resource timeline is capped
 * (250 entries) well short of a dev page's module count, so the URL is built from the
 * client entry, which is among the first few loaded, rather than searched for. The entry
 * sits in `dist/` when `exports` points there and in `src/` otherwise; both copies of
 * `/capabilities` re-export the modules the rest of the app shares, so it is the same
 * instance either way. An internal file can't be named instead: `dist/` bundles it into a
 * hashed chunk.
 */
export function capabilitiesUrl(page: Page): Promise<string> {
  return page.evaluate(() => {
    const layouts: [RegExp, string][] = [
      [/dist\/client-entry\.mjs$/, "dist/capabilities.mjs"],
      [
        /src\/routes\/client-entry\.tsx$/,
        "src/interface/capabilities.index.ts",
      ],
    ]
    for (const resource of performance.getEntriesByType("resource")) {
      for (const [entry, capabilities] of layouts)
        if (entry.test(resource.name))
          return resource.name.replace(entry, capabilities)
    }
    throw new Error("the adaptv client entry was never loaded")
  })
}
