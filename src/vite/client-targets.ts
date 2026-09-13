import type { Plugin } from "vite"

/**
 * The engines the CLIENT bundle is compiled for — JS syntax and CSS alike.
 *
 * Without it the client builds at Vite's default, whose Safari entry is 16.4. That
 * is not a floor adaptv ever chose, and on the CSS side it is not a harmless one:
 * Lightning CSS then keeps Tailwind's responsive variants as range media queries,
 * `@media (width>=40rem)`, which Safari only parses from 16.4. Every `sm:`, `md:`
 * and `lg:` rule in the app was dead on iOS 15.4–16.3, silently, while the same
 * stylesheet still rendered everything else there. Measured on the playground's
 * built CSS: 13 range queries before, 0 after, every one lowered to `min-width`,
 * and nothing else in the file changed. `oklch()` and `:focus-visible` stay as
 * authored, correctly: both are WebKit 15.4 too, so there is nothing to lower.
 *
 * Why each entry is what it is:
 *
 * - `safari15.4` / `ios15.4` — **Tailwind v4 wraps its whole stylesheet in
 *   `@layer`**, which WebKit parses from 15.4. Below that the app renders unstyled
 *   whatever this list says, so going lower would pay bytes for nothing. The minor
 *   version is honoured end to end: oxc (JS) lowers class static blocks at
 *   `safari16.3` and keeps them at `safari16.4`, and Vite passes the minor through
 *   to Lightning CSS, which lowers range queries at `16.3` and keeps them at `16.4`.
 *   `ios` is listed beside `safari` because the two are separate keys to both tools
 *   and the WebView that ships is iOS's. On the JS side the price is oxc lowering
 *   `#private` class members to WeakMaps below Safari 16 (TanStack Query's, about
 *   1 KB gzipped); no other chunk changed.
 * - `chrome111` — the Android WebView floor, `MIN_ANDROID_WEBVIEW` in
 *   `capacitor-config.ts`, which is also Tailwind v4's own Chromium minimum. The
 *   native gate refuses to boot below it, so compiling lower buys no device.
 *   `client-targets.test.ts` fails if the two drift.
 * - `edge111` / `firefox114` — Vite's own defaults, unchanged. Neither engine is a
 *   WebView adaptv ships in, and nothing measured asked for a different number.
 *
 * NEVER an `es20xx` entry here. Vite maps those to browser versions for the CSS
 * side too — `es2020` means Chrome 80 / Safari 14 to Lightning CSS — and that
 * grew the playground's stylesheet about sevenfold (12 KB to 84 KB).
 *
 * Not fixed by any target, and why the iOS floor is not lower: `@layer` (above),
 * `dvh`, and `Array.prototype.at` are all WebKit 15.4 and are not syntax, so no
 * transform can reach them.
 */
export const CLIENT_BUILD_TARGETS: readonly string[] = [
  "safari15.4",
  "ios15.4",
  "chrome111",
  "edge111",
  "firefox114",
]

/**
 * Compile the client for {@link CLIENT_BUILD_TARGETS}, in both lineages — the web
 * client and the capacitor bundle are the same client build.
 *
 * The two halves are set in two DIFFERENT places, and that was measured, not
 * assumed: with both on the client environment the build lowered its JS and shipped
 * a byte-identical stylesheet, same hash, all 13 range queries still in it.
 *
 * - JS: `environments.client.build.target`. Rolldown reads it per environment. It
 *   must not be the top-level `build.target`, which is every environment's default
 *   and would also retarget the server build — Node code that was never the problem.
 * - CSS: the top-level `build.cssTarget`. The CSS minifier, which is where Lightning
 *   CSS lowers syntax, is one plugin instance built from the TOP-LEVEL config, and
 *   the framework plugin shares plugin instances across environments during the
 *   build (`builder.sharedPlugins`), so an environment's own `cssTarget` never
 *   reaches it. Top-level is also right on the merits: the server environment only
 *   inherits it as its default `cssTarget`, and any CSS it emits is read by the same
 *   browsers.
 *
 * The service worker is not a Vite environment at all — it has its own bundler call
 * and its own target (`sw-build.ts`), deliberately untouched.
 *
 * `apply: "build"`: the target is a property of what ships. Vite's dev transform
 * and its dependency optimizer do not read `build.target` either way.
 */
export function adaptvClientTargetsPlugin(): Plugin {
  return {
    name: "adaptv:client-targets",
    apply: "build",
    config() {
      return {
        build: { cssTarget: [...CLIENT_BUILD_TARGETS] },
        environments: {
          client: {
            build: { target: [...CLIENT_BUILD_TARGETS] },
          },
        },
      }
    },
  }
}
