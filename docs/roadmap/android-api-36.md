# adaptv — Android target API 36

> ⏰ **TIME-SENSITIVE. Google Play requires `targetSdk` 36 by 2026-08-31** (extensions available to
> 2026-11-01). Today is 2026-08-30.
>
> Was **B9** in the decision register, where it sat at line 630 of a 2040-line file describing the
> deadline as *"~6 weeks out"* — a number that expired without anyone reading it. That burial is
> the reason this folder exists.

---

## Status: detected, not fixed

**What exists.** `adaptv doctor` already catches it. `checkAndroidTargetSdk` in
`src/native/doctor.ts` parses `targetSdk` / `targetSdkVersion` out of the Android `build.gradle`,
warns on anything below 36, and carries both the deadline and the remediation in its `detail` and
`fix` strings. It is covered by `src/native/doctor.test.ts` at 34, 35 and 36.

**What does not exist.** Nothing *raises* it. adaptv owns and regenerates the Android project, so
the target level is a value adaptv writes — but no code in `bin/` sets `targetSdk` at all; the
project inherits whatever the Capacitor template ships. A warning about a value the framework itself
controls is a diagnostic reporting adaptv's problem as the user's, which is precisely the pattern
the comment directly below `checkAndroidTargetSdk` argues against for `viewport-fit=cover`.

---

## What changes at API 36, and why it is not just a number bump

Three separate things break, and only the first is loud.

1. **Edge-to-edge becomes unconditional.** The opt-out is gone. adaptv is unaffected in *doctrine*
   — **L4** in the register already makes edge-to-edge always-on, never a toggle — but any code path
   that still assumes it can be turned off is now dead.

2. **`setStatusBarColor` and `setNavigationBarColor` become no-ops, not errors.** This is the
   dangerous one: **an app relying on them keeps compiling and silently stops tinting.** There is no
   exception, no warning, no failing build. `@capacitor/status-bar` is already half-dead here —
   `shouldSetStatusBarColor()` gates on the *device* `Build.VERSION.SDK_INT` and returns `false` at
   36+, so `setBackgroundColor` resolves successfully and does nothing. `setOverlaysWebView` is not
   gated at all and is equally inert. → [`native-shell-plugin.md §0.0`](native-shell-plugin.md)

3. **Status-bar tinting becomes purely a CSS problem.** The only supported way to tint a status bar
   in 2026 is to draw it yourself: a fixed-position element sized by `env(safe-area-inset-top)`, with
   `SystemBars.setStyle()` choosing light or dark *icons* to contrast it. Native background colour is
   gone with no replacement.

## The prerequisite

**Settle the safe-area contract first.** Capacitor hard-gates inset delivery on the viewport meta
tag literally containing `viewport-fit=cover` — adaptv generates that tag, so it cannot be wrong, but
everything downstream of the insets moves when the opt-out disappears. → the safe-area entries in
[`../decisions/register.md §6.0`](../decisions/register.md) (B18).

## How this interacts with what already shipped

adaptv has largely already moved to the CSS-side answer, which is why this is a bounded job rather
than an architecture change:

- `src/capabilities/theme-color.ts` (8 exports) paints the chrome from the web layer.
- `src/shell/route-tints.ts` + `src/hooks/use-chrome-tint.ts` drive it per route.
- `../research/capacitor-internals.md` records the measured platform behaviour, including that the
  Android system **nav** bar is browser/OS-owned on web and PWA and only native controls it
  (register **B29**), and that iOS 26 derives the tint from painted pixels while iOS 18 does the
  opposite (**B17**).

So the remaining work is the Android project side, not the rendering side.

## Definition of done

1. adaptv writes `targetSdk = 36` into the Android project it generates.
2. A real device or emulator on API 36 shows correct status-bar and nav-bar treatment — this cannot
   be closed by a unit test. → [`owed-device-verification.md`](owed-device-verification.md)
3. `checkAndroidTargetSdk` stays as a guard for a consumer who has pinned an older project, but
   stops being the only thing standing between the user and the deadline.
