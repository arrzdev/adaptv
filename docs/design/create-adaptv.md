# adaptv — `create-adaptv`, the scaffolder

`pnpm create adaptv my-app` writes a new app that `adaptv build web` builds. The code is
[`packages/create-adaptv/`](../../packages/create-adaptv/); **D3** in the decision register.

It is deliberately the smallest thing that makes the website's create command true, because the owner
expects to rewrite it ([`../roadmap/website.md`](../roadmap/website.md) §4). It asks nothing beyond the
app name, installs nothing, runs nothing, and scaffolds no native project.

---

## 1. Where it lives, and why there

`pnpm create adaptv` runs the npm package **`create-adaptv`**, so the scaffolder has to be a package of
its own. That is the case **L1** names for leaving the single-package layout, so it is the repo's first
`packages/*` entry. It is not a pnpm workspace member: it has **no dependencies** (node's `fs` and
`path` only), so there is nothing to install and nothing to link. Root tooling covers it: Biome, the bin
typecheck (`tsconfig.bin.json`) and vitest.

| File | What it is |
|---|---|
| `index.mjs` | The bin: reads the argument, prints, exits. |
| `create.mjs` | The work: copies `template/`, fills in the name, writes `package.json`. |
| `template/` | The app, verbatim except for two placeholders. |
| `create.test.mjs` | What it emits, what it prints, and a created app passing `adaptv build web`. |

`package.json` says `private: true`. The first public publish is a board decision. What a published
app needed from the framework is in §4.

## 2. What it emits

```
my-app/
  .gitignore
  adaptv.config.ts            flat: appId, name, description, themeColor, styles, router
  package.json                doctor · dev · preview · build, on the real CLI surface
  patches/                    adaptv's dependency patches, copied from the framework
  pnpm-workspace.yaml         allowBuilds for esbuild and sharp; patchedDependencies → patches/
  src/routing/config.ts       rootRoute([index(...)])
  src/routing/pages/home.page.tsx   one route, rooted in a View
  src/styles/main.css         adaptv's styles, then the app's plain CSS
  tsconfig.json
  vite.config.ts              adaptv() once
```

What it does **not** emit, on purpose:

- **No `web` block.** The config is flat → [`../decisions/rendering-and-delivery.md §2`](../decisions/rendering-and-delivery.md).
- **No service worker file.** adaptv owns the worker end to end; an app that needs its own behaviour
  lists a module in `serviceWorkers: []` (`rendering.md §3`). That is a config edit, not a file to
  scaffold.
- **No icons.** An app with no `icons` wears adaptv's mark on every surface, and `adaptv icons <image>`
  replaces it in one command. A committed placeholder set would be twelve files to delete.
- **No `android/` or `ios/`.** A native project is generated from config on the first native run.
- **No `adaptv run`.** That command does not exist; `adaptv build` does what it was imagined to do.
- **No `ssr` key in `vite.config.ts`.** `dist/` imports the modules adaptv's Vite plugin serves
  (`virtual:adaptv-*`), which Node refuses: a dev server that hands the package to Node answers every
  page with a 500. Every app needs `@arrzdev/adaptv` in `noExternal`, so `adaptv()` adds it, in serve
  and build (`src/vite/tanstack-resolve.ts`). A build bundles everything, so it passes either way.

Three details are there because the framework expects them:

- **`@/` is `src/`** (`tsconfig.json` `paths`, `resolve.tsconfigPaths` in `vite.config.ts`). adaptv
  imports the app's stylesheet and screen thunks through that alias (`src/vite/root-route-module.ts`
  `toAppAlias`). Without it the build fails on `@/styles/main.css?url`.
- **What the build would stamp is already there.** The tsconfig wiring, the ignore entries and the CSS
  layer order are what `src/vite/stamp.ts` and `adaptv:css-layer-order` write into an app that lacks
  them. A created app already has them, so its first build changes none of its files. The test checks
  that.
- **The patches, in `patches/`.** pnpm applies `patchedDependencies` only from the project it
  installs ([`patches.md §2`](patches.md)), so the app declares them from its own copy. The template's
  copy is the framework's `patches/`, held byte for byte by `create.test.mjs`. Bumping a patch means
  copying it here too.

The app's `@arrzdev/adaptv` dependency is the framework's version (`ADAPTV_VERSION`). Its peers are
pinned to the versions the framework pins. **`ADAPTV_SPEC`** overrides the framework spec, so you can
try the template against a checkout:

```bash
ADAPTV_SPEC=link:/path/to/adaptv pnpm create adaptv my-app   # or node packages/create-adaptv/index.mjs
```

## 3. What it prints

The CLI output contract ([`cli-contract.md`](cli-contract.md)) applies to it. It cannot import the
render engine because it ships alone, so it restates the palette and the two glyphs it uses, and the
test holds the glyphs to `bin/ui/theme.mjs`.

```
  adaptv · create my-app

  ✓ created my-app

    cd my-app
    pnpm install
    pnpm dev
```

The next steps use the package manager that ran it (`npm_config_user_agent`). A refusal is one `✖` on
stderr that names the fix, and exit 1: a missing name, a name that is not a lowercase package name, an
unknown option, a directory that already holds something.

## 4. What a published app needed

Measured by installing a `pnpm pack` tarball of the framework into a created app, outside the repo:

- **The `dist` cutover.** Installed from a tarball, the app's `vite.config.ts` did not load: Node
  refuses to strip types under `node_modules`, and `exports` pointed at `src/*.ts`. `exports` now
  point at `dist/`, and [`examples/basic`](../../examples/basic), a created app installed from the
  tarball, runs `adaptv dev web` and `adaptv build web`.
  → [`../roadmap/dist-cutover.md`](../roadmap/dist-cutover.md)
- **The patches, inside the app.** pnpm applies `patchedDependencies` only from the root project
  ([`patches.md §2`](patches.md)). A block that points at `node_modules/@arrzdev/adaptv/patches/`
  fails a fresh install with `ERR_PNPM_PATCH_NOT_FOUND`, because the files are inside the package
  being installed. The template now carries them in the app's `patches/` (§2), and adaptv's
  missing-patch error tells a hand-made app to copy them there.
- **The route's split chunk on the dev server.** The code-splitter writes `@tanstack/react-router`
  into the app's route module. Vite's SSR import analysis externalized that bare import before
  adaptv's redirect could resolve it, so Node looked for TanStack from the app, and a standalone pnpm
  app served a 500 in `adaptv dev web`. In dev, `src/vite/tanstack-resolve.ts` now inlines the router
  on the server.

Both were measured on 2026-10-05: an app created against the tarball, outside the repo, ran
`pnpm install`, `adaptv build web` (exit 0) and `adaptv dev web` (200), with nothing copied by hand
→ [`../roadmap/dist-cutover.md`](../roadmap/dist-cutover.md) item 4.

## 5. The npm name

`create-adaptv` is unclaimed on npm, and the website's create command depends on claiming it. The older
plan, a public scaffolder in front of a private framework on GitHub Packages, was overtaken when the
owner decided adaptv will be open source under MIT ([`../roadmap/website.md`](../roadmap/website.md)
§4). Once that happened there was no PAT to configure first, so there was no chicken-and-egg.
