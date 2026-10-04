# Changelog

All notable changes to adaptv are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Until 1.0, a minor version may break the
API.

## [Unreleased]

The first public alpha, planned as `0.1.0-alpha.1`. Nothing has been published yet: the package is
consumed from a local checkout. What exists today:

### Added

- **One config file.** `adaptv.config.ts` generates the web manifest, the native iOS and Android
  projects, launch screens, icons, theme and service worker.
- **The `adaptv` CLI.** `doctor`, `dev`, `preview` and `build` for `web`, `ios`, `android` or `all`
  (live reload including a physical device over the LAN, an unsigned `.ipa`, a debug `.apk`),
  `keys ota` and `icons`.
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
- **A `dist` build** (`pnpm build:check`). The package `exports` still point at `src/`; the cutover
  is on the [roadmap](docs/roadmap/dist-cutover.md).

[Unreleased]: https://github.com/arrzdev/adaptv/commits/main
