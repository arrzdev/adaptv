# adaptv — guides

**Procedures. If it has a command in it that a reader will actually run, it belongs here.**

A file here answers *"how do I do this?"*. It is the only folder whose contents **rot on a schedule
you cannot see**: a design doc stays true until the design changes, but a guide breaks the moment a
script is renamed, a port moves, or a dependency bumps — and nothing fails when it does.

## The bar

> **Every command in this folder must have been run, or resolved against `package.json`, on a date
> the file states.**

Not a style rule. `testing.md` sat for a month with a `pnpm dev` script that does not exist, filters
that do not exist, an import from a package that had been renamed, and a link to a file that was never
committed — **every command in it would have failed.** It looked authoritative the whole time.

So: date the file, say what you verified against, and prefer naming the source (`package.json`,
`ports.ts`) over restating a value that will drift away from it.

## What does not belong here

- **How a subsystem works** → [`../design/`](../design/README.md).
- **Why something was chosen** → [`../decisions/`](../decisions/README.md).
- **A platform fact with an experiment behind it** → [`../research/`](../research/README.md).
- **A procedure for work that does not exist yet** → [`../roadmap/`](../roadmap/README.md).

## The files

| File | What it gets you |
|---|---|
| [`testing.md`](testing.md) | The six-target discipline: what to run, on which target, and what counts as done. **Start here.** |
| [`e2e.md`](e2e.md) | The Playwright estate — four configs, what each proves, and the rules that keep it honest. |
| [`cookbook.md`](cookbook.md) | Consumer-facing recipes. **Opacity applies**: never name the machinery underneath. |
| [`autonomous-ui-testing.md`](autonomous-ui-testing.md) | Building a layout-reactive component with nobody watching the screen. |

## One thing to watch

`cookbook.md` is **consumer-facing**, so the opacity rule (**L20**) binds it: no vendor name may
appear in it, ever. The other three are internal and may name anything. If you add a
consumer-facing guide, say so at the top of the file so the next editor knows which register it is in.
→ [`../decisions/facade-and-opacity.md`](../decisions/facade-and-opacity.md)
