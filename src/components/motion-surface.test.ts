// @vitest-environment node
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/*
 * `docs/decisions/animation.md` A7 (🔒 §3.1): adaptv ships no motion component
 * and no motion context. Its animations run imperatively: `JSAnimation` on an
 * element's style (`src/hooks/use-animated-style.ts`), and a CSS `@keyframes`
 * rule for the drawer's panel, which keeps a motion value only as the store its
 * drag frames write to.
 *
 * Two routes back both look harmless in review. The full `motion` component
 * takes the same props as any element and renders the same one, but it is
 * created with motion's whole feature set loaded at module scope, so a static
 * import drags drag gestures and layout projection into every chunk that reaches
 * it. Button is reached from the shell, so on `main` that was 49 KB raw of the
 * ~735 KB initial JS on every target. `m` under a component-owned `LazyMotion`
 * fixes the bytes and breaks the app instead: the provider hands the app's
 * content a new context object on every render, so each app motion element
 * inside re-renders with the wrapper, and it replaces the app's own
 * `LazyMotion` (its async features, its `strict`) for everything inside.
 *
 * Biome's `noRestrictedImports` names those imports, which catches the obvious
 * case but not a namespace import, nor the interface barrels where that rule is
 * switched off. This is the other half: it bundles the package's browser entries
 * with the bundler a consumer builds with and reads which motion modules
 * survived tree-shaking, so every route back shows up here, as bytes.
 */

const ROOT = process.cwd()

/** `tsdown.config.ts`'s `browserEntry`, read off the file so the two cannot drift. */
function browserEntries(): Record<string, string> {
  const config = readFileSync(path.join(ROOT, "tsdown.config.ts"), "utf8")
  const block = /const browserEntry = \{([\s\S]*?)\n\}/.exec(config)?.[1]
  const files = [...(block ?? "").matchAll(/"(src\/[^"]+)"/g)].map(
    (match) => match[1],
  )
  expect(
    files.length,
    "browserEntry not found in tsdown.config.ts",
  ).toBeGreaterThan(5)
  return Object.fromEntries(
    files.map((file) => [
      path.basename(file).replace(/\.[^.]+$/, ""),
      path.join(ROOT, file),
    ]),
  )
}

const MOTION_PACKAGE =
  /^(?:motion|framer-motion|motion-dom|motion-utils)(?:\/|$)/

let shipped: Promise<string[]> | undefined

/** Motion's module ids that made it into the output with any bytes, trimmed. */
function shippedMotionModules(): Promise<string[]> {
  shipped ??= bundleMotionModules()
  return shipped
}

async function bundleMotionModules(): Promise<string[]> {
  const { build } = await import("vite")
  const output = await build({
    root: ROOT,
    configFile: false,
    logLevel: "silent",
    resolve: { alias: { "#adaptv": path.join(ROOT, "src") } },
    build: {
      write: false,
      minify: false,
      sourcemap: false,
      lib: {
        entry: browserEntries(),
        formats: ["es"],
      },
      rollupOptions: {
        //only motion is bundled; everything else is someone else's bytes
        external: (id) =>
          !MOTION_PACKAGE.test(id) &&
          !id.startsWith("#adaptv/") &&
          !id.startsWith(".") &&
          !id.startsWith("\0") &&
          !path.isAbsolute(id),
      },
    },
  })
  const bundles = Array.isArray(output) ? output : [output]
  const shipped = new Set<string>()
  for (const bundle of bundles) {
    if (!("output" in bundle)) continue
    for (const chunk of bundle.output) {
      if (chunk.type !== "chunk") continue
      for (const [id, info] of Object.entries(chunk.modules)) {
        const at = id.lastIndexOf("/node_modules/")
        if (at === -1 || info.renderedLength === 0) continue
        const pkgPath = id.slice(at + "/node_modules/".length)
        if (MOTION_PACKAGE.test(pkgPath)) shipped.add(pkgPath)
      }
    }
  }
  return [...shipped].sort()
}

describe("the framework's motion surface", () => {
  it("ships motion's animation engine and none of its components, contexts or their features", async () => {
    const shipped = await shippedMotionModules()
    const has = (fragment: string) =>
      shipped.some((id) => id.includes(fragment))

    //the components (`motion` and `m`), the provider and the context it hands
    //down, and the feature sets only the full component (or `domMax`) brings
    expect(
      shipped.filter(
        (id) =>
          id.includes("/render/components/") ||
          id.includes("/components/LazyMotion/") ||
          id.includes("/context/LazyContext") ||
          id.includes("/context/MotionContext/") ||
          id.includes("/projection/node/") ||
          id.includes("/gestures/drag/") ||
          id.includes("/gestures/pan/") ||
          id.includes("/motion/features/"),
      ),
    ).toEqual([])

    //the premise: motion IS bundled, as its engine. Without these the absence
    //above would pass on a bundle that simply lost every animation.
    expect(has("motion-dom/dist/es/animation/JSAnimation.mjs")).toBe(true)
    expect(has("motion-dom/dist/es/animation/generators/spring.mjs")).toBe(
      true,
    )
  }, 30_000)

  /*
   * `animate()` (and `useAnimate`, `animateValue`'s callers, `animateMotionValue`)
   * reaches a value through motion's visual element, sequence and animation
   * interface code: 62 KB of motion on every served route that preloads the
   * drawer, which is where it last lived. It drove nothing there. Its one call
   * sat behind a spring mode no drawer transition had, so the panel always moved
   * by the `@keyframes` rule. Biome names these imports in `src/`; this catches
   * the ones it cannot see, by what survives tree-shaking.
   */
  it("ships none of the code motion's animate() reaches a value through", async () => {
    const shipped = await shippedMotionModules()
    //the premise: the drawer's motion value is still bundled, so the absence
    //below is measured on a bundle that has the drawer in it
    expect(
      shipped.some((id) =>
        id.includes("motion-dom/dist/es/value/index.mjs"),
      ),
    ).toBe(true)
    expect(
      shipped.filter(
        (id) =>
          id.includes("VisualElement") ||
          id.includes("/animation/animate/") ||
          id.includes("/animation/sequence/") ||
          id.includes("/animation/interfaces/") ||
          id.includes("/animators/waapi/animate-"),
      ),
    ).toEqual([])
  }, 30_000)
})
