# adaptv — behaviors it fixes (and how to test them)

The cross-platform bugs adaptv already solves, **how** each is done (where in the code), and **how you
verify** it's working. Pairs with [`docs/guides/testing.md`](../guides/testing.md) (the six-target discipline) and
[`docs/research/capacitor-internals.md`](../research/capacitor-internals.md) (deep native details + version pins).

## The six targets

adaptv ships one codebase to six runtimes; the hard bugs live where they diverge.

| # | Target | What it is |
|---|--------|-----------|
| 1 | Desktop browser | Chrome/Safari on the Mac |
| 2 | Mobile browser — iOS | Safari in the iOS Simulator |
| 3 | Mobile browser — Android | Chrome in the emulator |
| 4 | Standalone PWA — iOS | Add-to-Home-Screen in the sim |
| 5 | Standalone PWA — Android | Add-to-Home-Screen / Install in the emulator |
| 6 | Native — iOS + Android | Capacitor WebView (`.ipa` / `.apk`) |

Rule of thumb: `app:` styles apply to **installed** (standalone **or** native); `web:` to a **browser tab**.

---

## Behavior catalogue

### 1. "Installed app?" is answered correctly everywhere
- **Problem:** a Capacitor WebView reports `display-mode: browser`, so any `display-mode: standalone`
  check silently takes the *web* branch on native (wrong safe-area, history, splash).
- **How:** `src/utils/platform.ts` — `isNativePlatform` / `isInstalledApp` / `getOS` off the Capacitor
  global (no import → web builds need nothing). A pre-paint script stamps
  `html[data-adaptv-platform="native|standalone|web"]` + `data-adaptv-os` before first frame.
- **Test:** on native (6), `document.documentElement.dataset.adaptvPlatform === "native"`. Safe-area /
  splash / memory-history branches all resolve to the installed path.

### 2. `app:` / `web:` style variants
- **Problem:** `@media (display-mode: …)` can't tell a native WebView from a browser tab.
- **How:** `src/styles/utils.css` — `app:` = standalone media query **OR** `data-adaptv-platform=native`;
  `web:` = `data-adaptv-platform=web` only (attribute-scoped, so native is excluded).
- **Test:** an element with `web:hidden app:block` is hidden in a tab (1–3), shown when installed (4–6).

### 3. Splash — installed-only, colour-driven, theme-aware, no double
- **Problem:** double-splash (OS splash + React splash showing the mascot twice), a splash that ignores
  the app's dark/light preference, a browser tab flashing a splash, Android 12 forcing a launcher icon.
- **How:**
  - Policy: React splash renders only when **installed**; a browser tab gets no splash unless
    `splashScreenInBrowser`. Gated by the critical-CSS splash gate keyed on the platform stamp.
  - The React splash **self-unmounts** (returns `null` when ready) — `RoutingShell` just mounts it.
  - **Its clock starts at the handoff, not at mount** (`SplashScreenProps.revealedAt`). The splash is
    painted *underneath* the OS splash on purpose, so a "stay up at least 1s" rule timed from mount
    spends that second behind the OS splash and flashes the brand for what is left — measured at 282ms
    on an emulator and ~430ms on a Pixel. `useSplashHandoff` waits for a painted frame, hides the OS
    splash, waits out its 200ms fade, and only then hands the splash a timestamp. CSS animations inside
    `[data-adaptv-splash]` are held at frame one until `<html data-adaptv-splash-revealed>` is stamped,
    so an intro animation cannot play to nobody either. → `docs/decisions/register.md` B32.
  - **…except on a not-found, where `RoutingShell` retires it.** A not-found boundary (root, since
    `notFoundMode: "root"`) short-circuits the outlet, so no layout route mounts and the app's ready
    signal — which lives in one — can never fire. adaptv mounts the splash, so adaptv takes it down; the
    decision is latched, so navigating back out of a 404 doesn't replay it. → `docs/decisions/register.md` B28.
  - Native mask is **colour-driven**, not an image: Android launch theme + `colors.xml` /
    `colors-night.xml`; iOS `AdaptvSplash` colour asset + a solid launch storyboard. Mascot lives *only*
    in the React splash → appears once.
  - `splashMaskMode`: `preferences` (follows `useTheme`) / `system` / `light` / `dark`. For
    `preferences`, the CLI writes a per-app night override (Android `UiModeManager` in a adaptv-owned
    `MainActivity`; iOS `AppDelegate.overrideUserInterfaceStyle`) so the splash tracks the app theme, not
    the device — on the **next** launch (1-launch, no "open twice").
  - Android-12 system splash: transparent `windowSplashScreenAnimatedIcon` → flat colour, no icon.
  - Code: `bin/lib/native.mjs` (`patchAndroidSplash` / `patchIosTheme` / `resolveSplashMask`; the
    first two are re-exported through `bin/lib/icons.mjs`),
    `src/capabilities/splash.ts`, `src/capabilities/native-theme.ts`, `src/shell/critical-css.ts`.
- **Test:** cold-start installed (4–6): solid mask colour → React splash fades the mascot in on the same
  colour → app (mascot once). Toggle the app to dark on a light device → the mask is dark next launch,
  and vice-versa. Browser tab (1–3): page loads instantly, no splash. (iOS storyboard's *first* pre-app
  frame follows the device for adaptive masks — a single-frame OS limit; a fixed mask has no such frame.)
  Cold-start installed straight into a URL that does not exist: the 404 is up and **tappable**, with no
  `[data-adaptv-splash]` left in the DOM (query the count, not visibility — on web a leftover splash is
  `display: none` and still covering).

### 4. Keyboard avoidance + hybrid drawer (the autofocus race)
- **Problem:** opening a drawer with an `autoFocus` field — the async `Keyboard.addListener` lost the
  race against the field's immediate `keyboardWillShow`, so the sheet stayed stuck behind the keyboard.
- **How:** `src/capabilities/keyboard.ts` — `initNativeKeyboard()` attaches the OS listeners **eagerly at
  app start** (in the shell), and `subscribeNativeKeyboard` delivers the current state synchronously.
  `useKeyboard` skips the whole `visualViewport` heuristic on native and uses the exact OS height.
- **Test:** native (6, or the iOS sim with the software keyboard on / Android emulator with
  `hw.keyboard=no`): open a drawer whose input is `autoFocus` — the whole sheet lifts above the keyboard
  immediately, no double-shift, dismisses on scroll. Retest the web `visualViewport` path (2/4) after any
  keyboard change.
- **…and the sheet answers the keyboard by GROWING, not by moving.** The drawer is effectively
  infinitely tall (`bottom: -excess` + a matching spacer) and only ever grows to what it needs, so
  a keyboard is not something to translate away from — it is a slice of the bottom that stops being
  usable. Nothing else shrinks the viewport for us either: the OS webview resize is off
  (`KeyboardResize.None`) and `useFreezeViewport` pins the layout viewport, deliberately. So on a
  keyboard the content box holds `room` = the keyboard's height BELOW its stack, and is allowed to
  grow into `max-h` by the same amount — the content that was visible stays visible, and where the
  cap refuses the growth the scroller absorbs it and the rest stays reachable by scrolling. Both
  properties animate on one curve, with the cap primed at the box's current height first so the
  growth starts where the sheet actually is (unprimed, the cap spends most of its travel in the
  slack above the content, where it changes nothing, and the raise reads as a snap: measured at
  202px in the first ~70ms of a 380ms motion, then a 280ms stall). Device trace of the raise:
  `top 264 → 125 → 72 → 65 → 62` with the box growing `610 → 812` and the room `0 → 336`.
- **Test:** a form drawer tall enough to hit the cap (playground → new task). Focus the field: the
  sheet must GROW upward as one decelerating motion — no snap, no shrink-then-settle — its actions
  must end up just above the keyboard, and there must be no empty band under the last field.
  Dismiss the keyboard: it gives the room back on one ease. Close it with the keyboard still up: no
  re-aim mid-slide.

- **How you actually test any of this:** `/lab/drawer-keyboard` in the playground. A real software
  keyboard cannot be scripted — no simulator raises one for an automated run, and no web API lets a
  page synthesise `visualViewport` geometry — so the page drives adaptv's keyboard observer through
  its test seam (`window.__adaptvKeyboardMock` + an `adaptv:keyboard-mock` event; while set,
  `useKeyboard` reports the mock and nothing else) and paints a solid block of the same height over
  the bottom. From the sheet's point of view that IS the keyboard. It self-runs 600ms after the
  drawer opens — the trigger cannot live on the page, because once the sheet is up the page is
  behind its backdrop and every tap dismisses it — and prints the verdict in an overlay above the
  panel, so ONE screenshot is the whole report on any target. Automation can read
  `window.__drawerConformance` instead.
  - 14 scenarios / ~75 assertions: raise · grow · shrink · dismiss · content growing and shrinking
    under a live keyboard · re-aim mid-raise · dismiss mid-raise · growth past the cap · return from
    the cap · a 70%-of-screen keyboard · picker collapsing mid-raise (keyboard first) · picker
    collapsing with the keyboard LAGGING a few frames (`?only=lag`) · scroll anchoring. Each asserts:
    never above the safe top · content clears the keyboard · settles flush · no edge reverses (waived
    where a step deliberately changes its mind) · eased-not-snapped (90% of travel must take >=120ms).
  - Keyboard heights are a FRACTION of the viewport, never px: a fixed `320` is ~40% of a phone held
    upright and ~90% of it on its side.
  - Two traps worth knowing. Scroll anchoring is measured MID-scroll, because pinned at the bottom
    the content genuinely must slide to fill the space the keyboard gave back — `UIScrollView` does
    the same, and demanding otherwise invents a rule iOS does not have. And a browser pane that is
    open but not on screen reports `document.hidden`, which freezes rAF *and* the animation
    timeline: the run reports `document hidden` when that happens, because the numbers are then
    meaningless.
- **Test (iOS, target 2):** `xcrun simctl openurl booted "http://localhost:<port>/lab/drawer-keyboard"`,
  tap *Open drawer*, screenshot. **(Android, target 3):** `adb reverse tcp:<port> tcp:<port>` then
  `adb shell am start -a android.intent.action.VIEW -d "http://localhost:<port>/lab/drawer-keyboard"`.
  Green on both. **Run on the installed targets (2026-09-02, the page is now in the Testing index so
  every target can reach it by tap):**
  - **iOS Safari, target 2, same day, as the control:** `FAIL 2/104`, both frame-rate only (`picker
    collapses mid-raise` 56fps 3 dropped; `picker collapses, keyboard lags` 38fps worst 187ms); every
    geometry check green.
  - **Standalone PWA on iOS, target 4 (Add-to-Home-Screen, two cold launches from the icon):**
    `FAIL 1/107` — the one failure is `picker collapses, keyboard lags: content edge never reverses —
    812 → 487`; every other check green at 58–62fps, including that scenario's frame rate.
  - **Native iOS, target 6 (probe app, iOS 26 simulator):** `FAIL 2/107` — both in ONE scenario,
    `picker collapses, keyboard lags`: `content edge never reverses — 874 → 524` and 39fps with a
    172ms worst frame. Every other scenario green at 56–60fps.
  - **Native Android, target 6 (probe app, Pixel 10 emulator, API 36):** three full runs, `FAIL 7/108`
    to `9/108`; the frame-rate checks come and go with the emulator (42–55fps, worst 34–92ms), and
    the SAME geometry check fails on every run: `picker collapses, keyboard lags: content edge never
    reverses — 923 → 554`. Programmatic focus does not raise the emulator's IME (`mInputShown=false`,
    `innerHeight` 923 throughout), so the reversal is the sheet's own motion, not a second keyboard.
  - **Standalone PWA on Android, target 5 (Pixel 10 emulator, Chrome 149):** reached, and not a
    measurement of the sheet. `adb reverse tcp:41800 tcp:41800` makes the preview `localhost` on the
    device, so Chrome sees a secure context, a controlling service worker and `manifest.json`, offers
    the "Install app" dialog, and launches the icon as `WebappActivity` with
    `(display-mode: standalone)` true on `index-nm-k7Jpk.js`. The run there reports `FAIL 7/91`, and
    every step sampled three frames in 700ms (the lag step: `226 → 845, 428 → 394, 897 → 394`):
    Chrome on this emulator paints at 3–20fps in the standalone window AND in the ordinary tab
    (`FAIL 11/95`, 7–20fps), while the WebView probe on the same emulator sampled 35–43 frames per
    step the same hour. The failures are the sampler reading motion still in flight, so the
    harness now stamps such a run `starved — Nfps median, checks unreliable` in its header, the
    way it stamps a hidden document. What target 5 owes is a device, or an emulator whose Chrome
    has a GPU process; the WebView result stands for the engine.
  So the one thing the installed targets add is a **content-edge reversal** in the scenario where
  the picker collapses first and the keyboard lands 48ms later: the content bottom turns around
  once between its start (the screen bottom) and its rest above the keyboard. It was first read as
  installed-only, because the browser tab on the same simulator passed geometry the same day; the
  e2e spec that followed (`playground/e2e/drawer-keyboard.spec.ts`) shows it on headless Chromium
  and on Playwright's WebKit at a 390 × 844 viewport too, so the variable is the viewport the
  scenario runs in, not the shell. The harness now names the turn on the overlay and carries the
  sample series on every `StepResult`, and the series says what the turn is: an **overshoot**.
  The content edge sits at the screen bottom while the picker collapses, then moves in ONE frame
  to a point past its rest, and eases back to the rest over the next ~300ms:

  ```
  Android native, /lab/drawer-keyboard?autorun, content bottom (t ms → px), rest 554
  18 → 923   50 → 923   89 → 472   105 → 472   117 → 481   183 → 518   231 → 545   316 → 551   397 → 554
  overlay: content edge never reverses — 923 → 554, turned 37px at 183ms (481 → 518)
  headless Chromium 390 × 844, rest 506: 844 → 506, turned 8px at 129ms (463 → 471)
  native iOS (probe .app, index-DRcMfQ2I.js), rest 524: 874 → 524, turned 6px at 248ms (503 → 509)
  standalone PWA on iOS (two cold launches from the icon), rest 487: 812 → 487, turned 21px at 261ms (411 → 432)
  ```

  The jump lands 82px past the rest on Android, 76px on the PWA, 43px on Chromium and 21px on
  native iOS, which is the height the collapsing picker gives back: the rows leave the layout in the same frame the keyboard room
  arrives, so the sheet is measured short and then re-grows to the height its motion is
  still easing toward. That names the fix without prescribing it (the drawer's settle and curve
  are not the variable, the order of the two geometry changes is) and it stays open here.
  Until it lands, the spec allows exactly that one failure by step and check name and fails on
  any other geometry failure, and on the day the turn disappears. Landscape is unreachable while the playground is portrait-locked by `orientation: "portrait"`,
  but orientation is not the variable that matters (keyboard-vs-reserve is), and the 70% scenario
  covers it.

- **Two geometry changes at once — content collapsing WHILE the keyboard raises.** Focusing a field
  that also closes an expanded picker shrinks the content and grows the room in the same instant.
  Handled, and the shape of the fix is the interesting part:
  - **A `max-height` cannot animate a shrink.** Once the content is shorter than the box, the
    *content* is the binding constraint and the cap is not touching anything — easing it animates
    nothing. Shrinks are eased by a `min-height` FLOOR pinned at the height the box had one
    observation ago (a ResizeObserver callback runs after layout but before paint, so the collapsed
    frame is never drawn) and then eased down. Growth keeps using the ceiling. The floor is eased
    out, never dropped: releasing it outright lets the box fall a whole room in one frame.
  - **The floor is only as good as the height it is measured against.** `natural` must be SUMMED
    from the box's children (stable siblings + the scroller's `scrollHeight`), not derived as
    `box - room + hidden`: the derived form mixes terms that update on different frames, so it dips
    for exactly one observation at the uncapped→capped boundary and reports a shrink that never
    happened. That single frame of fiction broke three unrelated scenarios the first time the floor
    was attempted, and it was invisible until the floor amplified it. → the two failed attempts are
    in git history; do not re-derive them.
  - **Verified by pixels, not by the assertion.** `?only=picker` isolates the scenario; a slit-scan
    (`fps=30,crop=6:H:x:0,tile=Nx1` over the 6px marker on the sheet's top edge) turns the motion
    into one readable curve. Before: a ~330px two-frame step. After: a graded descent, worst frame
    ~60px. The jump-ratio assertion scored the broken version as passing — trust the frames.
  - **The other ordering: picker first, keyboard LAGGING.** The scenario above raises the keyboard
    and THEN collapses the picker, so room is already held and `reaimKeyboardRoom` floors the
    collapse. The flicker in the wild is the reverse: the keyboard is DOWN and the picker EXPANDED,
    the user taps a text input, the picker collapses on the focus frame and the keyboard's height
    only lands a frame or two later (on native there is no predictive seed to coalesce them). With
    no room held yet, `reaimKeyboardRoom` early-returns at room 0 — so the collapse shrinks the box
    raw and the sheet's top DROPS, then snaps back UP when the keyboard grows it. The fix pins the
    floor EARLIER, on `focusin` (`primeKeyboardFloor`, gated by `shouldPrimeKeyboardFloor`): the
    picker collapses UNDER the floor and the keyboard-room effect's `heldFloor` path eases it to the
    final height in one motion. A focus that raises no keyboard (hardware keyboard, programmatic
    focus, readonly) retracts the floor after `DRAWER_KEYBOARD_FLOOR_CONFIRM_MS`, mirroring
    `use-keyboard`'s prediction retract. Isolate + slit-scan with `?only=lag`: before the fix a dip
    then a climb, after it a single descent.

### 5. Edge-to-edge + status bar
- **Problem:** content should draw under the status bar with safe-area padding; native only.
- **How:** always edge-to-edge (opinionated) — `StatusBar.overlaysWebView: true` in the generated
  Capacitor config; the shell's safe-area utilities pad it back. `useStatusBar` drives style/background
  from the theme on native (no-op on web).
- **Test:** native (6): content under the status bar, tint matches theme, header clears the inset.

### 6. Safe-area rendering
- **Problem (Android):** `env(safe-area-inset-top)` is `0` on an installed Android PWA, so a
  `max(2rem, …)` floor forced a fade band over the header. **Also:** safe-area padding utilities lost
  tailwind-merge conflict resolution.
- **How:** `src/components/scroll-view.tsx` — the top fade band tracks the inset (`+0.5rem`), so it's a
  soft ~8px edge on Android and unchanged on iOS. `src/utils/cn.ts` registers `p-safe`/`pb-safe`/… into
  tailwind-merge's padding groups so `View safe="bottom"` beats a stray `pb-0`.
- **Test:** installed Android (5/6): the top fade sits under the status-bar strip, never over the title.
  `<View safe="bottom" className="pb-0">` keeps the safe padding. *(Shipped to chopchop in PR #91.)*

### 7. Haptics — two surfaces, because iOS web forces it
- **How:** *imperative* — `src/capabilities/haptics.ts`: native engine (`@capacitor/haptics`) on
  Capacitor, `navigator.vibrate` on Android/Chrome web. **A documented no-op on iOS web.**
  *Declarative* — `src/capabilities/haptic-tick.ts` + `useHapticTick`: mounts an invisible, full-size
  `<input type="checkbox" switch>` on a tap target so the user's **real finger** fires the system tick.
  `Button haptic={…}` routes through both, so it works on all six targets; `useVibrate` gives the
  semantic aliases over the imperative API.
- **Why two:** iOS Safari has no `navigator.vibrate` and never will (WebKit's standards position on the
  Vibration API is formally `oppose`). Its one route to the Taptic Engine is the switch tick — and
  **Apple patched programmatic `.click()` in iOS 26.5**, so it now requires an actual touch. You cannot
  synthesise a finger, so no imperative call can reach it. The mechanism is inherently declarative.
  → `docs/decisions/register.md` B10.
- **Limits on iOS web:** system tick only — no weights, no notification patterns, no intensity.
  Requires System Haptics enabled (undetectable). Costs one DOM node per tap target.
- **Test:** tap a `haptic` button — a tactile tick on device. **Physical hardware only**; simulators
  produce no haptics, and the iOS-web path specifically needs iOS ≥ 26.5 to be a meaningful test.

### 8. External links
- **How:** `src/components/link.tsx` routes `isExternalUrl(to)` to `ExternalLink` → system browser
  (`@capacitor/browser`) on native, a new tab on web. Internal routes keep the gesture/smart-back path.
- **Test:** a `<Link to="https://…">` opens the in-app system browser on native (6), a new tab on web.

### 9. Network status
- **How:** `src/capabilities/network.ts` — `@capacitor/network` (accurate) on native, `navigator.onLine`
  + online/offline events on web. `useIsOffline` reads it via `useSyncExternalStore`.
- **Test:** airplane-mode toggles the value; native reflects real reachability, web the coarse signal.

### 10. Memory history when installed
- **Problem:** the OS edge-swipe-back / hardware-back needs a browser-history entry to navigate; when
  installed there is none, so it must be inert and the app owns back.
- **How:** `src/shell/standalone-history.ts` — `standaloneMemoryHistory()` returns in-memory history when
  `isInstalledApp()` (standalone **or** native), else `undefined` (browser keeps its history).
- **Test:** installed (4–6): edge-swipe/hardware-back doesn't escape the app; in-app nav is app-controlled.
  Android hardware back navigates and exits at the root.

### 11. Web manifest — install & launch chrome
- **How:** `src/vite/manifest.ts` — `theme_color` matches the light background (no dark strip on a light
  launch splash); `android-maskable-*` icons emit `purpose: "maskable"` so the adaptive icon + generated
  splash have no white matte box.
- **Test:** install on Android (5): home-screen icon fills its shape (no white box), the launch chrome
  isn't a dark strip. *(Shipped to chopchop in PR #91.)*

### 12. Primitives — `View` / `List` / `Text` / `Image` / `ScrollView`
- **How:** `src/components/view.tsx` (row/center/fill/safe layout, identical everywhere),
  `src/components/list.tsx` (virtualized long lists), `src/components/scroll-view.tsx`,
  `src/components/text.tsx`, `src/components/image.tsx`.
- **Test:** `View` lays out identically on 1–6; `List` scrolls a long dataset smoothly on device.
- ⚠︎ **This entry was written when the surface was two components and is a floor, not a census.**
  The public surface is 26 barrels — `src/interface/components.index.ts` is the list, and
  `src/components/barrels.test.ts` is what keeps it in lockstep with `src/components/` itself.
  That test exists because **the drift which hid `Text` from consumers passed typecheck, lint, the
  unit suite and `build:check`**: a missing re-export is invisible to every gate that does not
  compare the barrel to the directory. `Image` has its own design doc
  ([`image.md`](image.md)); the component sub-packages (`drawer/`, `dropdown/`, `avoid-keyboard/`)
  are a recorded documentation gap.

---

## Status of this doc's items

All of §1–12 are **transported and green** — verified on both simulators during the chopchop session,
and the seed passed the full gate at the time (`typecheck` 0, `test` 180/180, `biome` 0).
*(That count is a snapshot of the chopchop session, kept for its provenance. The suite is
**2542 tests / 164 files** as of 2026-08-30 — see [`../guides/testing.md`](../guides/testing.md)
for the current gate.)* What's *not* yet built is tracked in
[`../roadmap/README.md`](../roadmap/README.md), which is the single not-done list.

## Automated gate

```bash
pnpm typecheck && pnpm biome:check && pnpm test
```
