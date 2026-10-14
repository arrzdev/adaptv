<p align="center">
  <img alt="adaptv" src="assets/adaptv-mark.svg" height="104" />
</p>

<h1 align="center">adaptv</h1>

<p align="center">
  <b>One React codebase → desktop web, mobile web, an installable home-screen app,<br />and real iOS and Android apps that don't feel like a website in a box.</b>
</p>

<p align="center">
  You write ordinary React against the DOM, and ordinary CSS. adaptv owns everything<br />
  between that and an app that feels right on every target — the shell, the platform<br />
  divergences, the native project, and the tooling that runs it all.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/adaptv"><img alt="Status: alpha" src="https://img.shields.io/badge/status-alpha-orange?style=flat-square" /></a>
  <a href=".github/workflows/ci.yml"><img alt="CI: typecheck, lint, tests" src="https://img.shields.io/badge/CI-typecheck%20%C2%B7%20lint%20%C2%B7%20tests-blue?style=flat-square" /></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" /></a>
  <img alt="Node 22.15 or newer" src="https://img.shields.io/badge/node-%3E%3D22.15-brightgreen?style=flat-square" />
</p>

<p align="center">
  <a href="docs/README.md"><b>Documentation</b></a>
&ensp;•&ensp;
  <a href="docs/design/architecture.md">Architecture</a>
&ensp;•&ensp;
  <a href="docs/decisions/positioning.md">Why it exists</a>
&ensp;•&ensp;
  <a href="docs/roadmap/README.md">Roadmap</a>
</p>

> [!WARNING]
> **Alpha.** `adaptv` is on npm as `0.1.0-alpha.1`. APIs will change before 1.0. Start an app with
> `pnpm create adaptv my-app`, or add the framework with `npm i adaptv`. See [Status](#-status).

---

## 🚀 What you get

| The piece | What it does |
|---|---|
| 🧾 **One config file** | `adaptv.config.ts` generates the web manifest, native projects, launch screens, icons, theme and service worker. There is no second config. |
| 🖼️ **A frame you inherit** | The shell owns the document, critical CSS, the pre-paint theme stamp, safe areas and the edge-to-edge frame. Your route root is just a `View`. |
| 🧱 **Primitives that carry the divergences** | `View` · `List` · `Drawer` · `Swipeable` · `PullToRefresh` · `WheelColumn` · `Image` · `Input` · `Collapsible` · `Slider` · `Select` · `FieldGroup` · `ScrollView` — plus offline, not-found and boot-error screens. |
| 🔌 **Capabilities, branch already taken** | 30 modules and 40 hooks: haptics, keyboard, network, battery, motion, speech, compose, print, privacy screen, screen reader, notifications, app info, links that open the app, clipboard, share, files, geolocation, orientation, locale, status bar, back. Web and native branches, chosen internally. |
| 💾 **Storage in three tiers** | Sync key-value · async blob store · secure, on the platform keychain — and documented *best-effort, not secure*, on the web. |
| 📡 **Offline and updates** | A framework-owned service worker, plus a self-hosted **signed** over-the-air update channel for installed apps. |
| 🎨 **Icons from one image** | The whole set, including iOS's dark and tinted variants and Android's themed icon, sized against the mask each platform actually applies. |

One tool drives the whole loop:

```bash
adaptv doctor                        # does this machine have what a native build needs?
adaptv dev     web|ios|android|all   # live reload, incl. a physical device over the LAN
adaptv preview web|ios|android|all   # the real build, no live reload
adaptv build   web|ios|android|all   # deployable site · unsigned .ipa · debug .apk
adaptv keys ota                      # the signing pair for the update channel
adaptv icons --input ./mark.png      # every icon your app needs
```

## ⚡ Quick start

You need Node 22.15 or newer and pnpm 11. One command writes a working app:

```bash
pnpm create adaptv my-app
cd my-app
pnpm install
pnpm dev                  # adaptv dev web: serves the app on http://localhost:3000
pnpm build                # adaptv build web: the deployable site in .output/public
```

The starter needs pnpm: it carries adaptv's dependency patches, which npm and yarn do not apply.
To add the framework to an app you already have, `npm i adaptv` (or `pnpm add adaptv`) and read
[Your own app](#your-own-app).

Every command prints `! no 'icons' in adaptv.config.ts`. That is expected: an app with no icons
wears adaptv's mark. To use your own, add `icons: "./public/favicons"` to `adaptv.config.ts` and
run `pnpm exec adaptv icons --input ./mark.png` (one png or svg, 1024px or larger).

`adaptv.config.ts` is the one config file — the web manifest, the native
projects, icons and theme all come from it:

```ts
import { defineApp } from "adaptv/config"

export default defineApp({
  appId: "com.example.basic",
  name: "basic",
  description: "basic, built with adaptv.",
  themeColor: { light: "#ffffff", dark: "#0a0a0c" },
  styles: "./src/styles/main.css",
  router: {},
})
```

`src/routing/config.ts` declares the routes, and each route is a file whose root is a `View`:

```tsx
// src/routing/config.ts
import { index, rootRoute } from "adaptv/routes"

export const routes = rootRoute([index("pages/home.page.tsx")])
export default routes

// src/routing/pages/home.page.tsx
import { View } from "adaptv/components"
import { createFileRoute } from "adaptv/router"

export const Route = createFileRoute("/")({
  component: Home,
})

function Home() {
  return (
    <View fill center className="gap-2 p-safe-offset-6 text-center">
      <h1 className="font-semibold text-2xl">basic</h1>
      <p className="opacity-60">
        Edit src/routing/pages/home.page.tsx and save.
      </p>
    </View>
  )
}
```

`vite.config.ts` adds `adaptv()` and Tailwind:

```ts
import { adaptv } from "adaptv/vite"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"

export default defineConfig({
  resolve: { tsconfigPaths: true },          // `@/` is `src/`; adaptv imports your stylesheet through it
  ssr: { noExternal: ["adaptv"] },  // the dev server runs adaptv through Vite, not Node
  plugins: [adaptv(), tailwindcss()],
})
```

and `src/styles/main.css` imports `adaptv/tailwind.css` after Tailwind:

```css
@layer theme, base, adaptv, components, utilities;
@import "tailwindcss";
@import "adaptv/tailwind.css";
```

`tailwind.css` is adaptv's styles plus its variants (`app:`, `web:`, `dark:`, `light:`, and the
touch-safe `hover:` / `active:`) and the safe-area utilities (`p-safe`, `pb-safe-offset-4`, …).
adaptv merges no classes; if you want two of your own Tailwind classes merged, bring
`tailwind-merge` yourself.

Tailwind is the default, not a requirement: plain CSS, SCSS, CSS modules or any other engine work
too. Import `adaptv/styles.css` instead, and the safe-area insets are variables
(`--adaptv-inset-top`, …). → [`docs/decisions/styling.md`](docs/decisions/styling.md) §8

### Your own app

Install adaptv and its peers, at the versions it pins:

```bash
pnpm add adaptv react@19.2.3 react-dom@19.2.3 vite@8.0.11 motion@12.35.0
```

[`examples/basic/`](examples/basic) is a minimal app in this repository; copy its files as a
starting point.

> [!IMPORTANT]
> **Your app carries adaptv's dependency patches.** pnpm applies `patchedDependencies` only from
> the project it installs, so a package cannot bring its own. The example has them in its
> `patches/`, declared with app-relative paths in its `pnpm-workspace.yaml`, so a copy installs as
> it is. An app from `create-adaptv` has them the same way. Without them the first
> `adaptv build web` writes a second `createFileRoute` import into every route file →
> [`design/patches.md`](docs/design/patches.md).
>
> An app you set up by hand needs the files too. Install once, copy
> `node_modules/adaptv/patches/` to `patches/`, copy the `patchedDependencies` block from
> [`examples/basic/pnpm-workspace.yaml`](examples/basic/pnpm-workspace.yaml), then install again.
> pnpm fails with `Patch file not found` for any file the block lists that does not exist yet.
>
> After you upgrade adaptv, copy them again and update the keys to the new versions.

## ✨ Why it exists

Anyone who wants one codebase on every screen ends up at the same fork:

| Road | You get | You give up |
|---|---|---|
| Render to **native views** | real native rendering | the web platform — a second rendering model, a second styling system |
| Keep the **DOM**, put it in an app | React, CSS, the whole web ecosystem | nothing… except every place a web page does not behave like an app |

**adaptv takes the second road and refuses to pay its usual price.** That price is not vague rough
edges. It is a specific catalogue — safe areas landing after first paint, three unrelated keyboard
mechanisms, overscroll chaining, `:active` that can't be cleared from JS, edge-swipe fighting the OS
gesture, two splash screens colliding, cookies that simply do not work on device. Each is solvable in
an afternoon. Together they are why *"we'll just wrap the web app"* ends up feeling wrapped.

Three convictions shape the answer: behaviour with cross-platform consequences goes through a **typed
prop**, not a class name, so the ergonomic path is the correct path; **layout shift is a named enemy**,
because a button that moves out from under a thumb is a correctness bug; and **some problems can only
be fixed by a framework** — code that needs a server at request time is fine on the web and dead in a
shipped mobile bundle, so adaptv turns it into a build error with a caret on the offending line.

📖 The full argument, *including the reasons to be sceptical of it*, is in
[`decisions/positioning.md`](docs/decisions/positioning.md). The divergence catalogue in full is
[`VISION.md` §3](docs/VISION.md), and how each one is verified is
[`design/behaviors.md`](docs/design/behaviors.md).

## 🚦 Status

| The question | Where it stands |
|---|---|
| 📦 **Published?** | **Yes, as an alpha.** `adaptv` and `create-adaptv` `0.1.0-alpha.1` are on npm: `pnpm create adaptv my-app`, or `npm i adaptv`. |
| 🔗 **How it's consumed** | From npm. In this repository, [`examples/basic/`](examples/basic) installs a `pnpm pack` tarball and [`playground/`](playground/) links the checkout (`"adaptv": "link:../../.."`). |
| 🏗️ **Dist build** | `exports` and `files` point at `dist/` (`pnpm build:check`), and an app installed from the package runs `adaptv dev web` and `adaptv build web` → [`dist-cutover.md`](docs/roadmap/dist-cutover.md) |
| ✅ **Green today** | typecheck · lint · **2,618 unit tests across 167 files** — all gated in CI on every pull request |
| 📱 **Verified on device** | iOS Simulator and Android emulator, driven from this repo, plus a browser e2e suite in the playground |
| 🚧 **Not built yet** | a first-party native shell module · real breadth in the primitive catalogue → [`roadmap/`](docs/roadmap/README.md) |

## 📚 Documentation

[**`docs/README.md`**](docs/README.md) is the index — five folders, split by the *kind of claim* a file makes.

| Read | To find out |
|---|---|
| [`VISION.md`](docs/VISION.md) | the north star, the ten principles, and the divergence catalogue in full |
| [`design/architecture.md`](docs/design/architecture.md) | the load-bearing contracts: the three layers of the frame, `View`, storage |
| [`design/rendering.md`](docs/design/rendering.md) | rendering, delivery and the offline model |
| [`design/lifecycle.md`](docs/design/lifecycle.md) | config → build → native → update ([`design/ota.md`](docs/design/ota.md) for the channel) |
| [`decisions/register.md`](docs/decisions/register.md) | every locked decision, open question and recorded bug |
| [`guides/cookbook.md`](docs/guides/cookbook.md) | building an app on it: offline UI, auth guards, offline-first data |
| [`research/`](docs/research/README.md) | what a device actually does, each with the experiment that established it |

> [!IMPORTANT]
> **Changing the CLI?** [`design/cli-contract.md`](docs/design/cli-contract.md) first, without
> exception. Every rule in it exists because the output broke it once, and the test suite cannot
> catch most of them.

## 🗺️ Repository layout

- [`src/`](src) — the framework: the build plugin, the runtime primitives, capabilities, storage, OTA.
- [`bin/`](bin) — the `adaptv` CLI. Read [`design/cli-contract.md`](docs/design/cli-contract.md) before touching it.
- [`docs/`](docs) — five folders, split by the kind of claim each file makes.
- [`examples/basic/`](examples/basic) — a minimal app, installed from the packed tarball.
- [`playground/`](playground) — a real app vendored into the repo and linked against the local checkout.
- [`scripts/`](scripts) — repo tooling. Nothing here ships.

## 🛠️ Developing on adaptv

`playground/` is a real frontend app linked against the local checkout, so a framework change and the
app change it forces land together. Framework development only — nothing in `playground/` or
`scripts/` ships.

```bash
pnpm dev:web        pnpm preview:web        pnpm build:ios
pnpm dev:ios        pnpm preview:ios        pnpm build:android
pnpm dev:android    pnpm preview:android    pnpm build:all
pnpm dev:all        pnpm preview:all

pnpm gate           # typecheck, lint, unit tests, colour, publint + attw — everything CI runs
```

The full loop — fresh worktrees, ports, what the playground is and is not — is in
[`DEVELOPMENT.md`](docs/DEVELOPMENT.md).

## License

[MIT](LICENSE). Third-party notices for code adaptv ports are in
[`THIRD_PARTY_LICENSES`](THIRD_PARTY_LICENSES).
