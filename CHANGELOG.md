# Changelog

All notable changes to adaptv are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Until 1.0, a minor version may break the
API.

## [Unreleased]

### Changed

- **adaptv needs Node 22.15 or newer.** It was 22.12. This breaks Node 22.12 to 22.14: adaptv now
  edits two of its dependencies in memory as Node loads them, with `module.registerHooks`, which
  arrived in 22.15.
- **A created app carries no patch for the router.** `pnpm create adaptv` no longer writes
  `patches/@tanstack__router-generator@1.167.21.patch`, `patches/@tanstack__start-plugin-core@1.171.24.patch`
  or their two `patchedDependencies` lines; adaptv makes those changes itself. An existing app must
  delete both files and both lines and reinstall; until it does, the build stops with an error that
  names them.

- **An app imports only what its own `package.json` lists.** Importing one of adaptv's
  dependencies (the router included) from app source fails the build and the dev server unless
  the app lists that package itself. It used to resolve: npm hoists adaptv's dependencies, and
  under pnpm adaptv resolved them for the app.

- **adaptv and `create-adaptv` are MIT-licensed.** They were `UNLICENSED`. `LICENSE` is at the repo
  root and in `packages/create-adaptv`.
- **The router moves to its release with the preload fix** (TanStack Router 1.170.19, router core
  1.171.16, Start 1.168.36), and adaptv's two in-memory engine edits are pinned to the matching
  versions. See Fixed.
- **Hovers and type errors show adaptv's type names, not the router's.** This covers `notFoundScreen`
  and `notFoundComponent` (`NotFoundScreenComponent`, `NotFoundScreenProps`), `notFound`
  (`NotFoundOptions`), `isRedirect` (`RouteRedirect`), the route DSL (`RouteNode`,
  `RootRouteNode` and the other `*RouteNode` types), and `createRootRoute`, `getRouter`,
  `createAdaptvRouter` and `standaloneMemoryHistory`. These names are exported. A not-found screen is
  now typed as a function component, so a `React.lazy` default export no longer typechecks there.

- **Components no longer put class names of their own on their elements.** Their default look is plain
  CSS in `@layer adaptv.components`, keyed on `data-adaptv` / `data-part`, and what they lock is
  inline style. `className` is yours alone: an unlayered class or a Tailwind utility beats the
  default without `!important`. A selector that targeted one of adaptv's Tailwind classes no longer
  matches; target the `data-adaptv` / `data-part` attributes instead.

### Fixed

- **Tapping a link while its route is still preloading no longer logs a `TypeError`.** The tap
  navigated mid-preload; the navigation evicted the preloaded route from the cache, and the preload
  then read the evicted entry (`match._nonReactive`). The navigation itself always worked.

## 0.1.0-alpha.1

The first public alpha. Not published to npm yet: publishing waits on approval, and until then the
package is installed from the `pnpm pack` tarball. What it contains:

### Added

- **One config file.** `adaptv.config.ts` generates the web manifest, the native iOS and Android
  projects, launch screens, icons, theme and service worker.
- **The `adaptv` CLI.** `doctor`, `dev`, `preview` and `build` for `web`, `ios`, `android` or `all`
  (live reload including a physical device over the LAN, an unsigned `.ipa`, a debug `.apk`),
  `keys ota` and `icons`.
- **`create-adaptv`.** `pnpm create adaptv my-app` writes a new app: a flat config, one route,
  a stylesheet and scripts for `doctor`, `dev`, `preview` and `build`. Not published yet.
- **The shell.** It owns the document, critical CSS, the pre-paint theme stamp, safe areas and the
  edge-to-edge frame; SSR app shell and static-host files for the web build.
- **Primitives.** `View`, `ScrollView`, `List`, `Drawer`, `Dropdown`, `Swipeable`, `PullToRefresh`,
  `WheelColumn`, `Image`, `Input`, `TextArea`, `Button`, `Pressable`, `Link`, `ExternalLink`,
  `Checkbox`, `Switch`, `RadioGroup`, `Select`, `Slider`, `Collapsible`, `FieldGroup`, `Fab`,
  `Text`, `Icon`, `Spinner`, `ProgressBar`, `Skeleton` and `Divider`, plus offline, not-found,
  boot-error and update-required screens.
- **Capabilities and hooks** with the web and native branches chosen internally: haptics, keyboard,
  network, battery, motion, speech, compose, print, privacy screen, screen reader, notifications,
  app info, app state, inbound links, clipboard, share, files, geolocation, orientation, locale,
  status bar, keep-awake, back-button chain, gesture arbitration and screen lifecycle.
- **Storage in three tiers:** sync key-value, an async blob store, and secure storage on the
  platform keychain (best-effort, not secure, on the web).
- **Offline and updates:** a framework-owned service worker and a self-hosted, signed over-the-air
  update channel for installed apps.
- **Icons from one image,** including iOS dark and tinted variants and Android's themed icon.
- **A `dist` build.** The package `exports` and `files` point at `dist/`, and an app installed from
  the packed tarball runs (`examples/basic`).

[Unreleased]: https://github.com/arrzdev/adaptv/commits/main
