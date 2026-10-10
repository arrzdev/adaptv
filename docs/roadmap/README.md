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
| 2 | **`dist` cutover** | [`dist-cutover.md`](dist-cutover.md) | small | `exports` and `files` point at `dist/`. An app installed from the `pnpm pack` tarball runs (`examples/basic`). The `create-adaptv` template carries the patches. Left: whether the two `link:` shims stay. |
| 4 | **Capability gaps** | [`capability-gaps.md`](capability-gaps.md) | large | Tier 2 (dialogs, notifications, camera, biometrics, deep links; filesystem shipped 2026-09-02) is the best-formed roadmap material in the repo. Tier 3 is the long tail. |
| 5 | **Component gaps** | [`component-gaps.md`](component-gaps.md) | large | Ranked against Ionic and Expo. `Modal` and `Tabs` are the named holes; `Text`, `Collapsible`, `Slider`, `Select`, `FieldGroup`, `Icon`, `RadioGroup`, an inline `Spinner`, `ProgressBar`, `Skeleton` and `Divider` are **done**. |
| 6 | **Dev-loop debt** | [`dev-loop-debt.md`](dev-loop-debt.md) | medium | Four named items. Five of the original nine are discharged and were removed. |
| 7 | **Owed device verification** | [`owed-device-verification.md`](owed-device-verification.md) | small each | Eight checks no unit test can close. Cheap individually; they need hardware. |
| 8 | **Native keyboard curve** | [`native-keyboard-curve.md`](native-keyboard-curve.md) | small–medium | Agreed after PR #47, unbuilt. `src/capabilities/keyboard.ts` still emits height only; the OS duration/curve is thrown away. Additive, low risk. |
| 9 | **Open questions** | [`open-questions.md`](open-questions.md) | — | The questions under "Still open", plus one the register never carried; O22 (overlays) was answered 2026-09-09, O24 (Tailwind) 2026-10-05. Not work — decisions owed. |
| 10 | **Server boundary: no server functions on any target, detected from the compiler** | [`server-boundary.md`](server-boundary.md) | medium | **Owner's direction, 2026-10-05** (reverses 2026-09-14): adaptv has no server side, web included. The rule already runs; the work is coverage: refuse from the compiler's own set of server functions instead of an import list, and refuse direct imports of every engine package (L20). Detection spike done 2026-10-09 (§3, fixtures in `test/server-boundary/`); the build task is §5. |
| 11 | **`src/` reorganisation** | [`src-reorg.md`](src-reorg.md) | medium | **§0 answers "what would be ideal"** against the source trees of nine peer frameworks: all nine divide by **where the code executes**, adaptv divides by layer only, and the fix is a rename plus a gate rather than a restructure. **§1–§7** evaluate the owner's three proposals (group by domain · tests in their own folder · domain-first filenames) — **one, narrowly**, and against the other two. No locked decision conflicts. Sequenced **after** the `dist` cutover, except the one step that moves no files. |
| 12 | **Core / binding split** | [`core-binding-split.md`](core-binding-split.md) | medium–large | **L22**, decided 2026-09-09. Pull the imperative DOM work out of React into framework-free modules; **9,306 LOC across 18 files**, no behaviour change. Justified as organisation — whether a second framework binding is ever built is **O23** and is *not* decided. Wants a clean tree and an agreed order against #2 and #11, which move the same directories. |
| 13 | **Deep patches — candidates** | [`patch-delivery.md`](patch-delivery.md) §9 | unsized | The registry (§2) and the CSS post-processor (§4) **shipped** 2026-10-05; what is left in the file is a list of candidate patches, none designed. **L23** governs any of them. The real-device check of the rewrite is row 8 of [`owed-device-verification.md`](owed-device-verification.md). |
| 14 | **Platform releases, September 2026** | [`platform-releases-2026-09.md`](platform-releases-2026-09.md) | small each | Four rows, each tied to a trigger. The first **Xcode 27 / iOS 27 SDK** build does not launch on the pinned Capacitor 8.4.3 (UIScene), so a bump to ≥ 8.5.2 is forced, and that bump silently breaks three things (read from the upstream diffs, not built): `patchIosTheme`'s AppDelegate line, the old-WebView inset override, and the boot re-probe. **Target 37** breaks the physical-Android `--host` dev loop. **iOS 27** turns on scroll anchoring under adaptv's keyboard scrolls. Everything else is recorded as "no action, because". |
| 15 | **The website** | [`website.md`](website.md) | large | Unranked — it is not framework work. A survey of sixteen framework sites and the plan it produces: landing → docs → blog, built **on adaptv**, with the divergence catalogue as the landing page's centrepiece. Phases 0–1 need no install command; the hero's create command waits on #2 (the scaffolder, once #3, is built). |
| 16 | **Native desktop through Electron** | [`electron-desktop.md`](electron-desktop.md) | large | Unranked — **owner's direction, 2026-10-04: "not yet, but in the future".** A fourth host beside browser, PWA and Capacitor, behind the same capability interfaces. Lists the 19 native plugins adaptv wraps, the places adaptv calls Capacitor outside an interface, an Electron backend per API, and nine open questions; the host model (Q1) comes first. Wants #2 and #12 done before it starts. |
| 17 | **A migration skill for existing React apps** | [`migration-skill.md`](migration-skill.md) | medium | Unranked — **owner's direction, 2026-10-05: "eventually".** A `SKILL.md` an AI agent loads to move an existing React app (Vite, Next.js, CRA, Remix) onto adaptv: inventory, a report of what moves, changes or is blocked, then the edits. Carries the server rule (L3): adaptv has no server side, so Next.js API routes and server actions move to a separate backend. Best written after #2 and #3. |
| 18 | **ChopChop and Veralens move from `packages/nativ` to the published `adaptv`** | [`nativ-apps-dogfood.md`](nativ-apps-dogfood.md) | medium per app | Unranked — **decided 2026-10-09: after the alpha is on npm.** Both apps run on an in-repo copy of the framework, so the landing's "Built with adaptv" section carries a caveat. ChopChop first (71 imports, full report on TUD-423), then Veralens (17 imports; its one `Navigate` becomes a `redirect` in `beforeLoad`, and its per-route `head` needs an SSR check). Done when each installs `adaptv` from npm and its `packages/nativ` is gone. |

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
| Route / screen lifecycle | `src/hooks/use-screen-lifecycle.ts`, exported from `adaptv/hooks` |
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
| `Collapsible` (component-gaps Tier 1) | `src/components/collapsible.tsx` + `src/styles/collapsible.css`; lab `/lab/collapsible` |
| `Slider` (component-gaps Tier 1) | `src/components/slider.tsx`; lab `/lab/slider` |
| `Select` / `Picker` menu appearance (component-gaps Tier 1) | `src/components/select.tsx` (2026-09-02); `WheelColumn` remains the wheel appearance |
| Grouped-settings form / `FieldGroup` (component-gaps Tier 1) | `src/components/field-group.tsx` (2026-09-02); the grouped corners are `first:` / `last:` / `only:` in the consumer's `className`, not a `data-position` |
| Component gaps Tier 4 `FAB` | `src/components/fab.tsx`, exported from `adaptv/components` → [`component-gaps.md`](component-gaps.md) |
| **`create-adaptv` scaffolder** (was #3; the numbers below it are kept so references hold) | `packages/create-adaptv/` → [`../design/create-adaptv.md`](../design/create-adaptv.md); a published install waits on #2 |
