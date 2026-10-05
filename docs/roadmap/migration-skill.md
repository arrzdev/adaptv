# adaptv — a migration skill: an agent moves an existing React app onto adaptv

> **Status: direction recorded 2026-10-05 ("eventually"). Not built, not designed, not ranked above
> current work.** Nothing here has been tried on a real app. The rules in §3 are read from the locked
> decisions and the roadmap, not from a migration.
>
> **Size: medium. Risk: low** — it is a document, not code. Its cost is keeping it true while the
> surface it describes still moves.

---

## 0. The direction, in the owner's terms

A developer who already has a React app should get the benefits of adaptv (an installable app and
real iOS and Android builds) without much effort. adaptv ships, in its docs, a skill: a `SKILL.md`
an AI coding agent loads and follows to migrate that app. The skill knows what moves across as it
is, what must change, and what cannot come along — for example a Next.js app that also uses Next as
its backend (API routes, server actions), because adaptv's native and static artifacts have no
server.

## 1. What the deliverable is

- **One file an agent loads**, `SKILL.md` with the usual frontmatter (`name`, a `description` that
  says when to trigger), plus reference files it reads on demand, one per source stack.
- **Lives in the docs** and ships with the package, so the skill matches the installed version. The
  exact path is open (§4, Q2).
- **Consumer-facing, so L20 binds it.** Like `../guides/cookbook.md`, it may not name the engine
  underneath. It may name the *source* stack (Next.js, Vite, CRA, Remix, React Router), because that
  is the developer's code, not adaptv's.
- **It teaches, it does not rewrite blindly (L7).** The agent's first output is a report: what moves,
  what changes, what is blocked and why. It edits code only after that report.

## 2. The procedure the skill encodes (draft)

1. **Inventory.** Framework and router, rendering mode, data fetching, auth and where the session
   lives, styling system, browser-only APIs, and every place the app reaches a server.
2. **Classify each finding** as *moves as is*, *changes* (with the adaptv replacement), or *blocked
   on this target* (with the reason and the way out).
3. **Report and stop** for the developer's decision on anything blocked.
4. **Scaffold** with the scaffolder once it exists (`create-adaptv.md`), then move routes, screens
   and components across.
5. **Replace** hand-rolled platform code with adaptv primitives and capabilities: safe-area padding
   → the shell, scroll containers → `ScrollView`/`List`, `navigator.share`/vibrate/clipboard → the
   capability modules, `localStorage` for secrets → secure storage.
6. **Verify per target** with the commands in `../guides/testing.md`: `adaptv dev web`, then
   `adaptv build ios|android`, and say which targets were not checked.

## 3. The rules it must carry

- **adaptv has no server side, on any target (L3, owner 2026-10-05).** Next.js API routes, route
  handlers, server actions and `getServerSideProps` have no place to run, on the web as much as on a
  phone. The skill says so in the report and offers one exit: move that code to a separate backend
  the app calls over HTTP. Router loaders are not server code and are allowed on every target, so data a page
  fetches from the client can move into a loader.
- **Cookie-based auth breaks on device** (`../design/rendering.md §2`, register **B23**). A native
  WebView does not carry cookie sessions to the app's API, by vendor design, so a session held in
  an `HttpOnly` cookie must move to a bearer token the client holds, kept in `storage.secure`.
- **Next-only APIs have no counterpart** to keep: `next/image`, `next/font`, `next/head`, middleware,
  ISR. `next/image` maps to adaptv's `Image`; for each of the others the skill names the adaptv
  piece that replaces it or says it is dropped. Which piece that is has not been worked out yet.
- **Never import the engine (L20).** Router APIs come from `@arrzdev/adaptv/router`.
- **Never name or patch an underlying package in the consumer's project (L20).**

## 4. Open questions

- **Q1 — When.** The skill is cheapest to keep true after the `dist` cutover and `create-adaptv`
  (#2, #3) ship. The server rule (§3) is settled: no server side, on any target.
- **Q2 — Where it lives.** A folder in the published package (for example `skills/migrate/`), a page
  on the website, or both. The website plan (`website.md`) owns the public docs layout.
- **Q3 — Which source stacks first.** Proposed: Vite + React Router SPA (closest, cheapest), then
  Next.js (largest audience, most blocked findings), then CRA and Remix.
- **Q4 — How to keep it honest.** A migration of one small public app per source stack, run by an
  agent with the skill and checked on every target, before each release that changes the surface.
