# nativ — the `@nativ/shell` native plugin

> The first-party Capacitor plugin (Swift + Kotlin) that **owns the native shell** — edge-to-edge, real
> inset reporting, status/nav bar, colour-driven splash, and theme sync — collapsing today's mix of
> community plugins + CLI native-source string-patching into **one module nativ controls**. This is the
> native layer of `ARCHITECTURE.md §1.1` and **the wedge vs Ionic** (roadmap #2).
>
> Design, not built. The hard part is the **Android-15 / SDK-35 inset + keyboard breakage** (`RESEARCH.md
> §3`, flagged HIGH RISK) — treat it as the crux, not a detail. Started **2026-07-14**.

---

## 0. Why own a native module

Today the native shell is **assembled from parts**:
- Community plugins: `@capacitor/status-bar`, `@capacitor/splash-screen`.
- The CLI **string-patches native project source** on every sync — `patchAndroidSplash` (writes
  `colors.xml` / `values-night` / launch `styles.xml` / a themed or plain `MainActivity.java`) and
  `patchIosTheme` (writes the `NativSplash` colorset, the launch storyboard, and an `AppDelegate.swift`
  override) — see `bin/nativ.mjs`.
- The generated `capacitor.config.json` sets `StatusBar.overlaysWebView` + `SplashScreen` blocks.

It works and is green — but it's fragile: patching native source with regexes, community-plugin version
skew, and **no owned place to fix the Android-15 inset/keyboard breakage** that the current approach will
hit (`RESEARCH.md §3`). Doctrine (`ARCHITECTURE.md §0.6`): *rent stable cores, own seams.* Edge-to-edge +
insets **is** the seam — and roadmap #2 names it the wedge — so nativ should **own** it as a real plugin.

---

## 1. Scope — what the plugin owns

| Concern | Today | In `@nativ/shell` |
|---|---|---|
| Edge-to-edge draw | `StatusBar.overlaysWebView` + SDK defaults | owned on both platforms, incl. the SDK-35 forced-E2E path |
| **Inset reporting** | `env(safe-area-inset-*)` (web) only; Android IME unreliable | the plugin reports **real** insets (status, nav, cutout, **keyboard/IME**) to the WebView, uniform cross-platform |
| Status / nav bar | `@capacitor/status-bar` | owned: style (light/dark icons) + background/transparent, theme-driven |
| Splash mask | CLI string-patches launch theme / storyboard / colors | plugin config, still **colour-driven + theme-aware**, hold-until-ready handoff |
| Theme sync | CLI-patched `UiModeManager` / `overrideUserInterfaceStyle` | plugin API — no native-source patching |

The **JS layer above the plugin does not change**: nativ's shell consumes the plugin and keeps exposing
the same `--nativ-safe-*` CSS vars and the same hooks (`useStatusBar`, `useKeyboard`, splash). The
primitives are untouched; only the native implementation underneath them is replaced. That's the whole
point — own the native seam without disturbing the contracts in `ARCHITECTURE.md §1`.

---

## 2. The JS API — one plugin surface

```ts
import { Shell } from "@nativ/shell"

await Shell.configure({ edgeToEdge: true, statusBar: { style: "theme" }, splash: { … } })
await Shell.setTheme("dark" | "light" | "system")     // replaces the CLI MainActivity/AppDelegate patch
await Shell.hideSplash()                                // hold-until-ready handoff
Shell.addListener("insetsChange", ({ top, bottom, left, right, keyboard }) => { … })
```

nativ's shell subscribes to `insetsChange` and writes the values to CSS custom properties
(`--nativ-safe-top`, …, `--nativ-keyboard`), so `View safe="…"` and `useKeyboard` read one uniform source
on every target. On web the same vars resolve from `env(safe-area-inset-*)` / `visualViewport` — identical
shape, different origin (the layer-1 hybrid split of `ARCHITECTURE.md §4`).

---

## 3. The Android-15 / SDK-35 crux (the hard part)

`RESEARCH.md §3`: Android 15 **forces** edge-to-edge on `targetSdk 35`, and the old
`keyboard-resize`/`keyboard-offset` path is no longer reliable — inputs near the bottom get overlapped,
and devices `< API 35` need explicit layout margins to keep prior behaviour. The plugin must therefore:

- **Read `WindowInsetsCompat` directly** (not community keyboard resize modes) to get accurate insets,
  **including the IME (keyboard) inset** — the reliable post-15 source. Report it via `insetsChange`.
- **Feed the IME inset to `useKeyboard`** on native. `useKeyboard` already prefers the exact OS height on
  native (`BEHAVIORS.md §4`); this makes that source *reliable on 15+* instead of depending on the plugin
  resize mode that broke.
- **For `< API 35`**, apply explicit layout margins to preserve old behaviour (what the community fix
  plugin does).
- **Study before writing:** Capawesome's `android-edge-to-edge-support` `WindowInsets` handling and the
  linked issues (`RESEARCH.md §3`) — adopt their hard-won handling, diverge where nativ's single-module
  design differs. This is the "study Ionic/Capacitor prior art before reinventing" doctrine applied.

iOS is comparatively calm (safe-area insets are stable), but the plugin still owns the status-bar
overlay + the launch storyboard colour asset so the whole native shell lives in one place.

---

## 4. Migration path — CLI patching → plugin config (phased)

Own it, but **incrementally** — the Android-15 inset work is the risky, high-value core; the styling is
already green. So:

- **Phase 1 — the risky core.** Ship the plugin owning **edge-to-edge + inset/IME reporting** (the
  Android-15 fix). Keep the community `@capacitor/status-bar` / `@capacitor/splash-screen` and the CLI
  splash patching as-is. This de-risks the breakage first, with the smallest surface.
- **Phase 2 — absorb the rest.** Move status-bar styling, the colour-driven splash mask, and the theme
  override into the plugin's native code. The CLI **stops string-patching native source**
  (`patchAndroidSplash`/`patchIosTheme` retire); the generated `capacitor.config` replaces its
  `StatusBar`/`SplashScreen` blocks with a single `@nativ/shell` block; the splash mask colours flow from
  `nativ.config.ts` → the plugin config. `BEHAVIORS.md §3/§5/§6` get re-pointed at the plugin.

Net end state: the CLI installs + syncs one plugin and passes it config; the plugin owns every native
behaviour; **no regex patching of native projects.**

---

## 5. Wrap vs own

Per `RESEARCH.md §3` you *could* just depend on the Capawesome edge-to-edge plugin. But roadmap #2
explicitly makes this **the wedge vs Ionic**, and a rented native shell can't be the differentiator — so
**own it**, using the community plugin's `WindowInsets` handling as the reference implementation to study,
not as a runtime dependency. (Contrast with OTA in `LIFECYCLE.md §5.5`, where nativ *rents* the low-level
bundle-swap — there the swap isn't the wedge; here the native shell is.)

---

## 6. Testing & status

Native-only, and specifically at the **API 34 ↔ 35 boundary** — the plugin's inset/keyboard behaviour
must be verified on both an API-34 and an API-35 emulator (the breakage line), plus the six-target
discipline (`TESTING.md`). Manual `nativ run` today; a future `nativ e2e` (`LIFECYCLE.md §7.2`) could
automate it.

**Status:** not built (roadmap #2). Highest native-risk item; the Android-15 `WindowInsets`/IME handling
is the crux. Cross-refs: `ARCHITECTURE.md §1.1` (the native layer it implements) · `BEHAVIORS.md §3/§5/§6`
(current edge-to-edge / safe-area / splash it will absorb) · `RESEARCH.md §3` (the Android-15 issues to
read first) · `capacitor-internals.md` (version pins) · `LIFECYCLE.md §7` (how the CLI syncs it).
