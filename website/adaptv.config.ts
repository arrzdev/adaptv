import { defineApp } from "@arrzdev/adaptv/config"

//The adaptv website is an adaptv app. It is server-rendered (the default) because it
//is exactly the case that default exists for: a public surface that has to be indexed
//and shared.
export default defineApp({
  //⚠︎ Here because the CLI demands it, not because the site ships to a store: the config
  //type says a web-only app omits `appId`, but `adaptv dev web` refuses to start without
  //one (bin/lib/load-config.mjs). Drop it when the CLI agrees with the type.
  appId: "dev.adaptv.website",
  name: "adaptv",
  title: "adaptv — one React codebase, every screen",
  description:
    "One React codebase for desktop web, mobile web, an installable home-screen app, and real iOS and Android apps that don't feel like a website in a box.",
  //Every page is the same for every visitor, so the build writes each one as a file
  //and the Worker serves it from assets. Rendered per request instead, a page view
  //cost enough Worker CPU to fail with error 1102 about one time in eight (TUD-131).
  prerender: true,
  lang: "en",
  themeColor: { light: "#fbfbfd", dark: "#0b0c14" },
  styles: "./src/styles/main.css",
  orientation: "any",
  //a document people read: let them zoom it, select it, and see how far down they are
  allowZoom: true,
  ui: { hideScrollbars: "app" },
  router: {
    routesDirectory: "./routing",
    routerConfig: "./src/routing/config.ts",
    defaultPreload: "intent",
  },
})
