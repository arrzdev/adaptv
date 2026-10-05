# adaptv — decisions

**Settled choices, and — the part that makes this folder worth having — what was REJECTED and why.**

A file here answers *"what is settled?"*. It is a claim you may not re-litigate without **new
evidence**, not merely a new opinion. A decision belongs here when (a) it is written down, (b) no
other doc or code contradicts it, and (c) the rationale survives being asked *"why not the
opposite?"*.

**Record the rejected alternatives.** A decision with no casualties beside it is usually just the
first thing that was tried, and it will be re-tried. The most valuable entries in this folder are the
ones that stop somebody spending a week rediscovering that an approach cannot work.

## What does not belong here

- **How a shipped subsystem works** → [`../design/`](../design/README.md). If you are describing
  machinery rather than a choice between options, it is a design.
- **A platform fact established by an experiment** → [`../research/`](../research/README.md), which
  has its own bar (a claim, the experiment, what was ruled out).
- **Work not yet built** → [`../roadmap/`](../roadmap/README.md). A decision *about* unbuilt work can
  live here; the plan to build it cannot.
- **A bug in shipped code.** Those are `B` entries in [`register.md`](register.md) §6.

## The files

| File | What it settles |
|---|---|
| [`register.md`](register.md) | **The register** — the index of every locked decision (`L1`–`L21`), the open questions (`O1`–`O16`), and the numbered bug catalogue (`B1`–`B33`). Start here. |
| [`positioning.md`](positioning.md) | Why adaptv exists next to Ionic: the market picture, and the dev-loop comparison. |
| [`facade-and-opacity.md`](facade-and-opacity.md) | The `createServerFn` ban, how it is enforced unbypassably, and the opacity tier model. The ban covers every target (owner, 2026-10-05); its detection is still to widen → [`../roadmap/server-boundary.md`](../roadmap/server-boundary.md). |
| [`styling.md`](styling.md) | How consumers restyle primitives: `className` + `data-*` + `@layer`, and the three-layer precedence contract. |
| [`animation.md`](animation.md) | The motion substrate, the composited-only rule, and the iOS 60Hz ceiling. |
| [`rendering-and-delivery.md`](rendering-and-delivery.md) | `render` defaults to `"ssr"`; `web.host` is deleted. |
| [`dist-build.md`](dist-build.md) | Two builds via `tsdown`, and the four traps this package shape hits. |
| [`browser-chrome-autohide.md`](browser-chrome-autohide.md) | ❌ Rejected: browser-chrome auto-hide cannot be driven by forwarding scroll. |
| [`prior-art.md`](prior-art.md) | What to port from Ionic, ranked, plus the attribution convention. |

## The conventions

- **Statuses**: 🔒 LOCKED · 📐 DESIGNED (specced, not built) · ❓ OPEN · ❌ REJECTED / WITHDRAWN.
- **A 🔀 CONFLICTED status is a bug in this folder, not a state to live in.** Five sat unresolved for
  months after the code settled them. Resolve it or delete it.
- **When something ships, re-tense it.** A decision stays; a plan moves out.
