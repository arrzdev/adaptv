import type { CodeSample } from "@/components/code"

export const SHOWCASE_SAMPLES: CodeSample[] = [
  {
    label: "adaptv.config.ts",
    lang: "ts",
    code: `import { defineApp } from "@arrzdev/adaptv/config"

// The web manifest, the native projects, launch screens, icons,
// theme and service worker are all generated from this file.
export default defineApp({
  name: "Inbox",
  description: "Mail that works on the train.",
  themeColor: { light: "#ffffff", dark: "#0b0c14" },
  styles: "./src/styles/main.css",

  // add one line and the same app builds for the stores
  appId: "com.example.inbox",

  router: { routesDirectory: "./routes" },
})`,
  },
  {
    label: "inbox.page.tsx",
    lang: "tsx",
    code: `import { List, PullToRefresh, View } from "@arrzdev/adaptv/components"
import { useIsOffline } from "@arrzdev/adaptv/hooks"

export default function Inbox() {
  const offline = useIsOffline()

  // No wrapper, no 100vh, no safe-area maths. The shell
  // stretches this View into the frame on every target.
  return (
    <View safe="top">
      {offline && <OfflineBanner />}
      <PullToRefresh onRefresh={refetch}>
        <List
          data={threads}
          keyExtractor={(thread) => thread.id}
          renderItem={(thread) => <ThreadRow thread={thread} />}
        />
      </PullToRefresh>
    </View>
  )
}`,
  },
  {
    label: "send-button.tsx",
    lang: "tsx",
    code: `import { Button } from "@arrzdev/adaptv/components"

// \`haptic\` is a prop: the Taptic Engine on iOS, a vibration on
// Android, nothing on desktop. The branch is taken for you.
//
// And \`active:\` means a PRESS — not "a finger landed here on
// its way to scrolling", which is what CSS :active means.
export function SendButton({ onSend }: Props) {
  return (
    <Button
      haptic="light"
      onClick={onSend}
      className="bg-indigo-600 active:bg-indigo-700"
    >
      Send
    </Button>
  )
}`,
  },
  {
    label: "Terminal",
    lang: "bash",
    code: `adaptv doctor                        # can this machine build for a phone?
adaptv dev     web|ios|android|all   # live reload, incl. a real device over the LAN
adaptv preview web|ios|android|all   # the production build, on the device
adaptv build   web|ios|android|all   # a deployable site · an .ipa · an .apk
adaptv icons   ./mark.png            # every icon, dark and tinted variants included`,
  },
]

export const BUILD_ERROR = `$ adaptv build ios

✖ ios  src/routes/checkout.page.tsx:4:9

  2 │ import { View } from "@arrzdev/adaptv/components"
  3 │
  4 │ const charge = createServerFn(async (cart) => {
    │                ^^^^^^^^^^^^^^
  5 │   return stripe.charges.create(cart)

  This needs a server to run, and the native app has none —
  the app is a folder of files on the device. It would work
  in dev and on your web deploy, then fail on iOS and Android.

  Move the logic to your API and call it over the network,
  or use a route loader, which runs everywhere.`
