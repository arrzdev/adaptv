# adaptv — the dist build

> 🔒 **LOCKED.** How adaptv is built for publishing, settled empirically by building a replica
> of the package shape and consuming it from a real Vite 8 app.
>
> Lifted out of the decision register 2026-08-30 (was `DECISIONS.md §6.2`). The build itself is
> **shipped and verified** — `tsdown.config.ts`, `pnpm build:check`, `scripts/verify-dist.mjs`.
> Only the *cutover* (pointing `exports` at `dist/` instead of `./src/**`) is outstanding:
> → [`../roadmap/dist-cutover.md`](../roadmap/dist-cutover.md).

---

## The decision

Tested by building a replica of adaptv's exact package shape and consuming it from a real Vite 8 app.

**Shipping source works better than folklore claims — and still loses.** Vite 8's Rolldown scanner
*does* pre-bundle raw `.ts`/`.tsx` from `node_modules` (verified in `.vite/deps/_metadata.json`), and
the CSS subpath resolves fine. But three things break hard:

1. **Path aliases inside the package are a hard failure.** A library file importing `@/util/helper`
   fails — Vite does not apply a *dependency's* tsconfig paths. `@vitejs/plugin-react` escalates the
   `UNRESOLVED_IMPORT` warning to a build error. **Every internal import must be relative.**
2. **JSX in a `.ts` file is a hard failure**, fixable only by the consumer via `oxc.include`.
3. **`skipLibCheck` does not save consumers.** It skips `.d.ts`, not `.ts` reached through `exports` —
   so consumers inherit adaptv's tsconfig assumptions and typecheck its source. This is the decisive one.

Also: **Fast Refresh never reaches library components** either way (`@vitejs/plugin-react` skips
`node_modules`), so "ship source for better DX" doesn't buy what people think.

**⚠︎ A research trap worth recording:** `@ark-ui/react`'s npm *packument* shows
`exports: { ".": "./src/index.ts" }` with no `types` — it looks like a major library shipping raw TS.
**The tarball contains 3,747 `dist/` files, 960 `.d.ts`, and zero `src/`.** Publish-time package.json
rewriting. **Never judge how a package publishes from registry metadata — extract the tarball.**
Essentially nobody significant ships raw `.ts` as the default resolution target; the real pattern is
dist-by-default with source behind a custom condition.

**Tool: `tsdown` 0.22.12.** `tsup`'s own README now opens with *"This project is not actively maintained
anymore. Please consider using tsdown instead."*; Vite's docs point at tsdown for *"non-browser
libraries, or … advanced build flows"* — which is exactly adaptv's `/vite` and `/sw` entries; and tsdown
is VoidZero/Rolldown-org software, aligned with the consumer toolchain. **Honest caveat: it's still 0.x
and tsup still out-downloads it 26M vs 10M/month.** Pin exactly; don't float the range.

### Four traps that bite this specific package shape

- **🚨 Rolldown silently drops `"use client"`** from non-entry modules in bundle mode — verified: present
  with `unbundle: true`, **absent** in a normal bundle. Re-assert with
  `outputOptions: { banner: "'use client';" }` on the browser build only. tsdown's docs never mention
  directives; the failure is silent, so grep `dist/`.
- **🚨 `typescript@latest` is now 7.0.2, which silently switches `rolldown-plugin-dts` to the
  experimental `tsgo` generator** — it warns *"TypeScript 7.0 does not yet have a stable API… Some
  options will be unavailable."* **Pin `typescript@5.9.x`** in devDependencies until that settles.
  (Note this cuts against the separate suggestion to adopt TS 7 for its 13× speed — the two goals
  conflict today; the build pin wins.)
- **`exports: true` does not merge across an array config** — auto-generation captured only the last
  build's entries, silently omitting the rest. **Hand-write the `exports` map**, and let
  `publint: true` + `attw: true` police it. Put `clean: true` on the *first* build object only.
- **Don't build the CSS.** `@tsdown/css` is experimental and carries an **exact-version** peer dep on
  tsdown (`0.22.7` requires exactly `0.22.7`), emits a useless empty `styles.js` shim, and would run
  adaptv's hand-authored stylesheet through a second minifier before the consumer's own pipeline.
  Use `copy: [{ from: 'src/styles.css', to: 'dist/styles.css' }]` + a static export.

**Two smaller settled points:** `sideEffects: ["**/*.css"]` — `*.css` and `**/*.css` are *identical*
per webpack's `glob-to-regexp` (patterns without `/` are treated as `**/`-prefixed); the real footgun is
a path-anchored pattern like `"./src/**/*.css"`, which silently won't match the published `dist/` tree.
And keep `sourcesContent` embedded in the sourcemaps (tsdown's default) with `files: ["dist"]` — the map
is then self-contained and consumers get real stack traces **without shipping `src/`**.

---

