import { LinkDemo } from "@/components/docs-demos/link-demo"
import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "link",
  title: "Link and ExternalLink",
  summary:
    "`Link` navigates inside the app and tells a tap from a scroll or a hold. `ExternalLink` leaves the app: the in-app system browser on native, a new tab on the web.",
  platforms: ["Web", "PWA", "iOS", "Android"],
  importLine: 'import { Link, ExternalLink } from "@arrzdev/adaptv/components"',
  source: "src/components/link.tsx",
  blocks: [
    {
      type: "demo",
      component: LinkDemo,
      code: `import { ExternalLink, Link } from "@arrzdev/adaptv/components"

<Link to="/docs/$slug" params={{ slug: "pressable" }} className="rounded-xl bg-white px-4 py-3 active:bg-gray-100">
  Pressable
</Link>

<ExternalLink href="https://example.com" className="rounded-xl bg-white px-4 py-3 active:bg-gray-100">
  example.com
</ExternalLink>`,
    },
    { type: "h2", text: "Usage" },
    {
      type: "p",
      text: "`Link` renders a real `<a href>` through the router, so everything an anchor does still works: crawlers follow it, Cmd-click and middle-click open a new tab, the URL shows on hover, and the router can preload the route. On top of that it runs adaptv's press engine to decide whether a touch was a tap:",
    },
    {
      type: "ul",
      items: [
        "A clean tap navigates.",
        "A touch that scrolls the page, is cancelled, or is released outside the link does not navigate.",
        "A press held in place for longer than `300ms` is a hold, and does not navigate either.",
      ],
    },
    {
      type: "code",
      label: "links.tsx",
      lang: "tsx",
      code: `<Link to="/settings">Settings</Link>

<Link to="/orders/$orderId" params={{ orderId: order.id }}>
  Order {order.number}
</Link>

<Link to="/search" search={{ q: "shoes", page: 2 }}>
  Shoes
</Link>`,
    },
    { type: "h3", text: "There is no onClick" },
    {
      type: "p",
      text: "`Link` accepts no `onClick`, and that is deliberate. Navigation is the anchor's own click, and the engine decides whether that click is allowed to happen; a second handler would either run for touches that were scrolls, or be skipped without telling you. When navigation is the result of doing something (save, then leave), use a [Button](/docs/button) and navigate from its handler with the [router](/docs/router-api).",
    },
    {
      type: "code",
      label: "save-and-leave.tsx",
      lang: "tsx",
      code: `import { Button } from "@arrzdev/adaptv/components"
import { useRouter } from "@arrzdev/adaptv/router"

const router = useRouter()

<Button
  onClick={async () => {
    await save()
    router.navigate({ to: "/orders" })
  }}
>
  <Button.Text>Save</Button.Text>
</Button>`,
    },
    { type: "h2", text: "Link props" },
    {
      type: "props",
      rows: [
        {
          name: "to",
          type: "string",
          required: true,
          description:
            "A route path: `/settings`, or a pattern such as `/orders/$orderId` filled in by `params`. An external URL (anything with a scheme, such as `https:` or `mailto:`, or starting with `//`) renders an `ExternalLink` instead.",
        },
        {
          name: "params",
          type: "Record<string, string>",
          description: "Values for the `$name` segments in `to`.",
        },
        {
          name: "search",
          type: "Record<string, unknown>",
          description: "Query-string values.",
        },
        {
          name: "children",
          type: "ReactNode",
          required: true,
          description: "The link's content.",
        },
        {
          name: "className",
          type: "string",
          description: "Lands on the `<a>`.",
        },
        {
          name: "disabled",
          type: "boolean",
          default: "false",
          description:
            "Block navigation. Sets `aria-disabled` and `tabIndex={-1}` and switches the cursor to `not-allowed`.",
        },
        {
          name: "smartBack",
          type: "boolean",
          default: "false",
          description:
            "Treat the link as a back button: when the previous history entry is `to`, go back instead of pushing a duplicate. See below.",
        },
        {
          name: "ref",
          type: "Ref<HTMLAnchorElement>",
          description: "The `<a>` element.",
        },
      ],
    },
    {
      type: "note",
      tone: "warn",
      text: "That list is complete. `Link` does not pass other anchor attributes through: `style`, `id`, `aria-label`, `target`, `title` and `data-*` are not accepted, and neither are the router's `replace`, `hash`, `preload` or `activeProps`. Wrap the link's content if you need an attribute on an element, and navigate with the router when you need `replace`.",
    },
    { type: "h2", text: "Preloading" },
    {
      type: "p",
      text: "`Link` has no `preload` prop. Preloading is a router setting, and every `Link` follows it. Set it once under `router` in [adaptv.config.ts](/docs/config); adaptv does not turn it on for you.",
    },
    {
      type: "code",
      label: "adaptv.config.ts",
      lang: "ts",
      code: `import { defineApp } from "@arrzdev/adaptv/config"

export default defineApp({
  router: {
    // "intent": on hover and touch-start. "viewport": when the link scrolls into view.
    defaultPreload: "intent",
  },
})`,
    },
    {
      type: "p",
      text: '`"viewport"` suits an app that should keep working [offline](/docs/offline): every route a visible link points to is fetched before the user taps it.',
    },
    { type: "h2", text: "smartBack" },
    {
      type: "p",
      text: 'An in-app back button written as `<Link to="/inbox">` pushes a new `/inbox` entry. The history is now inbox, message, inbox, and the OS back gesture returns to the message. With `smartBack`, a plain left click checks whether going back one entry would land on `to`. If it would, the link calls `history.back()`, so the app\'s back button and the OS edge swipe share one stack.',
    },
    {
      type: "code",
      label: "message-header.tsx",
      lang: "tsx",
      code: `<Link to="/inbox" smartBack className="flex items-center gap-1">
  <ChevronLeft />
  Inbox
</Link>`,
    },
    {
      type: "ul",
      items: [
        'It is still an `<a href="/inbox">`. Modified clicks and crawlers see an ordinary link.',
        "When adaptv cannot confirm the previous entry, it pushes as usual. That is the case right after a deep link or a hard reload, when there is no recorded entry to compare with.",
        "The comparison is against `to` exactly as written, so `smartBack` is for static paths. A pattern such as `/orders/$orderId` never matches a real pathname and always pushes.",
      ],
    },
    { type: "h2", text: "ExternalLink" },
    {
      type: "p",
      text: 'A native app\'s WebView must not navigate to another site: the app would be replaced by a web page with no way back. `ExternalLink` renders `<a href target="_blank" rel="noopener noreferrer">` and intercepts a plain left click to open the URL the right way for the target.',
    },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "yes",
          note: "A new tab.",
        },
        { target: "Mobile web", status: "yes", note: "A new tab." },
        {
          target: "Installed PWA",
          status: "yes",
          note: "The URL is handed to the default browser, so the user leaves the app window. That is the platform's behaviour for an installed web app.",
        },
        {
          target: "iOS",
          status: "yes",
          note: "The in-app system browser (`SFSafariViewController`): it slides over the app and is dismissed back to it, with the app's state intact.",
        },
        {
          target: "Android",
          status: "yes",
          note: "A Custom Tab over the app. Back returns to the page that opened it.",
        },
      ],
    },
    {
      type: "p",
      text: "If the native browser plugin is unavailable, it falls back to `window.open`. Modified and non-primary clicks (Cmd, Ctrl, Shift, Alt, middle button) are left to the browser.",
    },
    { type: "h3", text: "ExternalLink props" },
    {
      type: "props",
      rows: [
        {
          name: "href",
          type: "string",
          required: true,
          description:
            "The destination: `https:`, `mailto:`, `tel:` or any other URL.",
        },
        {
          name: "onClick",
          type: "MouseEventHandler<HTMLAnchorElement>",
          description:
            "Runs first. Call `event.preventDefault()` to stop `ExternalLink` from opening the URL.",
        },
        {
          name: "className",
          type: "string",
          description: "Lands on the `<a>`.",
        },
        {
          name: "ref",
          type: "Ref<HTMLAnchorElement>",
          description: "The `<a>` element.",
        },
      ],
    },
    {
      type: "p",
      text: "Unlike `Link`, every other `<a>` attribute passes through (`aria-label`, `style`, `title`, `data-*`). `target` and `rel` are fixed and cannot be overridden. `ExternalLink` does not use the press engine: it is a plain anchor, it has an `onClick`, and `active:` on it is the browser's own `:active`.",
    },
    { type: "h3", text: "Link with an external to" },
    {
      type: "p",
      text: '`<Link to="https://example.com">` renders an `ExternalLink` for you, so a list of links from data does not have to branch. `params`, `search` and `smartBack` are ignored on that path.',
    },
    {
      type: "note",
      tone: "warn",
      text: "On that path `disabled` only sets `aria-disabled` today. The click still opens the URL. Do not render the link, or use `ExternalLink` with an `onClick` that calls `preventDefault()`, until this is fixed.",
    },
    {
      type: "p",
      text: "The test both components rely on, and the function that opens the URL, are exported from [capabilities](/docs/capabilities):",
    },
    {
      type: "code",
      label: "open-external.ts",
      lang: "ts",
      code: `import { isExternalUrl, openExternal } from "@arrzdev/adaptv/capabilities"

isExternalUrl("https://example.com") // true
isExternalUrl("mailto:hi@example.com") // true
isExternalUrl("//cdn.example.com/a.png") // true
isExternalUrl("/settings") // false

await openExternal("https://example.com")`,
    },
    { type: "h2", text: "Styling" },
    {
      type: "p",
      text: "`Link` starts from `text-left text-gray-950 no-underline cursor-pointer`, and `ExternalLink` from `text-left no-underline cursor-pointer`. All of it can be overridden from `className`. The three `touch-action` classes the press engine depends on are locked on both, and a disabled `Link` adds a locked `select-none`.",
    },
    {
      type: "table",
      head: ["Hook", "On", "When"],
      rows: [
        [
          '`data-adaptv="link"`',
          "`Link`",
          "Always, including when `to` is external.",
        ],
        ['`data-adaptv="external-link"`', "`ExternalLink`", "Always."],
        [
          "`data-pressed`",
          "`Link` (in-app)",
          "A pointer is down inside the press region. Style it with `active:`; see [Pressable](/docs/pressable).",
        ],
        [
          '`aria-disabled="true"`',
          "`Link`",
          "`disabled` is set. Style it with `aria-disabled:opacity-50`.",
        ],
      ],
    },
    {
      type: "p",
      text: "`Link` does not set an active class for the current route. Compare against the current location from the [router](/docs/router-api) and branch your `className`.",
    },
    {
      type: "p",
      text: "Two app-wide rules apply to every anchor with an `href`. The grey tap highlight is always off, because the press state already gives feedback. The iOS long-press preview sheet is controlled by `ui.touchCallout` in [adaptv.config.ts](/docs/config): by default it is suppressed in an installed PWA and on native, and kept in a Safari tab where copying a link is a real use. `Link` also sets `draggable={false}`.",
    },
    { type: "h2", text: "Accessibility" },
    {
      type: "ul",
      items: [
        "Both render a real anchor with an `href`: it is in the tab order, Enter follows it, and it is announced as a link.",
        "A disabled `Link` leaves the tab order (`tabIndex={-1}`) and is announced as disabled.",
        '`Link` cannot take an `aria-label`. An icon-only link needs visually hidden text inside it, for example a `<span className="sr-only">`.',
        "`ExternalLink` always opens a new browsing context. Say so in the label or with an icon when it is not obvious.",
      ],
    },
  ],
}
