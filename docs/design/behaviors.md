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
- **`AvoidKeyboard` looks twice.** Its aim picks a scrollTop on the focus frame, so content that lands
  above the field during the smooth scroll (suggestions, a validation message) left the field 76px under
  the box; when that scroll ends (`scrollend`, or the caret patch's 120ms quiet window where it is
  missing or the scroll never starts) it aims once more from fresh geometry, unless the user touched or
  wheeled, or focus moved.
  **Test:** `/lab/avoid-keyboard` → *Content arriving mid-scroll* → Run: the clearance must read >= 0.
- **…and the sheet answers the keyboard by GROWING, not by moving.** The drawer is effectively
  infinitely tall (`bottom: -excess` + a matching spacer) and only ever grows to what it needs, so
  a keyboard is not something to translate away from — it is a slice of the bottom that stops being
  usable. Who else shrinks the viewport differs per platform, and the engine MEASURES it rather
  than assuming: `useLayoutViewportShrink` reads what `innerHeight` gave up, and the room is
  `keyboard - shrink`. On iOS nothing else shrinks it — the OS webview resize is off
  (`KeyboardResize.None`; Android's plugin has no resize mode, so it is not asked there) and
  `useFreezeViewport` pins the layout viewport, deliberately — so the
  room is the whole keyboard. On the Android WebView Capacitor 8's `SystemBars` pads the WebView by
  the IME inset (measured on a Pixel 10 emulator: `innerHeight` 923 → 587 for a 336px keyboard,
  `--adaptv-inset-bottom` 24 → 0, `virtualKeyboard.overlaysContent` true throughout), so the shrink
  IS the keyboard, the room is 0 and the box only caps at the visible viewport; holding room there
  double-counted — a 336px blank band above the keyboard with the footer below the viewport, which
  is what the installed Android target showed before the measurement replaced the platform table.
  Three traps in that measurement, each seen on the emulator: the plugin's event and the WebView
  resize land in either order (event first on one raise, resize first on the next), so the shrink
  is read at render time, never held in effect state; `visualViewport.height` passes through 250
  while the IME animates with `innerHeight` already at 587, so the cap is the layout viewport, not
  the visual one; and the stylesheet cap is in viewport units, so it is re-read against the shrunk
  viewport (869 at rest, 533 shrunk) rather than cached from rest.
  So on a keyboard the content box holds `room` = the unpaid keyboard height BELOW its stack, and
  is allowed to grow into `max-h` by the same amount — the content that was visible stays visible,
  and where the cap refuses the growth the scroller absorbs it and the rest stays reachable by
  scrolling. Both
  properties animate on one curve, with the cap primed at the box's current height first so the
  growth starts where the sheet actually is (unprimed, the cap spends most of its travel in the
  slack above the content, where it changes nothing, and the raise reads as a snap: measured at
  202px in the first ~70ms of a 380ms motion, then a 280ms stall). Device trace of the raise:
  `top 264 → 125 → 72 → 65 → 62` with the box growing `610 → 812` and the room `0 → 336`.
- **Test:** a form drawer tall enough to hit the cap (playground → new task). Focus the field: the
  sheet must GROW upward as one decelerating motion — no snap, no shrink-then-settle — its actions
  must end up just above the keyboard (the playground keeps them in the scroll flow, so one swipe
  brings them there: iOS native measured Add task at 387–431pt and Cancel at 443–487pt against a
  keyboard top of 529pt), and there must be no empty band under the last field (Android native
  measured the last button at 622px in a 587px viewport before the shrink was subtracted, and the
  content box flush at 587 with 0px of room after).
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
  - The lab's anchoring scenario sets `scrollTop` by hand with nothing focused, so it says nothing
    about the BROWSER's scroll anchoring meeting adaptv's own keyboard scroll. That meeting is
    `playground/e2e/scroll-anchoring.spec.ts`, on both engines, and it matters because Safari 27
    turns anchoring on (WebKit 171840378) and the spec makes the focused editable a priority
    anchor, which is exactly the element adaptv scrolls. **Verdict (2026-09-13, Playwright WebKit
    625.1.21 on the Safari 27.0 line and Chromium 149, headless): no double adjustment.** Both
    engines anchor, including while adaptv's smooth scroll is travelling: 100px inserted above the
    focused field mid-scroll reads back synchronously as `scrollTop` +100 with the field unmoved.
    The smooth scroll's next frame then goes back to adaptv's ABSOLUTE target and overwrites that
    adjustment (chromium, drawer: `scrollTop` 5 → 10 and the field +95 on that frame). Every scroll
    write adaptv makes is absolute, so nothing adds a second adjustment, and the landing is the
    same with anchoring and with `overflow-anchor: none` forced on the scroller: the drawer at
    `scrollTop` 971 with its field 12px clear, AvoidKeyboard (keyboard raised 250ms after the
    focus) at 628 with 24px. At rest the insertion is anchored and stays anchored, and the focused
    row keeps its place to the pixel where the control moves it 100px. So `overflow-anchor: none`
    left set on a scroller adaptv drives is a regression, and the spec fails on it in every run;
    setting it only while adaptv scrolls and clearing it afterwards is NOT caught (0 of 4 runs),
    because the spec's at-rest insertion then runs with anchoring back on. What stays on a device:
    iOS momentum scrolling and a real keyboard's `visualViewport`. The WebKit fixes that matter
    here, "Anchoring adjustments stop momentum scrolls" (7bf2f19, 2026-02-11) and "Scroll anchoring
    in overflow scroll double-adjusts" (08e8584, 2026-02-13), landed before anchoring was flipped
    back on (3727113, 2026-03-27), per the platform-release research in #157; a fling is still
    worth one look on iOS 27, because desktop WebKit has no momentum to show it.
  - Found on the way, and not an anchoring effect: both surfaces aim from the geometry at the
    moment they scroll, and correct a change above the field only if they aim again afterwards.
    The drawer re-aims 420ms after the raise and AvoidKeyboard when the keyboard raise lands, which
    is why the spec's mid-scroll insertion lands clear. AvoidKeyboard now also takes one more look
    when each of its smooth scrolls ends (see *`AvoidKeyboard` looks twice* above), so a change during
    its last scroll is corrected too. The drawer still has the gap after its 420ms re-aim: a change
    after that is not corrected. Inserted at 450ms, it leaves the field `clearance
    -88` (`scrollTop` 871) on chromium with anchoring on or off, because its slower smooth scroll is
    still travelling and overwrites the adjustment; on webkit the scroll has already stopped, so
    anchoring keeps the field 12px clear (971), and only the control lands at -88. AvoidKeyboard
    with the keyboard already up (a field switch, which fires no keyboard event) used to land
    `clearance -76` on both engines, anchoring on or off; its look at the end of the scroll now
    lands it at its 24px buffer.
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
  native iOS. That distance is NOT the picker's height. The samples carry the box's raw inline
  geometry now, and they name it (headless Chromium, 390 × 844, the same run warm and cold):

  ```
  t    bottom  top  room  min  max  box  rectBottom
  56   844     25   0     819  819  819  844      floor primed on focus, picker already collapsed under it
  63   427     25   338   740  740  740  765      keyboard lands: room + floor + cap written in ONE step,
  71   431     29   338   740  740  740  769        panel FLIPped by the box delta (-79) and easing back
  130  472     70   338   740  740  740  810
  180  494     92   338   740  740  740  832      -> rest 506 / 104
  ```

  The distance past the rest is the floored box's net shrink: the floor primed at 819 on focus
  becomes `min(natural + room, cap)` = 740 when the keyboard lands, and the FLIP that carries that
  79px holds the TOP edge where it was, so the content edge, which also just took the room's 338px,
  starts 79px too high and rides the same transform back. In the plain raise the box grows by
  exactly the room, the two cancel, and both edges slide; whenever `Δbox ≠ Δroom` one transform
  can hold one edge only. The reaim path (a collapse with the room already held) has the same
  property by design, since every layout animation on that path measured 24–35fps. So the fix is
  a motion-model choice, recorded as D9 in the ledger: a second composited transform on the
  content stack (`Δroom − Δbox`, eased with the panel) is the recommendation, and it is not
  started here.
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
- **ExternalLink on web intercepts nothing.** Its `<a target="_blank" rel="noopener noreferrer">`
  opens the tab itself, so the browser guarantees no Referer and no opener. Only a native plain
  left-click is routed through `openExternal()`. A component has no caller to hand an outcome to, so
  intercepting on web would only add a script that has to get the Referer right.
- **Outcome:** `openExternal()` resolves `"opened"`, `"blocked"` (a popup blocker refused the tab),
  `"invalid"` (the URL does not parse — `window.open` would throw a `SyntaxError` — or its scheme is
  `javascript:`, `data:`, `blob:`, `about:` or `file:`, which would run in or replace the app) or
  `"unsupported"` (no window, i.e. the server). It never rejects.
- **Schemes:** only `http:`/`https:` open a browser. `mailto:`, `tel:` and app schemes are assigned to
  `location`: both native shells cancel that navigation and hand the URL to the OS
  (`WebViewDelegationHandler` on iOS, `Bridge.launchIntent` on Android) and a browser launches the
  handler without leaving the page. `"opened"` there means handed over. The in-app browser takes only
  http(s) (`SFSafariViewController`), and the old fall-through to `window.open` in a WebView read
  `"blocked"`, which was false. A native build missing that plugin hands an http(s) URL over through
  `location` the same way, never through a tab: iOS would give the OS the tab's `about:blank`, and
  Android's WebView has no second window. A protocol-relative `//host` resolves against the page, or takes
  `https:` when the page is on `capacitor://`.
- **The web tab, and why it is opened blank:** `window.open(url, "_blank")` sends the app's Referer,
  and under a `Referrer-Policy: unsafe-url` that is the full URL, query included. The `noopener` and
  `noreferrer` features would stop it, but either makes `window.open` return `null` even on success,
  the value a blocker returns. So the tab is opened at `about:blank` with no features, its `opener`
  is nulled, and an `<a rel="noreferrer">` clicked inside its own document carries it to the URL.
  The blank document is what keeps the Referer off: the navigation is its own, and an `about:blank`
  URL is never sent (removing the `rel` leaves the tests green; assigning `tab.location` from the
  app's script sends the full URL on both engines).
  Measured 2026-09-13 with the page served `unsafe-url` and a `?secret=` query:

  | | Referer on the request | `document.referrer` | a real blocker reads |
  |---|---|---|---|
  | `window.open(url)`, Chromium 149 | full URL | full URL | `blocked` |
  | `window.open(url)`, WebKit 26.5 | full URL | origin | no blocker to test |
  | blank tab + anchor, Chromium 149 | none | `""` | `blocked` |
  | blank tab + anchor, WebKit 26.5 | none | `""` | no blocker to test |

  One cost: WebKit keeps the `about:blank` entry, so the new tab's back button returns to a blank page
  (`history.length` 2 at the destination; Chromium replaces it, 1). A meta refresh inside the blank
  document avoids that on both engines, but a browser can be set to ignore refreshes and the tab would
  then sit blank while reporting `"opened"`; `location.replace` from the app's script sends the app's
  Referer on Chromium.
- **Test:** a `<Link to="https://…">` opens the in-app system browser on native (6), a new tab on web.
  `playground/e2e/browser.spec.ts` pins, on Chromium and WebKit with the page served `unsafe-url`:
  `opened` with no opener and no Referer from both the accessor and `ExternalLink`, `invalid` for an
  unparseable URL, `mailto:` opening no tab and leaving the page, and a `window.open` that returns
  `null` reading `blocked`. On full Chromium with its popup blocker on (Playwright's default headless
  shell has none) a real click opens the tab and a call after the user activation expired reads
  `blocked`.

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

### 12. Primitives — `View` / `List` / `Text` / `Image` / `ScrollView` / `Skeleton` / `Fab` / `Divider` / `Icon`
- **How:** `src/components/view.tsx` (row/center/fill/safe layout, identical everywhere),
  `src/components/list.tsx` (virtualized long lists), `src/components/scroll-view.tsx`,
  `src/components/text.tsx`, `src/components/image.tsx`, `src/components/skeleton.tsx` (the
  placeholder box: reduced-motion and forced-colors answered in `src/styles/skeleton.css`,
  assistive technology told once per `Skeleton.Region`), `src/components/fab.tsx` (a `Button`
  fixed to a screen corner: above the safe edges through `--adaptv-inset-*`, lifted by the live
  `--adaptv-keyboard-height` because the §4 frozen viewport leaves a fixed bottom control under
  the keyboard otherwise, and a `hidden` slide that honours reduced motion), `src/components/divider.tsx` (a 1px
  border scaled by `1 / floor(dpr)` to one device pixel at every density — a sub-pixel border width is
  rounded up by Chromium and floored to nothing by WebKit at 3x — and never a background, so it
  survives forced colours), `src/components/icon.tsx` (any icon
  set's `<svg>`: `aria-hidden` when decorative, `role="img"` + `aria-label` when labelled, a `1em`
  box, and the same Dynamic Type multiply as `Text` behind `scaleWithSystem`).
- **Test:** `View` lays out identically on 1–6; `List` scrolls a long dataset smoothly on device;
  `Skeleton` stops pulsing with Reduce Motion on, on 1–6, with no frame of motion first.
  `Fab`: on native (6) it clears the home indicator, and focusing a field lifts it above the
  keyboard on the keyboard's own curve (`/lab/fab` on a device; `playground/e2e/fab.spec.ts` drives
  the same path headless through the keyboard mock seam).
  on iOS (2, 4, 6) VoiceOver skips a decorative `Icon` and reads a labelled one as an image by name, and
  a `scaleWithSystem` icon grows with Larger Text after a reload.
- **`Select` (2026-09-02):** `src/components/select.tsx`. iOS renders `<select>` as a wheel, never a
  menu, and focusing it scrolls the page and raises the Done bar — so `Select` paints its own trigger
  and an anchored listbox on every target, keeps a real `<select>` mounted, hidden and never focused
  only so `name` / `required` / autofill and form submission keep working, closes on hardware and
  gesture back instead of navigating (Transient band, the rule `Dropdown` records), rides the
  `Dropdown` positioning engine, owns its keyboard model (arrows skip disabled options, Home/End,
  Enter/Space, Escape refocuses, typeahead), and gives options the press-core `touch-action`
  longhand ([`../decisions/register.md`](../decisions/register.md) B13).
- **`FieldGroup` (2026-09-02):** `src/components/field-group.tsx`, the grouped-settings form
  (`ion-list inset`, the iOS Settings pattern). A `Section` labels itself (`aria-labelledby` to its
  own `data-part="header"`) and keeps its rows as the only children of one `data-part="rows"`
  container, with `Header` / `Footer` slots that beat the `title` / `footer` shorthand. A `Row`
  carries `data-disabled` and `aria-disabled` together and takes an element-only `render` like
  `Text` ([`../decisions/styling.md §3.3`](../decisions/styling.md)), so `render={<label />}` makes
  the row its control's label and `render={<Link />}` makes it a navigation row. What it locks is
  structure only — `flex` on the row, `flex flex-col` on its label column — while alignment
  (`items-center justify-between`) is a default and every colour, radius, padding and gap is the
  consumer's `className` (styling §5.4). What it refuses is a `data-position` attribute:
  rows are siblings, so `first:` / `last:` / `only:` already spell the grouped corners (styling
  §5.4.1), and `getFieldItemPosition(index, total)` is exported for rows that are not DOM siblings,
  a virtualised list being the case.
- ⚠︎ **This entry was written when the surface was two components and is a floor, not a census.**
  The public surface is 36 barrels (`Collapsible`, `Slider`, `Select`, `FieldGroup`, `Skeleton`, `Fab`, `Divider`, `Icon` and `Spinner` landed together on 2026-09-02, `RadioGroup` after) — `src/interface/components.index.ts` is the list, and
  `src/components/barrels.test.ts` is what keeps it in lockstep with `src/components/` itself.
  That test exists because **the drift which hid `Text` from consumers passed typecheck, lint, the
  unit suite and `build:check`**: a missing re-export is invisible to every gate that does not
  compare the barrel to the directory. `Image` has its own design doc
  ([`image.md`](image.md)); the component sub-packages (`drawer/`, `dropdown/`, `avoid-keyboard/`)
  are a recorded documentation gap. `Collapsible` (2026-09-02) is the newest: a measured-height
  transition that rests at `auto`, and `hidden="until-found"` written after hydration because React
  drops the value.
- `Slider` (2026-09-02) paints its own track because iOS ignores a touch that starts on a native
  range track, and yields to a vertical scroll through the gesture arbiter. A touch that lifts
  where it landed sets the value on the lift: the press cannot, because the finger may be about to
  scroll, and both simulators showed a tap doing nothing until the lift became the set.

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
