# adaptv — `create-adaptv`, the scaffolder

> 📐 **Designed, not built.** Was `LIFECYCLE.md §8`; moved here 2026-08-30 because it is genuinely
> unbuilt and belongs with the other unbuilt work. **D3** in the decision register.
>
> **Risk: low.** Nothing blocks it.

---

## The npm-name constraint (do not lose this)

`create-adaptv` is **unclaimed on npm**. Publish the *scaffolder* publicly — it is only prompts and
file copying, with no framework source in it — and keep `@arrzdev/adaptv` private on GitHub Packages.

That split is not cosmetic: it fixes a chicken-and-egg. A private-registry framework needs a PAT
configured in `.npmrc` before it can be installed, and the tool that configures the `.npmrc` is the
scaffolder — so a private scaffolder could never be run by a new user. A public scaffolder that
writes the registry lines and then installs the private package is the only ordering that works.

*(Recorded in the register's §5.0 as part of the O12 discussion, which is otherwise superseded.)*

---

## What it emits

`pnpm create adaptv` (a separate package / `bin`) emits a ready app so the lifecycle starts from a correct
baseline, not hand-assembly:
- `adaptv.config.ts` (with a `web` block, optional `native.appId`, optional `ota`).
- `vite.config.ts` with a single `adaptv()` call.
- A `routing/` dir + one example `View`-rooted route (§`docs/design/architecture.md §1`).
- `src/styles/main.css`. **No service worker**: adaptv owns the worker end to end and there is no
  override file — an app that needs its own behaviour adds a module to `serviceWorkers: []`
  (`docs/design/rendering.md §3`), which is a config edit, not a scaffolded file. **No icon placeholder**: a scaffolded app with no `icons`
  directory already wears adaptv's own mark on every surface, and `adaptv icons <image>`
  replaces it in one command — a committed placeholder set would be twelve files to delete.
- Scripts wired to `adaptv dev` / `vite build` / `adaptv run`.
- Optionally scaffolds `android/`/`ios/` on first `adaptv sync` rather than at create time (keeps the repo
  lean; native projects are regenerable from config).

---

---

## Two things in the sketch above that are now stale

Both are consequences of decisions taken after §8 was written; fix them when building it rather than
scaffolding them faithfully.

- **"`adaptv.config.ts` (with a `web` block …)"** — there is no `web` block. The config went **flat**,
  and `web.host` was deleted outright. → [`../decisions/rendering-and-delivery.md §2`](../decisions/rendering-and-delivery.md)
- **"Scripts wired to `adaptv dev` / `vite build` / `adaptv run`"** — there is no `adaptv run`
  command. The real surface is `doctor · dev · preview · build · keys · icons`, and `adaptv build`
  covers what `run` was imagined to do.
