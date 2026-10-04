import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "cli",
  title: "adaptv CLI",
  summary:
    "Six commands: doctor, dev, preview, build, keys and icons. Every surface, flag, output path and environment variable.",
  platforms: ["Web", "PWA", "iOS", "Android"],
  source: "bin/adaptv.mjs",
  blocks: [
    {
      type: "p",
      text: "The `adaptv` binary ships with the `@arrzdev/adaptv` package. It runs the app on every surface, packages it, and owns the whole native toolchain: it generates the iOS and Android projects, finds the JDK, the Android SDK and CocoaPods, renders the launcher icons and picks a device. You never run a native CLI or open a native config.",
    },
    {
      type: "code",
      label: "Terminal",
      lang: "bash",
      code: `adaptv <command> [surface] [options]

adaptv --help            # the command list
adaptv <command> --help  # every flag that command takes
adaptv --version`,
    },
    {
      type: "p",
      text: "Run it from the app root, the directory holding `adaptv.config.ts`. Most apps call it through `package.json` scripts, see [Project structure](/docs/project-structure).",
    },
    {
      type: "table",
      head: ["Command", "What it does"],
      rows: [
        [
          "`adaptv doctor`",
          "Checks your machine has what a native build needs.",
        ],
        [
          "`adaptv dev <surface>`",
          "Runs the app with live reload on the surface you name.",
        ],
        [
          "`adaptv preview <surface>`",
          "Runs the real build the way a user gets it. No live reload.",
        ],
        [
          "`adaptv build <surface>`",
          "Packages the app: a deployable site, an unsigned `.ipa`, a debug `.apk`.",
        ],
        [
          "`adaptv keys ota`",
          "Generates the key pair that signs your update channel.",
        ],
        [
          "`adaptv icons --input <image>`",
          "Generates every icon the app needs from one image.",
        ],
      ],
    },
    {
      type: "note",
      text: "There is no `adaptv run`, `adaptv sync` or `adaptv init`. `run` became `dev` and `preview`, syncing is an internal step of both, and the project scaffolder (`create-adaptv`) is designed but not built yet.",
    },
    { type: "h2", text: "Surfaces" },
    {
      type: "p",
      text: "`dev`, `preview` and `build` take one required surface.",
    },
    {
      type: "table",
      head: ["Surface", "Means"],
      rows: [
        ["`web`", "The browser alone, no device."],
        ["`ios`", "A simulator, or a connected iPhone. macOS with Xcode only."],
        ["`android`", "An emulator, or a connected device."],
        [
          "`all`",
          "For `dev` and `build`: iOS and Android together. For `preview`: the web build served locally, plus iOS and Android.",
        ],
      ],
    },
    { type: "h2", text: "Before every command" },
    {
      type: "p",
      text: "`dev`, `preview`, `build` and `icons` read `adaptv.config.ts` first and check it before doing any work. Every problem is printed at once, each naming its key, and the command exits with code 1. Icon problems you can act on (no icon set, a source too small for a platform) are printed as notices above the run. The rules are listed on the [config page](/docs/config).",
    },
    {
      type: "note",
      tone: "warn",
      text: "Today these commands also stop with `missing 'appId' in adaptv.config.ts` when the config has no `appId`, even for the `web` surface. The config type documents `appId` as optional for web-only apps. Set one until the two agree. `doctor` and `keys` run without it.",
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
      text: "Prints a report and changes nothing. It checks, in order:",
    },
    {
      type: "ul",
      items: [
        "**Core**: `node`, and that adaptv's own install carries the native modules it ships.",
        "**Android**: the Android SDK (`ANDROID_HOME`, then `ANDROID_SDK_ROOT`, then `~/Library/Android/sdk`), a JDK (`JAVA_HOME`, then the one bundled with Android Studio), and `adb`.",
        "**iOS**: `xcodebuild` and CocoaPods (`pod`). Both optional, since they only exist on macOS.",
        "**Project**: whether `.adaptv/android` and `.adaptv/ios` exist yet, and where the icon set comes from (your `icons` directory, or adaptv's default mark).",
        "**Project checks**: silent failures in the generated native projects, such as a missing iOS privacy manifest or stale Android SDK levels.",
      ],
    },
    { type: "h2", text: "adaptv dev" },
    {
      type: "code",
      label: "Terminal",
      lang: "bash",
      code: `adaptv dev <web|ios|android|all> [--target <id>] [--latest] [--force]
  [--host] [--verbose] [-- <vite args>]

adaptv dev web
adaptv dev ios
adaptv dev all --latest
adaptv dev ios -- --port 4000`,
    },
    {
      type: "p",
      text: "Starts one Vite dev server and points every named surface at it, so an edit hot-reloads the browser and the native WebViews together. It runs until Ctrl-C, then reverts everything it changed.",
    },
    {
      type: "ol",
      items: [
        "Takes the single-instance lock, `.adaptv/dev.lock`. A second `dev` in the same app is refused, and so are `preview` and `build` while one is running. A lock left by a killed run is reclaimed on its own.",
        "Checks the config.",
        "For a native surface, builds the native web bundle into `.adaptv/web` if the config changed since the last one. App code edits never trigger this: live reload owns those.",
        "Starts the dev server with `--strictPort`, so a taken port is an error and never a silent move to the next one. The local and network addresses are printed under the `web` row. For a native surface it then waits for the server to finish optimizing dependencies, because an iOS WebView that attaches mid-optimize loses hot reload for good.",
        "Prepares `.adaptv/ios` and `.adaptv/android`. The first run scaffolds them and installs CocoaPods, which takes minutes. Later runs reuse them.",
        "Resolves the device, see Device selection below.",
        "Points the native apps at the dev server, then builds, installs and launches. When nothing native changed and the app is still installed, it skips the build and launches the installed app, which takes about a second.",
        "Watches. Hot updates flash on the status line.",
      ],
    },
    { type: "h3", text: "Keys while it runs" },
    {
      type: "table",
      head: ["Key", "Action"],
      rows: [
        [
          "`r`",
          "Reload: relaunch the installed app so its WebView loads a fresh document from the dev server. No reinstall.",
        ],
        [
          "`b`",
          "Rebuild: re-read `adaptv.config.ts`, rebuild the native bundle, and rebuild and reinstall the native app. Use it after a plugin or config change. A config adaptv cannot use ends the session.",
        ],
        ["`q` or Ctrl-C", "Stop, and revert everything the run changed."],
      ],
    },
    {
      type: "p",
      text: "`dev web` has no keys: it is the dev server and one status line.",
    },
    { type: "h3", text: "What a native dev run changes, and reverts" },
    {
      type: "ul",
      items: [
        "The generated native config gains a `server.url` pointing at the dev server. It lives in the process environment, never in a file, so a killed run cannot leave it behind.",
        "iOS: an App Transport Security exception for the dev server, and in LAN mode a Local Network permission declaration.",
        "Android emulator: an `adb reverse` mapping so the emulator's `localhost` reaches your machine.",
        "An offline page, shown in the WebView when the dev server is unreachable.",
      ],
    },
    {
      type: "p",
      text: "Teardown runs on Ctrl-C, SIGTERM, a closed terminal and any thrown error. The native dev server runs the app as a client-rendered SPA with no service worker, whatever `render` says, because a worker inside the WebView would cache the app and block hot reload. `dev web` keeps your normal web config.",
    },
    { type: "h3", text: "LAN mode and --host" },
    {
      type: "p",
      text: "Any native `dev` run binds the dev server to the LAN, because a physical device has to reach it. Which URL the app loads is decided per run: the machine's LAN address when the picked device is physical or `--host` is passed, `localhost` otherwise. `--host` takes no value: adaptv reads the address from the network interfaces, skipping loopback, VPN tunnels and container bridges, and prints the URL the device will load. An Android emulator cannot reach a LAN address, so a run that pairs one with `--host`, or with a physical iPhone under `dev all`, is refused: use a physical Android device, or run the two platforms separately.",
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
        "`preview web` runs `vite build`, then serves the result with `vite preview` and holds the terminal until Ctrl-C. This is the build to test the service worker, offline and the installed PWA against. Arguments after `--` go to `vite preview`.",
        "`preview ios` and `preview android` build the native web bundle, sync it into the native project, build the app, then install and launch it on the device you pick. Nothing is served and nothing reloads: it is the app a user would get.",
        "`preview all` builds and serves the web surface first, then runs iOS and Android, then holds the terminal for the web server. If no native platform could launch, it stops the server and exits 1.",
      ],
    },
    {
      type: "p",
      text: "`preview` and `build` skip work whose inputs did not change: the web bundle, the sync, and the install each have a fingerprint in `.adaptv/state.json`. `--force` ignores all of them.",
    },
    {
      type: "note",
      text: "The build fingerprint covers your app's source. It does not cover a linked copy of adaptv itself, so if you are developing the framework alongside an app, pass `--force` after changing framework code.",
    },
    { type: "h2", text: "adaptv build" },
    {
      type: "code",
      label: "Terminal",
      lang: "bash",
      code: `adaptv build <web|ios|android|all> [-o, --output <path>] [--force] [--json]
  [--quiet] [--verbose]

adaptv build web
adaptv build ios
adaptv build all -o ./artifacts/
adaptv build ios --json`,
    },
    {
      type: "table",
      head: ["Surface", "Produces", "Where"],
      rows: [
        [
          "`web`",
          "The deployable site, with the update channel inside it when `origin` is set.",
          '`.output/` for `render: "ssr"` (server in `.output/server`, static files in `.output/public`). `dist/client` for `render: "spa"`. The settled `web` row prints the directory.',
        ],
        [
          "`ios`",
          "An unsigned `.ipa`: a Release build of the device slice with signing switched off.",
          "`.adaptv/builds/<appName>.ipa`, or `--output`.",
        ],
        [
          "`android`",
          "A debug `.apk` (`gradlew assembleDebug`).",
          "`.adaptv/builds/<appName>.apk`, or `--output`.",
        ],
        ["`all`", "Both native artifacts.", "As above."],
      ],
    },
    {
      type: "p",
      text: "`--output` is a file path, or a directory when it ends in `/` or already exists as one; a directory keeps the default file name. It applies to the native artifacts only. `<appName>` is `appName`, falling back to `name`, with anything outside letters, digits, `.`, `_` and `-` replaced by `-`.",
    },
    {
      type: "p",
      text: "Signing is the one thing adaptv does not do. For TestFlight or the App Store, open `.adaptv/ios/App/App.xcworkspace` and use Xcode, Product, Archive. The unsigned `.ipa` installs on a simulator or feeds a re-signing pipeline. There is no release-signed Android build yet. See [Native builds](/docs/native-builds).",
    },
    { type: "h3", text: "build web and the update channel" },
    {
      type: "p",
      text: "When `adaptv.config.ts` names an `origin`, `build web` also publishes the over-the-air channel, and it is the only command that can. It builds the native bundle and archives it to `.adaptv/ota/bundle-<tag>.zip`, builds the site, then writes the archive and a signed manifest into the site's own output under `.well-known/adaptv/ota/`. Deploy the output directory and the update is live. See [OTA updates](/docs/ota-updates).",
    },
    {
      type: "p",
      text: "Signing is checked before anything is built. The command refuses, with the fix, when `otaPublicKey` is missing or unreadable, when no private key is in the environment, or when the private key is not the pair of `otaPublicKey`. An unchanged app keeps the tag it was first published with, so a re-deploy does not read as a release to every device.",
    },
    {
      type: "note",
      text: "A plain `vite build` also produces the site, and is what `build web` runs for that half. It does not publish the update channel. If your app sets `origin`, deploy with `adaptv build web`.",
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
      text: "Generates the RSA pair that signs and verifies your updates. `ota` is the only kind. Run it once per app. It prints both halves and writes nothing to disk:",
    },
    {
      type: "ul",
      items: [
        "**Public**: paste it into `adaptv.config.ts` as `otaPublicKey` and commit it. It is baked into the store binary, so changing it takes a store release.",
        "**Private**: put it in your deploy's secret store as `ADAPTV_OTA_PRIVATE_KEY`, and nowhere else.",
      ],
    },
    {
      type: "note",
      tone: "warn",
      text: "The private key is shown once and adaptv keeps no copy. Lose it and no installed app can be updated again until a store release carries a new public key out. Back it up the way you back up a signing certificate.",
    },
    { type: "h2", text: "adaptv icons" },
    {
      type: "code",
      label: "Terminal",
      lang: "bash",
      code: `adaptv icons --input <image> [-o, --output <dir>] [--yes] [--dark <image>]
  [--tinted <image>] [--monochrome <image>] [--margin <pct>] [--padding <pct>]
  [--background <hex>] [--verbose]

adaptv icons --input ./mark.png
adaptv icons --input ./mark.svg --dark ./mark-dark.png --yes`,
    },
    {
      type: "p",
      text: "Generates the whole icon set, every platform variant, from one png or svg. The set is written to the `icons` directory named in `adaptv.config.ts`, or to `--output`. One of the two must be chosen: adaptv never guesses a directory to write into. It replaces what is there, so it asks first unless you pass `--yes`. Every run also writes `.adaptv/icons-preview.html`, showing each icon under the mask its platform applies. See [Icons and splash](/docs/icons-and-splash).",
    },
    {
      type: "props",
      rows: [
        {
          name: "--input <image>",
          type: "path",
          required: true,
          description:
            "The png or svg to generate the set from, 1024px or larger. A smaller source still builds, with a notice.",
        },
        {
          name: "-o, --output <dir>",
          type: "path",
          default: "the config's icons dir",
          description: "Write the set here instead.",
        },
        {
          name: "--yes",
          type: "flag",
          description:
            "Replace what is already there without asking. Required off a terminal, where nobody can answer.",
        },
        {
          name: "--dark <image>",
          type: "path",
          description:
            "A hand-inverted version, for the iOS 18 dark-mode icon.",
        },
        {
          name: "--tinted <image>",
          type: "path",
          description:
            "A greyscale version, which iOS colours on a tinted home screen.",
        },
        {
          name: "--monochrome <image>",
          type: "path",
          description: "A single-colour version, for Android's themed icons.",
        },
        {
          name: "--margin <pct>",
          type: "0 to 50",
          default: "10",
          description:
            "Space left around your art in every icon. `0` fills it edge to edge.",
        },
        {
          name: "--padding <pct>",
          type: "0 to 40",
          description: "Extra space around your art, on top of `--margin`.",
        },
        {
          name: "--background <hex>",
          type: "hex colour",
          description:
            "Overrules the colour adaptv read from your image, for the icons that cannot be transparent.",
        },
      ],
    },
    { type: "h2", text: "Shared flags" },
    {
      type: "props",
      rows: [
        {
          name: "--target <id>",
          type: "dev, preview",
          description:
            "Launch on a specific device or simulator, by id. The id is validated against the current device list, then remembered. Not allowed with `all`, because an id belongs to one platform.",
        },
        {
          name: "--latest",
          type: "dev, preview",
          description:
            "Reuse the last device you picked for this platform. Falls back to the picker when that device is gone.",
        },
        {
          name: "--force",
          type: "dev, preview, build",
          description:
            "Do the work even when nothing changed: rebuild, re-sync, reinstall.",
        },
        {
          name: "--host",
          type: "dev",
          description:
            "Serve on this machine's LAN address so a physical device can reach it. Automatic when the target is one. Takes no value.",
        },
        {
          name: "--verbose",
          type: "all but keys",
          description:
            "Stream the raw tool output (Vite, Gradle, Xcode, CocoaPods) instead of the summarised steps. Also sets `ADAPTV_VERBOSE=1` for the build.",
        },
        {
          name: "--quiet",
          type: "doctor, build, keys",
          description: "Outcomes and failures only.",
        },
        {
          name: "--json",
          type: "doctor, build",
          description:
            "One JSON document on stdout and nothing else: `{ ok, command, version, notices, steps, result, error? }`. For scripts and CI.",
        },
        {
          name: "-- <vite args>",
          type: "dev, preview",
          description:
            "Everything after `--` is forwarded to Vite. For `preview` it applies to the web surface only.",
        },
      ],
    },
    { type: "h2", text: "Device selection" },
    {
      type: "p",
      text: "adaptv owns the device picker so it can remember your choice. The order is:",
    },
    {
      type: "ol",
      items: [
        "`--target <id>`: use that device. An unknown id is an error, and is not remembered.",
        "`--latest`: the device remembered for this platform, if it is still available.",
        "Otherwise an arrow-key picker, `which ios device?`. Connected phones are listed first, then simulators or emulators, with the OS version as a hint when two rows share a name. Your pick is saved to the `devices` section of `.adaptv/state.json`.",
      ],
    },
    {
      type: "p",
      text: "When nobody can answer (CI, piped input, an editor's task runner), the picker chooses for itself: the first simulator or emulator, and a physical device only when nothing else is listed. That choice is not remembered, so it never replaces the device you picked. If no device or simulator exists the command fails and tells you to boot one. A device listing that hangs for 30 seconds fails with the command that restarts the platform's device service.",
    },
    { type: "h2", text: "Terminals, CI and exit codes" },
    {
      type: "p",
      text: 'The live output (spinners, the watch block, the `r` and `b` keys, the picker and the `icons` confirmation) needs a real terminal on both stdout and stdin. Without one the CLI degrades and does not fail: steps print as plain lines, keys are off, and prompts answer for themselves as described above. A task runner that pipes stdin takes the keys away. With Turborepo, mark the task `"interactive": true`. Setting `CI` forces the plain mode. `NO_COLOR` turns colour off.',
    },
    {
      type: "p",
      text: "Failures go to stderr, everything else to stdout, so `adaptv build ios --json > out.json` never captures an error into the file.",
    },
    {
      type: "table",
      head: ["Exit code", "Meaning"],
      rows: [
        ["`0`", "Success, or a `dev` session you stopped."],
        ["`1`", "The run failed: a bad config, a failed build, no device."],
        [
          "`2`",
          "The command was typed wrong: an unknown command, flag or surface, or a bad flag value. Nothing ran. The message suggests the closest match.",
        ],
        ["`130`", "You cancelled a picker."],
      ],
    },
    { type: "h2", text: "Environment variables" },
    {
      type: "table",
      head: ["Variable", "Read by", "Effect"],
      rows: [
        [
          "`ANDROID_HOME`, `ANDROID_SDK_ROOT`",
          "native runs, doctor",
          "The Android SDK. Defaults to `~/Library/Android/sdk`.",
        ],
        [
          "`JAVA_HOME`",
          "native runs, doctor",
          "The JDK. When unset or unusable, adaptv uses the one bundled with Android Studio, then `/usr/libexec/java_home`.",
        ],
        [
          "`LANG`",
          "iOS runs",
          "Defaults to `en_US.UTF-8`, which CocoaPods needs. adaptv also finds `pod` in the usual gem and Homebrew locations.",
        ],
        [
          "`ADAPTV_OTA_PRIVATE_KEY`",
          "build web",
          "The private half of the OTA key pair.",
        ],
        [
          "`ADAPTV_OTA_PRIVATE_KEY_FILE`",
          "build web",
          "A path to a file holding it. Keep the file outside the repository.",
        ],
        [
          "`ADAPTV_OTA_ORIGIN`, `ADAPTV_OTA_PUBLIC_KEY`, `ADAPTV_OTA_ALLOW_UNSIGNED`",
          "build web",
          "Local-verification overrides, see the [config page](/docs/config).",
        ],
        [
          "`NITRO_PRESET`",
          "any SSR build",
          "Names the deploy target when it is not auto-detected. See [Deploying](/docs/deploying).",
        ],
        [
          "`ADAPTV_DEV_SW`",
          "dev web",
          "Set to `1` to serve your own `serviceWorkers` modules in dev. Off by default: dev has no service worker.",
        ],
        ["`CI`", "every command", "Forces plain, non-interactive output."],
        ["`NO_COLOR`", "every command", "Turns colour off."],
      ],
    },
    {
      type: "p",
      text: "The CLI also sets variables for the builds it spawns: `ADAPTV_TARGET=capacitor` for the native bundle, `ADAPTV_DEV_NATIVE=1` for a native dev server, `ADAPTV_VERBOSE=1` under `--verbose`. You can set `ADAPTV_TARGET=capacitor` on a bare `vite build` yourself. The rest are internal.",
    },
    { type: "h3", text: "The dev server port" },
    {
      type: "p",
      text: "The CLI has no port flag and reads no port variable. The port is whatever `vite.config.ts` says, and the CLI adds `--strictPort`. Two conventions cover the cases that come up. For one run, pass it through: `adaptv dev web -- --port 4000`. For a second checkout of the same app, read an environment variable in `vite.config.ts`, which is what adaptv's own site and playground do with `VITE_APP_PORT`:",
    },
    {
      type: "code",
      label: "vite.config.ts",
      lang: "ts",
      code: `const port = Number(process.env.VITE_APP_PORT ?? 41760)

export default defineConfig({
  server: { host: "0.0.0.0", port },
  preview: { host: "0.0.0.0", port },
  // ...
})`,
    },
    { type: "h2", text: "What the CLI writes" },
    {
      type: "table",
      head: ["Path", "What it is"],
      rows: [
        ["`.adaptv/ios`, `.adaptv/android`", "The generated native projects."],
        [
          "`.adaptv/web`",
          "The native web bundle: a static SPA with no service worker.",
        ],
        ["`.adaptv/builds/`", "The `.ipa` and `.apk` artifacts."],
        ["`.adaptv/ota/`", "Cached update-bundle archives."],
        [
          "`.adaptv/state.json`",
          "Everything the CLI remembers: build fingerprints and the device picked per platform.",
        ],
        [
          "`.adaptv/build/<target>.json`",
          "Where the last build of each kind wrote, and from which config.",
        ],
        ["`.adaptv/dev.lock`", "The single-instance lock of a running `dev`."],
        [
          "`.adaptv/icons-preview.html`",
          "The icon preview from `adaptv icons`.",
        ],
      ],
    },
    {
      type: "p",
      text: "All of `.adaptv/` is git-ignored and disposable. Deleting it costs a rebuild and a device prompt, never correctness.",
    },
  ],
}
