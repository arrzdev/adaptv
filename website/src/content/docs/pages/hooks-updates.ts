import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "hooks-updates",
  title: "Update hooks",
  summary:
    "Offer a waiting web update, talk to your own service-worker modules, and find out when a native install has fallen behind the store.",
  platforms: ["Web", "PWA", "iOS", "Android"],
  importLine:
    'import { useServiceWorkerUpdate, useServiceWorkerMessage, sendToServiceWorker, useStoreRelease } from "@arrzdev/adaptv/hooks"',
  source: "src/hooks",
  blocks: [
    {
      type: "p",
      text: "adaptv updates an app in two ways. On web and in an installed PWA the service worker is the update mechanism. On native, new JavaScript arrives over the air between store releases. Both are automatic by default and need no UI. These hooks are for the cases where the app wants a say. Read [offline](/docs/offline) for the service worker and [OTA updates](/docs/ota-updates) for the native side.",
    },

    { type: "h2", text: "useServiceWorkerUpdate" },
    {
      type: "api",
      name: "useServiceWorkerUpdate()",
      signature:
        "function useServiceWorkerUpdate(): { updateAvailable: boolean; applyUpdate: () => void }",
      description:
        'The app side of `serviceWorkerUpdate: "prompt"` in [config](/docs/config). Under that policy a new build\'s worker installs and waits: nothing reloads until the app asks. This hook tells you one is waiting and lets you apply it.',
      returns:
        "`updateAvailable` is `true` once a new version has installed and is waiting. `applyUpdate()` activates it and reloads the page; it does nothing when no update is waiting, so it is safe on a button that is always mounted.",
    },
    {
      type: "code",
      label: "adaptv.config.ts",
      lang: "ts",
      code: `import { defineApp } from "@arrzdev/adaptv/config"

export default defineApp({
  // ...
  serviceWorkerUpdate: "prompt",
})`,
    },
    {
      type: "code",
      label: "update-banner.tsx",
      lang: "tsx",
      code: `function UpdateBanner() {
  const { updateAvailable, applyUpdate } = useServiceWorkerUpdate()
  if (!updateAvailable) return null
  return (
    <View row className="items-center justify-between p-3">
      <Text>A new version is ready.</Text>
      <Button onClick={applyUpdate}>Reload</Button>
    </View>
  )
}`,
    },
    {
      type: "p",
      text: 'Under the default `"auto"` policy `updateAvailable` is always `false`: the waiting worker is applied at the next cold launch, when there is no typed-in form or upload to lose, so there is never a moment to offer. You can leave the banner mounted and switch the policy in config without touching the UI. Choose `"prompt"` when a session holds state a reload would destroy: an editor, a long form, a call.',
    },
    {
      type: "note",
      tone: "info",
      text: "`applyUpdate()` reloads the page. Save what the user would lose before you call it.",
    },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "yes",
          note: "Production builds only. `adaptv dev` registers no worker.",
        },
        {
          target: "Mobile web",
          status: "yes",
          note: "Production builds only.",
        },
        { target: "Installed PWA", status: "yes" },
        {
          target: "iOS",
          status: "no",
          note: "Always `false`. Native builds register no service worker; updates arrive over the air instead.",
        },
        {
          target: "Android",
          status: "no",
          note: "Always `false`, for the same reason.",
        },
      ],
    },

    { type: "h2", text: "useServiceWorkerMessage" },
    {
      type: "p",
      text: "An app can add its own modules to adaptv's worker by listing them under `serviceWorkers` in [config](/docs/config), for push notifications or background sync. Those modules run in the worker and import from `@arrzdev/adaptv/sw`. These two exports are the app's end of the channel.",
    },
    {
      type: "api",
      name: "useServiceWorkerMessage()",
      signature:
        "function useServiceWorkerMessage(handler: (message: ServiceWorkerMessage) => void): void",
      description:
        'Receive messages your worker modules send with `sendToApp`. It takes a handler and returns nothing, on purpose: messages are events, and a "last message" state value would drop all but one of a burst arriving in the same tick. The handler is held in a ref, so an inline arrow does not re-subscribe on every render. Messages without a string `type` are ignored.',
      params: [
        {
          name: "handler",
          type: "(message: ServiceWorkerMessage) => void",
          required: true,
          description:
            "Called once per message. `ServiceWorkerMessage` is `{ type: string; [key: string]: unknown }`.",
        },
      ],
    },
    {
      type: "api",
      name: "sendToServiceWorker()",
      signature:
        "function sendToServiceWorker(message: ServiceWorkerMessage): void",
      description:
        "Post a message to the worker controlling this page. Your module receives it with `onAppMessage`. It does nothing when no worker controls the page: before the first activation, on native and in dev.",
      params: [
        {
          name: "message",
          type: "ServiceWorkerMessage",
          required: true,
          description:
            "Must carry a string `type`. The rest must survive structured clone.",
        },
      ],
    },
    {
      type: "code",
      label: "src/sw/push.ts",
      lang: "ts",
      code: `import { onAppMessage, sendToApp } from "@arrzdev/adaptv/sw"

self.addEventListener("push", (event) => {
  event.waitUntil(sendToApp({ type: "push", body: event.data?.text() }))
})

onAppMessage((message) => {
  if (message.type === "clear-badge") void navigator.clearAppBadge?.()
})`,
    },
    {
      type: "code",
      label: "inbox.tsx",
      lang: "tsx",
      code: `useServiceWorkerMessage((message) => {
  if (message.type === "push") setBanner(String(message.body))
})

useScreenLifecycle({
  onEnter: () => sendToServiceWorker({ type: "clear-badge" }),
})`,
    },
    {
      type: "p",
      text: "The worker side, `@arrzdev/adaptv/sw`, exports `sendToApp(message)`, which broadcasts to every open window of the app, including one the worker does not control yet, and resolves to how many received it; `onAppMessage(handler)`, which returns an unsubscribe; and `cacheRoute` for caching your own requests. You never write registration code: adaptv bundles your modules into its worker and registers it.",
    },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "yes",
          note: "Production builds only.",
        },
        {
          target: "Mobile web",
          status: "yes",
          note: "Production builds only.",
        },
        { target: "Installed PWA", status: "yes" },
        {
          target: "iOS",
          status: "no",
          note: "No service worker on native. The handler never fires and sends do nothing.",
        },
        { target: "Android", status: "no", note: "Same." },
      ],
    },

    { type: "h2", text: "useStoreRelease" },
    {
      type: "api",
      name: "useStoreRelease()",
      signature: "function useStoreRelease(): StoreReleaseRequired | null",
      description:
        'Whether the over-the-air channel has moved past the native app this device has installed. That happens when you publish a build made against a different set of native plugins than the installed binary carries; from then on only a store update brings the two back in line. The install is still working: by default it keeps taking new bundles, and features that need the missing native code report unsupported through their hooks. Under `otaOnNativeSkew: "refuse"` it stays on its last matching bundle instead. adaptv reports the fact and how long it has been true, and leaves what to show to you.',
      returns:
        "`null` normally, and always on web, in a PWA and on the server. Otherwise `{ buildTag, since }`.",
    },
    {
      type: "props",
      rows: [
        {
          name: "buildTag",
          type: "string",
          description:
            "The build the channel is offering. Opaque to users; put it in bug reports.",
        },
        {
          name: "since",
          type: "number",
          description:
            "When this device first found a build made for a native layer it does not have, in ms since the epoch. It survives relaunches and is not reset by later builds, so it measures how long the install has been behind.",
        },
      ],
    },
    {
      type: "code",
      label: "update-nag.tsx",
      lang: "tsx",
      code: `const behind = useStoreRelease()
if (!behind) return null

const days = (Date.now() - behind.since) / 86_400_000
if (days > 14) return <UpdateRequiredScreen />
if (days > 3) return <UpdateBanner />
return null`,
    },
    {
      type: "note",
      tone: "info",
      text: 'A non-null value does not mean the new app is in the store yet. The channel moves when the release is built, usually before review lets anyone install it. Treat a fresh value as "an update is coming" and let its age turn it into "an update is overdue".',
    },
    {
      type: "p",
      text: "If all you want is a blocking screen after a number of days, set `updateRequiredAfterDays` in [config](/docs/config) and adaptv shows one for you. Use the hook for anything gentler.",
    },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "no",
          note: "Always `null`. There is no native layer to fall behind.",
        },
        { target: "Mobile web", status: "no", note: "Always `null`." },
        { target: "Installed PWA", status: "no", note: "Always `null`." },
        {
          target: "iOS",
          status: "yes",
          note: "Only when OTA updates are on, which needs `origin` set in config; see [OTA updates](/docs/ota-updates).",
        },
        { target: "Android", status: "yes", note: "Same." },
      ],
    },
  ],
}
