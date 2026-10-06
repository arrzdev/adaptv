import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "hooks-updates",
  title: "Update hooks",
  summary:
    "Offer a waiting web update, talk to your service-worker modules, and find out when a native install is behind.",
  platforms: ["Web", "PWA", "iOS", "Android"],
  importLine:
    'import { useServiceWorkerUpdate, useServiceWorkerMessage, sendToServiceWorker, useStoreRelease } from "@arrzdev/adaptv/hooks"',
  source: "src/hooks",
  blocks: [
    {
      type: "p",
      text: "Updates are automatic. Use these hooks when the app needs a say. See [offline](/docs/offline) and [OTA updates](/docs/ota-updates).",
    },

    { type: "h2", text: "useServiceWorkerUpdate" },
    {
      type: "api",
      name: "useServiceWorkerUpdate()",
      signature:
        "function useServiceWorkerUpdate(): { updateAvailable: boolean; applyUpdate: () => void }",
      description:
        'The app side of `serviceWorkerUpdate: "prompt"` in [config](/docs/config). A new worker installs and waits until the app asks.',
      returns:
        "`updateAvailable` is `true` when a new version waits. `applyUpdate()` activates it and reloads the page. It does nothing if none waits.",
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
      text: 'With the default `"auto"`, `updateAvailable` is always `false`. adaptv updates at the next cold launch. Choose `"prompt"` when a reload would lose state.',
    },
    {
      type: "note",
      tone: "info",
      text: "`applyUpdate()` reloads the page. Save the user's work first.",
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
          note: "Always `false`. No service worker.",
        },
        {
          target: "Android",
          status: "no",
          note: "Always `false`. No service worker.",
        },
      ],
    },

    { type: "h2", text: "useServiceWorkerMessage" },
    {
      type: "p",
      text: "Add your own worker modules with `serviceWorkers` in [config](/docs/config). They import from `@arrzdev/adaptv/sw`.",
    },
    {
      type: "api",
      name: "useServiceWorkerMessage()",
      signature:
        "function useServiceWorkerMessage(handler: (message: ServiceWorkerMessage) => void): void",
      description:
        "Receive messages that your worker modules send with `sendToApp`. Messages without a string `type`, and adaptv's own messages, are ignored.",
      params: [
        {
          name: "handler",
          type: "(message: ServiceWorkerMessage) => void",
          required: true,
          description:
            "Called for each message. `ServiceWorkerMessage` is `{ type: string; [key: string]: unknown }`.",
        },
      ],
    },
    {
      type: "api",
      name: "sendToServiceWorker()",
      signature:
        "function sendToServiceWorker(message: ServiceWorkerMessage): void",
      description:
        "Post a message to the controlling worker. Your module gets it with `onAppMessage`. It does nothing if no worker controls the page.",
      params: [
        {
          name: "message",
          type: "ServiceWorkerMessage",
          required: true,
          description: "Needs a string `type`.",
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
      text: "`@arrzdev/adaptv/sw` exports `sendToApp(message)`, `onAppMessage(handler)` and `cacheRoute`. `sendToApp` sends to every open window and resolves to the number that got it. `cacheRoute` caches your own requests.",
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
        { target: "iOS", status: "no", note: "No service worker." },
        { target: "Android", status: "no", note: "No service worker." },
      ],
    },

    { type: "h2", text: "useStoreRelease" },
    {
      type: "api",
      name: "useStoreRelease()",
      signature: "function useStoreRelease(): StoreReleaseRequired | null",
      description:
        'Tells you if the over-the-air channel is ahead of the native app. This happens when you publish a build for different native plugins than the installed app has. Only a store update fixes it. The app still works. By default it takes new bundles, and features that need the missing code report unsupported. With `otaOnNativeSkew: "refuse"`, it keeps its last matching bundle.',
      returns:
        "`null` normally, and always on web and the server. Otherwise `{ buildTag, since }`.",
    },
    {
      type: "props",
      rows: [
        {
          name: "buildTag",
          type: "string",
          description: "The build the channel offers.",
        },
        {
          name: "since",
          type: "number",
          description:
            "When this device first found such a build, in ms since the epoch.",
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
      text: 'A value does not mean the new app is in the store. A new value means "an update is coming". An old value means "an update is overdue".',
    },
    {
      type: "p",
      text: "For a blocking screen, set `updateRequiredAfterDays` in [config](/docs/config).",
    },
    {
      type: "targets",
      rows: [
        { target: "Desktop web", status: "no", note: "Always `null`." },
        { target: "Mobile web", status: "no", note: "Always `null`." },
        { target: "Installed PWA", status: "no", note: "Always `null`." },
        {
          target: "iOS",
          status: "yes",
          note: "Needs OTA updates on, with `origin` in config. See [OTA updates](/docs/ota-updates).",
        },
        { target: "Android", status: "yes", note: "Same as iOS." },
      ],
    },
  ],
}
