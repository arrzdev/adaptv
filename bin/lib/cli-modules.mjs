// The framework modules the CLI loads with `loadAdaptvModule`, named as paths under `src/`.
//
// One list, read twice: `tsdown.config.ts` builds each of them into `dist/cli/` so a
// published package, which ships no `src/`, still has every module the CLI asks for; and
// `load-ts.test.mjs` fails when a `loadAdaptvModule("…")` call names a module missing here,
// so a new call cannot work from a checkout and break only once published.
export const CLI_MODULES = [
  "config/app-config.ts",
  "native/android-sdk.ts",
  "native/doctor.ts",
  "native/installed-plugins.ts",
  "native/stamp-privacy.ts",
  "ota/build/ota-config-module.ts",
  "ota/build/ota-emit.ts",
  "utils/color.ts",
  "vite/app-config-errors.ts",
  "vite/app-config-loader.ts",
  "vite/build-stamp.ts",
  "vite/capacitor-config.ts",
  "vite/icon-set.ts",
  "vite/verify-patches.ts",
]
