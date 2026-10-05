import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "cli",
  title: "adaptv CLI",
  summary:
    "Commands, flags, exit codes, environment variables and common errors.",
  platforms: ["Web", "PWA", "iOS", "Android"],
  source: "bin/adaptv.mjs",
  blocks: [
    {
      type: "p",
      text: "Run `adaptv` from the app root, the folder with `adaptv.config.ts`. On a new machine, run `adaptv doctor` first.",
    },
    {
      type: "code",
      label: "Terminal",
      lang: "bash",
      code: `adaptv <command> [surface] [options]
adaptv <command> --help
adaptv --version`,
    },
    { type: "h2", text: "Surfaces" },
    {
      type: "p",
      text: "`dev`, `preview` and `build` take one surface: `web`, `ios` (needs macOS and Xcode), `android` or `all` (iOS and Android, plus web for `preview`).",
    },
    {
      type: "p",
      text: "`dev`, `preview`, `build` and `icons` check `adaptv.config.ts` first. They print every problem with its key and exit with code 1. See [Config](/docs/config).",
    },
    {
      type: "note",
      tone: "warn",
      text: "These commands stop with `missing 'appId' in adaptv.config.ts` when `appId` is not set, also for `web`. Set an `appId`, even for a web-only app.",
    },
    { type: "h2", text: "adaptv doctor" },
    {
      type: "code",
      label: "Terminal",
      lang: "bash",
      code: "adaptv doctor [--json] [--quiet] [--verbose]",
    },
    {
      type: "p",
      text: "Prints a report and changes nothing. It checks `node`, the Android SDK, a JDK, `adb`, `xcodebuild`, CocoaPods, the native projects and the icon source.",
    },
    {
      type: "p",
      text: "The Android SDK and JDK rows are required. If one is missing, `doctor` exits with code 1, also for a web-only or iOS-only app. Ignore rows for platforms you do not use. The default SDK and JDK paths are macOS paths. On Linux and Windows, set `ANDROID_HOME` and `JAVA_HOME`.",
    },
    { type: "h2", text: "adaptv dev" },
    {
      type: "code",
      label: "Terminal",
      lang: "bash",
      code: `adaptv dev <web|ios|android|all> [--target <id>] [--latest] [--force]
  [--host] [--verbose] [-- <vite args>]`,
    },
    {
      type: "p",
      text: "Starts one dev server. Every surface loads from it, so an edit updates all of them. It runs until you stop it, then reverts its changes. The first native run creates the native projects, which takes minutes.",
    },
    {
      type: "p",
      text: "A second `dev` in the same app is refused. Native `dev` runs have no service worker.",
    },
    {
      type: "table",
      head: ["Key", "Action"],
      rows: [
        ["`r`", "Reload the app."],
        ["`b`", "Reread the config, rebuild and reinstall."],
        ["`q` or Ctrl-C", "Stop and revert."],
      ],
    },
    {
      type: "p",
      text: "In `dev web`, `r` and `b` do nothing. `q` and Ctrl-C still stop it.",
    },
    { type: "h3", text: "LAN mode" },
    {
      type: "p",
      text: "With a physical device or `--host`, the app loads your machine's LAN address, which adaptv prints. Otherwise it loads `localhost`. An Android emulator cannot reach a LAN address, so that combination is refused.",
    },
    { type: "h2", text: "adaptv preview" },
    {
      type: "code",
      label: "Terminal",
      lang: "bash",
      code: `adaptv preview <web|ios|android|all> [--target <id>] [--latest] [--force]
  [--verbose] [-- <vite args>]`,
    },
    {
      type: "ul",
      items: [
        "`preview web` builds and serves the site until Ctrl-C. It ignores `--target`, `--latest` and `--force`.",
        "`preview ios` and `preview android` build the app and install it on a device.",
        "`preview all` runs the web build, then iOS and Android. If no native platform starts, it exits with code 1.",
      ],
    },
    {
      type: "p",
      text: "Native runs skip work whose inputs did not change. `--force` runs it anyway, also after you change a linked copy of adaptv.",
    },
    { type: "h2", text: "adaptv build" },
    {
      type: "code",
      label: "Terminal",
      lang: "bash",
      code: `adaptv build <web|ios|android|all> [-o, --output <path>] [--force] [--json]
  [--quiet] [--verbose]`,
    },
    {
      type: "ul",
      items: [
        '`web`: the deployable site, in `.output/` for `render: "ssr"` or `dist/client` for `render: "spa"`.',
        "`ios`: an unsigned `.ipa` for devices, at `.adaptv/builds/<appName>.ipa`.",
        "`android`: a debug `.apk`, at `.adaptv/builds/<appName>.apk`.",
        "`all`: both native files.",
      ],
    },
    {
      type: "p",
      text: "`--output` is a directory when it ends in `/` or already exists as one, and a file path otherwise. With `all`, use a directory, or the `.apk` overwrites the `.ipa`. `build web` ignores `--output`.",
    },
    {
      type: "p",
      text: "adaptv does not sign. For the App Store, open `.adaptv/ios/App/App.xcworkspace` in Xcode and choose Product, Archive. See [Native builds](/docs/native-builds).",
    },
    { type: "h3", text: "Update channel" },
    {
      type: "p",
      text: "When the config sets `origin`, `build web` also writes the update channel into the site, under `.well-known/adaptv/ota/`. Only this command does. A plain `vite build` does not. See [OTA updates](/docs/ota-updates).",
    },
    {
      type: "p",
      text: "`build web` stops before it builds if `otaPublicKey` is missing or invalid, no private key is set, or the keys do not match.",
    },
    { type: "h2", text: "adaptv keys" },
    {
      type: "code",
      label: "Terminal",
      lang: "bash",
      code: "adaptv keys ota [--quiet]",
    },
    {
      type: "p",
      text: "Makes the RSA key pair that signs updates. Run it once per app. It prints the keys and writes no file.",
    },
    {
      type: "ul",
      items: [
        "**Public key:** set it as `otaPublicKey` and commit it. A change needs a store release.",
        "**Private key:** keep it as the secret `ADAPTV_OTA_PRIVATE_KEY`.",
      ],
    },
    {
      type: "note",
      tone: "warn",
      text: "adaptv keeps no copy of the private key. If you lose it, installed apps cannot update until a store release ships a new public key.",
    },
    { type: "h2", text: "adaptv icons" },
    {
      type: "code",
      label: "Terminal",
      lang: "bash",
      code: `adaptv icons --input <image> [-o, --output <dir>] [--yes] [--dark <image>]
  [--tinted <image>] [--monochrome <image>] [--margin <pct>] [--padding <pct>]
  [--background <hex>] [--verbose]`,
    },
    {
      type: "p",
      text: "Makes the icon set from one image. It writes to the `icons` folder of the config, or to `--output`. It replaces existing files, so it asks first unless you pass `--yes`. It also writes `.adaptv/icons-preview.html`. The app reads only the `icons` config key. See [Icons and splash](/docs/icons-and-splash).",
    },
    {
      type: "table",
      head: ["Flag", "Default", "Effect"],
      rows: [
        [
          "`--input <image>`",
          "required",
          "A png or svg, 1024px or larger. A smaller image gives a warning.",
        ],
        [
          "`-o, --output <dir>`",
          "config `icons`",
          "Folder to write the set to.",
        ],
        [
          "`--yes`",
          "off",
          "Replace files without asking. Required without a terminal.",
        ],
        [
          "`--dark <image>`",
          "none",
          "Hand-inverted image for the iOS 18 dark icon.",
        ],
        [
          "`--tinted <image>`",
          "none",
          "Greyscale image for the iOS tinted home screen.",
        ],
        [
          "`--monochrome <image>`",
          "none",
          "Single-colour image for Android themed icons.",
        ],
        [
          "`--margin <pct>`",
          "`10`",
          "Space around your art, 0 to 50. `0` fills the icon.",
        ],
        [
          "`--padding <pct>`",
          "`0`",
          "Extra space added to `--margin`, 0 to 40.",
        ],
        [
          "`--background <hex>`",
          "from the image",
          "Background for icons that cannot be transparent.",
        ],
      ],
    },
    { type: "h2", text: "Flags" },
    {
      type: "table",
      head: ["Flag", "Commands", "Effect"],
      rows: [
        [
          "`--target <id>`",
          "dev, preview",
          "Use this device or simulator. Not allowed with `all`.",
        ],
        [
          "`--latest`",
          "dev, preview",
          "Use the last device you picked for this platform.",
        ],
        [
          "`--force`",
          "dev, preview, build",
          "Rebuild, sync and reinstall even if nothing changed.",
        ],
        [
          "`--host`",
          "dev",
          "Serve on the LAN address. Automatic for a physical device.",
        ],
        [
          "`--verbose`",
          "all except keys",
          "Show the raw output of the build tools.",
        ],
        [
          "`--quiet`",
          "doctor, build, keys",
          "Print results and failures only.",
        ],
        [
          "`--json`",
          "doctor, build",
          "Print one JSON document: `{ ok, command, version, notices, steps, result, error? }`.",
        ],
        [
          "`-- <vite args>`",
          "dev, preview",
          "Pass the rest to the web server.",
        ],
      ],
    },
    { type: "h2", text: "Device selection" },
    {
      type: "ol",
      items: [
        "`--target <id>`. An unknown id is an error.",
        "`--latest`, if that device is still available.",
        "A picker. adaptv saves your choice in `.adaptv/state.json`.",
      ],
    },
    {
      type: "p",
      text: "Without a terminal, adaptv takes the first simulator or emulator, or else a physical device. It does not save this choice.",
    },
    { type: "h2", text: "Terminals and exit codes" },
    {
      type: "p",
      text: 'Keys, the picker and prompts need a terminal. Without one, output is plain and prompts choose for themselves. In Turborepo, set `"interactive": true` on the task. Errors go to stderr, so `--json > out.json` never holds one.',
    },
    {
      type: "table",
      head: ["Exit code", "Meaning"],
      rows: [
        ["`0`", "Success, or a `dev` session you stopped."],
        ["`1`", "The run failed, or a `doctor` row failed."],
        [
          "`2`",
          "Wrong usage: an unknown command, flag or surface, or a bad flag value. Nothing ran.",
        ],
        ["`130`", "You cancelled a picker."],
      ],
    },
    { type: "h2", text: "Common errors" },
    {
      type: "table",
      head: ["Message", "Fix"],
      rows: [
        [
          "`no adaptv.config.ts here. Run from an app root.`",
          "Run the command in the folder with `adaptv.config.ts`.",
        ],
        [
          "`missing 'appId' in adaptv.config.ts`",
          "Add `appId`, such as `com.acme.notes`.",
        ],
        [
          "`'plugins' names '<name>', which is not installed.`",
          "Install the package or remove the entry. Native runs only.",
        ],
        [
          "`nowhere to write. Set 'icons' ... or pass --output <dir>`",
          "Set `icons` in the config or pass `--output`.",
        ],
        [
          "`'--target' is per-platform and 'dev all' spans both`",
          "Use `--latest`, or run each platform alone.",
        ],
        [
          '`unknown <platform> device "<id>"`',
          "Run without `--target` and pick.",
        ],
        [
          "`the Android emulator can't reach an external dev server`",
          "Drop `--host`, or use a physical Android device.",
        ],
        [
          "`no LAN address on this machine`",
          "Connect to Wi-Fi or Ethernet. A VPN alone is not enough.",
        ],
        [
          "`the key being signed with is not the one this app verifies against`",
          "`ADAPTV_OTA_PRIVATE_KEY` is not the pair of `otaPublicKey`.",
        ],
      ],
    },
    {
      type: "p",
      text: "The dev server never moves to another port. To change the port from `vite.config.ts`, pass `-- --port <n>`.",
    },
    { type: "h2", text: "Environment variables" },
    {
      type: "table",
      head: ["Variable", "Effect"],
      rows: [
        [
          "`ANDROID_HOME`, `ANDROID_SDK_ROOT`",
          "Android SDK folder. Default `~/Library/Android/sdk`.",
        ],
        [
          "`JAVA_HOME`",
          "JDK folder. If unset, adaptv tries Android Studio's Java, then `/usr/libexec/java_home`.",
        ],
        [
          "`ADAPTV_OTA_PRIVATE_KEY`, `ADAPTV_OTA_PRIVATE_KEY_FILE`",
          "The private key, or a file that holds it. Used by `build web`.",
        ],
        [
          "`ADAPTV_BUILD_TAG`",
          "Sets the build tag of the service worker and update channel.",
        ],
        [
          "`NITRO_PRESET`",
          "Server deploy target. See [Deploying](/docs/deploying).",
        ],
        [
          "`ADAPTV_DEV_SW`",
          "`1` serves your `serviceWorkers` modules in `dev web`.",
        ],
        ["`CI`, `NO_COLOR`", "Plain output, no colour."],
      ],
    },
    { type: "h2", text: "Files the CLI writes" },
    {
      type: "p",
      text: "`.adaptv/` is git-ignored and safe to delete. It holds the native projects, `builds/`, update archives, `state.json` (fingerprints and chosen devices) and `dev.lock`.",
    },
  ],
}
