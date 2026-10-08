import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "project-structure",
  title: "Project structure",
  summary: "The files of an adaptv app, and which ones adaptv writes for you.",
  blocks: [
    {
      type: "p",
      text: "An adaptv app is a Vite project with a config, a route config, pages and a stylesheet. adaptv generates everything else into `.adaptv/`. [Quick start](/docs/quick-start) has the file contents.",
    },
    {
      type: "code",
      label: "my-app/",
      lang: "text",
      code: `my-app/
├── adaptv.config.ts    the app config
├── vite.config.ts
├── tsconfig.json
├── package.json
├── public/             static files, and the icon set
├── src/
│   ├── routing/
│   │   ├── config.ts   the route tree
│   │   ├── pages/      one file per route
│   │   └── layouts/    layout routes
│   ├── styles/main.css the stylesheet
│   └── sw/             optional service-worker modules
└── .adaptv/            generated, git-ignored`,
    },
    {
      type: "p",
      text: "`adaptv.config.ts` and `vite.config.ts` must sit at the app root. `src/routing` and `src/routing/config.ts` are defaults. Folder names under `src/` are yours.",
    },
    { type: "h2", text: "adaptv.config.ts" },
    {
      type: "p",
      text: "The one config. The head, manifest, service worker, router and native projects all come from it. `router` is required, even as `{}`. Every key is in the [config reference](/docs/config).",
    },
    {
      type: "p",
      text: "Two `router` paths resolve from different bases. `routesDirectory` (default `./routing`) is relative to `src/`. `routerConfig` (default `./src/routing/config.ts`) is relative to the app root.",
    },
    { type: "h2", text: "vite.config.ts" },
    {
      type: "p",
      text: "Add `adaptv()`, and with Tailwind put it before `tailwindcss()`. You add no React, router, PWA or deploy plugin. See the [Vite plugin](/docs/vite-plugin).",
    },
    { type: "h2", text: "src/routing" },
    {
      type: "p",
      text: "`config.ts` declares the route tree. Each entry names a file under the routes directory. adaptv owns the root route, so you declare only its children. Put app-wide providers in a layout route. File names are yours. See [Routing](/docs/routing) and the [Router API](/docs/router-api).",
    },
    {
      type: "code",
      label: "src/routing/config.ts",
      lang: "ts",
      code: `import { index, rootRoute, route } from "adaptv/routes"

export default rootRoute([
  index("pages/home.page.tsx"),
  route("/blog", "pages/blog.page.tsx"),
  route("/blog/$slug", "pages/blog/post.page.tsx"),
])`,
    },
    { type: "h2", text: "src/styles/main.css" },
    {
      type: "p",
      text: "The file named by `styles`. Import `adaptv/styles.css`, then your tokens. With Tailwind, import Tailwind, then `adaptv/tailwind.css`. See [Styling](/docs/styling) and [Theming](/docs/theming).",
    },
    { type: "h2", text: "public/" },
    {
      type: "p",
      text: "Files here are served as they are. The `icons` key names the icon folder, usually `public/favicons`. With no `icons` key, the app uses adaptv's own mark. Run `adaptv icons --input <image>` to fill the folder. Do not add a manifest or service worker. adaptv generates both. See [Icons and splash](/docs/icons-and-splash).",
    },
    { type: "h2", text: "src/sw/" },
    {
      type: "p",
      text: "Optional. For your own service-worker code, write a module with `adaptv/sw` and list it in `serviceWorkers`. See [Offline](/docs/offline).",
    },
    { type: "h2", text: "tsconfig.json" },
    {
      type: "p",
      text: "adaptv adds the route-types entries to an existing file if it has an `include` array and a `paths` object. It adds nothing otherwise. The `.adaptv/**/*.ts` entry brings in all of adaptv's ambient types, `?adaptv-image` imports included.",
    },
    {
      type: "code",
      label: "tsconfig.json",
      lang: "text",
      code: `{
  "include": [
    ".adaptv/**/*.ts",
    "src"
  ],
  "compilerOptions": {
    "paths": {
      "#adaptv-route-tree": ["./.adaptv/routeTree.gen.ts"],
      "@/*": ["./src/*"]
    }
  }
}`,
    },
    {
      type: "p",
      text: "Without the `#adaptv-route-tree` path, every `to` is a plain `string`.",
    },
    { type: "h2", text: "package.json" },
    {
      type: "ul",
      items: [
        "Depend on `adaptv`. Install its peers yourself: `react`, `react-dom`, `vite` and `motion`. Tailwind is optional: add `tailwindcss` and `@tailwindcss/vite` to use it.",
        "Scripts call `adaptv` by name, for example `adaptv dev ios`. See the [CLI](/docs/cli).",
        'A task runner must pass the terminal through. In Turborepo, set `"interactive": true` on the task.',
      ],
    },
    { type: "h2", text: ".adaptv/" },
    {
      type: "p",
      text: "Generated files. Git-ignore it, as with `dist/`. You can delete it. The next run rebuilds it and asks for a device again. The next native run regenerates `ios/` and `android/`. adaptv adds `.adaptv/` and `capacitor.config.json` to `.gitignore` for you.",
    },
    {
      type: "table",
      head: ["Path", "What it is"],
      rows: [
        ["`routeTree.gen.ts`", "The typed route tree."],
        ["`sw.gen.ts`", "The service worker entry. Web builds write it."],
        [
          "`build/web.json`, `build/capacitor.json`",
          "The last build of each kind.",
        ],
        ["`web/`", "The web bundle for native apps."],
        [
          "`ios/`",
          "The Xcode project. Open `ios/App/App.xcworkspace` to sign.",
        ],
        ["`android/`", "The Gradle project."],
        ["`builds/`", "The `.ipa` and `.apk` files."],
        ["`ota/`", "Cached update archives."],
        ["`state.json`", "Build fingerprints and the last device."],
        ["`dev.lock`", "The lock of a running `adaptv dev`."],
      ],
    },
    {
      type: "p",
      text: "Treat `.adaptv/ios` and `.adaptv/android` as build output. adaptv rewrites them from the config on every native run. See [Native builds](/docs/native-builds).",
    },
    { type: "h2", text: "Build output" },
    {
      type: "table",
      head: ["Directory", "From", "Deploy it?"],
      rows: [
        [
          "`.output/`",
          '`render: "ssr"`',
          "Yes. `server` runs the app. `public` holds static files.",
        ],
        ["`dist/client`", '`render: "spa"`', "Yes, to any static host."],
        ["`dist/server`", "Any build", "No. Scratch space."],
      ],
    },
    {
      type: "p",
      text: "See [Deploying](/docs/deploying) and [Rendering](/docs/rendering).",
    },
  ],
}
