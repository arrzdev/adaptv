# Writing a docs page

The public docs live in `website/src/content/docs/pages/`, one file per page. The shape follows
Expo's docs, because the product has the same parts: components, hooks, capabilities, a config
file and a CLI.

**Read these first:** `src/content/blocks.ts` (every block you can use),
`src/content/docs/types.ts` (the page shape), and the reference page
`src/content/docs/pages/switch.ts` with its demo `src/components/docs-demos/switch-demo.tsx`.

## The one rule: the source is the truth

Every prop, default, type, command, flag and config key must be read out of the framework source
(`../src`, `../bin`) or its internal docs (`../docs`) before it is written down. Never write an API
from memory or from what a similar library does. If the source and an internal doc disagree, the
source wins. If something is unbuilt or half-built, say so in a `note` block; adaptv is pre-alpha
and the docs say what is true today.

- Public import paths are the `exports` of `../package.json`: `adaptv/components`,
  `/hooks`, `/capabilities`, `/storage`, `/config`, `/router`, `/routes`, `/utils`, `/ota`,
  `/vite`, `/sw`, `/styles.css`. Only document what those barrels (`../src/interface/*.index.ts`) export.
- JSDoc in the source is the best starting text. Rewrite it for a reader who has never seen the
  repo: drop decision-register ids (L20, O7, B9), internal file paths and history.
- The engines underneath (the router, the native shell) can be named when it helps someone debug,
  but a page is about adaptv's API, not theirs.

## Page shapes

**Component page**: `platforms`, `importLine`, `source`, then blocks: a `demo` first (live
component + the code that produced it), `h2 Usage` (when to reach for it, the one thing people get
wrong), `h2 Props` (`props` block, every public prop), sub-components and their props if it is a
compound, `h2 Styling` (data attributes, what `className` lands on, what is locked), `h2 Ref` if it
has an imperative handle, `h2 Accessibility` if there is something to say, `h2 Where it works`
(`targets` block) when targets genuinely differ.

**Hook / capability page**: several related hooks share a page. For each: an `api` block
(name, signature, description, params, returns), a short `code` example, and a `targets` block
when behaviour differs by target (it usually does: that is why the hook exists).

**Guide**: task-shaped. What you are trying to do, the steps, the code, what goes wrong.

**Reference (config, CLI)**: every key / command / flag, each with type, default and one or two
sentences. Use `h2` per area and `props` or `table` blocks.

## Demos

A demo is a small component in `src/components/docs-demos/<slug>-demo.tsx`, imported by the page
file and passed to a `demo` block along with a `code` string a reader could paste. Rules:

- Built from the real adaptv component. It must run in a desktop browser with a mouse.
- Style with the site's tokens: `bg-background`, `bg-surface`, `bg-sunken`, `bg-raised`,
  `text-foreground`, `text-subtle`, `text-muted`, `border-border`, `border-border-strong`,
  `bg-brand`, `text-brand`, `bg-success`, `bg-danger`. Both themes must look right.
- `Pressable` takes `onPress`; `Button` takes `onClick`; `Link` has neither. `Pressable` is a bare
  `div`, so give it `flex` yourself. `View` is a flex column; `<View row>` is a row.
- The `code` string shows ordinary Tailwind (`bg-gray-200`), not this site's tokens.
- Keep it small: a demo shows the component's one idea, not an app.

## Voice

Plain, short, second person. Say what it does, then how to use it. No marketing, no "simply",
"just", "easily", "powerful", "seamless". No rhetorical questions. No "not X, but Y" constructions.
Prefer a concrete example to an adjective. Text fields accept `` `code` ``, `**bold**` and
`[label](/docs/slug)` links, and bold may hold code and links; link to other pages by slug
when you mention them.

## Mechanics

- A page file exports `export const page: DocPage = { ... }`. Slugs are flat and lowercase.
- Do not edit `src/content/docs/index.ts`, `blocks.ts`, `types.ts`, `prose.tsx` or
  `docs-layout.tsx` when adding a page in a batch; register pages in `index.ts` last.
- `pnpm typecheck` and `pnpm lint` in `website/` must pass. Run `pnpm format` before finishing.
