# adaptv — roadmap

**Not-yet-built work only. This is the single not-done list.**

Before this folder existed there were four of them — the root `README.md` §Status block, `RESEARCH.md`
§1, `DECISIONS.md` §4, and `HANDOFF.md` §4 — and they disagreed with each other *and* with the code.
Six of `RESEARCH.md` §1's seven "missing pieces" had shipped; nine of `DECISIONS.md` §4's twelve had
shipped; `HANDOFF.md` recorded a locked decision backwards. One list in one place is most of the
value of the whole reorganisation.

## What belongs here

A file here describes work that **does not exist in `src/` or `bin/` yet**. That is the only
admission test, and it is also the eviction test: **the moment something ships, its file moves out
of this folder** — into `design/` if it is machinery, `decisions/` if it settled a question — or is
deleted. A roadmap entry that has shipped is worse than no entry, because it sends a reader looking
for work that is already done.

## What does not belong here

Anything that already runs. Present-tense descriptions of shipped machinery go in
[`../design/`](../design/README.md); settled choices go in [`../decisions/`](../decisions/README.md);
platform facts established by experiment go in [`../research/`](../research/README.md). Bug reports
against shipped code are not roadmap items either — those live as `B` entries in
[`../decisions/register.md §6`](../decisions/register.md).

---

## The list, ranked

| # | Item | Where | Size | Note |
|---|---|---|---|---|
| 1 | **First-party `@adaptv/shell` plugin** | [`native-shell-plugin.md`](native-shell-plugin.md) | large | ⚠︎ **Needs a redesign before an implementation.** Capacitor 8's core `SystemBars` took over the ground it was designed to claim. |
| 2 | **`dist` cutover** | [`dist-cutover.md`](dist-cutover.md) | small | The build is done and verified; only the `exports` flip and the playground shims remain. |
| 3 | **`create-adaptv` scaffolder** | [`create-adaptv.md`](create-adaptv.md) | medium | Unblocked, low risk. |
| 4 | **Capability gaps** | [`capability-gaps.md`](capability-gaps.md) | large | Tier 2 (dialogs, notifications, camera, filesystem, biometrics) is the best-formed roadmap material in the repo. Tier 3 is the long tail. |
| 5 | **Component gaps** | [`component-gaps.md`](component-gaps.md) | large | Ranked against Ionic and Expo. `Modal` and `Tabs` are the named holes; `Text` is **done**. |
| 6 | **Dev-loop debt** | [`dev-loop-debt.md`](dev-loop-debt.md) | medium | Four named items. Five of the original nine are discharged and were removed. |
| 7 | **Owed device verification** | [`owed-device-verification.md`](owed-device-verification.md) | small each | Seven checks no unit test can close. Cheap individually; they need hardware. |
| 8 | **Native keyboard curve** | [`native-keyboard-curve.md`](native-keyboard-curve.md) | small–medium | Agreed after PR #47, unbuilt. `src/capabilities/keyboard.ts` still emits height only; the OS duration/curve is thrown away. Additive, low risk. |
| 9 | **Open questions** | [`open-questions.md`](open-questions.md) | — | Nine undecided questions plus one the register never carried; O22 (overlays) was answered 2026-09-09. Not work — decisions owed. |
| 10 | **`src/` reorganisation** | [`src-reorg.md`](src-reorg.md) | medium | **§0 answers "what would be ideal"** against the source trees of nine peer frameworks: all nine divide by **where the code executes**, adaptv divides by layer only, and the fix is a rename plus a gate rather than a restructure. **§1–§7** evaluate the owner's three proposals (group by domain · tests in their own folder · domain-first filenames) — **one, narrowly**, and against the other two. No locked decision conflicts. Sequenced **after** the `dist` cutover, except the one step that moves no files. |

---

## Loose ends that are too small for their own file

Each is a one-sitting job with a verified current state.

| # | Item | Evidence | Owner's call? |
|---|---|---|---|
| L1 | ✅ **Done 2026-08-30 — `useScreenLifecycle` is exported.** It was in the internal `src/hooks/index.ts` — a barrel nothing ever imported, drifted from the public one in both directions, and deleted with the OTA slice — but not in `src/interface/hooks.index.ts`, the barrel `exports` points at, so [`../design/coordination.md §4`](../design/coordination.md) documented a contract no consumer could import. Barrel omission, not a decision: the code moved. The hooks that *are* private (`useCaretRepaint`, `useSuppressTextMagnifier`) are private because the shell mounts them on every app; this one does nothing unless a route calls it. | `src/interface/hooks.index.ts` | answered |
| L2 | ✅ **Closed 2026-08-30 — not a gap; `"./image-asset"` was deliberately not added.** The declaration ships as `src/virtual-adaptv-image-asset.d.ts`, one of **seven** `virtual-adaptv-*.d.ts` files, none of which is in `exports`: they reach the consumer through the tsconfig `include` glob instead. An export would not have helped, because a subpath does not load an ambient declaration either — it is one consumer-side line either way. Verified by typechecking a real `?adaptv-image` import in the playground with no such export. The dist cutover still owes these seven a path that survives it → [`dist-cutover.md`](dist-cutover.md). | `src/virtual-adaptv-image-asset.d.ts`; `../design/image.md` §13 row 12 | no |
| L3 | ✅ **Done 2026-08-30 — `check-colour` runs in CI.** It was gate-only, so it bound whoever remembered to run the gate; `.github/workflows/ci.yml` now runs it as a fifth step, and CI is `pnpm gate` minus nothing. The pty capture was the reason to hesitate and it did not survive contact: the check passes with `CI`/`GITHUB_ACTIONS` set, and `script`'s argument order (util-linux vs BSD) is now tried both ways rather than guessed, because a wrong guess would have printed as a colour failure. | `.github/workflows/ci.yml`; `scripts/check-colour.mjs` | no |
| L4 | **Ionic's `Used by:` line in `THIRD_PARTY_LICENSES` is still `(pending)`.** This is a legal surface, not a tidiness one: either the port happened and the notice owes a file list, or it did not and `../decisions/prior-art.md` overstates. `src/capabilities/gesture-controller.ts` is modelled on Ionic's, which suggests the former. | `THIRD_PARTY_LICENSES:49` | **Yes** |
| L5 | **~20 upstream links carry a "verified as of 2026-07" stamp** and have not been re-checked since. They are now spread across `../decisions/prior-art.md §12`, `../decisions/facade-and-opacity.md §5` and `../research/capacitor-internals.md`, each carrying that caveat. | those three files | no |
| L6 | **Two cross-doc amendments `../design/image.md` §13 asked for and never got.** Rows 15/16: repoint `../VISION.md` §5's `Image` line at the image doc (the component shipped 2026-07-30), and note in `../research/component-surface.md` §6 that `expo-image`'s blurhash/thumbhash `placeholder` is a **native-decoder** feature that does not transfer to a WebView. | `../design/image.md:1191`, `:1192` | no |

---

## Recently evicted (shipped)

Kept only long enough for a reader who remembers these as open. Delete this table once it stops
being surprising.

| Was | Shipped as |
|---|---|
| Route / screen lifecycle | `src/hooks/use-screen-lifecycle.ts`, exported from `@arrzdev/adaptv/hooks` |
| `useAppState` | `src/capabilities/app-state.ts`, `src/hooks/use-app-state.ts` |
| Back-button priority chain | `src/capabilities/back-chain.ts`, `src/hooks/use-back-handler.ts` |
| Gesture arbitration | `src/capabilities/gesture-controller.ts` + three consumers |
| **OTA for native** ("not built") | `src/ota/` (9 runtime files) + `src/ota/build/` (3), `adaptv keys ota` → [`../design/ota.md`](../design/ota.md) |
| `.adaptv/` generated dir + `adaptv` barrel | `src/vite/adaptv-dir.ts`, `route-tree-opacity.ts`; enforced by `bin/lib/opacity.mjs` |
| SSR app shell + static-host files | `src/vite/app-shell.ts`, `src/vite/static-host.ts` |
| `dist` build (as opposed to the cutover) | `tsdown.config.ts`, `pnpm build:check`, `scripts/verify-dist.mjs` |
| `images.placeholder` config key "not wired" | `src/config/app-config.ts` (`AdaptvImagesConfig`), `src/vite/adaptv-plugin.ts` |
| Dev-loop §C "add the instance lock" | `bin/lib/lock.mjs` |
| Dev-loop §F `OFFLINE_PAGE` "keep in sync" | mechanised by `src/shell/offline-page-name.test.ts` |
| Lint delivery (Biome vs oxlint) | Biome 2.3.2, verified end-to-end (**O7** in the register) |
| **Android target API 36** | `src/native/android-sdk.ts` (`ANDROID_SDK_LEVELS`, stamped into `variables.gradle` on every Android prepare by `bin/lib/native.mjs`); `adaptv doctor` reads `variables.gradle`. The record is **B9** in [`../decisions/register.md`](../decisions/register.md) |
| Component gaps Tier 4 `FAB` | `src/components/fab.tsx`, exported from `@arrzdev/adaptv/components` → [`component-gaps.md`](component-gaps.md) |
