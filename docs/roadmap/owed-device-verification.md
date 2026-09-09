# adaptv — owed device verification

> Six checks that **no unit test can close**, each cheap on its own and each blocked on hardware or
> an installed build. Assembled 2026-08-30 from `HANDOFF.md §4.1` (before that file was deleted),
> `design/behaviors.md`, and `research/capability-surface.md`.
>
> These are not bugs. They are claims the suite structurally cannot reach: 2542 tests over happy-dom
> prove structure and lifecycle, which is all a DOM can prove.

---

| # | What | Why a test cannot settle it | Needs |
|---|---|---|---|
| 1 | **iOS-web haptics** (`src/capabilities/haptic-tick.ts`) | The 13 tests pin structure and lifecycle. Whether the tick *actually fires* is a physical-transducer question — **simulators produce no haptics at all**. | A physical iPhone on iOS ≥ 26.5 |
| 2 | **`clickable`'s `pointercancel` behaviour** (register **B13**) | Every engine **except the broken one** treats the shorthand and the longhand identically, so a passing test proves nothing. Only a real iOS device shows the difference. | A physical iPhone |
| 3 | **Gesture-controller priority *numbers*** | The arbitration *logic* is proven (`src/capabilities/gesture-controller.ts` + tests). The ordering is a feel judgement on a real screen carrying a drawer, a swipeable row and a scroller **at once**. | Any device, but a real screen and a real finger |
| 4 | **`theme-color` / status-bar tint on iOS 26** (register **B17**) | iOS 26 derives the tint from the **rendered page edge** rather than the meta tag, so it is only observable in rendered pixels. iOS 18 does the exact opposite, so both floors need checking. | iOS 26 **and** iOS 18 |
| 5 | **`keep-awake` inside a Capacitor WebView** | caniwebview lists Screen Wake Lock as unsupported in both WKWebView and Android WebView; the browser support tables do not cover webviews at all. Neither source can answer it. `getKeepAwakeCaveat()` exists precisely because "resolves but does nothing" is a real third state. | A native run on both platforms |
| 6 | ~~**The two installed (PWA) targets for the drawer/keyboard work**~~ (run 2026-09-02 on iOS PWA, native iOS and native Android — see `design/behaviors.md` §keyboard; installed-only content-edge reversal found (PWA + both natives, not the browser tab) in the `picker collapses, keyboard lags` scenario, sample series still owed; the Android PWA was not reached) | `design/behaviors.md` recorded green on targets 2 and 3 only. | Android Add-to-Home-Screen, and the sample series behind the reversal |

---

## Two traps recorded with these

Both have cost time before and will again.

- **The simulator's hardware keyboard hides keyboard bugs.** "Only reproduces on the physical device"
  is usually `Connect Hardware Keyboard` being on — the software keyboard never appears, so the
  layout never moves.
- **A simulator cannot exercise iOS 14+ Local Network permission.** The sim does not enforce it, so
  the LAN-IP dev path "works on the sim, fails on the device" — the most confusing possible signal.
  → [`../decisions/positioning.md §2`](../decisions/positioning.md), which records that everything
  *up to* the permission prompt is already proven.

## Also outstanding, same class

**Android target API 36 on a real API-36 device** — see
[`android-api-36.md`](android-api-36.md). Its definition-of-done depends on this list.
