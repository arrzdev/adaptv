# adaptv — open questions

> **Decisions owed, not work owed.** Everything here is genuinely undecided; nothing here is blocked
> on effort. Consolidated 2026-08-30 from `DECISIONS.md §5` and `VISION.md §9`, which had drifted
> apart — `VISION.md §9` still lists as open six questions the register closed months ago.
>
> When one of these is answered it moves to [`../decisions/`](../decisions/README.md), with its
> rationale and — the part that matters — **what was rejected and why**.

---

## Still open

### O11 — Six-target test automation

**Can the native matrix run in CI, or does it stay local?**

Real today: CI runs **five** web-only gates (typecheck, biome, biome:playground, vitest,
`scripts/check-colour.mjs`); the native matrix is local. The 305 Playwright tests under
`playground/` run on a developer's machine only — the browser half of this question is a CI job,
not a research problem, and is the part `pnpm gate` never covered either.

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
| Testing automation | ❓ still open — **O11** above |
| Distribution / signing | ✅ **O16** — stop at the artifact. No fastlane. Unsigned `.ipa`, debug `.apk`; signed builds stay in Xcode ▸ Archive. |
| Navigation model | ❓ still open — **O15** above |

**Two more the register closed that are worth not re-litigating.** `O14` (config back-compat →
`web`/`native`/`ota` blocks) is **withdrawn**, not pending: the config went flat and `web.host` was
deleted (→ [`../decisions/rendering-and-delivery.md §2`](../decisions/rendering-and-delivery.md)).
And **IAP / monetization is deliberately EXCLUDED from core** — RevenueCat already is the
vendor-neutral abstraction, the hard parts are server-side, and the legal surface moves in *weeks*,
so a framework release would encode a legal snapshot that expires before the release does.
