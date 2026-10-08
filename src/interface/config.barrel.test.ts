import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import {
  declaredExports,
  exportsOf,
} from "#adaptv/test-utils/barrel-guard"

/*
 * An `AdaptvAppConfig` screen option is typed `ScreenThunk<Props>`, and the app
 * writes the component it loads. If `Props` is public from no entry, the app can
 * only type that component by copying the shape. `UpdateRequiredProps` shipped
 * that way while `SplashScreenProps` and `OrientationGuardProps` sat exported
 * beside it in `adaptv/config`.
 *
 * The props of an option whose default screen is a component (`OfflineProps`,
 * `BootErrorProps`) are public from `adaptv/components`, next to that
 * component, so either barrel counts.
 */
const APP_CONFIG = resolve(process.cwd(), "src/config/app-config.ts")
const BARRELS = ["config.index.ts", "components.index.ts"].map((name) =>
  resolve(process.cwd(), "src/interface", name),
)

/** Every name a barrel makes public, following its `export *` lines one level. */
function publicNames(barrel: string): string[] {
  return exportsOf(readFileSync(barrel, "utf8")).flatMap((e) => {
    if (e.names) return e.names
    const module = [".ts", ".tsx"]
      .map((ext) => resolve(barrel, "..", `${e.spec}${ext}`))
      .find((file) => existsSync(file))
    return module ? declaredExports(readFileSync(module, "utf8")) : []
  })
}

describe("the config barrel", () => {
  it("makes the props type of every screen option public", () => {
    const props = [
      ...readFileSync(APP_CONFIG, "utf8").matchAll(
        /\?: ScreenThunk<([A-Za-z]+)>/g,
      ),
    ].map((m) => m[1] ?? "")
    const exported = BARRELS.flatMap(publicNames)
    expect(props.length).toBeGreaterThan(0)
    expect(props.filter((name) => !exported.includes(name))).toEqual([])
  })
})
