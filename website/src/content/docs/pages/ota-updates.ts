import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "ota-updates",
  title: "Over-the-air updates",
  summary:
    "Ship new JavaScript to installed iOS and Android apps from your own web deploy, signed, with automatic rollback and no update server.",
  blocks: [
    {
      type: "p",
      text: "The native app is a shell around a bundle of JavaScript, CSS and assets. None of that bundle is native code, so a newer one can be downloaded and swapped in without a store release. adaptv hosts the update channel **inside your ordinary web deploy**: `adaptv build web` writes it, your host serves it, and every installed app polls it. There is no third-party service and no separate publish step.",
    },
    {
      type: "p",
      text: "On the web and in an installed PWA the [service worker](/docs/offline) is the update mechanism, and nothing on this page applies.",
    },
    { type: "h2", text: "Set it up" },
    {
      type: "ol",
      items: [
        "Generate a signing key pair: `adaptv keys ota`. Run it once per app.",
        "Put the **public** half in `adaptv.config.ts` as `otaPublicKey` and commit it. Put the **private** half in your deploy's secret store as `ADAPTV_OTA_PRIVATE_KEY`.",
        "Set `origin` to the public origin of your web deploy.",
        "Build and submit the native apps. The origin and public key are baked into the binary, so installs made before this step never check for updates.",
        "From then on, deploy the web app with `adaptv build web`. Each deploy publishes the update.",
      ],
    },
    {
      type: "code",
      label: "Terminal",
      lang: "bash",
      code: `adaptv keys ota`,
    },
    {
      type: "p",
      text: "The command prints both halves once and keeps no copy. The private key is printed last and is not written to disk anywhere.",
    },
    {
      type: "note",
      tone: "warn",
      text: "Back the private key up the way you back up a signing certificate. Every installed app verifies against the public half inside its binary. Lose the private half and no installed app can be updated again until each user takes a new store release that carries a new public key.",
    },
    {
      type: "code",
      label: "adaptv.config.ts",
      lang: "ts",
      code: `export default defineApp({
  // ...
  appId: "com.acme.app",
  origin: "https://app.acme.com",
  otaPublicKey: \`-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...
-----END PUBLIC KEY-----\`,
})`,
    },
    { type: "h2", text: "Config" },
    {
      type: "p",
      text: "The keys are top-level in `adaptv.config.ts`. There is no nested `ota` block.",
    },
    {
      type: "props",
      rows: [
        {
          name: "origin",
          type: "string",
          description:
            "The app's public origin, such as `https://app.acme.com`. Origin only: no path, no trailing slash. It must be `https` outside local addresses, and the build fails otherwise, because both mobile platforms block cleartext inside the network stack and the check would fail silently on every device. Omit it and OTA is off: no channel is written and the app never checks.",
        },
        {
          name: "otaPublicKey",
          type: "string",
          description:
            "The public half of the signing pair, a PEM SPKI RSA key, exactly as `adaptv keys ota` printed it. Without it, a build that has an `origin` refuses to publish.",
        },
        {
          name: "otaPollMinutes",
          type: "number",
          default: "60",
          description:
            "How often an app looks for an update while it stays in the foreground. `0` turns the timer off; launch and resume still check. The minimum is `5`, and a smaller number fails the build.",
        },
        {
          name: "otaOnNativeSkew",
          type: '"install" | "refuse"',
          default: '"install"',
          description:
            "What an install does with a bundle built against a different set of native plugins than it has. See **When a release changes native code** below.",
        },
        {
          name: "updateRequiredAfterDays",
          type: "number",
          description:
            "Days an install may be left behind by a native change before adaptv shows a blocking update screen. Unset by default, which means never.",
        },
        {
          name: "updateRequiredScreen",
          type: "() => import(...)",
          description:
            "Your own screen for `updateRequiredAfterDays`. Receives `days`, `since` and `buildTag`.",
        },
      ],
    },
    {
      type: "note",
      tone: "warn",
      text: "Treat `origin` and `otaPublicKey` as permanent, like the bundle ID. Both are baked into the store binary and can only change through a store release. An install that never takes that release keeps asking the old origin, or keeps rejecting the new key, for the rest of its life. It is not broken, it is frozen, and it says nothing about it.",
    },
    { type: "h2", text: "Publishing" },
    {
      type: "p",
      text: "`adaptv build web` does three things in order when `origin` is set:",
    },
    {
      type: "ol",
      items: [
        "Builds the native bundle (a static SPA with no service worker), hashes it into a `buildTag`, and zips it under `.adaptv/ota/`.",
        "Builds the site.",
        "Writes the zip and a signed `manifest.json` into the site's client output, under `.well-known/adaptv/ota/`.",
      ],
    },
    {
      type: "code",
      label: "What your host serves",
      lang: "text",
      code: `https://app.acme.com/.well-known/adaptv/ota/
  manifest.json            buildTag, nativeFingerprint, url, sha256, createdAt, signatures
  bundle-<buildTag>.zip    the bundle installed apps download`,
    },
    {
      type: "p",
      text: "Signing is checked before anything is built. The command refuses, with the reason, when `otaPublicKey` is missing or unreadable, when no private key is in the environment, or when the private key in the environment is not the pair of the public key in the config. Provide the private key as `ADAPTV_OTA_PRIVATE_KEY`, or a path to it as `ADAPTV_OTA_PRIVATE_KEY_FILE`.",
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
        "**The origin is the channel.** A staging build deploys to the staging origin and its installs point there. There is no channel name to get wrong.",
        "**A re-deploy of identical code is not a release.** The build fetches the currently deployed manifest and, when the `buildTag` matches, carries its timestamp over. The files are still written on every deploy, because a deploy replaces the whole site.",
        "**Old zips do not need to stay on the server.** Rollback is a local operation over bundles the device already has.",
        "**A plain `vite build` does not publish.** Only `adaptv build web` can, because it has to make two builds. If your deploy runs `vite build`, installed apps stop receiving updates and nothing reports it.",
        "`--force` rebuilds the native bundle even when nothing changed.",
      ],
    },
    { type: "h2", text: "Hosting the channel" },
    {
      type: "p",
      text: "Any host that serves static files from your origin over `https` works. Two things to set:",
    },
    {
      type: "ul",
      items: [
        'Serve `/.well-known/adaptv/ota/manifest.json` with `Cache-Control: no-cache` (or `no-store`). A CDN that caches the manifest hands devices a stale answer for as long as it is cached, and from inside the app that looks exactly like "no update".',
        "Make sure your host does not strip or rewrite the `.well-known` directory. On a static SPA host, the catch-all rewrite must not answer these two files with `index.html`.",
      ],
    },
    { type: "h2", text: "What an installed app does" },
    {
      type: "p",
      text: "You call nothing. The shell starts the updater on native when the build has an `origin`.",
    },
    {
      type: "ul",
      items: [
        "**It checks** on every launch, on every resume from the background, and on the `otaPollMinutes` timer. One check runs at a time, and each check restarts the timer.",
        "**It downloads in the background** and verifies the bundle before unpacking.",
        "**It applies at the next cold start**, never in the middle of a session. Replacing the document under a running app would discard scroll position, typed input and open sheets.",
        "**The one exception is a first launch.** A fresh install whose embedded bundle is already out of date waits for the current one, behind the launch screen, for up to 5 seconds. After that it starts on the embedded bundle and the update applies next launch. It does not wait when the update needs native code this binary lacks.",
      ],
    },
    { type: "h2", text: "Safety" },
    {
      type: "p",
      text: "An update channel can run any JavaScript inside every installed app, with every permission the app was granted. A compromised CDN or DNS record would otherwise be enough. So:",
    },
    {
      type: "ul",
      items: [
        "**The bundle is signed, and the manifest is signed too.** The zip's signature is verified natively against the key in the binary. The manifest carries its own signature over its fields, including the timestamp, so a genuine old bundle cannot be replayed under a new date to force a downgrade. `sha256` alone protects against corruption, not substitution.",
        "**Unsigned channels are refused at build time**, not warned about.",
        "**A boot watchdog rolls back a bundle that does not start.** The app reports ready after it mounts. A freshly applied bundle that does not report in time is reverted at the next launch.",
        "**Rollback goes to the last known-good bundle**, not to the bundle in the store binary, which may be a year old.",
        "**A rolled-back bundle is blocked on that device**, so it is not downloaded again at the next launch while the channel still advertises it.",
        "**There is no server kill switch and no phased rollout.** To withdraw a bad release, fix it or redeploy the previous build. The channel always says what your web deploy says, which keeps native and web on the same version.",
      ],
    },
    {
      type: "note",
      text: "Only web assets can ship this way. The native splash and launch colour, the app icon, the app name, the set of native plugins, `origin` and `otaPublicKey` change only through a store release.",
    },
    { type: "h2", text: "When a release changes native code" },
    {
      type: "p",
      text: "Every build records a fingerprint of what JavaScript can call natively: the native plugin set, each plugin's version, the native runtime's version, and the `appId`. When you add a plugin, the channel starts publishing bundles whose fingerprint differs from the apps already installed, days before review lets anyone install the new binary. `otaOnNativeSkew` decides what those installs do.",
    },
    {
      type: "table",
      head: ["Value", "Behaviour", "Choose it when"],
      rows: [
        [
          '`"install"` (default)',
          "The bundle installs and runs. Features that need the missing native code report themselves unavailable through their capability hook, such as `useShare().supported`.",
          "Almost always. Every bug fix in that release reaches every install on the day you deploy.",
        ],
        [
          '`"refuse"`',
          "The bundle is not downloaded. The install stays on its last matching bundle until a store update.",
          "The release changed a contract the JavaScript cannot route around: a server API, an auth flow, a data shape.",
        ],
      ],
    },
    {
      type: "note",
      tone: "warn",
      text: 'Under `"install"`, check `supported` before calling a native capability, and never call a native plugin at module scope. A rejected call while modules evaluate stops the app from mounting, and the watchdog rolls the bundle back.',
    },
    { type: "h3", text: "useStoreRelease" },
    {
      type: "api",
      name: "useStoreRelease()",
      signature:
        "function useStoreRelease(): { buildTag: string; since: number } | null",
      description:
        "Whether the channel has moved past the binary this device has installed. `null` is the normal answer, and the only answer on web and PWA. A value means the app is working and is behind in one direction: only a store update brings its native layer back in line. `since` is when this device first saw such a build, in ms since the epoch, and it survives relaunches so you can act on how long it has been.",
      returns:
        'It does not say a newer app is in the store yet. The channel moves when the release is built, usually before review finishes. Treat a fresh value as "an update is coming" and an old one as "an update is overdue".',
    },
    {
      type: "code",
      label: "update-nudge.tsx",
      lang: "tsx",
      code: `import { useStoreRelease } from "@arrzdev/adaptv/hooks"

export function UpdateNudge() {
  const behind = useStoreRelease()
  if (!behind) return null

  const days = (Date.now() - behind.since) / 86_400_000
  if (days < 7) return null

  return <Banner>Update the app from the store to get the latest features.</Banner>
}`,
    },
    { type: "h3", text: "Blocking the app" },
    {
      type: "p",
      text: "Set `updateRequiredAfterDays` and adaptv takes the screen once an install has been behind for that many days. It is a number and not a switch on purpose. `0` blocks the moment the channel moves, which is right when a server contract broke with the release and hostile otherwise. Something like `14` lets the store catch up first. An install in this state is still working, so leave this unset unless the app would be broken anyway.",
    },
    {
      type: "p",
      text: "The default screen states how long the install has been behind and does not promise the new version is downloadable. Replace it with `updateRequiredScreen`. The `UpdateRequired` component exported from `@arrzdev/adaptv/components` is what the shell mounts; you only need it directly when you build your own shell.",
    },
    {
      type: "code",
      label: "src/components/update-required.tsx",
      lang: "tsx",
      code: `import type { UpdateRequiredProps } from "@arrzdev/adaptv/config"

export default function UpdateRequiredScreen({ days, buildTag }: UpdateRequiredProps) {
  return (
    <View center safe="all" className="fixed inset-0 gap-4 bg-white px-6 text-center">
      <Text>This version is {days} days out of date. Update from the store to continue.</Text>
      <Text className="text-xs text-gray-500">{buildTag}</Text>
    </View>
  )
}`,
    },
    { type: "h2", text: "The runtime API" },
    {
      type: "p",
      text: "`@arrzdev/adaptv/ota` exports the machinery the shell drives: `startOtaUpdates(options)`, which returns a stop function and accepts `onUpdateReady(buildTag)` and `onStoreReleaseRequired(buildTag)` callbacks, and the pure policy functions (`decideUpdate`, `decideFirstLaunch`, `selectRollbackTarget`, `selectPrunableBundles`) with their types. An app using the generated shell has no reason to call these. They are public for telemetry and for apps that replace the shell.",
    },
    { type: "h2", text: "Store policy" },
    {
      type: "p",
      text: "Both stores allow this, within limits. Apple's Developer Program License Agreement (section 3.3.1(B)) permits downloaded interpreted code as long as it does not change the app's primary purpose, bypass signing or the sandbox, or create a store for other apps; App Store Review Guideline 2.5.2 is the related rule on self-contained apps. Google Play's policy on self-updating code exempts code that runs in a virtual machine or interpreter, and names JavaScript in a WebView. What follows for you:",
    },
    {
      type: "ul",
      items: [
        "Ship fixes, copy, layout and features in the spirit of the app you submitted. Do not use OTA to turn the app into a different product after review.",
        "Web assets only. adaptv never downloads native code, and nothing it downloads may.",
        "Content delivered over the air is still subject to each store's content rules.",
      ],
    },
    {
      type: "note",
      text: "This summarises the policies as adaptv's maintainers read them in mid-2026. It is not legal advice; read the current agreements before relying on it.",
    },
    { type: "h2", text: "Testing locally" },
    {
      type: "ul",
      items: [
        "`ADAPTV_OTA_ORIGIN` overrides `origin` for a local run. `http://localhost`, `127.0.0.1` and `10.0.2.2` are accepted as cleartext origins.",
        "`ADAPTV_OTA_PUBLIC_KEY` overrides `otaPublicKey`, only together with `ADAPTV_OTA_ORIGIN`, so you can verify a signed channel against a throwaway pair without holding the production key.",
        "`ADAPTV_OTA_ALLOW_UNSIGNED=1`, only together with `ADAPTV_OTA_ORIGIN`, publishes an unsigned channel. Local use only.",
      ],
    },
    { type: "h2", text: "What is still open" },
    {
      type: "ul",
      items: [
        "**Key rotation is not built.** The binary carries one public key. There is no way yet to introduce a second key across a store release, and an install that misses a rotation rejects every later manifest silently.",
        "**A process killed while a bundle is being unpacked** is not fully reasoned about by the watchdog yet.",
      ],
    },
    { type: "h2", text: "Where it works" },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "no",
          note: "Not needed. A deploy is the update; the service worker picks it up.",
        },
        { target: "Mobile web", status: "no", note: "Same as desktop web." },
        {
          target: "Installed PWA",
          status: "no",
          note: "Same. `useStoreRelease()` is always `null`.",
        },
        {
          target: "iOS",
          status: "yes",
          note: "Requires `origin` and `otaPublicKey` in the binary that is installed.",
        },
        {
          target: "Android",
          status: "yes",
          note: "Same. A local cleartext channel additionally needs a network security exception, which production never does.",
        },
      ],
    },
  ],
}
