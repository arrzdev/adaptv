# adaptv — OTA: over-the-air updates for the native target

> ✅ **SHIPPED.** This is a description of machinery that exists, not a plan.
>
> `src/ota/{policy,updater,ledger,manifest-signing,native-fingerprint,store-release}.ts` (each with
> tests) · `src/ota/build/{ota-emit,ota-zip,ota-config-module}.ts` · `src/ota/{use-ota-updates,
> use-store-release}.ts` · `adaptv keys ota` generates the
> signing pair · `adaptv build web` publishes the update channel into the deploy when the config
> names an origin · config keys `otaPublicKey` / `otaPollMinutes` / `otaOnNativeSkew` /
> `updateRequiredAfterDays`. The end-to-end bench is `playground/apps/frontend/scripts/ota-lab.ts`.
>
> **Provenance.** This was `LIFECYCLE.md §5` until 2026-08-30, where it sat under the heading
> *"Not built. This is the design."* for roughly a month after it shipped. It was moved out because
> a thousand lines of subsystem design is a document, not a section.
>
> **Section numbers are deliberately preserved** (`§5.1`, `§5.4b`, `§5.6`, …). About forty comments
> across `src/ota/`, `src/capabilities/` and `src/config/` cite them by number, and renumbering
> would break every one of those pointers to buy nothing.

---

## 5. Update — over-the-air for native

Framing from the goal: *the build is saved on every deployment to a
default public folder*, and the app pulls it — **no third-party update server**.

### 5.1 The core insight

The Capacitor SPA (`.adaptv/web`) is **pure JS/CSS/assets — zero native code**. So an OTA update *is*
simply shipping a newer `.adaptv/web` to the installed app. The entire safety problem reduces to:
**"is this new bundle native-compatible with the installed shell?"**

**⚠︎ Policy correction (verified 2026-07-20).** Earlier drafts of this doc and `../decisions/prior-art.md §12.2` cited
"Apple §3.3.2." That citation is **wrong on two counts**:

- There is **no §3.3.2 in the App Store Review Guidelines.** The relevant Review Guideline is **2.5.2**
  ("Apps should be self-contained in their bundles… nor may they download, install, or execute code
  which introduces or changes features or functionality of the app").
- In the **Developer Program License Agreement** (v. 2026-06-18), **§3.3.2 is now "Regulatory
  Compliance"** (FDA/FAA/FCC) — nothing to do with code. The interpreted-code rule moved to
  **§3.3.1(B) "Executable Code."**

And §3.3.1(B) was **rewritten in a more permissive direction**: the historic requirement that
interpreted code run in "Apple's built-in WebKit framework or JavaScriptCore" has been **deleted
entirely** (0 occurrences of "WebKit" or "JavaScriptCore" in the 117-page agreement). The rule is now
purely behavioural — downloaded interpreted code is fine so long as it (a) doesn't change the app's
primary advertised purpose, (b) doesn't bypass signing/sandbox/OS security, and (c) doesn't create a
storefront for other apps.

**Google Play** names the exemption verbatim: the no-self-update rule *"does not apply to code that
runs in a virtual machine or an interpreter… (such as **JavaScript in a webview** or browser)"* — with
the standing obligation that OTA content must not itself violate Play policy.

> **Net: adaptv's OTA design is squarely inside both stores' rules, and the 2026 DPLA rewrite made
> Apple's position clearer and slightly broader, not narrower.** The hard line is unchanged: web
> assets only. No `.dylib`/`.framework`/`dex`/`JAR`/`.so`, ever — the packer must reject them.

### 5.2 The channel lives in the app's own web deploy

adaptv hosts OTA on the **same origin the web app already deploys to** — no Appflow/Capgo backend:

```
https://app.acme.com/.well-known/adaptv/ota/
   manifest.json           → { buildTag, nativeFingerprint, url, sha256, createdAt, signature }
   bundle-<buildTag>.zip    → the deterministic .adaptv/web build for the Capacitor target
```

**No `<channel>` segment, and no `adaptv ota` command.** Both were in earlier drafts; both are gone,
and for the same reason. (The heading here used to read *"and there is no command for it"* — publishing
turned out to need one, `adaptv build web`, for the reason worked out below. What never came back is a
command whose job is to *decide* to publish.)

*The origin **is** the channel.* A staging build deploys to the staging origin and its installs already
point there — `origin` is baked into the store binary, so an install can only ever read its own
deployment's channel. A path segment would be a second, softer copy of a decision the binary has
already made, and the failure it enables (a production install pointed at staging) is one the origin
makes structurally impossible.

*And the emission is not a decision.* "Can this ship OTA or does it need a store release?" is derivable
from the build — it is the fingerprint comparison of §5.3, computed from files that exist. A command
would ask a human to answer a question the build already knows the answer to, and the wrong answer is
silent. So the emission is a build step: **`adaptv build web` writes the channel into the web deploy's
output**, and the ordinary web deploy carries it. Literally "the build is saved on every deployment,"
with nothing for anyone to remember to run beyond the build they were already running.

> **Written into the built output, never into `public/`.** A zip in `public/` is an input to the *next*
> build, so the Capacitor bundle would swallow a copy of the app's own update history and grow without
> bound. `installOfflinePage` (`bin/lib/offline-page.mjs`) is the existing precedent for writing into
> the finished output rather than the source tree.

**`origin` is as permanent as the bundle ID.** It can only change through a store release, and the
installs that never take that release are orphaned at the old origin forever. It belongs in the config
with that weight attached, not as a deploy detail.

#### 🔴 A cleartext origin is not a slow channel, it is no channel at all

`resolveOtaBuildConfig` **fails the build** on an `http:` origin that is not a local address
(`assertReachableOtaOrigin`). Both mobile platforms refuse cleartext by default, and they refuse it
*inside the platform's own network stack*: the update check throws before a byte leaves the device,
the updater catches that the way it catches being offline — correctly, for a real network — and the
launch asks for nothing. Nothing is logged, nothing is retried differently, and every install stays
on its store version for good.

It has to be caught at build time because there is no later. It is invisible in the bundle, invisible
on the web (where the browser reads the origin, not the platform), and shows only on an installed
device, as an update system that installs nothing and reports no error.

Local addresses (`localhost`, `127.0.0.1`, `10.0.2.2`) are allowed through, because that is a bench
pointed at a channel on the same machine. Reaching one of those from a device still needs the
platform's own dev exception — on Android a `network_security_config` naming those hosts, which
`ota-lab` writes into the generated project itself and nothing ships. **Measured, not inferred:** the
Android leg of the bench asked for nothing at all until that policy existed, and the probe that
settled it was one call to the native http plugin over the WebView's debugger, answering
`Cleartext HTTP traffic to localhost not permitted`.

#### Which build emits it, and how it knows the channel is stale

*Decided 2026-08-14.* **The `web` build emits, running the Capacitor build as a sub-step.** The zip must
be the `capacitor`-target client (SPA, no SW), which is *not* what a web build otherwise produces — so
the emitting build has to make both. The alternative (the native build writes it, the web deploy merely
carries it) is one producer instead of two passes, but it breaks the promise that makes this design
worth having: deploying the web app would silently publish a missing or frozen channel whenever someone
forgot to run the native build first.

*Implemented 2026-08-14 as `adaptv build web` (`bin/adaptv.mjs`), not as a Vite plugin.* The two
lineages are chosen **per process** (`ADAPTV_TARGET`), so no plugin inside a single `vite build` can
produce both. Publishing is therefore a command that sequences them:

1. build the `capacitor` client into `.adaptv/web` → hash it (`buildTag`) → archive it into `.adaptv/ota/`
2. build the site
3. write the archive + `manifest.json` under `.well-known/adaptv/ota/` in the directory the site build
   wrote: `.output/public` for `render: "ssr"`, `dist/client` for `"spa"`

**Step 1 precedes step 2, and `bin/lib/ota-publish.test.mjs` pins the order.** The reason given here
was that step 2 overwrites the directory step 1 reads: reordered, the command would still succeed while
publishing the *site* as the native bundle — an update every device downloads and none can boot. The
client outputs no longer overlap: the native build writes `.adaptv/web` (`src/vite/capacitor-config.ts`)
and the site build's client output is `.output/public` or `dist/client` (`src/vite/build-stamp.ts`). The
server build's `dist/server` scratch is still shared by both (`src/vite/native-bundle.ts`).

This replaced the CLI's deliberate refusal of `build web` ("a web build is `adaptv preview web`"), which
stopped being true the moment there was something only a web *build* could produce. `preview web` still
serves; it does not publish.

**The archive is written on every deploy, changed or not.** A deploy replaces the whole site, so an
"it's already up there" skip deletes the channel from the next one and every install starts 404ing.
What an unchanged build does skip is the *announcement*: `createdAt` is carried over from the deployed
manifest when the tags match, so a scheduled re-deploy of identical bytes is not read as a release by
the replay defence (§5.4c).

**Staleness is answered by the deployed manifest, not by a local cache.** The obvious move is to reuse
`bin/lib/fingerprint.mjs` — the `run`/`build` accelerator — but it cannot answer this question:

- `.adaptv/state.json`, where the last-seen hash lives, is **gitignored**, so a CI checkout starts with
  an empty cache every single time.
- It is **mtime**-based (deliberately, `fingerprint.mjs`), and a fresh clone stamps every file with the
  checkout time, so even a preserved cache would report "everything changed" on every run.

The state that actually persists across deploys is the deploy itself. `buildTag` is a **content hash of
the built client** — the same property that makes rollback free — so the build fetches
`<origin>/.well-known/adaptv/ota/manifest.json`, compares tags, and emits only on a difference. No
cache, no CI configuration, and identical behaviour on a laptop and on a clean runner. A 404 (first ever
deploy) and an unreachable origin both mean "emit", which is the safe direction.

> **Old zips do not need carrying forward**, which is the tempting mistake on an immutable-deploy host
> (Pages/Netlify replace the whole tree). A device that already downloaded a bundle has it *locally*,
> and rollback is a local operation over local bundles — the server is never asked for an old one. Only
> the current `manifest.json` + its zip need to exist.

So the split is: **correctness is adaptv's** (content hash vs the deployed manifest), **speed is also
adaptv's** (the existing local fingerprint cache skips the extra Capacitor pass when nothing changed —
an accelerator only, never the thing that decides whether the channel is right), and **CI/CD's job is
nothing** beyond deploying the site build's output as it already does.

> The bundle cache does **not** key on `fingerprint(appRoot)` alone, the way `dev` and `preview` do.
> That walk skips `node_modules`, which is right for them and wrong here: upgrading adaptv would report
> a hit and publish a bundle built by the previous version *to every installed device*. "Worst case you
> look at slightly stale code" stops being the trade the moment the artifact ships. The key is the app's
> sources + the native plugin set + adaptv's own runtime source.

#### How often an install looks — `otaPollMinutes`

*Decided 2026-08-15.* Launch and resume cover almost every session, and they share one blind spot: a
session that is **neither relaunched nor backgrounded**. A tablet left on a counter, a phone held open
through a shift, a device on a stand — those apps check once and then sit as far behind the deploy as
the session is long. Worse, the two events are *coupled to each other*: because the swap is staged
(§5.4), a bundle that arrives during a session needs a second cold start to be seen, so the practical
cost of a missed check is not one launch, it is two.

So there is a third check, on a timer, and it is a **config key with a default** rather than an
interval adaptv picks:

```ts
otaPollMinutes: 60   //the default. 0 turns it off; the minimum is 5.
```

*A key, not a constant,* because the right number is a property of the app and adaptv cannot see it. An
internal tool on office wifi and a consumer app on a metered connection want different answers, and the
cost of the wrong one lands on the app's bill, not on the framework's. *With a default,* because the
blind spot is real and an app that configures nothing should not have it — the same stance as
`otaOnNativeSkew: "install"`.

**It moves when the download happens, never when the swap does.** A tick that reloaded the WebView
would tear the live session it was polling from, which is the one thing §5.4 exists to prevent. A poll
that finds an update stages it exactly as launch and resume do; the user sees it at their next cold
start, with the bundle already on disk.

Three properties the implementation has to hold (`src/ota/updater.ts`, pinned in `updater.test.ts`):

- **One check at a time.** Two concurrent checks both reach `downloadBundle` for the same tag, and the
  plugin answers the second by *throwing*. That throw is caught — so the symptom is not an error, it is
  the second check abandoning its run before `setNextBundle`: bytes on disk and no pointer at them. The
  overlap that actually happens is a resume landing on a check already in flight over a slow network.
- **The clock is restarted by every check**, not free-running. "This long since we last looked" is what
  was asked for; a free-running interval makes resuming an app cost a check and then a tick moments
  later, which is two requests for one answer.
- **Resolved at build time** (`resolveOtaPollIntervalMs`), so the shipped bundle carries a literal
  number of milliseconds and no runtime reproduces the default.

**The 5-minute floor refuses the build rather than clamping.** `otaPollMinutes: 30` meaning half a
minute and `otaPollMinutes: 30` meaning half an hour are indistinguishable in a config file and differ
by sixty times the traffic — and the difference shows up on a CDN bill months later, never in testing.
A clamp would silently reinterpret what someone wrote; the error says which unit it is and points at
`0` for turning the poll off. `0` is off, not unset: launch and resume still check, and there is no
configuration in which an installed app never looks for an update.

### 5.3 The compatibility signal — `nativeFingerprint`

The crux (the thing Capgo's CLI gets right, `../decisions/prior-art.md §12.2`). At build time adaptv computes a
**`nativeFingerprint`** = hash of the native surface: the installed Capacitor plugin set + versions +
core version + `appId` + any custom native code. It's baked into **both** the store binary and every OTA
manifest.

- **fingerprint matches** → the JS bundle is compatible with the installed shell → OTA is safe: download,
  verify `sha256`, unpack to a data dir, set as the pending bundle, **apply on next launch**.
- **fingerprint differs** → the native surface moved. What happens then is `otaOnNativeSkew`, and the
  default is **install anyway**: the bundle runs, and the parts of it that need native code this binary
  does not have report themselves unavailable through the capability hook that wraps them (§5.6).
  `"refuse"` is the other
  setting — no download, and the install waits for the store.

Either way the JS never *silently* calls into a shell that cannot serve it, which is what keeps adaptv
inside **DPLA §3.3.1(B)** (per the §5.1 correction — *not* "§3.3.2", which is Regulatory Compliance).
The bundle is web content either way; what the fingerprint buys is that the app knows which half of
itself the installed binary can actually run.

🔴 **This used to be a gate, and turning it into a signal is a deliberate reversal.** A gate makes the
native surface the release cadence of *everything*: one added plugin, and every copy fix, every crash
fix, every layout correction in that release waits on review plus however long users take to update.
Under "once the app is in the store, everything is OTA" that is the wrong trade — the fix that ships is
worth more than the feature that is dark. The cost is that a feature *can* be dark, which is why the
runtime question has to be askable (§5.6) rather than assumed away.

#### 🔴 It is **not** `nativeFingerprint()` from the CLI

`bin/lib/fingerprint.mjs` exports a function of the same name. It is a **build-cache key** — it hashes
icons, the config, the pbxproj, everything that would make a native rebuild necessary. Using it here
would refuse every OTA update after an icon tweak.

This one hashes only what a JS bundle can *call*: the native plugin set, each plugin's version, the
core version, `appId`. Two functions, one name, opposite tolerances for change. Whoever unifies them
breaks the gate in the direction that has no symptom until a user's device crashes.

#### 🔴 A store release does not reset the pointer — adaptv must

Verified in the plugin source: `checkAndResetConfigIfVersionChanged()` detects the version change and
calls `resetConfig()`, which is one line — `preferences.setAppId(nil)`. **The current-bundle pointer
survives untouched.** Downloaded bundles live in `Library/NoCloud/`, which survives an app update, and
so does the preference naming which one is current.

So: install v1 (fingerprint F1), take OTA bundle B (F1), update through the store to v2 (F2, new native
plugin) — and the first launch after that update runs **B, built for F1, against F2**. Exactly the
incompatibility this gate exists to prevent, arriving through the one path the gate never sees, because
it happens inside the plugin before any adaptv code runs.

Under adaptv's model this is not an edge case, it is the default: **a store release only happens
*because* the native layer changed**, so nearly every store release lands here.

Falling back to the embedded bundle when the native layer did *not* actually change costs one OTA
download and is safe by construction, so the version change is a sufficient proxy — no custom
fingerprint needs stamping into `Info.plist`/`strings.xml`.

> ### ✅ BUILT — `returnToEmbedded` in `updater.ts`, the first thing `settleLaunch` does
>
> **The stuck state is worse than the draft above says, and it is silent.** Every fingerprint the
> running JavaScript can see is baked into *itself*: `otaConfig.nativeFingerprint` is what the running
> bundle was built against, and no bundle can observe the binary underneath it. So after the store
> release the channel advertises a bundle for F2, the stale bundle compares it against **F1**, and
> `decideUpdate` answers `needs-store-release` — for a release the user already installed. Nothing on
> the device or on the channel breaks that loop. The app is stranded on B for good, and from the
> outside it looks like updates simply stopped being published.
>
> The app **version** is the signal, because it is the one thing the OS changes on a store release and
> the one thing JavaScript can still read (`getVersionName` + `getVersionCode`). Changed since last
> launch, and not already on the embedded bundle → `reset()` + `reload()`. The new version is recorded
> **before** the reset, so a reload racing a second launch cannot loop.
>
> **An earlier draft said the guard has to be native, because a JS guard runs inside the stale bundle.**
> That is the right worry and it is already covered from the other side: if the stale bundle does not
> survive contact with the new binary, it never pings, and the `readyTimeout` watchdog rolls back to
> the embedded bundle by itself. The two paths meet — boots → this guard resets it; does not boot →
> the watchdog does.
>
> **🔴 An earlier draft of this section also predicted a third thing that does not happen: a visible
> reload on the launch after a store update, which §5.5's native patch would remove.** Reading the
> host rather than reasoning about it says otherwise. Capacitor refuses its own persisted server path
> whenever the binary version moved — `Bridge.isNewBinary()` blanks `CAP_SERVER_PATH` before
> `loadWebView` reads it, and `CAPBridgeViewController.updateBinaryVersion()` nils `serverBasePath`
> before `instanceDescriptor()` consults it. So the stale bundle is never loaded at all, on either
> platform, with or without the patch. This guard's `current === null` check is what keeps it honest
> about that: on the launch after a store release the plugin already reports no current bundle, so the
> guard correctly does nothing rather than reloading a document that is already the right one. It
> stays as the net for a pointer that somehow survives — not as the normal path.
>
> **Verified on a simulator by bumping `MARKETING_VERSION` and reinstalling over the top**, with the
> device's bundles and ledger left in place. The app came back on the embedded bundle, exactly as
> designed — and then would not leave it, because `reset()` clears the pointer but keeps the bundle,
> and the plugin refuses to re-download one it already has. That second stranding is fixed in
> `startOtaUpdates`; the story of it is in §5.4d's device-verification block, because it is not
> specific to store releases.

> ### ✅ BUILT (2026-07-20) — `src/ota/policy.ts` + `updater.ts`, 14 tests
>
> **Policy is pure and fully tested; the mechanism is rented.** `decideUpdate`,
> `selectRollbackTarget`, `selectPrunableBundles` and `decideFirstLaunch` take plain data — no
> plugin, no filesystem, no network — because *when to apply*, *what may be trusted* and *what to
> roll back to* are exactly the decisions whose failure modes are ugly, and they should be
> verifiable without a device.
>
> Two functions that were here have since been **deleted rather than wired**: `selectBootBundle`
> and `hasProvenItself`. Both described decisions adaptv does not get to make — the boot pointer is
> resolved in native code before any JavaScript runs, and the "did it boot" proof is that the app is
> running at all. Keeping them would have left the next reader looking for the call site of a
> function that could never have one.
>
> Guarded in tests, each for a specific failure:
> - **Native-fingerprint mismatch → refuse.** Not a version check, a *compatibility* check: a bundle
>   calling a plugin the installed binary lacks crashes on a user's device, and OTA bundles never pass
>   review or a staged rollout, so nothing upstream catches it.
> - **Unsigned manifest → refuse** (default). An update channel is a remote-code-execution channel into
>   every installed app.
> - **Pruning never deletes the last known-good.** That retention *is* rollback; removing it turns a bad
>   deploy into a bricked app with no recovery path.
> - **A pending bundle that never pings is failed**, and the watchdog falls back. Silence must read as
>   failure, because a bundle that cannot boot cannot update itself out of that state.
>
> `startOtaUpdates` checks on launch **and on resume** — the resume path matters more, since a mobile
> app is backgrounded far more often than cold-started, and a launch-only check can leave a user stale
> for days. It is a direct consumer of the coordination layer's `onResume`, which exists precisely
> because a native WebView resume is not a browser focus event.
>
> **And on a timer, if the app asks for one — `otaPollMinutes`.** See below.
>
> The other half is `settleLaunch`, and losing it is silent: it is what tells the watchdog the bundle
> reached the app. Dropping that call does not disable the watchdog, it **inverts** it — every update
> rolls itself back one launch later, which looks exactly like updates that never install. Both live in
> one effect (`useOtaUpdates`) so they cannot be wired up separately.

### 5.4 Applying, safety, rollback

- **Apply on next launch, never mid-session** — swapping the WebView root under a live app tears its
  state. The download happens in the background (on launch + on **resume** — this is a consumer of the
  `useAppState` resume signal from the coordination layer — and on the `otaPollMinutes` timer); the
  swap happens at the next cold start.

> #### The one exception is a *screen* state, not a device state
>
> `decideFirstLaunch` may apply a bundle immediately, and it is right to: a brand-new install whose
> bundle is already stale should show a new user the current product, not a version of it that no
> longer exists. Nothing is torn, because nothing is on screen — the native splash is still up.
>
> 🔴 **`action: "wait"` is not on its own permission to do that**, and this is the trap the poll
> exposed. The verdict is computed from `cachedAtStart`, which is read **once** when the updater
> starts, so an install with nothing proven yet keeps answering `"wait"` for the whole session. Three
> ordinary paths then reach `plugin.reload()` on a mounted app: a resume, a poll tick, and — the most
> common of the three — a launch check that simply outran `FIRST_LAUNCH_BUDGET_MS` on a slow network,
> so the app was revealed while its own check was still in flight. Each one replaces the document
> underneath the user: scroll position, half-typed input and open sheets all gone, and nothing about
> it reads as an update.
>
> So the reload is gated on `launchScreenStillUp()` — the hold still being held — which is the actual
> precondition ("nothing is visible to tear") rather than a proxy for it. Every release path clears
> the hold, including the budget timer, so it goes false at exactly the moment applying in place stops
> being free. The staged path is what those checks get instead, which is the rule above. Pinned by
> four tests in `updater.test.ts` ("applying in place, which only a launch may do"); two of them fail
> against the code as it stood before the poll existed.
- **Boot watchdog + rollback** — the shell pings "app ready" after a successful boot. If a freshly
  applied bundle doesn't ping within N seconds, the updater reverts to the last-known-good bundle on the
  next launch. Never brick. Keep ≥1 previous good bundle.
- **Integrity** — `sha256` in the manifest is verified before unpack; the manifest should be signed (an
  app-held public key) so a compromised CDN can't push arbitrary JS.

**No server kill switch, and no phased rollout.** Both are standard in hosted OTA products and both are
wrong here. A kill switch would be a *second* source of truth about which version is current, competing
with the host's own release management — the recovery path is already "fix it and promote the previous
deployment," which is the one the team already knows. A phased rollout deliberately desynchronizes the
native cohort from the web one, which is the single invariant adaptv exists to hold. The per-device
equivalent of a kill switch — the local blocked list — is mandatory, and it is what stops a rolled-back
bundle from being re-downloaded on the very next launch.

#### The rollback target is the last known-good, not the embedded bundle

The rented plugin rolls back to the **embedded** bundle, unconditionally. Under adaptv's model that is
the wrong target and the wrongness compounds: the embedded bundle is from the last store release, which
by design may be a year old. A single bad deploy would throw every device back a year, and a device that
had been happily running last week's bundle loses it for a defect it never encountered.

adaptv keeps ≥1 known-good bundle precisely so this target exists. Rolling back to the embedded bundle
is the *last* resort, not the first. §5.5 is the patch.

#### `ready()` keys on the same signal the boot fallback does

There is exactly one question — *did the app mount?* — and it already has an answer in the codebase:
`boot-fallback.ts`'s watchdog asks whether the mount point has children. `ready()` must use that same
condition rather than inventing a second definition that can drift from it.

B30 removes the trap the earlier draft worried about. adaptv installs **no runtime error boundary**, by
decision, and the boot fallback is prerendered HTML that runs no app code — so there is nothing in
adaptv's own surface that could call `ready()` from a failure path and certify a broken bundle as good.

#### 🔴 The two clocks must be ordered, and the naïve ordering is wrong

Two independent timers now answer "has this bundle booted?", and they are started at very different
moments:

| | Starts at | On expiry |
|---|---|---|
| `BOOT_GRACE_MS` (8000) | `DOMContentLoaded`, in the document | reveals the error screen |
| `readyTimeout` | **plugin `init()`**, in native code | rolls the bundle back |

`startRollbackTimer()` is called from the plugin's constructor — verified at `LiveUpdate.swift:41` and
`LiveUpdate.java:128` — which is *before* the WebView has loaded the document at all. So the correct
constraint is not `readyTimeout ≥ BOOT_GRACE_MS`:

> `readyTimeout ≥ (native launch → DOMContentLoaded) + BOOT_GRACE_MS + margin`

The gap is the whole native boot, WebView setup, and document fetch/parse — 1–3 s on a slow Android
cold start. The plugin README's recommended `10000` against `BOOT_GRACE_MS = 8000` leaves ~2 s *minus*
that gap, which can be negative. Get it wrong in that direction and a merely **slow** bundle is rolled
back before the document has even given up on it — and `autoBlockRolledBackBundles` then makes the
mistake sticky. A false rollback is worse than no rollback, so the value is measured on the slowest
target, not inherited from the README.

### 5.4a First launch — the one place blocking is right

Everywhere else, blocking the user on a network check is the wrong trade, and every mature OTA product
says so (Expo calls a launch-blocking fetch "extremely poor" UX). **First launch is different, and it is
different because of adaptv's own model.**

If store releases only happen when the native layer changes, the embedded bundle can be arbitrarily old
by the time someone installs. A user who installs after fifty OTA deploys would otherwise get the
year-old onboarding, use it, and see the app change under them on the second launch. That is not a stale
cache; it is showing a new user a product that no longer exists.

So on the **first** launch, and only when nothing usable is cached, adaptv waits. Three branches:

| Situation | Behaviour |
|---|---|
| No update available | Normal path, no wait. |
| Update available and fingerprint-compatible, **no cached bundle** | **Wait**, under a budget. The embedded bundle is the floor if the budget blows. |
| Update available but **fingerprint mismatch** | **Boot the embedded bundle immediately.** No budget, no wait. |

The third branch is whoever installs during the store review window: the binary is the old fingerprint,
the channel already advertises the new one, and there is no point waiting for something this device can
never apply.

The cached-bundle test is `getDownloadedBundles()` **filtered by the device's fingerprint** — a bundle
this device cannot run is not a cache hit.

#### What the user looks at while it waits

Not a progress bar, and not an adaptv-branded screen. The splash is the consumer's, optional, and
adaptv's standing job is to get the native one out of the way as fast as possible — that does not change
here.

- **The app defines a splash** → hide the native mask, mount **only the splash**, and hold the app tree
  unmounted until the swap is done.
- **No splash** → simply do not release the native mask yet.

Either way the covering surface is already the right one, and it stays up across the `reload()` that
applies the bundle, so there is no white flash. What must *not* happen is mounting the app tree and then
swapping the bundle underneath it.

> **A known, accepted cost:** with a consumer splash, the screen shown during that first wait is the one
> from the *embedded* bundle — so an app that redesigned its splash shows brand-new users the old one,
> once, for the duration of one download. The alternative is a solid colour with no brand at all. The
> splash loses less.

The mount gating has a precedent: `shell-layout.tsx`'s `notFound` path already handles "the tree never
mounts, so the splash never retires itself," which is why `splashRetired` exists.

### 5.4b ⚠︎ "Replace in place" is the one thing not to do

A natural way to describe this is *"hit the URL, replace the build in place, next launch is fresh."*
The first and last parts are right; **the middle one must not be literal.**

```
   ❌ overwrite the running bundle dir        ✅ write a NEW dir, then flip a pointer
      bundles/current/  ← unpack over it        bundles/<buildTagA>/   ← last known good
                                                bundles/<buildTagB>/   ← newly downloaded
                                                pointer = B (applied at next cold start)
```

Three reasons the pointer-flip is required, not stylistic:

1. **The running bundle is memory-mapped and actively serving.** Overwriting files under a live
   WebView produces torn reads and undefined behaviour — some chunks old, some new.
2. **Rollback becomes impossible.** §5.4's watchdog reverts to the last-known-good bundle if a fresh one
   fails to ping "app ready." That only works if the previous bundle still physically exists. Overwriting
   destroys the thing you roll back *to*, which converts a bad deploy into a **bricked app with no
   recovery path** — the exact failure OTA must never have.
3. **Interrupted downloads.** Unpacking over the live directory means a connection drop mid-write leaves
   a half-replaced app. Writing to a new dir makes the swap atomic: it either flipped or it didn't.

So: download → verify `sha256` → unpack to `bundles/<buildTag>/` → mark pending → **flip at next cold
start** → keep the previous dir until the new one proves itself. Retain ≥1 known-good bundle; prune
older ones on successful boot.

### 5.4c Minify, don't obfuscate

The production build already minifies — that's the win, and it's free. **Obfuscation is a separate
thing and not worth it here:**

- **It buys no secrecy.** The same bundle is already served publicly to every browser visiting the web
  app. The OTA zip is not exposing anything that wasn't public.
- **It costs the thing OTA needs most: debuggability.** OTA ships code that never touched a reviewer or
  a store rollout. When a bundle boots wrong in the field, the watchdog log and the stack trace are all
  you have — obfuscation makes them unreadable exactly when it matters.
- Source maps then have to be uploaded and matched per bundle to undo the damage.

Ship minified + content-hashed. If a secret is in the bundle, obfuscation doesn't protect it — moving it
server-side does.

### 5.4d 🔴 Signing is not optional — the blast radius is categorically different

`§5.4` says the manifest *"should be"* signed. **Make that a must**, because the failure mode is not
comparable to a normal web compromise:

| Compromise | Web deploy | OTA channel |
|---|---|---|
| Attacker controls | what a visitor sees this session | **code inside every installed app** |
| Persistence | gone on next deploy | **survives; the app re-applies it every launch** |
| Sandbox | browser | the app's own origin, with **every granted native permission** — camera, location, secure storage, biometrics |
| User can escape by | closing the tab | **reinstalling the app** |

A hijacked DNS record or a compromised CDN edge is enough. `sha256` in the manifest protects against
*corruption*, not *substitution* — the attacker rewrites both the bundle and its hash. **Only a
signature the app verifies with a public key baked into the store binary breaks that.**

Practical shape: sign the manifest with an offline private key; embed the public key in the native
shell (so it can only change via a store release); verify before unpack; refuse and keep the current
bundle on mismatch. Support a second "next" public key in the shell so the signing key can be rotated
across one store release without bricking updates.

#### 🔴 Sign the manifest, not only the zip — otherwise the two defences cancel out

The rented plugin's `signature` covers **the zip's bytes**. That leaves every field *around* it
unauthenticated, and the monotonic-`createdAt` downgrade defence is built out of exactly those fields.
So an attacker who can serve the channel replays a genuine old pair with one field rewritten:

```
{ buildTag: A_old, createdAt: <now>, signature: sig_A }  +  zip_A
```

`createdAt` passes, because it is newer. The signature passes, because it is authentic — it really is
the signature of `zip_A`. **A signed downgrade, with both defences switched on**, back to a bundle whose
vulnerability is already public.

So adaptv signs a **canonical serialization of the manifest** with the zip's sha256 inside it. Then
`createdAt` and `buildTag` are inside the signed envelope and the replay stops being expressible.

#### Where signature verification happens, and where it does not

`src/ota/policy.ts` runs in the WebView. It requires the signature field to be **present and
well-formed** and passes it down; it never verifies it. Verification is native, against a key that
lives in the store binary, because a check performed by the code an attacker is trying to replace is
not a check. This is written down because the function reads like the natural place to put it.

> ### ✅ BUILT — `adaptv keys ota`, `src/ota/manifest-signing.ts`, `src/ota/build/ota-emit.ts`
>
> **The contract was measured, not assumed.** The plugin's native check is RSASSA-PKCS1-v1_5 over
> SHA-256 of the zip — Android builds the key through `X509EncodedKeySpec` (SPKI) and iOS through
> `SecKeyCreateWithData(kSecAttrKeyTypeRSA)` then `rsaSignatureDigestPKCS1v15SHA256`. Apple's
> documentation says PKCS#1; a Swift experiment against the real Security framework showed
> `SecKeyCreateWithData` takes **either**, so one SPKI PEM works on both platforms and no native patch
> is needed for signing. A second experiment verified a signature produced by Node's
> `createSign("sha256")` under exactly the call the plugin makes, with a flipped-byte control.
>
> **Both signatures, and neither substitutes for the other.** `signature` (the zip, checked natively)
> keeps attacker code out of the app. `manifestSignature` (the canonical form above, checked in JS)
> keeps a CDN compromise from rearranging honest bundles. `decideUpdate` refuses a manifest carrying
> only one — that is not "partly signed", it is missing exactly one of the two defences.
>
> **The key pair is `adaptv keys ota`, and adaptv keeps no copy of the private half.** A key adaptv
> stores is a key adaptv can lose, and losing it means no installed app can be updated again until a
> store release carries a new public half out. The public half lives in `adaptv.config.ts` under
> `otaPublicKey`, committed on purpose (it is baked into the store binary, and changing it *is* a
> store release); the private half is `ADAPTV_OTA_PRIVATE_KEY` in the deploy's secret store, never a
> config field, because a config field gets committed.
>
> **`adaptv build web` refuses to publish rather than publish something unverifiable.** Four states,
> all of which otherwise produce a green CI run and a channel every device rejects: no declared public
> key, a public key no device can load, no private key in the environment, and — the only place it is
> catchable at all — a private key that is not the other half of the declared public one. The check
> runs *before* the bundle is built, so the answer costs a second rather than two builds.
>
> ⏳ **Key rotation is not implemented.** §5.4d's "second *next* public key in the shell" needs the
> native side to accept two, and the rented plugin's config takes exactly one — so rotation today means
> a store release, with the usual gap while devices take it. Accepting two keys in JavaScript alone
> buys nothing: the native check would still refuse a manifest signed with the new one. The open
> question is what an install that never takes that release does — see §5.7.
>
> `ADAPTV_OTA_PUBLIC_KEY` (only alongside `ADAPTV_OTA_ORIGIN`) overrides the declared key for local
> verification, and it is not a convenience. The committed key's private half lives in a secret store
> by design, so without an override the only ways to exercise a *signed* channel locally are holding
> the production key on a laptop or editing the committed config. Both are worse than a variable.
> One resolver (`resolveOtaPublicKey`) feeds the JS check and the Capacitor config together —
> resolved separately, a build could trust one key in JS and another in native, which on a device
> reads as "the update downloads and is then silently refused".

> ### ✅ VERIFIED ON DEVICE (2026-08-14) — iPhone 16 Pro simulator, signed channel, `playground … ota-lab`
>
> The bench publishes through adaptv's own `writeChannel` with a real key pair, so what the device
> verified is the shipped emitter and not a re-implementation of it. What ran:
>
> - **Install → check.** The binary carries the public key in `capacitor.config.json` *and* in the
>   bundle (`requireSignature: true`), and asks `/.well-known/adaptv/ota/manifest.json` on launch.
> - **First launch applies immediately.** Nothing cached → splash held → downloaded → reloaded, badge
>   visible on launch 1. That is `decideFirstLaunch`, not a leak of the staging rule.
> - **Every later publish takes two launches.** Download and stage on one, swap on the next cold
>   start. Confirmed by the badge staying on the *old* colour through the launch that downloaded.
> - **A tampered `manifestSignature` is refused before the download.** One flipped base64 byte, zip
>   signature left valid: the device fetched the manifest and **never requested the zip**. Restoring
>   the byte installed the same bundle — the control that makes the refusal mean what it says.
>
> 🔴 **And it found a bug no unit test could have.** The rented plugin *throws* when asked to download
> a bundle it already has (`bundleAlreadyExists`). That throw landed in the check's catch-all, so
> `setNextBundle` was never reached and the app **never ran that bundle again** — it re-fetched the
> manifest every launch and did nothing, forever. Two ordinary paths reach it: every store release
> (`reset()` clears the pointer and leaves the bundle on disk) and any launch killed between the
> download and the next cold start. `startOtaUpdates` now asks `getDownloadedBundles()` first and
> stages what is already there. Reproduced on a stranded device, then fixed on the same device with
> no network transfer at all.
>
> Skipping that download skips no verification: a bundle is on disk only because a download verified
> it, and the tag is a content hash, so "already have this tag" is "already have these exact bytes".

> ### ✅ VERIFIED ON DEVICE (2026-08-14) — the safety net, with a bundle that genuinely cannot boot
>
> `poison` publishes a bundle with a `throw` as the entry module's first statement, which is the only
> honest way to ask whether the net exists. What ran, in one sitting:
>
> - **The watchdog reverts.** The bundle loaded, never mounted, never pinged, and the plugin put the
>   app back roughly fifteen seconds in — onto the *embedded* bundle, unconditionally. That was the
>   unpatched plugin showing exactly the behaviour §5.5's first edit exists to change; the same
>   sequence, re-run after the patch, lands on the last known-good OTA bundle instead.
> - **The reverted tag is blocked, so there is no boot loop.** The channel kept advertising the
>   poisoned build across further launches; the device fetched the manifest each time and never
>   re-downloaded it. That is `autoBlockRolledBackBundles` feeding `decideUpdate.blockedBuildTags`.
> - **The boot screen shows, and shows the specific code.** `BOOT-THROW`, not the vaguer `BOOT-STALL`
>   the stall timer would have written eight seconds later — the first-signal-wins guard, on a device.
> - **The retry button is a real escape.** Tapping *Reload* dropped to the embedded bundle in about
>   three seconds, well inside the watchdog's window, so a user is not made to wait it out.
>
> 🔴 It also found the splash bug in §5.4e: for the first two of those runs the screen was revealed
> under an opaque native view. A bench that only asserted "the app recovers" would have passed.
>
> ⚠︎ **The first poison was a no-op, and it looked like a finding.** The `throw` was *appended* to the
> entry, so it fired after the module body had already mounted the app: the bundle booted, pinged, and
> was marked known-good, while the bench reported a watchdog that had not fired. Appending works for
> the badge (`stampBadge`) because CSS has no evaluation order; a module body has one.

> ### ✅ VERIFIED ON DEVICE (2026-08-14) — Android emulator (Pixel 7, API 36), the same signed channel
>
> Android is not a formality. The zip's signature is checked by a **different implementation** on each
> platform — `X509EncodedKeySpec` + `SHA256withRSA` there, `SecKeyCreateWithData` +
> `rsaSignatureDigestPKCS1v15SHA256` on iOS — so a key shape one accepts and the other does not gives
> a channel that works perfectly on half the installed base, and nothing but running it says. The same
> SPKI PEM and the same signed zips that the iPhone took were served to the emulator unchanged:
>
> - **The whole loop.** First launch applied immediately (`decideFirstLaunch`); every later publish
>   downloaded on one launch and swapped on the next cold start, badge and all.
> - **A tampered `manifestSignature` is refused before the download**, with the restore-and-install
>   control on the same bundle.
> - **The safety net.** Poisoned bundle → boot screen reading `BOOT-THROW`, watchdog reverting to the
>   embedded bundle at ~15s, the poisoned tag blocked afterwards, and the plugin's own state confirming
>   it: `current: null`, `blocked: [<poisoned>]`, and the *previous good* bundle still on disk while the
>   poisoned one was deleted.
> - **The §5.4e splash fix holds on Android too.** At 10s the screen was still the opaque native view;
>   by 16s the ES5 watchdog had revealed the boot screen and cleared it.
>
> 🔴 **It found the cleartext trap in §5.2.** Before that was understood the Android app requested
> *nothing at all*, which in the channel log is indistinguishable from an app that was never wired for
> updates. The framework now refuses an unreachable origin at build time rather than shipping one.

### 5.4e The three error layers, and why the bottom two overlap

Since #54 there are three distinct things that respond to "the app isn't there," and they are not
interchangeable:

| Layer | Lives in | Catches | Does not catch |
|---|---|---|---|
| **App error boundary** | the bundle — **the consumer's**, adaptv installs none (B30) | render errors after mount, failed fetches, a route that throws | anything that kills the bundle before it mounts |
| **Boot fallback** | prerendered HTML in the document + inline ES5 watchdog | `BOOT-LOAD` / `THROW` / `REJECT` / `STALL` — the bundle that never executed | anything that boots and then misbehaves |
| **OTA watchdog** | native, outside the JS entirely | a bundle that never pings `ready()` | same |

The boundary lives inside the thing it protects: if the bundle dies before React mounts, the boundary
does not exist. That is not a gap to close, it is why B31 exists.

The bottom two **overlap** — both fire on "the bundle didn't boot" — and the difference is what they
*do*: one shows, one reverts. That overlap is the source of both hazards above (the two clocks, §5.4)
and below (the retry button). Left uncoordinated, they show the user an error and then disagree about
what happens next.

#### 🔴 Under OTA, the fallback's retry button is a trap

`getBootFallbackScript()` reloads on any `<button>` click. That is right in the general case and
well-argued in B31 — in a document where no app JavaScript is running, a button has no other reachable
behaviour.

But **`location.reload()` re-runs the same broken bundle.** `serverBasePath` is applied by the bridge at
*launch*; reloading the WebView does not revisit it. So a corrupt OTA bundle produces: fallback appears
→ user taps retry → fails → taps again → fails, indefinitely. The native rollback may have already
chosen a target and it stays inert, because only a real cold start — or the plugin's own `reload()`,
which re-reads the pointer — applies it. The user's only escape is to kill the app, and nothing on
screen says so.

The fix needs no patch: `reset()` and `reload()` are both public API on both platforms. On native the
retry calls them instead, which drops to the embedded bundle (or, with `setNextBundle`, to the last
known-good) without a cold start. The inline script can reach them because **the bridge is injected
natively, independently of the app bundle** — the same property `bin/lib/offline-page.mjs` already
relies on to reach `CapacitorHttp` from a page that is not part of the bundle. It stays ES5, and it
degrades to `location.reload()` wherever there is no bridge, which is web and PWA.

#### 🔴 And the fallback was revealing itself under an opaque native view

Layer 2's whole job is to *show* something, and on native it was showing it to nobody. The launch
splash is a **native view over the WebView**, held open on purpose (`launchAutoHide: false`, §5.4c) so
there is no flash between the OS splash and the app's own — and the only thing that hides it is
`hideNativeSplash()`, called from the shell after React paints. That is exactly the code a boot
failure means did not run.

Measured on a simulator with a bundle whose entry threw: the document was correct, the grace period
elapsed, the screen was revealed, and the app sat under a flat splash colour until the OTA watchdog
reverted it fifteen seconds later. Every guarantee in this section held, and the user saw none of it.

`getBootFallbackScript()` now hides the splash as part of the reveal, feature-detected exactly like
its `LiveUpdate` use — on web and PWA there is no bridge and the WebView is all there ever was. Hiding
it *only* on the reveal keeps `launchAutoHide: false` doing its job on every launch that works.

#### Which fallback shows, under OTA

`app-shell.ts` writes the markup, CSS and watchdog into `index.html`, and `index.html` travels inside
the zip. So a `bootErrorScreen` override ships with each bundle, which is what you want.

The corollary is the boundary between layer 2 and layer 3: the one failure the fallback cannot cover is
`index.html` itself arriving damaged. There is then no document for the watchdog to run in, the screen
stays blank, and the **native** watchdog is the only thing left. That is precisely why layer 3 is not
redundant with layer 2.

#### The failure signal carries the buildTag

> ### ✅ BUILT — `data-adaptv-boot-bundle` on `<html>`, beside the code
>
> The fallback stamps `data-adaptv-boot-failed="<code>"` for telemetry. Under OTA the missing half was
> *which bundle* — with no kill switch, recovery is a human noticing and promoting the previous
> deployment, so the feedback loop **is** that noticing, and `BOOT-LOAD` on its own names no deploy to
> roll back.
>
> **The tag cannot be written into the bundle.** It is a content hash of the bundle, and the watchdog
> ships inside that bundle's `index.html`, so stamping the tag there changes the tag it describes. An
> `adaptv-build.json` sidecar was the plan and has the same defect one level down: hashing before
> writing it makes the published tag a hash of something other than what shipped, and `computeBuildTag`
> run against the unpacked bundle then disagrees with the manifest that named it.
>
> So the value comes from the **native bridge** — `LiveUpdate.getCurrentBundle()`, the only thing that
> knows what actually booted, reachable from the fallback for the same reason `retry` already reaches it
> (injected natively as a document-start script, not part of the bundle). It is stamped *after* the
> reveal and never blocks it, and it is cleared when a late mount wins the race, so the attribute is
> always a statement about the screen that is up.
>
> The embedded bundle stamps `embedded` rather than nothing. "The binary the store shipped cannot
> start" is a different and far worse fact than "the last deploy cannot start", and an absent attribute
> would read as neither. On web and PWA there is no bridge and no bundle to name, so nothing is stamped.

### 5.5 Own the policy, rent the swap

Per doctrine (`docs/design/architecture.md §0.6`: rent stable cores, own seams) and `../decisions/prior-art.md §12.2` ("don't DIY the
bundle-swap blindly"): adaptv **owns** the channel convention, the manifest schema, the `nativeFingerprint`
gate, the watchdog/rollback policy, and the resume-driven check; adaptv **rents** the low-level
`WebView.setServerBasePath` bundle-swap rather than hand-rolling the native file juggling.

**🔒 Plugin pick: `@capawesome/capacitor-live-update` (MIT, 8.3.0)** — per `docs/decisions/register.md` **O8**.

| Option | License | Status |
|---|---|---|
| **`@capawesome/capacitor-live-update` 8.3.0** | **MIT** | ✅ **Pick.** Genuinely backend-free, and the **strongest signature story (RSA PEM + SHA-256)** — which is decisive now that §5.4d makes signing mandatory rather than optional. |
| `@capgo/capacitor-updater` 8.51.2 | **AGPL / commercial dual** | Healthier raw metrics (810★, 2 open issues) and its CLI already does fingerprint detection — but **AGPL is disqualifying for a framework that ships to consumers.** Fallback only, under the commercial licence. |
| `@capacitor/live-updates` (Appflow) | — | ❌ **Ruled out** — no new sales since 2025-02-11, sunsets 2027-12-31. |

**One trap that must be encoded, not discovered:**

**Capawesome defaults `readyTimeout` to `0`, which means rollback is _disabled_.** adaptv must force a
non-zero value — otherwise §5.4's watchdog silently doesn't exist and a bad bundle bricks the app. The
value itself is constrained from below by the two-clock ordering in §5.4, and `autoBlockRolledBackBundles`
is documented as having no effect at `0` either, so a zero here silently removes two defences, not one.

> *(An earlier draft listed `Library/NoCloud/ionic_built_snapshots/` conformance as a second trap. It
> is not adaptv's to get right — the plugin hard-codes that path with a "DO NOT CHANGE" comment at
> `LiveUpdate.swift:11`. Rented, and already correct.)*

#### The patch — two edits, both small, both about targets

adaptv installs the plugin as **its own** dependency (the same position as `@capacitor/ios`/`android`),
which is also what makes `installedPlugins()` see it, and patches it through the `patchedDependencies`
mechanism already used for three other packages.

1. **The rollback target.** `rollback()` is 15 lines (`LiveUpdate.swift:793`, mirrored at
   `LiveUpdate.java:1265`) and passes `nil` — the embedded bundle — in two places. Resolve those to the
   last known-good instead. The state needed is already there: `previousBundleId` and the blocked list.
2. **The pointer a store release invalidates.** The version-changed branch clears only the `appId`.
   `previousBundleId` survives it — and edit 1 has just turned that field into a rollback *target*, so
   on the new binary it aims at a bundle built against the one it replaced. Clear it there.

> ### ✅ PATCHED AND VERIFIED ON DEVICE (2026-08-14) — iOS simulator **and** Android emulator
>
> `patches/@capawesome__capacitor-live-update@8.3.0.patch`, four edits mirrored across
> `LiveUpdate.swift` and `LiveUpdate.java`. Every edit is marked `ADAPTV PATCH` in the source, which is
> what `src/vite/verify-patches.ts` looks for — see the loud-failure note at the end of this block.
>
> **Edit 1 — the rollback target — proved by the plugin's own log line.** With a bundle that cannot
> boot on the channel and a known-good OTA bundle behind it, Android logged
> `App is not ready. Rolling back to 6b9bb13cab6e84f2 bundle.` — where the unpatched string is the
> literal word `default`. The app came up on `OTA · AMBER`, `serverBasePath` pointed at that bundle's
> directory, and the poisoned tag went into `blockedBundleIds`. The same sequence on iOS landed on
> `OTA · VIOLET` with `previousBundleIdKey` intact and the poisoned tag blocked. On both, the fallback
> was the newest bundle the device is known to be able to start — not whatever the store shipped.
>
> **Edit 2 — proved by what is missing after a version bump.** `versionCode 1 → 2` on Android and
> `CURRENT_PROJECT_VERSION 1 → 2` on iOS, reinstalled over the top with the downloaded bundles left in
> place. `previousBundleId` is gone from both stores afterwards while `blockedBundleIds` survives, which
> is the intended split: a bundle that could not boot is bad on any binary, a bundle that *could* is
> only known-good on the binary it was proven against.
>
> #### 🔴 Two things this cost, both worth keeping written down
>
> **The reason for edit 2 in the draft above was wrong.** It said the version-changed branch had to drop
> the *bundle* pointer, or the stale bundle would load and be reloaded out of in front of the user.
> Capacitor never lets that happen: `Bridge.isNewBinary()` blanks `CAP_SERVER_PATH` before
> `loadWebView` reads it, and `CAPBridgeViewController.updateBinaryVersion()` nils `serverBasePath`
> before `instanceDescriptor()` consults it. There was no reload to remove. What edit 2 is really for is
> the sentence above it — it is the other half of edit 1, not a fix for anything upstream does wrong.
> The patch still clears the next-bundle pointer alongside it, as belt-and-braces: it keeps the plugin's
> own record of what will boot true from the moment it notices the change, rather than resting on an
> internal of a package it merely rents.
>
> **`setCurrentBundleById(null)` in that branch kills the plugin on Android.** It reads like the direct
> way to say "point at the embedded bundle", and it is a *live* operation — it reaches through the
> bridge to re-point the local web server and reload it. The branch runs from the plugin's constructor,
> and Capacitor registers plugins (`Bridge.java:231`) before it builds that server (`Bridge.java:276`),
> so the call throws an NPE which `LiveUpdatePlugin.load()` swallows — leaving `implementation` null and
> the update core silently dead for the whole launch. The symptom is an app that fetches the manifest
> and never the zip: it looks precisely like a channel or signing problem. `setNextBundleById` only
> commits the path preference, which is read later, and is what the patch uses. iOS survives the same
> line because its equivalent is guarded on a view controller that does not exist yet — a no-op there,
> fatal here, from one shared source edit.
>
> **A consumer install without the patch fails loudly**, per `verify-patches.ts`: `adaptv build`/`dev`
> for a native target reads the two native sources out of the installed plugin, checks them for the
> `ADAPTV PATCH` marker, and refuses with the `patchedDependencies` block to copy. It has to be a hard
> failure — an unpatched native build still compiles and still installs updates, so nothing downstream
> would ever say.
>
> Key rotation (§5.4d) is still outstanding and genuinely needs a native change: it is a third edit, not
> one of these two.

**Everything else stays rented.** Zip extraction, checksum, RSA-PEM verification, the `NoCloud`
conformance, `serverBasePath` persistence — 2,600 lines whose bugs only surface in the field. The seam
stays one module wide.

### 5.6 The binary surface is the limit of OTA

Everything reachable by OTA is web assets. Everything else changes only through a store release, and it
is worth naming the list because each item looks like something an app author would expect to be able
to change any time:

- the **native splash** and the launch mask
- the **app icon**
- the app **name** and store listing
- the native plugin set (that is §5.3's gate, from the other direction)
- **`origin`** — §5.2

`origin` is the surprising one and the most permanent: it is the address at which the app looks for
its own future. An install that never takes the release that changes it stays pointed at the old origin
for the rest of its life.

#### What happens to an install that is left behind

Every item on that list produces the same situation: the channel's newest build carries a different
`nativeFingerprint` from the app that is installed. **By default the bundle installs anyway.**

That is the whole product decision, so it is worth stating it in the form the alternative takes. A
release is almost never *only* a native change — it is a native change plus the week of fixes that
happened to ship with it. Refusing the bundle withholds all of them from exactly the installs that are
furthest behind, and it keeps withholding them for every deploy after that one, because the fingerprint
never comes back into line without a store update. Installing means every fix lands the day it ships and
one feature is dark until the user updates.

🔴 **The thing that makes this survivable is that "dark" has to be askable.** A native call on a binary
that does not implement it is a rejected bridge message — it does not corrupt anything, but it is not
something a component can shrug off either, and at module scope it takes the whole bundle down (the
watchdog rolls that back, and the user still watched a launch fail).

**Every adaptv capability already carries the answer**, in the `supported` its hook returns — the same
field that says "this browser has no Web Share". A binary one native release behind is just another
reason for that field to be `false`, so nothing new is added to the consumer's vocabulary:

```tsx
const share = useShare()
if (!share.supported) return <p>Update the app from the store to share.</p>
return <button onClick={() => share.share(target)}>Share</button>
```

Underneath, that field consults `Capacitor.PluginHeaders` (`src/utils/native-plugins.ts`) — injected by
the native layer with a `{ name, methods }` entry per compiled plugin. It is the one thing on the device
that describes the **binary** rather than the bundle, and nothing a bundle carries can change it, which
is exactly the property the answer needs.

adaptv reads the plugin **name** only. The headers are precise to the method, and that is the shape that
would catch the harder half of native skew — a plugin present but one major behind, where only the new
method is missing — but no capability adaptv ships turns on a single method today, so reading one would
be a mechanism with no caller. The data is there when one appears.

⚠︎ Not `Capacitor.isPluginAvailable`. It asks whether an implementation is registered for this platform,
and a JS implementation counts. On native it *happens* to reduce to the header check — every
`@capacitor/*` package registers its fallback under `"web"` only, which never matches `"ios"`/`"android"`
— but that is how those packages are written, not a contract. One plugin registering an `"ios"` JS shim
would make it answer `true` on a binary carrying none of that plugin's native code, and the failure would
be a rejected bridge call on a user's device rather than a hidden button.

A missing plugin is also not the same statement as "this feature does not exist here". Each capability
falls **through** to its web path rather than reporting unsupported: an Android WebView on a secure
origin has a real `navigator.clipboard` and a real `navigator.vibrate`, so a skewed bundle keeps copying
and keeps buzzing. Only when the WebView has nothing either does `supported` go `false`.

**A plugin adaptv does not ship is the plugin author's contract, not ours.** A community or in-house
Capacitor plugin should answer through its own bridge when its native half is absent; adaptv deliberately
ships no generic "can I call this?" wrapper, because a framework whose value is that the developer never
has to know the problem exists cannot also hand him an API for asking.

`"refuse"` remains one config line away, and there is a real case for it: a release that moved a server
API, a data shape, or an auth flow in step with the native change. Then the JS cannot route around the
gap, a half-working bundle is worse than a stale one, and the install should sit still. adaptv cannot
detect that case — it lives entirely on the server — which is exactly why it is a config and not an
inference.

🔴 **The comparison has to be against the BINARY, and after the first skewed install it is not the same
value as the bundle's.** `otaConfig.nativeFingerprint` is baked into whatever bundle is running and
describes the machine that built it. Take one bundle built for the next native layer and that constant
becomes that layer's fingerprint, on an app that has not gained a single plugin — every later manifest
then compares equal and the device reports itself up to date for ever. So the ledger records the
binary's own fingerprint, read off the **embedded** bundle, which is the one launch where the two
coincide. A store release forces that launch (`returnToEmbedded`), so the value is re-learnt exactly
when it changes.

The same reversal reaches the rollback ledger. A bundle's *fingerprint* used to decide whether it was
worth keeping or rolling back to; under `"install"` that would retain the bundle from before the native
change and delete every bundle since — a cushion years old, and a re-download on every rollback. What is
kept now is the app version a bundle **booted on** (`provenOn`), which is evidence rather than
inference, and which still expires the moment a store release swaps the native layer underneath it.

**So adaptv reports the state, and the app declares the policy.** Three surfaces, and which one you
reach for is the whole design. A capability's `supported` above is the per-feature one; the other two
are about the install as a whole:

```ts
// adaptv.config.ts — the policy. One number, and adaptv brings the screen.
updateRequiredAfterDays: 14,
updateRequiredScreen: () => import("@/components/update-required"),  //optional
```

```tsx
// anywhere in the app — the raw state, for anything short of taking the screen
const stranded = useStoreRelease()   //null | { buildTag, since }
```

`since` is persisted, and consecutive incompatible deploys **extend** that stranding rather than
restarting its clock — otherwise the installs furthest behind, which are the ones a busy channel hits
most often, would be the only ones whose counter never grew.

**Why a number and not a switch.** The channel moves when a release is *built*, generally a little
before review lets anyone install it. `0` blocks the moment that happens: right when the server contract
broke with the release, hostile when it did not. `14` lets the store catch up and interrupts only the
installs that really were left behind. Omitted — the default — adaptv never takes the screen, because
locking someone out of an app that works is a product decision with a real cost, and adaptv shipping a
default threshold would be making that call for every app that installs it.

⚠︎ **It is not the same question as "is the new version in the store yet."** The channel moves when the
release is *built*, which is generally a little before review lets anyone install it. A fresh value means
"an update is on the way"; only its age means "this install is overdue".

The state is written and cleared on the **comparison**, not on the decision. Under the default the
decision for a skewed bundle is `install`, so an app that read the verdict would take every bundle and
never learn that its native half had stopped keeping up — the features going dark would have nothing
attached to explain them. It is cleared on exactly one event: a manifest that was fetched, verified, and
asks for the native layer this binary actually has. Never on a failed check — a device with no network
has concluded nothing, and clearing there would make every stranded install look healthy for precisely
as long as it stayed offline.

**What adaptv still owns regardless of the pick:** the `.well-known` channel convention, the manifest
schema, the `nativeFingerprint` computation, signature verification (§5.4d), the boot watchdog, and the
resume-driven check. The plugin is only the file-juggling + `serverBasePath` layer, which keeps the swap
replaceable — if Capgo's licensing or health changes, the seam is one module wide. If neither plugin
fits, the DIY path (download → verify → unpack to a new dir → flip pointer → apply next launch) is the
documented fallback.

### 5.7 What is still open, and what a local bench cannot reach

Two lists, and the second one is the easier to forget. The first is work not done; the second is
verification that **cannot** be done here, no matter how carefully, because the bench differs from a
real deployment in ways that hide exactly the failures worth finding.

#### Still open

- **Key rotation (§5.4d).** Genuinely needs a native change — the rented plugin's config takes one key,
  so accepting a `next` key in JavaScript alone buys nothing. What is undecided is not the mechanism
  but the fallback: what an install does when it never takes the store release that carries the new
  key. Today it fetches every manifest and refuses each one in silence, for ever, because a bundle
  under attack must not narrate its own verification (§5.4d). That silence is right against an
  attacker and wrong against a rotation, and the two are indistinguishable from inside the app. The
  `ota-lab` reproduced this by accident once — a stale publish carrying a previous session's key — and
  the only symptom was an app that looked perfectly healthy.
- **The watchdog under a partially applied bundle.** The ledger records `pending` before the pointer
  moves, so a process killed between `recordStaged` and `setNextBundle` is covered. A process killed
  *inside* the plugin's own unpack is not adaptv's state to reason about, and what the watchdog should
  do about a half-written bundle directory has not been settled.

#### What the bench structurally cannot catch

`ota-lab` serves the channel from a plain node server on localhost. Three classes of failure are
invisible to it, and all three need the playground deployed to a real host:

- **CDN caching of `manifest.json`.** The bench sends `Cache-Control: no-store`; a real static host
  does not. A cached manifest means the device keeps asking and keeps being handed a stale answer for
  minutes or hours — indistinguishable, from inside the app, from "there is no update". This is the
  most likely production failure in §5.2's whole design, and nothing local can surface it.
- **A launch check that outruns its own budget.** On localhost a check never takes 5 seconds, so
  `FIRST_LAUNCH_BUDGET_MS` never expires and the app is never revealed while its own check is still in
  flight. On a real network that is ordinary, and it is the most common of the three paths that
  `launchScreenStillUp` guards (§5.4) — the guard is written and unit-tested, but the deployed
  environment is what will exercise it for real.
- **Anything that needs a long-lived install.** Rotation's failure mode, a poll running for hours
  across real backgrounding, and a device that has been offline across several publishes all need
  calendar time against a channel that keeps moving. The bench resets on every `fresh`.

---
