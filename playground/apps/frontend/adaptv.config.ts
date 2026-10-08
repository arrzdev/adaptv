import { defineApp } from "adaptv/config"

export default defineApp({
  appId: "dev.arrz.projectzero",
  //`adaptvlab://lab/app-state?from=link` opens the app on that lab page, which counts the
  //links it hears — the manual check that a link routes once, cold or warm.
  deepLinks: { scheme: "adaptvlab" },
  name: "ChopChop",
  //NOTE: no `plugins` field. It is for Capacitor plugins adaptv does NOT ship — the base set
  //(device, haptics, preferences, …) is already bundled and exposed through adaptv's own API,
  //so listing one of those here declares nothing and only reads like it's required.
  description: "A focused task list for desktop, mobile, and PWA.",
  lang: "en",
  themeColor: { light: "#eeeeec", dark: "#0a0a0c" },
  icons: "./public/favicons",
  orientation: "portrait",
  //Env-driven so one lab app builds twice: with Tailwind (the default) and with none
  //(`vite.plain.config.ts` sets PLAYGROUND_CSS=plain), which proves adaptv needs no
  //Tailwind (docs/decisions/styling.md §0.1, §9). Same pages, same specs.
  styles:
    process.env.PLAYGROUND_CSS === "plain"
      ? "./src/styles/plain.css"
      : "./src/styles/main.css",
  // adaptv registers and owns the service worker itself — precache, navigation,
  // updates. This list is only for behaviour that is the APP's; the probe is a
  // no-op that keeps the extension path exercised.
  serviceWorkers: ["./src/sw/probe.ts"],

  splashScreen: () => import("@/components/splash-screen"),
  orientationGuardScreen: () => import("@/components/rotate-guard"),
  notFoundScreen: () => import("@/components/not-found-screen"),
  bootErrorScreen: () => import("@/components/boot-error-screen"),
  //NOTE: no `providers` field — adaptv has none. The app-wide provider tree is a
  //layout route: see `src/routing/layouts/providers.layout.tsx`.

  //SSR is the default; top-level `render: "spa"` is the only other option.
  //
  //Env-driven ONLY so the service-worker e2e suite can build both modes from one
  //lab app. It matters because the two are genuinely different workers: under
  //`spa` every navigation is answered from the precache, so a bug like "the shell
  //answers a link to a PDF" is live and online — under `ssr` the same bug is
  //invisible, because navigations go to the network either way. A suite that only
  //ever built `ssr` would have shipped green through exactly that.
  render: process.env.ADAPTV_RENDER === "spa" ? "spa" : "ssr",

  //Env-driven for the same reason as `render`, and with the same justification:
  //`prompt` is a genuinely DIFFERENT registration, not a flag read at runtime.
  //Under `auto` the client applies a waiting worker itself at launch; under
  //`prompt` it must never apply one and instead hands the app the moment. Exactly
  //one of those two branches is compiled into any given build, so a suite that
  //only ever built the default would ship the other one unexercised — and its
  //failure mode is an update that either never arrives or arrives on top of
  //someone's unsaved work.
  serviceWorkerUpdate:
    process.env.ADAPTV_SW_UPDATE === "prompt" ? "prompt" : "auto",

  //The floor, not a realistic number — a shipped app wants the 60-minute default.
  //It is here so `ota:lab` can watch the third check actually fire: publish, leave
  //the app open, and the update stages itself DURING the session, so the colour
  //lands on the very next launch instead of the one after it.
  otaPollMinutes: 5,
  //The policy the design doc itself uses as its example, and the one a real app
  //without a moved server contract would pick: two weeks for the store to catch
  //up, then adaptv's own screen takes over. Declared so that screen exists in the
  //one app that can show it — with no number it never renders, anywhere — and
  //so `e2e/forced-screens.spec.ts` can walk it through the real wiring. A device
  //that falls behind in `ota:lab` today reads `behind` on /lab/ota for 13 days
  //before anything covers that page.
  updateRequiredAfterDays: 14,
  router: {
    //route generator — adaptv owns the generated tree's location (.adaptv/) and
    //the generator's formatting, so only these two are ours to set
    routesDirectory: "./routing",
    routerConfig: "./src/routing/config.ts",
    //runtime — createRouter
    memoryHistoryInStandalone: true,
    defaultPreload: "viewport",
    defaultPreloadStaleTime: Number.POSITIVE_INFINITY,
  },
})
