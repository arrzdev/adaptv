# adaptv — owed device verification

> Seven checks that **no unit test can close**, each cheap on its own and each blocked on hardware or
> an installed build. Assembled 2026-08-30 from `HANDOFF.md §4.1` (before that file was deleted),
> `design/behaviors.md`, and `research/capability-surface.md`. Row 3 narrowed 2026-09-02: the
> `keep-awake` WebView check closed on Android and shrank to a physical-iPhone need on iOS. Row 5
> narrowed 2026-09-13: the Safari tab closed on iOS 18.0 and 26.1, and the installed PWA and native
> surfaces were measured and do not follow the rule.
>
> These are not bugs. They are claims the suite structurally cannot reach: 2542 tests over happy-dom
> prove structure and lifecycle, which is all a DOM can prove.

---

| # | What | Why a test cannot settle it | Needs |
|---|---|---|---|
| 1 | **iOS-web haptics** (`src/capabilities/haptic-tick.ts`) | The 13 tests pin structure and lifecycle. Whether the tick *actually fires* is a physical-transducer question — **simulators produce no haptics at all**. | A physical iPhone on iOS ≥ 26.5 |
| 2 | **`clickable`'s `pointercancel` behaviour** (register **B13**) | Every engine **except the broken one** treats the shorthand and the longhand identically, so a passing test proves nothing. Only a real iOS device shows the difference. | A physical iPhone |
| 3 | **`keep-awake`'s lit screen in the WKWebView** (`src/capabilities/keep-awake.ts`) | The simulator proves the disabler is taken, not the pixels. On an iPhone 17 Pro simulator (iOS 26.1) the app's own UI process logs `ScreenSleepDisabler::updateState() shouldKeepScreenAwake=1` at the request and `=0` at the release — the identical line MobileSafari logs for the same page — but the simulator has no Auto-Lock (no Display & Brightness row) and never idle-locks, so the screen staying lit is unobservable there. Android is **closed** (2026-09-02, Pixel 10 emulator API 36, WebView Chrome/149.0.7827.5): `dumpsys power` shows the `SCREEN_BRIGHT_WAKE_LOCK` row while held and none after release; at a 15 s `screen_off_timeout` the display is `Asleep` 25 s after a release and `Awake` 25 s after a request. | A physical iPhone |
| 4 | **Gesture-controller priority *numbers*** | The arbitration *logic* is proven (`src/capabilities/gesture-controller.ts` + tests). The ordering is a feel judgement on a real screen carrying a drawer, a swipeable row and a scroller **at once**. | Any device, but a real screen and a real finger |
| 5 | **`theme-color` / status-bar tint on iOS 26** (register **B17**, **B33**) | iOS 26 derives the tint from the **rendered page edge** rather than the meta tag, so it is only observable in rendered pixels. iOS 18 does the exact opposite, so both floors need checking. The **Safari tab is closed** (2026-09-13, iPhone 16 simulator on iOS 18.0 `22A3351` and iPhone 17 simulator on iOS 26.1 `23B86`, light and dark, `/lab` and `/lab/route-tint`, full-resolution screenshots sampled at fixed columns): B17's rule holds. On 18.0 the meta tag drives the top bar — a meta-only `#e60000` reached it while the page stayed `#eeeeec` — and on 26.1 the painted edge drives both bands, with the same meta-only write moving nothing. The one Safari failure is B33's first-frame claim, which does not hold on 26.1 (see B33). The **installed PWA and native iOS surfaces disprove the lab page's rule** that both bands take the route's colour: the PWA on 18.0 shows the tint at the bottom only; the PWA on 26.1 at the top only; native on 18.0 and 26.1 keeps the page's own pixels in the top band and shows the tint only as a gradient at the bottom edge. Still owed there: the meta-only write in the iOS 26 PWA; a cold launch straight onto a route (the PWA and the native app always start at `/`, so their route cells were reached by in-app navigation); a production build, since every timing came from the dev server; and the app's own Dark mode switch, which could not be reached, so dark was set through the OS appearance. | iOS 26 **and** iOS 18 simulators, for the PWA and native cells |
| 6 | ~~**The two installed (PWA) targets for the drawer/keyboard work**~~ (run 2026-09-02 across iOS PWA, native iOS, native Android and — since PR #95 — the Android standalone PWA; see `design/behaviors.md` §keyboard) | `design/behaviors.md` recorded green on targets 2 and 3 only. The content-edge reversal the run found was **not** installed-only, which PR #111 established on both engines at a phone viewport, and the sample series it owed is carried now (PR #96 adds the box's raw per-frame geometry). What is left is narrower than the row: the Android standalone PWA was reached, but Chrome on that emulator paints at 3–20 fps, so its verdict measures the sampler rather than the sheet. | A real Android device, or an emulator whose Chrome has a GPU process |
| 7 | **System-bar treatment on a physical API-36 device** (register **B9**) | The project's `targetSdkVersion` and the injected `--safe-area-inset-*` were read off an Android 17 emulator on 2026-09-02 (the numbers are in B9). What an emulator cannot show is the real panel: cutout, gesture-nav bar and status-bar icon contrast on glass, where edge-to-edge is enforced with no opt-out. | A physical phone on Android 16 or later |

---

## Three traps recorded with these

All three have cost time before and will again.

- **The simulator's hardware keyboard hides keyboard bugs.** "Only reproduces on the physical device"
  is usually `Connect Hardware Keyboard` being on — the software keyboard never appears, so the
  layout never moves.
- **A simulator cannot exercise iOS 14+ Local Network permission.** The sim does not enforce it, so
  the LAN-IP dev path "works on the sim, fails on the device" — the most confusing possible signal.
  → [`../decisions/positioning.md §2`](../decisions/positioning.md), which records that everything
  *up to* the permission prompt is already proven.
- **A pty on stdin brings the device picker back.** `script -q <file> <cmd> < /dev/null` still hands
  the child a pty, so `process.stdin.isTTY` is true and `adaptv preview ios` waits on the picker
  forever whenever more than one target is listed — `bin/lib/render.mjs` `select` takes the first
  option only when there is NO tty, so this is not a CLI bug. A headless run passes the choice
  itself: `script -q /tmp/out.txt env TERM=xterm-256color pnpm exec adaptv preview ios --target <udid>`.

## Closed on the emulator, not on glass

**Android target API 36** shipped 2026-09-02 (register **B9**), and the emulator half of its
verification ran with it. Row 7 is what an emulator cannot settle.
