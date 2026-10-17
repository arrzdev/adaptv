# adaptv — the landscape: Ionic/Capacitor, React Native/Expo, Flutter

A fair comparison, for two readers: the team (what adaptv really is) and the website (what to say to
a new developer). Every outside claim carries a link that was opened on **2026-10-14**; what could
not be opened is marked `[TBD: awaiting real data]`; rival cells with no link are marked the same way. Two pages were opened later: Ionic platform styles (2026-10-15) and expo-updates/Expo web (2026-10-17). Repo claims point at a path. Market numbers
live in [`../decisions/positioning.md`](../decisions/positioning.md) §1 and are not repeated here.

> **Correction to carry forward.** "Ionic can't do custom UI" is wrong. Ionic styles adapt per platform mode: iOS styles on Apple devices, Material Design on Android, and the mode is set as a class on `<html>` ([platform styles](https://ionicframework.com/docs/theming/platform-styles)), which is the hook for overriding them.
> The real difference is *who owns the dangerous behaviour* (§3), and *how the app is built* (§1).

## 1. Side by side

| | **adaptv** | **Ionic (+ Capacitor)** | **React Native (+ Expo)** | **Flutter** |
|---|---|---|---|---|
| Rendering model | The DOM, inside a Capacitor WebView on native, a browser on web. `README.md` | Web Components in a WebView ([Ionic README](https://raw.githubusercontent.com/ionic-team/ionic-framework/main/README.md), [Capacitor](https://capacitorjs.com/docs)) | React components create real native views ([RN docs](https://reactnative.dev/docs/intro-react-native-components)). Web via react-native-web, which wraps `react-dom` primitives ([Expo web](https://docs.expo.dev/workflow/web/)) | Its own engine draws every pixel; it bypasses native widgets ([architecture](https://docs.flutter.dev/resources/architectural-overview)) |
| Language | TypeScript/React, HTML, CSS | JS/TS with Angular, React or Vue ([Ionic README](https://raw.githubusercontent.com/ionic-team/ionic-framework/main/README.md)) | JavaScript/TypeScript, React ([RN docs](https://reactnative.dev/docs/intro-react-native-components)) | Dart ([architecture](https://docs.flutter.dev/resources/architectural-overview)) |
| UI kit | Primitives carrying the platform divergences (`src/interface/components.index.ts`, 36 export lines) | Component set that adapts to iOS or Material Design mode ([platform styles](https://ionicframework.com/docs/theming/platform-styles)) | Core components mapped to native views; richer kits are third-party ([RN docs](https://reactnative.dev/docs/intro-react-native-components)) | Material and Cupertino widget sets ([Cupertino](https://docs.flutter.dev/ui/widgets/cupertino)) |
| Web output | First-class: the web is the primary target. `docs/VISION.md` §1 | A web app; Capacitor says "if it works in the browser, it probably works" in the app ([Capacitor](https://capacitorjs.com/docs)) | Supported, static or client rendering ([Expo web](https://docs.expo.dev/workflow/web/)) | Supported, but "not suitable for static websites with text-rich flow-based content"; SEO limits ([Flutter web FAQ](https://docs.flutter.dev/platform-integration/web/faq)) |
| Native API access | Capacitor plugins wrapped as hooks/functions, branch chosen inside (`src/capabilities/`, `README.md`) | Capacitor plugin API: Swift, Java, JS ([Capacitor](https://capacitorjs.com/docs)) | Native modules; New Architecture (JSI, Fabric, TurboModules) on by default since 0.76 ([RN](https://reactnative.dev/docs/the-new-architecture/landing-page)) | Platform channels and FFI ([architecture](https://docs.flutter.dev/resources/architectural-overview)) |
| OTA | Self-hosted signed channel, `docs/design/ota.md`, `src/ota/` | Appflow Live Updates pushes HTML, JS and CSS changes only, binary-compatible ([Appflow](https://ionic.io/docs/appflow/deploy/intro)); Capacitor's own live-updates guide returned 404 → `[TBD: awaiting real data]` on whether Capacitor alone has one | `expo-updates` speaks the Expo Updates protocol; EAS Update is one server, a custom server also works ([expo-updates](https://docs.expo.dev/versions/latest/sdk/updates/), [custom server](https://github.com/expo/custom-expo-updates-server)); optional code signing via `codeSigningCertificate` | `[TBD: awaiting real data]` (not researched this run) |
| Distribution | Web deploy, installable PWA, `.ipa`/`.apk` from `adaptv build` (`README.md`) | Web, PWA, stores via Capacitor `[TBD: awaiting real data]` | Stores; web hosting `[TBD: awaiting real data]` | Stores; web hosting `[TBD: awaiting real data]` |
| Learning curve | Know React and CSS; the CLI hides the native project (`docs/decisions/positioning.md` §2 "The consumer never touches Capacitor") | `[TBD: awaiting real data]` | `[TBD: awaiting real data]` | Dart and its widget system ([architecture](https://docs.flutter.dev/resources/architectural-overview)) |
| Typical trade-offs | WebView ceiling; pre-alpha, unpublished (`README.md`) | UI-layer health, see `positioning.md` §1; WebView ceiling `[TBD: awaiting real data]` | Renders native views, not the DOM ([RN docs](https://reactnative.dev/docs/intro-react-native-components)) | Separate engine and language; web text/SEO limits ([Flutter web FAQ](https://docs.flutter.dev/platform-integration/web/faq)) |

## 2. What the developer decides vs what the framework decides

| Area | adaptv | Ionic | React Native/Expo | Flutter |
|---|---|---|---|---|
| Navigation and transitions | Framework (TanStack Router + adaptv shell) | `[TBD: awaiting real data]` | `[TBD: awaiting real data]` | `[TBD: awaiting real data]` |
| Gestures, scroll, keyboard, safe areas | **Framework decides** (§3) | Components handle much of it; the dev owns app-level glue `[TBD: awaiting real data]` | Native views supply platform behaviour ([RN docs](https://reactnative.dev/docs/intro-react-native-components)) | Engine draws instead of native widgets ([architecture](https://docs.flutter.dev/resources/architectural-overview)) |
| Visual look | Dev owns it (className, Tailwind-optional) | Dev themes the iOS/MD modes ([platform styles](https://ionicframework.com/docs/theming/platform-styles)) | `[TBD: awaiting real data]` | Material or Cupertino widgets ([Cupertino](https://docs.flutter.dev/ui/widgets/cupertino)) or custom painting `[TBD: awaiting real data]` |

Rows for non-adaptv tools that I could not open are `[TBD]`; do not turn them into website copy.

## 3. What adaptv decides for you

Each row is a behaviour the dev does not get to get wrong. Evidence is in the repo.

| Area | What is decided | Evidence |
|---|---|---|
| Root frame and scroll | A framework-owned shell seeds a full-viewport, inset-aware slot; `View` cannot scroll wrong; scroll is a prop (`scroll="y"`), not a class | `docs/VISION.md` §2 (principles 1, 2, 4); `src/components/view.tsx`, `src/components/scroll-view.tsx` |
| Safe areas | Edge-to-edge by default; the shell owns the inset variables | `docs/VISION.md` §1; `src/shell/`; `src/styles/patches.css` |
| Keyboard | Native listeners attach at app start so an autofocused field cannot lose the race; viewport is pinned; the sheet grows instead of moving | `docs/design/behaviors.md` §4; `docs/design/keyboard-signal.md`; `src/capabilities/keyboard.ts`; `src/hooks/use-freeze-viewport.ts` |
| Gestures | One gesture controller arbitrates drawer, swipe-back and pull-to-refresh; physics are fixed | `docs/design/coordination.md`; `src/capabilities/gesture-controller.ts`; `src/components/edge-swipe-gestures.tsx` |
| Back navigation | A priority chain handles Android back | `src/capabilities/back-chain.ts`; `src/hooks/use-back-handler.ts` |
| Transitions and animation | Compositor-promotion policy and settled transforms, found by experiment on a physical iPhone | `docs/design/performance-boost.md`; `docs/research/composited-transform-authoring.md`; `docs/decisions/animation.md` |
| Installed-PWA traps | Platform stamped before first paint; `app:`/`web:` style variants; WebKit caret and magnifier patches on by default | `docs/design/behaviors.md` §1, §2; `docs/decisions/register.md` §1.3 |
| Splash and launch | No double splash, no white flash, colour-driven native mask | `docs/design/behaviors.md` §3 |
| Layout shift | Treated as a named enemy; mitigations must hold in every case | `docs/VISION.md` §2.1 |
| Server boundary | Server functions are a build failure on every target; adaptv has no server side | `docs/design/server-boundary.md`; `docs/decisions/facade-and-opacity.md` |
| Offline and updates | Framework-owned service worker; no worker on Capacitor; signed OTA | `docs/design/rendering.md` §3, §3.5; `docs/design/ota.md` |
| Config | One `adaptv.config.ts` generates manifest, native projects, icons, theme | `docs/VISION.md` §2 (principle 5) |

Escape hatches exist: principle 8 says every default is overridable, and guardrails teach with a lint or
warning rather than rewrite code (principle 3). "Takes freedom away" means *the dangerous default is
closed*, not *you cannot leave*.

"Months of testing" is the board's statement. The repo backs the substance: a six-target test
discipline (`docs/design/behaviors.md`, `docs/guides/testing.md`) and device-only findings in
`docs/research/`. No calendar figure is in the repo `[TBD: awaiting real data]`.

## 4. Website claims

Short, true, fair. One per difference.

1. **One React codebase, and the web is the home target.** Source: `docs/VISION.md` §1. Contrast: React Native renders native views and treats web through react-native-web ([RN](https://reactnative.dev/docs/intro-react-native-components), [Expo web](https://docs.expo.dev/workflow/web/)).
2. **You write React and CSS, not a second language.** Flutter uses Dart ([architecture](https://docs.flutter.dev/resources/architectural-overview)); adaptv does not.
3. **Scroll, keyboard, safe areas and gestures are already decided.** Source: §3 rows above; `docs/design/behaviors.md`.
4. **Capacitor underneath, hidden from you.** The CLI generates and reverts the native config. Source: `docs/decisions/positioning.md` §2 "The consumer never touches Capacitor"; Capacitor is the shared runtime ([Capacitor](https://capacitorjs.com/docs)).
5. **The dangerous mistakes fail at build time.** Server functions that cannot run in an app are rejected by the build. Source: `docs/design/server-boundary.md`.
6. **Updates you host and sign yourself, built in.** Source: `docs/design/ota.md`. Fair note: Expo also supports signed OTA on EAS or on your own server that implements its protocol ([expo-updates](https://docs.expo.dev/versions/latest/sdk/updates/)); do not claim self-hosting as unique to adaptv.
7. **Your app is also a website.** Same code deploys to the web and installs as a PWA. Source: `README.md` ("What you get"). Fair note: Flutter web has SEO limits ([FAQ](https://docs.flutter.dev/platform-integration/web/faq)).

Lines to avoid: "Ionic can't do custom UI" (false); "feels exactly native" (the objection to beat is
in `positioning.md` §1, and a demo, not copy, beats it); any claim that a rival is unmaintained
(attacking projects is out of scope).

## 5. Open items

- Ionic's `/docs/components` page was not read (the platform-styles page was, on 2026-10-15).
- Capacitor OTA (the guide URL 404'd), Flutter OTA, and Flutter renderer details: `[TBD: awaiting real data]`.
- Ionic gesture/keyboard handling at the component level: `[TBD: awaiting real data]`; read `@ionic/core` source before claiming a gap. `docs/decisions/prior-art.md` documents what adaptv ported from it.
