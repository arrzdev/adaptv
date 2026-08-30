# adaptv — design

**How a subsystem works TODAY. Present tense, always.**

A file here describes machinery that exists in `src/` or `bin/` right now: what it does, why it is
shaped that way, and where it is enforced. If you can point at the code, it belongs here.

## The one rule

> **A future-tense sentence in this folder is a bug.**

Not a style preference — a structural guard. Before this folder existed, `COORDINATION.md` opened
its status section with *"All four are **unbuilt**"* about four subsystems that had all shipped, and
`LIFECYCLE.md §5` carried a thousand lines of OTA design under the heading *"Not built. This is the
design."* for a month after it shipped. Both were the single most misleading sentence in their file,
and both are impossible here: a plan cannot be present tense, so it cannot pass review in this
folder. **Plans go to [`../roadmap/`](../roadmap/README.md).**

When something ships, the design moves *in*. When something is only proposed, it stays *out*.

## What does not belong here

- **A choice between options, with the rejected ones** → [`../decisions/`](../decisions/README.md).
- **A platform fact with an experiment behind it** → [`../research/`](../research/README.md).
- **Anything with a command in it that a reader will run** → [`../guides/`](../guides/README.md).
- **Unbuilt work** → [`../roadmap/`](../roadmap/README.md).

## The files

| File | Subsystem |
|---|---|
| [`architecture.md`](architecture.md) | The cross-platform contracts: the shell/frame, `View`, the storage tiers, the escalation ladder. |
| [`lifecycle.md`](lifecycle.md) | config → build → deploy → CLI. The Vite plugin's deploy decision model. |
| [`rendering.md`](rendering.md) | The isomorphism boundary, and the full service-worker / offline / update model. |
| [`ota.md`](ota.md) | Over-the-air updates for the native target, end to end. |
| [`coordination.md`](coordination.md) | The runtime spine: app state, the back chain, the gesture controller, route lifecycle. |
| [`behaviors.md`](behaviors.md) | The per-fix catalogue — what adaptv fixes, how, and how to test each. |
| [`image.md`](image.md) | `Image` and the build-time placeholder pipeline. |
| [`keyboard-signal.md`](keyboard-signal.md) | The keyboard-height signal and its cache. |
| [`performance-boost.md`](performance-boost.md) | Compositor-promotion policy: when to promote, and when emphatically not. |
| [`patches.md`](patches.md) | The four dependency patches, why they are verified at build time, and what to do when one stops applying. |
| [`vite-plugin-map.md`](vite-plugin-map.md) | A map of `src/vite/` — which files are seams, which are shims, and the four places plugin order is load-bearing. |
| [`cli-contract.md`](cli-contract.md) | **The CLI output contract** — ~50 numbered rules, each from a real regression. Read before touching `bin/`. |
| [`cli-visual.md`](cli-visual.md) | The CLI's visual design system. `bin/ui/theme.mjs` is its executable half. |

## Known gaps

Real subsystems with no design doc, in rough order of what they cost a newcomer. Recorded so the
absence is deliberate rather than invisible:

1. **The icon pipeline** — `bin/lib/{icons,icon-gen,artwork,icon-preview,icon-geometry,icon-tuning,ico}.mjs`,
   ~110 K of code and ~60 K of tests, full of non-obvious platform rules (luminance ramps, safe
   rings, radius-vs-bounding-box fitting, iOS 18 appearance variants, Android monochrome derivation).
   The only prose is a comment block in the root `README.md` and `adaptv icons --help`. **The largest
   undocumented body in the repo.**
2. **Boot failure / boot-fallback** — `src/shell/boot-fallback.ts`, `boot-error.tsx`,
   `src/vite/boot-fallback-prerender.ts`. Code that must work when everything else has failed.
   `rendering.md §3.1.3` covers the component contract; nothing covers the prerender machinery.
3. **Route tints / chrome tint** — `src/shell/route-tints.ts`, `src/hooks/use-chrome-tint.ts`,
   `src/capabilities/theme-color.ts`. A shipped capability whose only prose is a cookbook recipe and
   two bug entries.
4. **Component sub-packages** — `drawer/`, `dropdown/`, `avoid-keyboard/`. Their *motion* is well
   covered; their structure, snap points and nested-scroll arbitration are not, and `Dropdown` has no
   doc at all.
