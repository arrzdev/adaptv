# adaptv — documentation

**Five folders, split by the KIND OF CLAIM a file makes — not by subsystem.** The split is the point:
it is what stops a plan and a description of shipped code from sitting in the same paragraph, which is
the failure this tree was reorganised to fix.

## Which folder answers your question

| You want to know | Folder | The claim it makes |
|---|---|---|
| **"What is settled? What was rejected?"** | [`decisions/`](decisions/README.md) | A choice, with its casualties. Do not re-litigate without new evidence. |
| **"How does this work today?"** | [`design/`](design/README.md) | Machinery that exists in `src/` or `bin/` **right now**. Present tense, always. |
| **"Why does the platform do that?"** | [`research/`](research/README.md) | A platform fact, established by an experiment that is recorded well enough to re-run. |
| **"How do I run it?"** | [`guides/`](guides/README.md) | A procedure with commands, verified on a stated date. |
| **"What is not done?"** | [`roadmap/`](roadmap/README.md) | Work that does **not** exist yet. The single not-done list. |

Each folder's own `README.md` states its admission test and what it refuses. Read that before adding
a file — the tests are narrow on purpose.

## Start here

- **New to adaptv?** [`../README.md`](../README.md), then [`VISION.md`](VISION.md) for where it is
  going, then [`design/architecture.md`](design/architecture.md) for how it is put together.
- **Working on the framework?** [`DEVELOPMENT.md`](DEVELOPMENT.md), then
  [`guides/testing.md`](guides/testing.md) — the six-target discipline is the part that is easy to
  skip and expensive to skip.
- **Touching `bin/`?** [`design/cli-contract.md`](design/cli-contract.md), first, without exception.
  Every rule in it was written because the output broke it once and the owner had to report it, and
  the test suite cannot catch any of it.
- **Wondering whether something is decided?** [`decisions/register.md`](decisions/register.md) — the
  index of every locked decision (`L1`–`L21`), open question (`O1`–`O16`) and bug (`B1`–`B33`).
- **Picking up work?** [`roadmap/README.md`](roadmap/README.md) — ranked, with the loose ends at the
  bottom.

## The two habits that keep this tree true

**1. Grep before you hand-roll.** Before writing anything cross-platform, search
[`research/`](research/README.md) and the register's bug catalogue. Both exist because the answer
already cost somebody a day, and neither is discoverable from the code. Before a dependency or SDK
bump, re-read [`research/capacitor-internals.md`](research/capacitor-internals.md) — the version pins
and the known-breakage list live there.

**2. When something ships, move it.** A file's folder is a claim about its tense. A shipped design in
`roadmap/` sends a reader looking for work that is already done; a plan in `design/` tells them a
subsystem does not exist when it does. Both have happened here, for a month at a time:
`coordination.md` announced four shipped subsystems as *"unbuilt"*, and a thousand lines of shipped
OTA design sat under the heading *"Not built. This is the design."*

## Two conventions worth knowing

- **Statuses**: 🔒 LOCKED · 📐 DESIGNED (specced, not built) · ✅ SHIPPED · ❓ OPEN · ❌ REJECTED.
  A 🔀 CONFLICTED marker is a bug in the tree, not a state to live in.
- **Opacity (L20)**: consumer-facing text — the root `README.md`, `guides/cookbook.md`, and every byte
  the CLI prints — must never name the machinery underneath. Internal docs, including everything in
  `design/` and `decisions/`, name it freely.
  → [`decisions/facade-and-opacity.md`](decisions/facade-and-opacity.md)

## The two files not in a folder

| File | Why it is here |
|---|---|
| [`VISION.md`](VISION.md) | The north star. Deliberately aspirational, so it fits none of the five tests above. |
| [`DEVELOPMENT.md`](DEVELOPMENT.md) | The contributor entry point — it spans all five kinds of claim by design. |
