import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "native-builds",
  title: "Native builds",
  summary:
    "Run the app on a simulator, an emulator or a phone, and build an .ipa and an .apk.",
  blocks: [
    {
      type: "p",
      text: "The native apps are your web bundle inside a native shell that adaptv owns. You create no Xcode or Android Studio project. You set `appId`, install the toolchains, and use `dev`, `preview` and `build`.",
    },
    { type: "h2", text: "Install the tools" },
    {
      type: "ul",
      items: [
        "Node 22.12 or newer.",
        "iOS: a Mac with Xcode and CocoaPods. iOS builds do not run on Linux or Windows.",
        "Android: the Android SDK and a JDK. This works on Linux when `ANDROID_HOME` and `JAVA_HOME` are set.",
      ],
    },
    {
      type: "p",
      text: "adaptv reads `ANDROID_HOME`, then `ANDROID_SDK_ROOT`. If neither is set, it uses `~/Library/Android/sdk`, which is the macOS default. On Linux, set `ANDROID_HOME`. It uses `JAVA_HOME` when `$JAVA_HOME/bin/java` exists, and otherwise looks for Android Studio's JDK.",
    },
    {
      type: "code",
      label: "Terminal",
      lang: "bash",
      code: `adaptv doctor`,
    },
    {
      type: "p",
      text: "`doctor` prints one row per requirement and a fix for each failure. It checks Node, the Android SDK, JDK and `adb`, and on macOS `xcodebuild` and CocoaPods. Red native rows do not matter for a web-only app. It also flags a `WKAppBoundDomains` key in the iOS `Info.plist` (remove it), an Android target SDK below 36 (run any Android command), and a missing `PrivacyInfo.xcprivacy`.",
    },
    { type: "h2", text: "Turn native on" },
    {
      type: "p",
      text: "Setting `appId` enables native builds. Every adaptv command needs it, including web commands.",
    },
    {
      type: "code",
      label: "adaptv.config.ts",
      lang: "ts",
      code: `import { defineApp } from "@arrzdev/adaptv/config"

export default defineApp({
  name: "Chop Chop",
  themeColor: { light: "#ffffff", dark: "#0a0a0a" },
  appId: "com.chopchop.app",
  // Plus the other required keys. See the Config page.
})`,
    },
    {
      type: "p",
      text: "`appName` sets the label under the icon. `plugins` lists extra native plugins. `pluginConfig` holds their native settings, keyed by class name. `privacy` holds the iOS privacy declarations adaptv cannot derive. See [Config](/docs/config).",
    },
    { type: "h2", text: "Run while you work" },
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
      text: "`dev` installs the app on the device you pick and points it at the dev server. Press `r` to reload the JavaScript. Press `b` to rebuild the native app after a new plugin, icon or `appName`. Ctrl-C stops it and reverts adaptv's changes.",
    },
    {
      type: "ul",
      items: [
        "`--target <id>`: launch on one device. adaptv remembers it. Not valid with `all`.",
        "`--latest`: reuse the last device.",
        "`--force`: redo the work. Use it when a build looks stale.",
      ],
    },
    {
      type: "p",
      text: "With no flag, `dev` shows a list of simulators, emulators and devices. The pick is stored in `.adaptv/state.json`. adaptv does not create emulators. Make one in Android Studio first.",
    },
    {
      type: "p",
      text: "`dev` and `preview` install as `<appId>.dev`, named `<name> (dev)`. They sit next to the store install. `build` uses the real `appId`.",
    },
    { type: "h3", text: "Use a physical phone" },
    {
      type: "ul",
      items: [
        "iPhone: open `.adaptv/ios/App/App.xcworkspace` once. Under Signing and Capabilities, pick your team. A free Apple ID works. Turn on Developer Mode in Settings, Privacy and Security. After the install, trust the developer under Settings, General, VPN and Device Management. ",
        "Android phone: turn on USB debugging.",
        "adaptv adds a cleartext exception on iOS and a port reverse on Android for the session. If your `Info.plist` already has an `NSAppTransportSecurity` entry, adaptv skips its exception and live reload may fail.",
      ],
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
      text: "`preview` launches the production bundle with no dev server. Use it to check the [splash](/docs/icons-and-splash), offline start and [updates](/docs/ota-updates).",
    },
    { type: "h2", text: "Package it" },
    {
      type: "code",
      label: "Terminal",
      lang: "bash",
      code: `adaptv build ios                # .adaptv/builds/<app>.ipa
adaptv build android            # .adaptv/builds/<app>.apk
adaptv build all -o ./dist/     # iOS and Android into ./dist/`,
    },
    {
      type: "ul",
      items: [
        "The `.ipa` is a Release build, unsigned. Sign it in your own pipeline.",
        "The `.apk` is debug-signed. Google Play does not accept it, and no release `.aab` is built yet.",
        "`build all` builds iOS and Android only, not the web app.",
        "End a directory in `-o` with `/`. Without it, adaptv treats a new path as a file, and the `.apk` overwrites the `.ipa`.",
      ],
    },
    {
      type: "p",
      text: "For TestFlight or the App Store, run `adaptv build ios` so the project is current. Open `.adaptv/ios/App/App.xcworkspace`, pick your team, then Product, Archive.",
    },
    { type: "h2", text: "Where the projects live" },
    {
      type: "p",
      text: "The projects are in `.adaptv/ios` and `.adaptv/android`. adaptv re-stamps them from `adaptv.config.ts` on every run. Do not edit or commit `.adaptv/`.",
    },
    {
      type: "p",
      text: "The app needs iOS 15, Android 7 (SDK 24) and System WebView 111 or newer.",
    },
    { type: "h2", text: "Add a native plugin" },
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
      code: `export default defineApp({
  // ...
  plugins: ["@capacitor/camera"],
  pluginConfig: {
    Camera: {
      /* the plugin's native settings */
    },
  },
})`,
    },
    {
      type: "p",
      text: "Install the package, list it, and call its JavaScript API. adaptv wires it into both projects. A listed plugin that is not installed stops a native build. In `dev`, press `b` after adding a plugin.",
    },
    {
      type: "note",
      tone: "warn",
      text: "adaptv has no key for permission text. A plugin that needs `NSCameraUsageDescription` or an Android permission gets none. Hand edits in `.adaptv/` are overwritten.",
    },
    {
      type: "p",
      text: "A new plugin ships only through a store release. See [Over-the-air updates](/docs/ota-updates).",
    },
    { type: "h2", text: "No server in the app" },
    {
      type: "p",
      text: "A native build has no server and no service worker, whatever `render` says. A server-function import fails the build. Call your own API or use a route `loader`.",
    },
    { type: "h2", text: "What goes wrong" },
    {
      type: "table",
      head: ["Message", "Fix"],
      rows: [
        [
          "Xcode is missing the iOS platform, or has no destination.",
          "Run `xcodebuild -downloadPlatform iOS`.",
        ],
        ["iOS code signing is not set up.", "Pick a team in Xcode."],
        [
          "The simulator or device bridge stopped responding.",
          "Run `adb kill-server` on Android. On iOS, reboot, or run `sudo launchctl kickstart -k system/com.apple.CoreSimulator.simdiskimaged`.",
        ],
        ["No JDK found.", "Install Android Studio, or set `JAVA_HOME`."],
      ],
    },
  ],
}
