# adaptv — research

Facts about how a **platform** behaves, each established by an experiment, each written down because
the investigation cost real time and the codebase cannot tell you any of it.

## The index

| Finding | Engine / platform | Reproduces on |
|---|---|---|
| [Where a transform is authored decides whether it settles](composited-transform-authoring.md) | WebKit | physical iPhone only |

## What belongs here

Three tests, all of them:

- **It is a fact about a platform, not about adaptv.** "WebKit re-rasterises at the end of an inline
  transition" belongs here. "the drawer panel is the sheet plus a hidden tail" does not — that is a
  design, and it belongs in a comment on the design.
- **Reading the code cannot recover it.** If the next person would find it in an afternoon with a
  debugger, it is a comment, not an entry.
- **It was established, not inferred.** There is an experiment, and the entry records it precisely
  enough to re-run or falsify.

Not here: API choices → `DECISIONS.md`. What neighbours do → `PRIOR-ART.md`, `VS-IONIC.md`. Gaps in
the vision and upstream to watch → `RESEARCH.md` (singular, at the docs root — that one is
forward-looking; this folder is backward-looking). Promotion policy → `PERFORMANCE-BOOST.md`.
Driving a device → `AUTONOMOUS-UI-TESTING.md`.

## Writing an entry

Lead with the platform, the hardware, and whether it reproduces anywhere cheaper. A finding that
only shows on a physical device is not a weaker finding, but an entry that fails to say so invites
someone to "disprove" it headless.

Then five sections. The last two are what make the archive worth keeping:

1. **The claim** — narrow enough to be wrong.
2. **How it was established** — the experiment, and specifically *what was held constant*. A
   bisection is worth only the variables it controlled.
3. **What was ruled out** — every dead hypothesis is a week somebody else does not spend. A claim
   with no casualties beside it is usually just the first thing that was tried.
4. **Where it is enforced** — the file and the rule that breaks if someone simplifies the fix. An
   entry that points at no code becomes folklore.
5. **What else it predicts** — every other site using the same mechanism, with a verdict on each.
   The fix is one file; the audit is the return on the investigation.

Name the file after the **mechanism**, not the symptom, so the next finding about the same mechanism
lands beside it: `composited-transform-authoring.md`, not `drawer-settle-bug.md`.
