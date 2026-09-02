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

**Answered.** `.github/workflows/ci.yml` step `Test (playwright, chromium)` runs the playground's
main Playwright config — chromium project, `CI=1`, the config's own server on `E2E_PORT` — on every
PR and push to `main`, and uploads the HTML report with traces when it fails. Chromium only, because
that is where every network, permission and touch test lives (WebKit runs 67 fewer); the three SW
configs each `vite build` first and are a follow-up. `pnpm gate` still does not run it — minutes
against seconds — so CI is the gate for this one.

### O11b — Native matrix

**Can the native matrix run in CI, or does it stay local?**

Real today: CI runs the web-only gates (typecheck, biome, biome:playground, vitest,
`scripts/check-colour.mjs`, and now the browser suite above); the native matrix is local.

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

---

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
