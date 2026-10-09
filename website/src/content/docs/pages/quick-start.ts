import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "quick-start",
  title: "Quick start",
  summary:
    "Start an adaptv app with one command, and learn the files a minimal app needs.",
  blocks: [
    {
      type: "note",
      tone: "warn",
      text: "adaptv is an alpha. It is on npm as `0.1.0-alpha.1`, and APIs will change before 1.0.",
    },
    { type: "h2", text: "Requirements" },
    {
      type: "ul",
      items: [
        "Node 22.15 or newer, and pnpm 11.1.1.",
        "For iOS: macOS, Xcode and CocoaPods.",
        "For Android: the Android SDK, a JDK and `adb`.",
      ],
    },
    {
      type: "p",
      text: "Web needs only Node and pnpm. Run `adaptv doctor` from an app root to check a machine. Its Android and JDK rows are required. They fail on a machine without them, even if you only build web. Set `ANDROID_HOME` and `JAVA_HOME` to fix this.",
    },
    { type: "h2", text: "Start an app" },
    {
      type: "code",
      label: "Terminal",
      lang: "bash",
      code: `pnpm create adaptv my-app
cd my-app
pnpm install
pnpm dev                    # http://localhost:3000`,
    },
    {
      type: "p",
      text: "The starter uses Tailwind and carries adaptv's dependency patches. Use pnpm: npm and yarn do not apply the patches. To add adaptv to an app you already have, `npm i adaptv` and write the files below.",
    },
    { type: "h2", text: "Run the repository apps" },
    {
      type: "code",
      label: "Terminal",
      lang: "bash",
      code: `git clone https://github.com/arrzdev/adaptv.git
cd adaptv
pnpm install
pnpm build                  # the site reads dist/
pnpm --dir website install  # the site is its own pnpm project
pnpm website:dev            # this site, http://localhost:41760
pnpm dev:web                # playground, http://localhost:41730
pnpm dev:ios                # playground, iOS Simulator
pnpm dev:android            # playground, Android emulator`,
    },
    {
      type: "p",
      text: "`website/` and `playground/` are separate pnpm projects. Each installs its own dependencies. To use the CLI by hand, run it from `website/` or `playground/apps/frontend/`. The dev server fails on a busy port. For the website, set `VITE_APP_PORT` to pick another.",
    },
    { type: "h2", text: "A minimal app" },
    {
      type: "p",
      text: "You write five files, plus `package.json` and `tsconfig.json`. You need no `index.html`, manifest, service worker or native project. See [Project structure](/docs/project-structure).",
    },
    { type: "h3", text: "adaptv.config.ts" },
    {
      type: "p",
      text: "Required keys: `name`, `description`, `themeColor`, `styles` and `router`. `router` can be empty. Also set `appId`, even for web. Every CLI command fails with `missing 'appId' in adaptv.config.ts` without it. See [config](/docs/config).",
    },
    {
      type: "code",
      label: "adaptv.config.ts",
      lang: "ts",
      code: `import { defineApp } from "adaptv/config"

export default defineApp({
  appId: "com.acme.app",
  name: "Acme",
  description: "An Acme app.",
  themeColor: { light: "#ffffff", dark: "#000000" },
  styles: "./src/styles/main.css",
  router: {},
})`,
    },
    { type: "h3", text: "vite.config.ts" },
    {
      type: "code",
      label: "vite.config.ts",
      lang: "ts",
      code: `import { adaptv } from "adaptv/vite"
import { defineConfig } from "vite"

export default defineConfig({
  resolve: { tsconfigPaths: true, dedupe: ["react", "react-dom"] },
  plugins: [adaptv()],
})`,
    },
    { type: "h3", text: "src/routing/config.ts" },
    {
      type: "p",
      text: "The route tree. Paths are relative to `src/routing`. See [Routing](/docs/routing).",
    },
    {
      type: "code",
      label: "src/routing/config.ts",
      lang: "ts",
      code: `import { index, rootRoute } from "adaptv/routes"

export default rootRoute([index("pages/home.page.tsx")])`,
    },
    { type: "h3", text: "src/routing/pages/home.page.tsx" },
    {
      type: "p",
      text: "A page exports `Route`. Its root is a `View` or a `ScrollView`. Do not use `h-screen`. See [The frame](/docs/the-frame).",
    },
    {
      type: "code",
      label: "home.page.tsx",
      lang: "tsx",
      code: `import { ScrollView, View } from "adaptv/components"
import { createFileRoute } from "adaptv/router"

export const Route = createFileRoute("/")({ component: Home })

function Home() {
  return (
    <ScrollView>
      <View className="home">
        <h1>Hello</h1>
      </View>
    </ScrollView>
  )
}`,
    },
    { type: "h3", text: "src/styles/main.css" },
    {
      type: "p",
      text: "Plain CSS. adaptv's rules sit in a cascade layer, so any class of yours beats them. The safe-area insets are variables.",
    },
    {
      type: "code",
      label: "src/styles/main.css",
      lang: "text",
      code: `@import "adaptv/styles.css";

.home {
  gap: 1rem;
  padding: calc(var(--adaptv-inset-top) + 2rem) 1.5rem calc(var(--adaptv-inset-bottom) + 2rem);
}`,
    },
    {
      type: "p",
      text: "Tailwind is optional. To use it, add `tailwindcss` and `@tailwindcss/vite`, list `adaptv()` before `tailwindcss()`, and import `adaptv/tailwind.css` after Tailwind instead of `styles.css`. See [Styling](/docs/styling).",
    },
    { type: "h3", text: "package.json" },
    {
      type: "p",
      text: "Depend on `adaptv`, and on `react`, `react-dom`, `vite` and `motion` at the versions adaptv pins as peers. Other versions can install two copies of React, which crash with `Cannot read properties of null (reading 'useEffect')`.",
    },
    {
      type: "code",
      label: "package.json",
      lang: "text",
      code: `{
  "type": "module",
  "scripts": {
    "dev": "adaptv dev web",
    "build": "adaptv build web"
  },
  "dependencies": {
    "adaptv": "0.1.0-alpha.1",
    "motion": "12.35.0",
    "react": "19.2.3",
    "react-dom": "19.2.3",
    "vite": "8.0.11"
  }
}`,
    },
    {
      type: "p",
      text: "The app also needs adaptv's dependency patches. Install once, copy `node_modules/adaptv/patches/` to `patches/`, add the `patchedDependencies` block from the starter's `pnpm-workspace.yaml`, then install again. Vite 8 is required.",
    },
    { type: "h3", text: "tsconfig.json" },
    {
      type: "p",
      text: "adaptv edits an existing `tsconfig.json` when it loads the config. It adds `.adaptv/**/*.ts` to `include`, and a `#adaptv-route-tree` entry to `paths`. adaptv reaches its own types through `.adaptv/adaptv-env.d.ts`, so you add nothing else. Your file must already have an `include` array and a `paths` object. If not, adaptv adds nothing and `navigate` loses its route check. `.adaptv/` holds generated files and git ignores it. You can delete it. The next run rebuilds it.",
    },
    { type: "h2", text: "Common problems" },
    {
      type: "ul",
      items: [
        "**`no adaptv.config.ts here`.** Run the CLI from the app folder.",
        "**`missing 'appId'`.** Add `appId` to the config.",
        "**A page does not scroll.** Its component returns more than one root element. Use one `ScrollView`.",
        "**With Tailwind, your classes lose to adaptv resets.** Put `adaptv()` before `tailwindcss()`.",
        "**A framework edit has no effect on `preview` or `build`.** The build is cached and says nothing. Pass `--force`.",
      ],
    },
    {
      type: "p",
      text: "Next: [The frame](/docs/the-frame), [Routing](/docs/routing), [Native builds](/docs/native-builds).",
    },
  ],
}
