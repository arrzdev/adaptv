import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "native-builds",
  title: "Native builds",
  summary:
    "Run the app on an iOS simulator, an Android emulator or a phone with one command, and package an .ipa and an .apk from the same source.",
  blocks: [
    {
      type: "p",
      text: "The iOS and Android apps are the same web bundle inside a native shell that adaptv owns. You do not create an Xcode or Android Studio project, write a native config file, or run a sync step. You set one config key, install the platform toolchains, and use the same three commands you use for the web: `dev`, `preview` and `build`.",
    },
    { type: "h2", text: "What you need installed" },
    {
      type: "table",
      head: ["For", "You need"],
      rows: [
        ["Everything", "Node 22.12 or newer."],
        [
          "iOS",
          "A Mac with Xcode, and CocoaPods (`pod`). iOS builds do not run on Linux or Windows.",
        ],
        [
          "Android",
          "The Android SDK (installing Android Studio is the usual way) and a JDK. Android Studio's bundled JDK is found automatically.",
        ],
      ],
    },
    {
      type: "p",
      text: "adaptv finds the toolchains itself: `ANDROID_HOME`, then `ANDROID_SDK_ROOT`, then `~/Library/Android/sdk`; `JAVA_HOME`, then Android Studio's bundled runtime. A value you export in your shell always wins.",
    },
    { type: "h3", text: "Check the machine with doctor" },
    {
      type: "code",
      label: "Terminal",
      lang: "bash",
      code: `adaptv doctor`,
    },
    {
      type: "p",
      text: "`doctor` prints one row per requirement and how to fix each one that fails. Pass `--json` for one machine-readable document on stdout, `--quiet` for outcomes and failures only, `--verbose` for the raw output.",
    },
    {
      type: "table",
      head: ["Group", "Checks"],
      rows: [
        ["Core", "Node, and adaptv's own install."],
        [
          "Android",
          "Android SDK, JDK, and `adb` (optional, needed to launch on a device or emulator).",
        ],
        ["iOS (macOS only)", "`xcodebuild`, and CocoaPods (optional)."],
        [
          "Project",
          "Whether the Android and iOS projects exist yet, and the icon source: a count of your icons, or a line saying the app ships adaptv's default mark.",
        ],
      ],
    },
    {
      type: "p",
      text: "When a native project exists, `doctor` also reads it for three problems that otherwise fail without an error message:",
    },
    {
      type: "ul",
      items: [
        "`WKAppBoundDomains` present in the iOS `Info.plist` without the matching opt-in. The native bridge does not load and every capability silently falls back to its web behaviour.",
        "An Android target SDK below 36. Google Play refuses the upload. The fix is to run any Android command: adaptv raises the level itself.",
        "A missing `PrivacyInfo.xcprivacy`. App Store Connect rejects the build after upload.",
      ],
    },
    { type: "h2", text: "Turn native on" },
    {
      type: "p",
      text: "Native builds are enabled by `appId`. A web-only app leaves it out.",
    },
    {
      type: "code",
      label: "adaptv.config.ts",
      lang: "ts",
      code: `import { defineConfig } from "@arrzdev/adaptv/config"

export default defineConfig({
  name: "Chop Chop",
  themeColor: { light: "#ffffff", dark: "#0a0a0a" },

  appId: "com.chopchop.app",
  // appName: "Chop Chop", // home-screen label, defaults to \`name\`
})`,
    },
    {
      type: "props",
      rows: [
        {
          name: "appId",
          type: "string",
          description:
            "Reverse-domain identifier: the iOS bundle id and the Android application id. Setting it enables native builds.",
        },
        {
          name: "appName",
          type: "string",
          default: "name",
          description: "The label under the icon on the device.",
        },
        {
          name: "plugins",
          type: "string[]",
          description:
            "Extra native plugins, by package name. Added to the set adaptv ships for its own capabilities.",
        },
        {
          name: "pluginConfig",
          type: "Record<string, Record<string, unknown>>",
          description:
            "Native runtime settings for plugins, keyed by the plugin's class name (`Camera`, `PushNotifications`).",
        },
        {
          name: "privacy",
          type: "AdaptvPrivacyConfig",
          description:
            "Declarations for the iOS privacy manifest that adaptv cannot derive: `tracking`, `trackingDomains`, `collectedData`, extra `requiredReasonAPIs`.",
        },
      ],
    },
    { type: "h2", text: "Run it while you work" },
    {
      type: "code",
      label: "Terminal",
      lang: "bash",
      code: `adaptv dev ios
adaptv dev android
adaptv dev all --latest   # web, iOS and Android together`,
    },
    {
      type: "p",
      text: "`dev` prepares the native project, installs the app on the device you pick, and points it at the dev server, so edits hot-reload on the device as they do in a browser. It runs until Ctrl-C and then reverts everything it changed in the native project.",
    },
    {
      type: "table",
      head: ["Key", "Does"],
      rows: [
        ["`r`", "Reloads the JavaScript."],
        [
          "`b`",
          "Rebuilds and reinstalls the native app. Needed after a change that lives in the shell: a new plugin, a new icon, `appName`.",
        ],
      ],
    },
    {
      type: "props",
      rows: [
        {
          name: "--target <id>",
          type: "flag",
          description:
            "Launch on a specific simulator, emulator or device, by id. The choice is remembered. Cannot be combined with `all`.",
        },
        {
          name: "--latest",
          type: "flag",
          description:
            "Reuse the device you picked last time for this platform. Falls back to the picker when there is none.",
        },
        {
          name: "--host",
          type: "flag",
          description:
            "Serve on this machine's LAN address so a physical device can reach the dev server. Takes no value, and is automatic when the target is a physical device.",
        },
        {
          name: "--force",
          type: "flag",
          description:
            "Do the work even when nothing changed: reinstall, rebuild, re-sync.",
        },
        {
          name: "--verbose",
          type: "flag",
          description:
            "Stream the raw build output instead of the summarised steps.",
        },
        {
          name: "-- <args>",
          type: "passthrough",
          description:
            "Everything after `--` goes to the dev server: `adaptv dev ios -- --port 4000`.",
        },
      ],
    },
    { type: "h3", text: "Picking a device" },
    {
      type: "p",
      text: "With no flag, `dev` and `preview` show an arrow-key list of simulators, emulators and connected devices with their OS versions. The pick is stored in `.adaptv/state.json`, which is what `--latest` reads. When there is no terminal to ask (CI, a script), adaptv picks the first simulator or emulator, and a physical device only when nothing else exists.",
    },
    { type: "h3", text: "On a physical phone" },
    {
      type: "p",
      text: "A phone has to reach the dev server over the network, which is plain `http`. For the length of the session adaptv adds the iOS transport-security exception and the Android port reverse that make this work, and removes them on exit. If a session is killed hard, the next run cleans up what was left. If your `Info.plist` contains a transport-security entry adaptv did not write, it warns you to remove it before App Review.",
    },
    { type: "h3", text: "The dev app installs next to the real one" },
    {
      type: "p",
      text: "`dev` and `preview` install under `<appId>.dev` with the name `<name> (dev)`. It sits beside a store or `build` install on the same phone, with its own storage, so testing never touches your real data. `build` uses the release `appId`.",
    },
    { type: "h2", text: "Run the real build" },
    {
      type: "code",
      label: "Terminal",
      lang: "bash",
      code: `adaptv preview ios
adaptv preview android`,
    },
    {
      type: "p",
      text: "`preview` builds the production bundle, puts it inside the app, and launches it with no dev server and no live reload. This is what a user gets, and the place to check launch, the [splash](/docs/icons-and-splash), offline start and [over-the-air updates](/docs/ota-updates). It takes `--target`, `--latest`, `--force` and `--verbose`.",
    },
    {
      type: "note",
      text: "When a build looks stale after you changed something outside your app source (a linked package, a file the fingerprint does not track), run the command again with `--force`.",
    },
    { type: "h2", text: "Package it" },
    {
      type: "code",
      label: "Terminal",
      lang: "bash",
      code: `adaptv build ios               # .adaptv/builds/<app>.ipa
adaptv build android           # .adaptv/builds/<app>.apk
adaptv build all -o ./dist     # web, iOS and Android into ./dist
adaptv build ios --json        # machine-readable result for CI`,
    },
    {
      type: "table",
      head: ["Target", "Artifact", "Signed"],
      rows: [
        [
          "`ios`",
          "An `.ipa` built in Release for devices.",
          "No. It is unsigned, for a re-signing pipeline (fastlane, `codesign`).",
        ],
        [
          "`android`",
          "A debug `.apk`.",
          "With the debug key. It installs on a device or emulator and is not accepted by Google Play.",
        ],
      ],
    },
    {
      type: "p",
      text: "`-o, --output <path>` takes a directory or a file path and defaults to `.adaptv/builds/`. `--force`, `--json`, `--quiet` and `--verbose` are also accepted. `build` refuses to run while a `dev` session is live for the same project, because `dev` has the native project temporarily patched.",
    },
    { type: "h3", text: "Signing and the stores" },
    {
      type: "p",
      text: "Signing is the one step adaptv does not do for you. For TestFlight or the App Store, run `adaptv build ios` once so the project is current, open `.adaptv/ios/App/App.xcworkspace` in Xcode, select your team, and use Product ▸ Archive.",
    },
    {
      type: "note",
      tone: "warn",
      text: "A release-signed Android build (a keystore, an `.aab` for Google Play) is not built yet. `adaptv build android` produces the debug `.apk` only.",
    },
    { type: "h2", text: "Where the native projects live" },
    {
      type: "p",
      text: "They are in `.adaptv/ios` and `.adaptv/android`, inside the hidden, git-ignored `.adaptv/` directory. They are not at the app root, and a folder named `ios/` or `android/` at your root is left alone. Each project is created the first time you target that platform and then kept. On every run adaptv stamps it again from `adaptv.config.ts`: identity, icons, launch colours, SDK levels, plugin wiring, the privacy manifest. The native runtime config is generated per run and is never a file you edit.",
    },
    {
      type: "p",
      text: "Treat `.adaptv/` as build output. A fresh clone or a CI machine has none of it and produces the same app, so anything you change by hand in there exists on your machine only.",
    },
    { type: "h2", text: "What the build targets" },
    {
      type: "table",
      head: ["", "Value", "Notes"],
      rows: [
        [
          "Android compile and target SDK",
          "36 (Android 16)",
          "Stamped on every Android run. adaptv only ever raises it.",
        ],
        ["Android minimum", "SDK 24 (Android 7)", "Set by the native runtime."],
        [
          "Android System WebView",
          "111 or newer",
          "The styling engine's floor. On an older WebView the app shows an explanatory page in place of a blank screen.",
        ],
        ["iOS minimum", "iOS 15", ""],
        [
          "System bars",
          "Edge to edge on both platforms",
          "The app draws under the status bar and the navigation bar. Pad with the [safe-area utilities](/docs/safe-areas).",
        ],
      ],
    },
    { type: "h2", text: "Adding a native plugin" },
    {
      type: "p",
      text: "adaptv ships the plugins its own [capabilities](/docs/capabilities) use. For anything else, any Capacitor-compatible plugin works: install the package, list it, and call its JavaScript API.",
    },
    {
      type: "code",
      label: "Terminal",
      lang: "bash",
      code: `pnpm add @capacitor/camera`,
    },
    {
      type: "code",
      label: "adaptv.config.ts",
      lang: "ts",
      code: `export default defineConfig({
  // ...
  appId: "com.chopchop.app",
  plugins: ["@capacitor/camera"],
  pluginConfig: {
    Camera: { /* the plugin's own native settings */ },
  },
})`,
    },
    {
      type: "p",
      text: "adaptv wires the iOS pod and the Android gradle module into the project it owns. A plugin that is listed and not installed stops the build before any native tool runs, with the package name. In a `dev` session, press `b` after adding one.",
    },
    {
      type: "note",
      tone: "warn",
      text: "There is no config key for permission text yet. A plugin that needs an iOS usage description (`NSCameraUsageDescription`) or an Android `<uses-permission>` does not get one from adaptv, and this includes location from adaptv's own set. It is an open design question.",
    },
    {
      type: "p",
      text: "A new plugin changes the native shell, so it reaches users through a store release and cannot go out over the air. Bundles built against the new shell are held back from older installs. See [Over-the-air updates](/docs/ota-updates).",
    },
    { type: "h2", text: "The privacy manifest" },
    {
      type: "p",
      text: "Apple requires `PrivacyInfo.xcprivacy` in every app. adaptv generates it on every iOS build and derives the required-reason APIs from the plugins compiled in, which for most apps is the whole obligation. What only you can know goes in `privacy`:",
    },
    {
      type: "code",
      label: "adaptv.config.ts",
      lang: "ts",
      code: `privacy: {
  tracking: false,
  collectedData: [
    {
      type: "NSPrivacyCollectedDataTypeEmailAddress",
      linked: true,
      tracking: false,
      purposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"],
    },
  ],
},`,
    },
    { type: "h2", text: "No server inside the app" },
    {
      type: "p",
      text: "The native build is always a static single-page app: no server, no server rendering, and no service worker, whatever `render` says for the web. Code that only runs on a server has nowhere to run.",
    },
    {
      type: "ul",
      items: [
        "The build fails when app source imports the underlying framework's server-function API, or puts a `server: { ... }` key on a route. The error names the file.",
        "Move that logic behind your own API and call it over the network, or use a route `loader`, which runs on every target.",
        "Secrets never belong in the bundle. Anything in the app can be read by whoever installs it.",
        "Offline start works without a worker because the whole bundle is on the device. Your data still needs its own strategy: see [Offline and the service worker](/docs/offline).",
      ],
    },
    { type: "h2", text: "Where it works" },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "no",
          note: "Use `adaptv build web`. See [Deploying](/docs/deploying).",
        },
        { target: "Mobile web", status: "no" },
        { target: "Installed PWA", status: "no" },
        {
          target: "iOS",
          status: "partial",
          note: "`dev`, `preview` and an unsigned `.ipa`. Store signing is done in Xcode. Needs a Mac.",
        },
        {
          target: "Android",
          status: "partial",
          note: "`dev`, `preview` and a debug `.apk`. A release-signed `.aab` is not built yet.",
        },
      ],
    },
    {
      type: "p",
      text: "Every command and flag is listed on the [CLI](/docs/cli) page, and every key on the [Config](/docs/config) page.",
    },
  ],
}
