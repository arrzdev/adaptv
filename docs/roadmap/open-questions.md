# adaptv — open questions

> **Decisions owed, not work owed.** Everything here is genuinely undecided; nothing here is blocked
> on effort. Consolidated 2026-08-30 from `DECISIONS.md §5` and `VISION.md §9`, which had drifted
> apart — `VISION.md §9` still lists as open six questions the register closed months ago.
>
> When one of these is answered it moves to [`../decisions/`](../decisions/README.md), with its
> rationale and — the part that matters — **what was rejected and why**.

---

## Still open

### O11a — Browser suite in CI

**Answered: all four suites, both engines.** `.github/workflows/ci.yml` job `e2e` is a matrix of
eight parallel jobs — the main config and the three service-worker configs (`sw`, `sw-spa`,
`sw-prompt`), each × `chromium` and `webkit` — on every PR and push to `main`. Each job installs only
its own engine, runs its config with `CI=1` so the config boots and never reuses its own server, and
uploads that job's HTML report with traces as `playwright-report-<suite>-<engine>` when it fails;
`fail-fast` is off, so one red cell never hides the rest. This was first chromium-and-main-only, with
the SW configs recorded as the follow-up; they are now in, and webkit with them, because webkit is
the nearest thing CI has to the installed PWA's real engine. Still `retries: 0`, and the known
`update.spec.ts` chromium intermittent (it reaches the `sw` and `sw-spa` chromium cells) is **not**
`continue-on-error`: it goes red when it fires, and a re-run is a visible human act. `pnpm gate` still
does not run any of this — minutes against seconds — so CI is the gate for it.

### O11b — Native matrix

**Can the native matrix run in CI, or does it stay local?**

Real today: CI runs the web-only gates (typecheck, biome, biome:playground, vitest,
`scripts/check-colour.mjs`, and every browser suite above on both engines); the native matrix is local.

This is the question that gates
[`owed-device-verification.md`](owed-device-verification.md): six of those checks are owed precisely
because nothing automated reaches them. Answering it either shrinks that list or makes it permanent.

### O15 — Navigation model

**How much of tabs / modals / sheets stacking does adaptv own, versus leaving it to the router?**

The most consequential open question in the set, because
[`component-gaps.md`](component-gaps.md) Tier 3 — `TabBar`, nav header/toolbar, `SearchBar` — cannot
be designed until it is answered. Both neighbouring ecosystems treat these as **routing-level**
concerns (`ion-tabs`/`ion-router-outlet`; `expo-router`'s `Stack`/`NativeTabs`) rather than as
free-standing components. adaptv owns its router, which is why this has the most leverage and why it
cannot be lifted from either API directly.

### O6 — Is the Ionic port inventory discharged?

Marked 🔄 *in progress*. The three **mechanisms** now exist — `src/capabilities/gesture-controller.ts`,
`src/capabilities/back-chain.ts`, and the iOS input shims — but whether the *port list* in
[`../decisions/prior-art.md`](../decisions/prior-art.md) is finished is unclear from the code.

**This needs an owner's call rather than an investigation**, and it has a legal edge: the Ionic entry
in `THIRD_PARTY_LICENSES` still reads `Used by: (pending)`. Either the port happened and the notice
owes a file list, or it did not and `prior-art.md` overstates. → roadmap **L4**.

### O9 — Capability scope

Marked 🔄 *in progress*, and **superseded in practice** by
[`capability-gaps.md`](capability-gaps.md), which is a better-formed version of the same question
(ranked, tiered, with the render-vs-delegate decision named explicitly). Worth closing formally as
"answered by the tiering" rather than leaving a second, vaguer entry alive.

### O17 — Who declares a bundled plugin's OS permission?

**Does adaptv stamp the permission a bundled plugin needs, or does the app?**

Evidence: `@capacitor/geolocation` is the one plugin in adaptv's bundled set that needs an Android
`<uses-permission>` (`ACCESS_FINE_LOCATION`) and an iOS `NSLocationWhenInUseUsageDescription`;
`src/native/` generates neither, so the first call fails on a device with nothing in the build saying
why. Stamping both for every app is not the answer: an unused location permission costs store review,
and the iOS string is user-facing copy adaptv cannot write.

Candidate shape: one config declaration (`permissions: { location: "…why…" }`) that stamps both.
Decided by: whether `adaptv.config.ts` may carry per-platform, user-facing copy at all — L20 draws
that line for plugin names; nothing has drawn it for permission text.

### O18 — L20 against L21 on `pnpm.patchedDependencies`

**Whose sentence is the patch instruction?**

L20: adaptv never asks the consumer to add `pnpm.patchedDependencies`. L21: the install instructions
adaptv shows are derived from the patches that actually shipped. Evidence:
`describeMissingPatches` in `src/vite/verify-patches.ts` follows L21 — when a shipped patch is not
applied it prints the exact `patchedDependencies:` block to add to `pnpm-workspace.yaml`, which is
the ask L20 forbids. Both cannot hold as written.

Decided by: whether the patches travel inside adaptv at all. If the `dist` cutover ships the patched
packages vendored, the sentence is never printed and L20 wins by construction; if not, L20 has to say
"never asks *silently*" and L21 is the wording of the ask.

### O19 — Is `notFoundScreen` in the entry chunk on purpose?

**Should the one config screen with no boot-failure role become the lazy chunk its syntax promises?**

Evidence: every screen in `adaptv.config.ts` is written `() => import("…")` and rewritten by
`importThunk` (`src/vite/root-route-module.ts`) into a static `import` in the generated root route,
so all of them ride in the entry chunk. The comment there justifies it for `offlineComponent` only —
the offline UI must not live in a chunk that can fail to load — and the others inherit the mechanism
without a reason of their own. Measured on the playground: a lazy `notFoundScreen` cuts the entry by
131 KB raw / 46 KB gzipped on every load, for a screen most sessions never render.

Decided by: whether the static rewrite is the contract (then the config syntax should stop looking
lazy) or the exception (then `offlineComponent` stays static and the rest split). Either answer ends
the mismatch between what the config says and what ships.

### O20 — OTA has no outcome channel

**When an update check fails, who hears about it?**

Evidence: `check()` in `src/ota/updater.ts` reads the manifest through `fetchManifest`, which answers
`null` for a malformed one, and `check()` returns on `null` — the same exit as "nothing new". Right
for the user (the app carries on) and blind for the developer: a channel publishing garbage looks
exactly like a channel with nothing to say, and today the only oracle is the ota-lab log on a dev
machine.

Decided by: whether adaptv owns any telemetry surface at all. It has none; this would be the first,
and its shape — an event the app can log, a last-outcome `doctor` can read, or a hook — is the whole
question.

### O21 — `syncKeyboardState` as a decision table

**Should the keyboard-state decision be pure, so each device finding is a fixture?**

Evidence: `syncKeyboardState` in `src/hooks/use-keyboard.ts` is one closure that reads
`visualViewport`, the VirtualKeyboard API and the platform flags and writes state in the same body.
Every branch is a device-measured finding (iOS's two-step height, the VK-less Chromium double-count,
the native dip) and none is unit-tested, because the reads and the decision are one body.
`(inputs) → decision` plus a reader would make each finding a row in a table.

Decided by: whether the device ladders in `docs/research/` stay the test of record — in which case a
unit table is a second truth to keep in step — or become the source of the table's fixtures.

### O22 — Overlays: render them, or delegate to the OS?

**Answered 2026-09-09 by the owner: render, one engine with thin presets.** The rationale, and
what the answer rejected, are recorded in [`../decisions/register.md §5`](../decisions/register.md)
O22. [`capability-gaps.md`](capability-gaps.md) Tier 2 #1 and [`component-gaps.md`](component-gaps.md)
Tier 2 are unblocked by it and no longer owe a decision. The question as it was put, and the
measurement that decided it, are kept below because the measurement is the reusable part.

**Does adaptv render its own alert, action sheet and toast, or hand them to the OS?**

[`capability-gaps.md`](capability-gaps.md) Tier 2 #1 and [`component-gaps.md`](component-gaps.md)
Tier 2 are the same question asked from the capability side and the component side. Both defer to
"record it in `../decisions/`", and neither can move until this is answered. It is recorded here so
there is one place to answer it.

**The delegate option's web tier was measured, because that is the half the table asserted without
a number.** A page's whole vocabulary there is `window.confirm`, and this is what it renders:

    iOS 26 simulator, Safari, http://localhost:41860
      a centred rounded card over a dimmed page
      the message string, no title
      two buttons: Cancel, OK
      no origin line

    Pixel 10 emulator, the app's own WebView, https://localhost
      a Material dialog
      the message string, no title
      two buttons: CANCEL, OK
      no origin line

So the web tier under `delegate` is: one string, two fixed buttons, no title, no third choice, no
destructive styling, and a synchronous block of the main thread that cannot be awaited beside React
state. Any screen that needs a title, a red destructive button, or three options has **no** web path
at all. That is the load-bearing fact, because it means delegating does not remove the rendered
engine from the framework — an app still has to ship one for the web — it adds a second
implementation beside it, and a second accessibility model to keep in step.

**The back chain already reserves a band for this.** `BackPriority.Overlay` in
`src/capabilities/back-chain.ts` is documented as "Drawers, modals, sheets — registered while open",
and an OS-owned dialog can never occupy it: the OS dismisses its own dialog before the app hears the
press. Delegating puts the most modal thing in the app outside the one mechanism that orders
modality.

*(Checked while writing this: nothing outside `use-back-handler.test.ts` registers at that band
today — `Dropdown` uses `Transient`, and `Drawer` registers no handler at all. That is a separate
gap from this question, and it does not change the answer; it means the band's first real consumer
will be whatever this question produces.)*

**The question is not uniform across the five overlays.** Ranked by how strong the delegate case is:

| Overlay | Delegate case |
|---|---|
| Toast | **Strongest.** Android's is a real OS affordance outside the app window; it outlives navigation, and a rendered one cannot. |
| Action sheet | Strong on look — the iOS sheet is instantly recognisable, and getting it wrong is more visible than not having it. |
| Alert | **Weakest.** Measured above: two buttons and a string, on both engines. |
| Spinner, progress | Not a dialog at all; nobody delegates these. |

Answering "render" for the set and then delegating toast on Android alone is a defensible split, but
it should be chosen, not discovered.

**Recommendation: render, with one engine and thin presets.** The web is a primary target, the
delegate path has no usable web tier, `Drawer` is already an overlay with a gesture engine and a
positioning layer behind it, and modality ordering is already adaptv's. The cost is that
accessibility becomes adaptv's problem rather than free, which is real work and should be priced
into the item rather than discovered during it.

**Decided by the owner** — render, 2026-09-09. The counter-case put was that the genuine platform
look on native is worth more than one look across targets; it is a positioning call rather than a
measurement, and it did not win.

### O25 — What is adaptv's iOS floor?

**Which iOS version must the shipped app work on: 15.0, 15.4, 16.4 or 18?**

The repo has four answers, and each one is load-bearing somewhere:
- **iOS 18.** `../research/component-surface.md:738` ("adaptv's floor is iOS 18") uses it to reject
  a CSS-only edge fade, and `src/styles/scroll-fade.css:25` says the same in code, citing a
  `DECISIONS.md` that no longer exists. `../decisions/register.md:270` (O10) calls `@starting-style`
  usable "(iOS 18 floor)". `register.md:1234` (B16) scopes a Popover mitigation to "an iOS 18 floor".
- **iOS 16.4.** `src/vite/capacitor-config.ts:68` sets the Android WebView floor to "Tailwind v4's
  own stated minimum (Chrome 111 / Safari 16.4 / Firefox 128)", and `../decisions/register.md:1548`
  locks that reasoning. Applied to iOS it gives 16.4, which is also Vite's default Safari target and
  so what main's client build is compiled for today. #121 rewrites that comment to name only the
  Chromium half.
- **iOS 15.4.** Open PR #121 compiles the client for `safari15.4`/`ios15.4`, because Tailwind v4
  wraps the stylesheet in `@layer`, and no build target can lower that. Its own Feedback wanted
  notes that the native deployment target is still 15.0, below that CSS floor.
- **iOS 15.0.** This is the native project adaptv generates. Capacitor 8.4.3's `ios-pods-template`
  sets `platform :ios, '15.0'` (`App/Podfile:3`) and `IPHONEOS_DEPLOYMENT_TARGET = 15.0`, and nothing
  in `bin/lib/native.mjs` raises it. `../design/image.md:39` ("while adaptv supports iOS 15–16") and
  `:181` ("when adaptv's iOS floor reaches 17") reason from a 15/16 floor, and
  `src/components/image.tsx:188` repeats it in code ("while adaptv supports iOS 15").

The answers disagree in ways that change code:
- At 18, #121's lowering is unneeded, the native target should be 18, and `image.md`'s iOS 15–16
  hedges go.
- At 16.4, #121's lowering is unneeded too, because Vite's default already targets it. The native
  target moves to 16.4, the iOS 18 statements still need fallbacks, and Tailwind's own fallbacks for
  `@property` and `color-mix()` stop mattering.
- At 15.4, the iOS 18 statements become feature floors that each need a fallback or a stated
  degradation, and the native target moves up to 15.4.
- At 15.0, `@layer` itself is unsupported, so Tailwind v4's output does not work there at all.

One related measurement, from the iOS 16.2 simulator on 2026-09-13: Safari against the dev server
drops Tailwind's `rtl:` variants and some callout text. The dev stylesheet keeps native CSS nesting
(`&:where(...)`), which WebKit parses only from 16.5, while the production build flattens it. So
below 16.5 a device can verify only the production build, whatever floor is chosen (open PR #213
flattens the dev stylesheet too).

What staying below 16.4 costs in CSS, read off main's production build on 2026-09-14 (the web and
capacitor stylesheets are byte-identical). None of it is verified on a device, because the lowest
simulator here is iOS 16.2:
- **Range media queries.** Vite's default CSS target (Safari 16.4) leaves 13 `(width >= …)` queries,
  which match nothing below 16.4, so every `sm:`/`md:` breakpoint is dead on 15.x and 16.0–16.3.
  #121 lowers them.
- **Alpha colours over a variable token.** `bg-x/15` over an `@theme inline { --color-x: var(--x) }`
  token has no computable fallback, so below 16.2 it paints at full opacity. The playground has 31,
  and a lab badge's text disappears into its background. No build pass fixes it; literal colours or
  dedicated subtle tokens do.
- **`in oklab` gradients.** `bg-gradient-to-b` emits an unguarded interpolation that 15.x drops,
  painting nothing (the playground's 404 numerals). Plain gradients fix it.
- **The `lh` unit** needs 16.4.

adaptv's own `src/` ships none of the four: its only alpha classes (`bg-black/40` in the drawer,
`bg-slate-900/60` in its chrome tint) use literal colours, which Tailwind gives literal fallbacks. The
cost lands on consumer styling written the Tailwind v4 and shadcn way.

Decided by: whether the floor is the oldest OS the shipped bundle runs on, which the native
deployment target has to match, or the oldest OS the design may lean on without a fallback. It
cannot be both 15.x/16.4 and 18. Either answer turns every statement above into one number with one
owner.


---

### O23 — Does adaptv ever ship a second framework binding?

**If the primitives are split into a framework-free core and a React binding
([`core-binding-split.md`](core-binding-split.md)), does a `vue` / `svelte` / `angular` binding ever
get built on top of it — or does the core stay an internal organising principle?**

Evidence, both ways. **For:** roughly half of `src/` and effectively all of `bin/` are already
framework-free (22,843 LOC of CLI, 5,815 of capabilities, zero React in either), and markup is 6.9 %
of the lines in the files that render — so the part that is genuinely React is much smaller than the
tree suggests. **Against, and it is the heavier side:**
[`../decisions/positioning.md`](../decisions/positioning.md) §1 documents Ionic dying *of this exact
thing* — three bindings, human commits down 82 %, and `@ionic/react-router` still pinned to React
Router v5 with the v6 request open since 2021 at 409 👍. Three bindings is not what they shipped; it
is why none of them is current. Also unresolved: the second half of adaptv's stated wedge — the
`createServerFn` ban — is written against TanStack's vocabulary, so each framework needs its own
inventory of what to forbid, and that inventory *is* the product.

Note the shape is already constrained if the answer is ever yes: **L1** (single package) and register
§5.0.0 (the npm scope must match the repo owner) mean a subpath export, `@arrzdev/adaptv/vue`, never a
separate `@adaptv/*` package.

Decided by: whether adaptv ever has a second consumer asking, and by one person's maintenance budget.
**Explicitly not decided by the split itself** — that work is justified as organisation, and answering
this question `no` does not undo it.

### O24 — Does adaptv keep Tailwind as a hard requirement?

**`styling.md` §0.1 locked Tailwind v4 as a hard requirement on 2026-07-28 and named its own revisit
condition — *"revisit as an additive path, not a replacement, if a non-Tailwind consumer ever becomes a
target."* Going to alpha with a hard dependency on someone else's build is the owner raising exactly
that. Does it change?**

Evidence. **The pillar has moved.** §0.1's decisive argument is not cost — it is that a
`@custom-variant` delivers a correctness fix to idiomatic consumer code, and *"there is no CSS
mechanism for this"*. That is an argument for the **rewriting**, not for **Tailwind**: the post-processor
in [`patch-delivery.md`](patch-delivery.md) §4 delivers the same fix to any CSS dialect. If it ships,
Tailwind stops being load-bearing for correctness and becomes ergonomics.

**What leaving costs, measured 2026-09-09.** The components are the cheap half — 344 distinct utilities
across `components`/`shell`/`routes`, only 9 of them carrying a variant, i.e. a structural vocabulary
(`flex`, `min-h-0`, `shrink-0`) and a mechanical rewrite. The expensive half is elsewhere:
`safe-area.css` declares **81 `@utility`** — `p-safe`, `pt-safe-offset-*`, `mb-safe-or-*` — which is
public vocabulary a consumer types and which §5.4.1 blessed precisely because Tailwind cannot spell it;
`tailwind-merge` is the spine of the three-layer precedence contract (§2, §5.5) with `mergeStyles` in 26
files, so `locked` — the whole of bug **B8**'s remedy — is defined in its terms. Leaving is not
"rewrite the components in CSS"; it is re-deciding §2, §5, §6 and §7 of `styling.md`.

**One knot it unties:** §0.1's third coupling, `index.css`'s `@source "../**/*.{ts,tsx}"`, binds the
styling layer to shipping-as-source, and [`dist-cutover.md`](dist-cutover.md) has to carry that path or
every internal utility silently stops being generated.

**Unproven either way: the bundle.** Utilities are *shared* — one `.flex` rule serves adaptv and the
app — where per-component CSS is not, though it is per-component tree-shakeable. Nobody has measured
it, and it should not be argued without measuring.

Decided by: whether a non-Tailwind consumer is a real target for alpha, and not before
[`patch-delivery.md`](patch-delivery.md) §4 exists — doing it in the other order pays the cost while
the capability that replaces it is still hypothetical.

## The one live question `VISION.md §9` has that the register does not

**Secure storage / auth — how opinionated should adaptv be about the bearer-token + biometric flow?**

Partly answered: the *storage* is settled (`@aparajita/capacitor-secure-storage` 8.0.0 — **O8b**;
`@capacitor/preferences` is plaintext and must never hold tokens — **B23**), and the bearer-token
architecture is validated because cookies do not work cross-origin in a WebView. What is **not**
settled is how much of the *flow* adaptv owns. Biometrics is Tier 2 in
[`capability-gaps.md`](capability-gaps.md), and this question decides whether it arrives as a bare
capability or as an opinionated auth recipe.

---

## Already closed — `VISION.md §9` has not been updated

Recorded here so the next reader does not reopen one. Full rationale in
[`../decisions/register.md §5`](../decisions/register.md).

| `VISION.md §9` says open | Actually |
|---|---|
| Styling system | ✅ **O1** — `className` + 3-layer `mergeStyles` + `data-*` + `@layer`. → [`../decisions/styling.md`](../decisions/styling.md) |
| Lint delivery | ✅ **O7** — Biome 2.3.2, verified end-to-end. `noRestrictedImports` for imports, GritQL for AST shapes. The oxlint option was prototyped and dropped. |
| `List` virtualization | ✅ Wraps `@tanstack/react-virtual`; shipped. |
| OTA — bundle a live-update client? | ✅ **O8** — `@capawesome/capacitor-live-update` 8.3.0, self-hosted. **Not Capgo**, and Appflow is dead. → [`../design/ota.md`](../design/ota.md) |
| Testing automation | ✅ browser suite — **O11a** above · ❓ native matrix still open — **O11b** above |
| Distribution / signing | ✅ **O16** — stop at the artifact. No fastlane. Unsigned `.ipa`, debug `.apk`; signed builds stay in Xcode ▸ Archive. |
| Navigation model | ❓ still open — **O15** above |

**Two more the register closed that are worth not re-litigating.** `O14` (config back-compat →
`web`/`native`/`ota` blocks) is **withdrawn**, not pending: the config went flat and `web.host` was
deleted (→ [`../decisions/rendering-and-delivery.md §2`](../decisions/rendering-and-delivery.md)).
And **IAP / monetization is deliberately EXCLUDED from core** — RevenueCat already is the
vendor-neutral abstraction, the hard parts are server-side, and the legal surface moves in *weeks*,
so a framework release would encode a legal snapshot that expires before the release does.
