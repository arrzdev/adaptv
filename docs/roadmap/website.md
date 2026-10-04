# adaptv — the website

> 📐 **Researched, and a first draft scaffolded** in [`website/`](../../website/README.md). A survey
> of sixteen framework sites (fetched 2026-09-20) and the plan it produces. The draft is the landing
> page, a docs shell and one field note; everything in §3.3–§3.5 beyond that is still unbuilt, which
> is why this file is still in `roadmap/`.
>
> **The owner's brief, 2026-09-20:** *"someone that enters the website instantly understands why
> adaptv is important and why YOU (developer) will want to use it."* The code will be open source.
> The site sells **the fixes** — the loupe, the viewport-height maths, the keyboard — not the stack
> underneath; naming the engines on the site is neither a goal nor a violation, and the GitHub
> README can be transparent about them. The CLI's opacity rule (**L20**, `bin/lib/opacity.mjs`) is
> untouched by any of this.

---

## 1. What every framework site has in common

Surveyed: Next.js, Nuxt, Astro, Svelte/SvelteKit, Vite · TanStack, React Router/Remix, SolidStart,
Hono, Tailwind · Expo, Capacitor, Ionic, Tauri, React Native, Flutter.

**The shape is always landing → docs → blog**, and the three parts do three different jobs: the
landing page answers *why*, the docs answer *how*, the blog proves *it is alive and the people
behind it know things*.

### The landing page, in the order it almost always runs

| # | Block | What it is | Who does it best |
|---|---|---|---|
| 1 | **Hero** | A "The X for Y" line, ONE explanatory sentence, `Get started`, and a copyable create command | Next (`npx create-next-app`), Astro, Vite (tabbed by package manager) |
| 2 | **Show, don't tell** | The product itself, immediately under the hero | Nuxt (tabbed code + file tree), React Native (code beside iOS + Android frames), Ionic (live component, iOS/MD toggle) |
| 3 | **Feature grid** | 4–14 cards | everyone; it is the weakest block on every site |
| 4 | **Proof** | Company logos, npm/GitHub stats, tweet walls, peer testimonials | Vite (quotes from other framework authors), Astro (a benchmark chart against named rivals) |
| 5 | **Ecosystem** | Templates, modules, showcase, "deploy anywhere" logos | Nuxt, Astro |
| 6 | **Sponsors · newsletter · footer** | | |

The cross-platform sites add one thing: the hero's second sentence **names the platforms and says
"single codebase"** (Flutter, Tauri, Expo, Ionic — nearly verbatim), and OTA is sold as an
*outcome* — Expo: "Get the latest to every user, instantly".

### The docs

- **Sections: Getting Started · Guides · Reference**, with a tutorial kept *separate* where one
  exists (Next `/learn`, Astro, Svelte). React Router follows Diátaxis outright (Tutorials ·
  How-Tos · Explanations · API).
- **Content lives in the framework repo** as markdown (Next, Nuxt, Svelte, Vite, Expo, TanStack,
  React Router); the site pulls it in. Separate docs repos are the Docusaurus-era pattern.
- **Table stakes:** edit-on-GitHub, package-manager tabs, filename headers on code blocks, ⌘K
  search (Algolia DocSearch, or local — Vite and Svelte use no third party), RSS.
- **The 2026 table stakes:** `llms.txt`, "Copy page" as markdown, `.md` URLs. Next, Nuxt and Expo go
  further and serve agents a different *homepage* — Expo's includes "common misconceptions" and
  "when to consider alternatives".
- **Per-platform differences** (the part that matters most here): Expo puts platform badges in every
  API page header and tags every method; Tauri has a filterable plugin support matrix; React Native
  has "Developer notes" tabs that explain one concept separately to web, iOS and Android developers.
- Version dropdowns everywhere — irrelevant until there is a second version.

### The blog

Release posts are the spine everywhere. The sites that feel alive add **engineering deep dives**
(TanStack's "Inside a TanStack Router Navigation", Next's Turbopack posts, Expo at ~10 posts/month)
or a fixed-cadence digest (Svelte and Astro: "What's new", monthly).

### How the sites are built

**Every framework dogfoods itself** (Hono is the lone, self-mocking exception) and most keep the
site source open. Docs tooling is either the framework's own (Nuxt Content, Starlight, VitePress,
SolidBase) or a custom MDX app (Next, Expo, Tailwind, TanStack).

---

## 2. What adaptv cannot copy, and what it has instead

Block 4 — proof — is the one that carries most landing pages, and adaptv has **none of it**: no
logos, no download count, no testimonials, and today no install command either (`private: true`,
no scaffolder → [`create-adaptv.md`](create-adaptv.md), [`dist-cutover.md`](dist-cutover.md)).

What it has is something none of the sixteen have: **a catalogue of specific, felt bugs, each with a
recorded experiment and a shipped fix** ([`../VISION.md §3`](../VISION.md),
[`../design/behaviors.md`](../design/behaviors.md), [`../research/`](../research/README.md)). And
[`../decisions/positioning.md`](../decisions/positioning.md) already names the objection the site
exists to beat — *"I have yet to see a webview that doesn't feel like a webview"* — and how:
**"in a demo, not a README."**

So the landing page inverts the usual weighting. **Block 2 becomes the whole page; block 3 shrinks
to a footnote; block 4 is replaced by evidence.**

---

## 3. The plan

### 3.1 The site is an adaptv app

Not for the principle of it — because it is the demo. `render` defaults to `"ssr"` *precisely* for
"a landing page, pricing, docs" ([`../decisions/rendering-and-delivery.md §1`](../decisions/rendering-and-delivery.md)),
so this is the default's own use case. A visitor on a phone is already holding the product:
the page they are scrolling has the press physics, the overscroll containment and the drawer, it
installs to the home screen, and it opens offline. **"Open this on your phone"** (a QR on desktop)
is a CTA no other framework site can make.

It will also be the first adaptv app that is mostly *content*, so it will force things the
playground never has: an MDX pipeline, syntax highlighting, search, prerendered pages. That is a
feature of doing it — but timebox it. If the content pipeline is more than ~a week, ship the docs on
Starlight and keep the landing page and blog on adaptv; the demo lives on the landing page.

Location: [`website/`](../../website/README.md) at the repo root — its own pnpm project linked to
the root like `playground/`. **Scaffolded 2026-09-20**: the landing page, two live demos, a docs
shell and the first field note run on `adaptv dev web`, server-rendered. **Landing page redesigned
2026-09-21** after the owner called the first pass template-grade: the hero now runs a live inbox
built from adaptv components (phone and desktop frames over one state), feature cards hold the live
component instead of describing it, and the rules it is held to are in `website/README.md §Design
rules`. Public docs content belongs in `website/` — **not** in `docs/`, whose five folders make
internal claims and name the machinery freely. Host where the playground already deploys.

**What dogfooding found on day one** — each is a framework item, not a site item:

- **`adaptv dev web` refuses a config with no `appId`** (`bin/lib/load-config.mjs`), though the
  config type documents `appId` as the thing a *web-only* app omits. The site carries one it does
  not want.
- **`useTheme()` is a hydration trap.** It resolves the theme off `<html>` on the first client
  render, which the server cannot know, so any markup that branches on it mismatches. The site
  renders both icons and lets `dark:` pick. Worth a line in the hook's docs, or a CSS-only helper.
- **`Button` takes `onClick`, `Pressable` takes `onPress`.** The first draft's own code sample got
  it wrong, and typecheck only caught it once the component was used for real. Two names for one
  gesture is a papercut every new user will hit.
- **A "plain web view" cannot be written with utilities inside an adaptv app** — the patches reach
  it. Correct behaviour, but it means every comparison demo is raw unlayered CSS.
- **No document scroll** (🔒 [`../decisions/browser-chrome-autohide.md`](../decisions/browser-chrome-autohide.md))
  means a content site on a mobile *browser* never retracts the URL bar, and `#hash` links and
  scroll restoration are the app's to build. Accepted cost; the first content site is where it is felt.

**Docs written 2026-09-21.** 48 pages in `website/src/content/docs/pages/`, shaped after Expo's
docs because the product has the same parts: guides (get started, concepts, shipping) and a
reference (19 component pages with live demos and props tables, five hook pages and the
capabilities / storage / router / utils APIs as signature blocks, and the config, CLI and Vite
plugin references). Every page was written from the source, not from `docs/`. The authoring rules
are in `website/DOCS_AUTHORING.md`.

**What writing the docs found** — reading every public API end to end, against its lab page and its
internal doc, surfaced these. Each is a framework item; the public pages carry a `note` where a
reader would trip on it. None is verified beyond what is stated.

- **`List` does not scroll its full extent** (measured in Chromium): the inner spacer is a flex
  child of the column `ScrollView` and shrinks to the viewport, so 10,000 rows report a
  `scrollHeight` of the mounted rows only. `flex-shrink: 0` on the spacer fixes the measurement.
  `List` also takes no `ref`, so it cannot be given to `PullToRefresh`.
- **`Input` / `TextArea` `ref.clear()` never reaches React's `onChange`** (measured), so a
  controlled field's state and DOM disagree. `TextArea` ignores `rows` when `autoResize={false}`.
  `onSubmitKey` is skipped on touch devices while the fields lab expects it to fire. The `caret:`
  class routing matches no Tailwind variant.
- **Server functions are refused in every build**, SSR web included (`src/vite/ban-server-apis.ts`),
  where the owner's direction is to refuse only the artifact with no server. The `server:` scan
  misses an options object passed by variable.
- **Back chain:** `Drawer` registers no back handler (only `Dropdown` does), and nothing listens to
  the browser's Back button; the drawer lab says browser Back closes it. `Drawer.Nested`'s flag is
  unused; there is no Escape-to-close, no focus trap, and `Title`/`Description` are not
  aria-linked. `onOpenChange` fires when following the prop and twice on close.
- **`Link`'s props are closed**: no `aria-label`, `style`, `id`, `data-*`, `replace`, `hash` or
  `preload`, and `to` is an untyped string, while `ExternalLink` passes every anchor attribute. A
  `disabled` external `Link` still opens. `smartBack` compares the raw `to` with the pathname, so a
  parameterised route never matches.
- **`Button`** cannot submit a form (`type` is locked and the native click is cancelled), types
  `onClick` as a `MouseEvent` it never receives, and sets no `data-disabled` though the lab says so.
- **Hardcoded colours that ignore a dark theme:** the `PullToRefresh` arc (`text-gray-950`, and no
  indicator slot) and the default `Offline` screen. `Dropdown` relies on the consumer's `@theme`
  defining `bg-surface`, `ring-border` and `text-foreground`.
- **`Checkbox`** has no indeterminate mark (the lab says a dash), drops label text placed inside
  it, and an external `<label htmlFor>` does not toggle it. **`Dropdown`** has no arrow keys,
  type-ahead or focus move despite `role="menu"`. **`WheelColumn`** has no keyboard path and no
  haptic tick. **`Swipeable`** slots drop every prop but `children`, and `enabled={false}` leaves
  an open row open.
- **Haptics ordering:** `supportsHapticTick()` turns false once `useHaptics()` has installed the
  vibrate polyfill, so a later `attachHapticTick` attaches nothing on iOS Safari. **Keep-awake** is
  one lock with no refcount. **`useStatusBar`** never restores. **`kv`** hydration on native is not
  actually gated behind the splash (`void initKv()`).
- **Native:** no Android release signing or `.aab` (`build android` is a debug `.apk`), no config
  key for permission text (adaptv's own geolocation plugin included), the manifest hardcodes
  `start_url: "/"`, and `notFoundHomeTo` is unreachable from config.
- **Stale text:** `app-config.ts` says `adaptv gen icons`; `secure.ts` says `adaptv sync`;
  `types.ts` says `orientationGuardComponent` / `updateRequiredComponent` (the keys end in
  `Screen`); `cli-spec.mjs` says the channel lands in `dist/client` (SSR writes `.output/public`)
  and `-o` is ignored by `build web`; `patches.css` says scrollbar hiding is installed-only (the
  default is `"all"`); `docs/design/lifecycle.md` §7, `rendering.md` §2, `architecture.md` §3.2
  and `decisions/browser-chrome-autohide.md` (`View scroll="y"`) describe things that no longer
  exist; `styling.md` §3's `data-part` contract is set by `Image` alone; `UpdateRequiredProps` and
  the `Swipeable` root props are not exported; the public not-found export is `UiNotFound`.

### 3.2 Landing page

1. **Hero.** The README's sentence is already right: *one React codebase → desktop web, mobile web,
   an installable home-screen app, and real iOS and Android apps that don't feel like a website in a
   box.* One app shown in four frames (browser · home screen · iOS · Android). CTAs: `Get started`,
   and the create command **once it exists** — until then `Read the docs` + `Star on GitHub`.
2. **The fork.** The README's two-roads table, compressed: native views cost you the web platform;
   the DOM costs you "every place a web page does not behave like an app". *adaptv takes the second
   road and refuses to pay.*
3. **The price, itemised — the centrepiece.** Six to eight divergences, each a side-by-side
   *plain web view* vs *adaptv*, live and touchable on a phone, a captured clip on desktop (steal
   Ionic's toggle). Candidates, all shipped: the double-tap **loupe** · **`100vh`** and the launch
   shift · the **keyboard** (three mechanisms, one signal) · **`:active`** that never clears ·
   **overscroll chaining** · the **double splash** · safe areas landing after first paint ·
   edge-swipe vs the OS gesture. Each links to its deep dive (§3.4).
4. **The fix only a framework can make.** Server-only code in a mobile bundle → a build error with
   a caret on the line. Show the actual terminal output.
5. **One file, one tool.** Tabbed code à la Nuxt: `adaptv.config.ts` · a route · a capability hook ·
   the CLI (`dev|preview|build` × `web|ios|android|all`).
6. **Updates.** Deploy the web app and the installed apps follow — signed, self-hosted. Sold as the
   outcome, the way Expo does.
7. **When *not* to use adaptv.** Lifted from Expo's agent page, and native to this repo's culture:
   positioning.md already writes down the reasons to be sceptical. It reads as confidence.
8. Footer: docs, blog, GitHub, RSS, "install this site".

### 3.3 Docs

| Section | Contents | Source today |
|---|---|---|
| **Get started** | install · first app · run it on a phone · project structure | unwritten — blocked on the scaffolder |
| **Guides** | offline UI · auth without cookies · offline-first data · theming · icons · deploying web · shipping iOS / Android · OTA | [`../guides/cookbook.md`](../guides/cookbook.md) is the seed |
| **Concepts** | the frame you inherit · `View` · layout shift as a correctness bug · rendering and offline | rewrite from `VISION.md`, `design/architecture.md`, `design/rendering.md` |
| **Reference** | config · CLI · components · hooks · capabilities · storage · OTA | unwritten; 16 export subpaths, ~30 components, 40 hooks. Generate what can be generated from TSDoc |
| **Platform notes** | one page per divergence: the platform fact, the experiment, what adaptv does | `research/`, `design/behaviors.md`, the register's bug catalogue |

Steal outright: **platform badges on every API** (web · home screen · iOS · Android — Expo), package-
manager tabs, filename headers, edit-on-GitHub, **local search** (no third-party index),
`llms.txt` + copy-as-markdown from day one, one page per CLI error (Next's `/docs/messages`).
Skip: versioning, i18n, AI chat, showcase, templates — nothing to put in them yet.

**Platform notes is the unusual one and the SEO play.** Developers search for the bug, not for a
framework: "ios pwa 100vh", "capacitor keyboard resize", "webview :active stuck". Each page answers
the question honestly for someone who will never use adaptv, then shows the one-liner that makes it
not their problem.

### 3.4 Blog

Release notes once there are releases. Until then — and as the lasting spine — **field notes**: the
deep dives the landing page links to. The material already exists in `research/`, the register and
the PR history: how the loupe is suppressed; why iOS 26's bars follow painted pixels and iOS 18's do
the opposite; a sheet settle that only a `@keyframes` rule gets clean; what Android's WebView really
does to `innerHeight` under the keyboard. Ten posts are sitting in the repo unwritten-up. RSS from
day one.

### 3.5 Sequence

| Phase | Ships | Blocked on |
|---|---|---|
| **0** | `website/` scaffold on adaptv ✅; landing page with 3 live divergence demos; 3 field notes | nothing |
| **1** | Docs: Concepts, Platform notes, Guides | nothing — none of it needs an install command |
| **2** | Get started, the create command in the hero, Reference | open-sourcing, [`dist-cutover.md`](dist-cutover.md), [`create-adaptv.md`](create-adaptv.md) |
| **3** | Proof, as it arrives: stats, a showcase, quotes | users |

Phases 0–1 can go public before the package does; a site that explains the problem well is worth
having while the install command is still "soon".

---

## 4. Decisions owed by the owner

- **Domain and name treatment** — nothing is registered in the repo.

### Answered 2026-09-20

- **Licence: MIT.** It is what the whole neighbourhood uses (Next, Nuxt, Astro, Vite, TanStack, Expo,
  Capacitor, Ionic), and nothing in the tree objects: the three ports in `THIRD_PARTY_LICENSES` are
  MIT, and of 42 direct and peer dependencies 41 are MIT and one (`sharp`) is Apache-2.0. The flip
  itself — a `LICENSE` file, `package.json`'s `license`, the README badge and its closing section —
  belongs to the open-sourcing change, and it turns roadmap loose end **L4** from tidiness into an
  obligation: Ionic's `Used by: (pending)` line must name the files before the repo is public.
- **`create-adaptv` is needed, and is expected to be rewritten later.** So build the smallest one
  that makes the hero's command true — prompts and a template copy — and do not design for the
  rewrite. Open source also deletes the reason for its public-scaffolder / private-framework split
  → [`create-adaptv.md`](create-adaptv.md).
