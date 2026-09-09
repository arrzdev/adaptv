# adaptv — capability gaps

> The ranked list of device APIs adaptv does not have yet. Extracted from
> [`../research/capability-surface.md §4`](../research/capability-surface.md) on 2026-08-30 — that
> doc stays where it is and remains the full three-way comparison (Expo / React Native / Capacitor,
> with the web column). This file is only the actionable remainder, so a "what's left" reader does
> not have to read a research doc to find it.
>
> The audit that produced this folder called §4 **the best-formed roadmap material in the repo**.
> Nothing here is a rewrite; it is the same content with the shipped rows removed.

---

## Correcting the baseline first

`../research/capability-surface.md` disagrees with itself about how many capabilities adaptv has —
its intro says *"17 capabilities + 23 hooks"* and §4, ten lines later, says *"adaptv has 12
capabilities"*. **Neither is right.** Counted from `src/interface/capabilities.index.ts` on
2026-08-30: **18 capability modules and 27 hook modules.**

The §4 prose list also omits `theme-color` entirely — a whole shipped capability with 8 exported
symbols (`src/capabilities/theme-color.ts`), landed in PR #64, which drives per-route browser chrome
tinting. Read the barrel, not either list.

---

## Tier 2 — high value, real work

### 1. Native dialogs / action sheet / toast

`@capacitor/dialog`, `@capacitor/action-sheet`, `@capacitor/toast`; RN's `Alert`, `ActionSheetIOS`,
`ToastAndroid`.

⚠️ **This owes a decision before it owes an implementation, and the decision is
`render` vs `delegate`. It is written up as
[`open-questions.md` O22](open-questions.md), with the web tier measured on two engines and a
recommendation; answer it there, not here.**

|  | Render them (Ionic's model) | Delegate to the OS (RN/Capacitor's model) |
|---|---|---|
| Look | one look on all three targets | the genuine platform look |
| Styling | full control | none |
| Accessibility | adaptv's problem | free |
| Web tier | a real one | nothing beyond `window.confirm` |

Given adaptv's positioning — correct-by-construction primitives, the web as a *primary* target —
**rendering is very likely right**, but it should be recorded as an explicit decision in
[`../decisions/`](../decisions/README.md) rather than arrived at by default.

Note this **overlaps** the component gap in `../research/component-surface.md §8` Tier 2. That
overlap is the decision above, not a duplicated entry — the two docs are not asking for the same
thing twice.

The row that said the web tier is "nothing beyond `window.confirm`" now has a number behind it: on
the iOS simulator and on the Android emulator that is one string, two fixed buttons, no title and no
destructive styling. See O22.

### 2. Notifications (local + push)

`@capacitor/local-notifications` / `@capacitor/push-notifications`; on web the Notification and Push
APIs **through the service worker adaptv already owns end to end** (`src/sw/`). The web tier is
therefore mostly already-built infrastructure, which makes this cheaper than it looks.

### 3. Camera / image picker / document picker

`@capacitor/camera` covers all three natively; `getUserMedia` and `<input type="file">` cover web.
High-frequency in real apps.

### 4. Filesystem

`@capacitor/filesystem` plus OPFS on web.

### 5. Biometrics

WebAuthn on web is genuinely good; native needs a community plugin. Pairs naturally with
`storage.secure`, which already exists and already documents its web/native honesty gap
(register **B23** — `@capacitor/preferences` is plaintext and must never hold tokens).

---

## Tier 3 — the long tail

Sensors / motion · battery · brightness · contacts · calendar · SMS + mail · print · speech ·
store review · screen-capture blocking · localization (`Intl` makes the web tier free) ·
barcode scanning · text zoom.

---

## Not gaps — places adaptv is already ahead

Recorded so nobody "closes" them by adopting a weaker neighbour's design:

- **`back-chain`** — priority-auction back handling. Ionic has it; React Native has only a flat
  `BackHandler`; Capacitor exposes only a raw event.
- **`gesture-controller`** — Expo delegates gesture arbitration to a third-party library.
- **The three-tier storage split**, with an honest web-security story rather than a pretended one.
- **`ota/`** — → [`../design/ota.md`](../design/ota.md).

---

## One shape worth carrying into every new capability

`keep-awake` exposes `supported` **and** a `getKeepAwakeCaveat()` string, because *"the API exists
and resolves but does nothing"* is a third state, distinct from supported and unsupported — iOS below
18.4 resolves a wake lock and still dims the screen (WebKit bug 254545). A boolean cannot express
that, and silently doing nothing is exactly the failure this whole layer exists to prevent.

Related: three probes documented in §4 as consumer API — `isShareSupported()`, the clipboard write
probe, and keep-awake's `supported` — are **deliberately withheld from the public barrel**.
`src/interface/capabilities.index.ts` states the rule and `capabilities.barrel.test.ts` enforces it:
a standalone predicate is a second way to ask a question the surface already answers, and a second
answer can disagree with the first.
