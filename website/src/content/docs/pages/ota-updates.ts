import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "ota-updates",
  title: "Over-the-air updates",
  summary:
    "Ship new JavaScript to installed iOS and Android apps without a store release.",
  blocks: [
    {
      type: "p",
      text: "`adaptv build web` writes a signed update channel into your web deploy. Installed native apps poll it and install new web assets. There is no update server. On the web and in an installed PWA, the [service worker](/docs/offline) does this job.",
    },
    { type: "h2", text: "Set it up" },
    {
      type: "ol",
      items: [
        "Run `adaptv keys ota` once per app. It prints a public key and a private key. adaptv keeps no copy.",
        "Put the public key in `adaptv.config.ts` as `otaPublicKey`. Commit it.",
        "Store the private key as the secret `ADAPTV_OTA_PRIVATE_KEY` in your deploy. Or set `ADAPTV_OTA_PRIVATE_KEY_FILE` to a file that holds it.",
        "Set `appId` and `origin` in the config.",
        "Build and submit the native apps. They carry the origin and key. Earlier installs never check for updates.",
        "Deploy with `adaptv build web`. Each deploy publishes an update.",
      ],
    },
    {
      type: "code",
      label: "adaptv.config.ts",
      lang: "ts",
      code: `import { defineApp } from "@arrzdev/adaptv/config"

export default defineApp({
  // ...
  appId: "com.acme.app",
  origin: "https://app.acme.com",
  otaPublicKey: \`-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...
-----END PUBLIC KEY-----\`,
})`,
    },
    {
      type: "note",
      tone: "warn",
      text: "Back up the private key. If you lose it, no installed app can update until each user takes a new store release with a new key. `origin` and `otaPublicKey` are also fixed in the store binary. Change either only with a store release.",
    },
    { type: "h2", text: "Config keys" },
    {
      type: "props",
      rows: [
        {
          name: "origin",
          type: "string",
          description:
            "The public origin of your web deploy. No path, no trailing slash. It must be `https`, except for local addresses. Without it, or without `appId`, OTA is off.",
        },
        {
          name: "otaPublicKey",
          type: "string",
          description:
            "The public key from `adaptv keys ota`. Without it, a build with an `origin` refuses to publish.",
        },
        {
          name: "otaPollMinutes",
          type: "number",
          default: "60",
          description:
            "How often a foreground app checks. `0` turns the timer off. Launch and resume still check. The minimum is `5`.",
        },
        {
          name: "otaOnNativeSkew",
          type: '"install" | "refuse"',
          default: '"install"',
          description:
            "What an app does with a bundle built for other native plugins. See below.",
        },
        {
          name: "updateRequiredAfterDays",
          type: "number",
          description:
            "Days an app may lag a native change before a blocking screen appears. Off by default.",
        },
        {
          name: "updateRequiredScreen",
          type: "() => import(...)",
          description:
            "Your own blocking screen. It gets `days`, `since` and `buildTag`.",
        },
      ],
    },
    { type: "h2", text: "Publish" },
    {
      type: "p",
      text: "With `origin` set, `adaptv build web` builds the native bundle, builds the site, and writes this into the site:",
    },
    {
      type: "code",
      label: "Output",
      lang: "text",
      code: `.well-known/adaptv/ota/
  manifest.json            signed
  bundle-<buildTag>.zip`,
    },
    {
      type: "p",
      text: "The command stops early if the public key is missing, no private key is set, or the keys are not a pair. In CI:",
    },
    {
      type: "code",
      label: "deploy.yml (excerpt)",
      lang: "text",
      code: `- run: pnpm adaptv build web
  env:
    ADAPTV_OTA_PRIVATE_KEY: \${{ secrets.ADAPTV_OTA_PRIVATE_KEY }}
- run: <your host's deploy command>`,
    },
    {
      type: "ul",
      items: [
        "The origin is the channel. A staging deploy publishes to the staging origin.",
        "Serve `manifest.json` with `Cache-Control: no-cache`. A CDN that caches it hides every update.",
        "Do not rewrite `.well-known` to `index.html`.",
        "A plain `vite build` publishes nothing. Use `adaptv build web`.",
      ],
    },
    { type: "h2", text: "What an installed app does" },
    {
      type: "ul",
      items: [
        "It checks on launch, on resume, and on the poll timer.",
        "It downloads in the background and verifies the signatures.",
        "It applies the update at the next cold start. You cannot force an update sooner.",
        "On a first launch with an out-of-date embedded bundle, it waits up to 5 seconds behind the splash for the current one.",
      ],
    },
    { type: "h2", text: "Roll back" },
    {
      type: "p",
      text: "The app calls ready after it mounts. A new bundle that does not report ready is reverted at the next launch and blocked on that device. The revert first lands on the bundle inside the store binary. adaptv then points the following launch at the newest bundle that worked. So a user runs the older bundle for one session.",
    },
    {
      type: "p",
      text: "There is no kill switch. To withdraw a bad release, redeploy the previous build with `adaptv build web`. A redeployed build gets a new timestamp, so devices accept it. Never call a native plugin at module scope. The bundle would never report ready.",
    },
    { type: "h2", text: "When a release adds native code" },
    {
      type: "p",
      text: "A new plugin changes the native fingerprint. Bundles with the new fingerprint reach apps before the new binary does.",
    },
    {
      type: "table",
      head: ["otaOnNativeSkew", "Behaviour"],
      rows: [
        [
          '`"install"`',
          "The bundle installs. Features that need the missing code report themselves unavailable, for example `useShare().supported`. Check before you call.",
        ],
        [
          '`"refuse"`',
          "The app stays on its last matching bundle until a store update. Use it when the release changed a server contract.",
        ],
      ],
    },
    {
      type: "p",
      text: "`useStoreRelease()` from `@arrzdev/adaptv/hooks` returns `{ buildTag, since }` when the channel is ahead of this binary, and `null` otherwise. `since` is in milliseconds and survives relaunches.",
    },
    {
      type: "code",
      label: "update-nudge.tsx",
      lang: "tsx",
      code: `import { useStoreRelease } from "@arrzdev/adaptv/hooks"

// Banner is your own component.
export function UpdateNudge() {
  const behind = useStoreRelease()
  if (!behind) return null
  if (Date.now() - behind.since < 7 * 86_400_000) return null
  return <Banner>Update the app from the store.</Banner>
}`,
    },
    {
      type: "p",
      text: "To block the app instead, set `updateRequiredAfterDays`. `0` blocks at once. `14` gives the store time to catch up. Use it only when a server change would break the old app.",
    },
    {
      type: "p",
      text: 'To use your own screen, set `updateRequiredScreen: () => import("@/components/update-required")` in the config. Its default export gets `{ days, since, buildTag }`.',
    },
    { type: "h2", text: "Test locally" },
    {
      type: "ul",
      items: [
        "`ADAPTV_OTA_ORIGIN` replaces `origin`. `http://localhost`, `127.0.0.1` and `10.0.2.2` (the Android emulator's address for your computer) may use `http`. A device also needs a cleartext exception. adaptv adds none.",
        "`ADAPTV_OTA_PUBLIC_KEY` replaces `otaPublicKey`. Use it with a throwaway key pair. It needs `ADAPTV_OTA_ORIGIN`.",
        "`ADAPTV_OTA_ALLOW_UNSIGNED=1` publishes an unsigned channel. It needs `ADAPTV_OTA_ORIGIN`. Local use only.",
      ],
    },
    { type: "h2", text: "What goes wrong" },
    {
      type: "p",
      text: "Installed apps do not update. Check these causes in order.",
    },
    {
      type: "ol",
      items: [
        "The app was built before `origin` and `otaPublicKey` were set. Ship a store build.",
        "Your deploy runs `vite build` and not `adaptv build web`.",
        "The private key does not match `otaPublicKey`. The build prints a refusal.",
        "A CDN caches `manifest.json`. Set `Cache-Control: no-cache`.",
        "`appId` is missing, or the origin is not `https`.",
        "The bundle never reports ready, so the watchdog rolls it back. Look for a native call at module scope.",
        "You changed the key or origin. Installed apps ignore the change until a store release.",
        "The app has not cold-started yet. Close it and open it again.",
      ],
    },
    {
      type: "p",
      text: "On native, the failing bundle's build tag is on `<html data-adaptv-boot-bundle>`. Send it with your crash reports to find the bad deploy.",
    },
    { type: "h2", text: "Where it works" },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "no",
          note: "Not used. The service worker updates the app.",
        },
        { target: "Mobile web", status: "no", note: "Same as desktop web." },
        {
          target: "Installed PWA",
          status: "no",
          note: "Same. `useStoreRelease()` is `null`.",
        },
        {
          target: "iOS",
          status: "yes",
          note: "Needs `origin` and `otaPublicKey` in the installed binary.",
        },
        { target: "Android", status: "yes", note: "Same." },
      ],
    },
  ],
}
