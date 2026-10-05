import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "introduction",
  title: "Introduction",
  summary:
    "What adaptv is, what it does for you, what you write, and its status.",
  blocks: [
    {
      type: "p",
      text: "adaptv is a React framework. One codebase ships to desktop web, mobile web, an installed home-screen app, and native iOS and Android apps. You write React and Tailwind. adaptv handles the differences between targets. The native apps are web views in a native shell. See [the six targets](/docs/six-targets).",
    },
    { type: "h2", text: "What adaptv does, and what you write" },
    {
      type: "table",
      head: ["adaptv does", "You write"],
      rows: [
        [
          "The HTML document, the manifest, the service worker and the native projects.",
          "`adaptv.config.ts`. See [config](/docs/config).",
        ],
        [
          "A full-screen frame for every page. See [The frame](/docs/the-frame).",
          "Pages. Each page root is a [View](/docs/view) or a [ScrollView](/docs/scroll-view).",
        ],
        [
          "The root route and the route tree. See [Routing](/docs/routing).",
          "A route config and one file per page.",
        ],
        [
          "The web and native branch inside each capability, such as haptics, keyboard and storage. See [capabilities](/docs/capabilities).",
          "Calls to one API. No platform checks.",
        ],
        [
          "Fixes for `hover:` and `active:`, plus the `app:` and `web:` variants and the safe-area utilities. See [Styling](/docs/styling).",
          "Your design system. adaptv ships no palette.",
        ],
        ["Nothing for data.", "Your data layer."],
      ],
    },
    { type: "h2", text: "The CLI" },
    {
      type: "p",
      text: "The `adaptv` CLI runs every target. `dev` gives live reload. `preview` runs the real build. `build` writes the files to ship. `dev`, `preview` and `build` need a target. See the [CLI reference](/docs/cli).",
    },
    {
      type: "code",
      label: "Terminal",
      lang: "bash",
      code: `adaptv doctor                        # check this machine for native builds
adaptv dev     web|ios|android|all   # live reload
adaptv preview web|ios|android|all   # the real build
adaptv build   web|ios|android|all   # site, unsigned .ipa, debug .apk
adaptv keys ota                      # signing keys for updates
adaptv icons --input ./mark.png --output ./public/favicons   # all icons from one image`,
    },
    { type: "h2", text: "When not to use it" },
    {
      type: "ul",
      items: [
        "Games and heavy graphics. Use a native renderer.",
        "Camera or AR apps. A web view gets in the way.",
        "Apps that need server code on every screen. A native bundle has no server. Put that logic in an API. See [Rendering](/docs/rendering).",
      ],
    },
    { type: "h2", text: "Status" },
    {
      type: "note",
      tone: "warn",
      text: "adaptv is **pre-alpha**. `@arrzdev/adaptv` is not on npm and has no install command. You link a local checkout. [Quick start](/docs/quick-start) shows how. APIs change without notice. The `create-adaptv` scaffolder does not exist yet.",
    },
    { type: "h2", text: "Where to go next" },
    {
      type: "ul",
      items: [
        "[Quick start](/docs/quick-start): run an app.",
        "[Project structure](/docs/project-structure): what each file does.",
        "[The frame](/docs/the-frame): read this before you write a page.",
        "[Routing](/docs/routing), [Styling](/docs/styling), [Theming](/docs/theming).",
        "[Deploying](/docs/deploying) and [Native builds](/docs/native-builds).",
        "Reference: [View](/docs/view), [hooks](/docs/hooks-device), [config](/docs/config), [CLI](/docs/cli).",
      ],
    },
  ],
}
