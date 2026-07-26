import { defineApp } from "@arrzdev/adaptv/config"

export default defineApp({
  appId: "dev.arrz.projectzero",
  name: "ChopChop",
  // extra Capacitor plugin registered via config (base set is bundled by adaptv)
  plugins: ["@capacitor/device"],
  description: "A focused task list for desktop, mobile, and PWA.",
  lang: "en",
  themeColor: { light: "#eeeeec", dark: "#0a0a0c" },
  icons: "./public/favicons",
  orientation: "portrait",
  styles: "./src/styles/main.css",
  sw: "./src/sw.ts",

  splashScreen: () => import("@/components/splash-screen"),
  orientationGuardScreen: () => import("@/components/rotate-guard"),
  notFoundScreen: () => import("@/components/not-found-screen"),
  //NOTE: no `providers` field — adaptv has none. The app-wide provider tree is a
  //layout route: see `src/routing/layouts/providers.layout.tsx`.

  router: {
    render: "ssr",
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
