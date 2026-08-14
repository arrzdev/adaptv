/// <reference lib="webworker" />

import { onAppMessage, sendToApp } from "@arrzdev/adaptv/sw"

/**
 * The lab's app-owned service-worker module — deliberately does nothing real.
 *
 * ChopChop used to hand-write its whole worker (precache, navigation strategy,
 * lifecycle, route warming). All of that is adaptv's now, so the app worker is
 * empty of delivery concerns by design — that is the change, stated as code.
 *
 * What it still earns its place doing is exercising `serviceWorkers: []` end to
 * end: without one file in that list the whole extension path — the generated
 * entry, the bundling, the ordering guarantee — ships untested.
 */

console.log("[probe] app service-worker module loaded")

//The app→worker direction. Anything adaptv reserves for itself is filtered out
//before it reaches here, so this only ever sees the app's own traffic.
onAppMessage((message) => {
  console.log("[probe] message from the app", message)
  void sendToApp({ type: "probe:pong", echo: message.type })
})
