import { LinkDemo } from "@/components/docs-demos/link-demo"
import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "link",
  title: "Link and ExternalLink",
  summary: "`Link` goes to a route in the app. `ExternalLink` leaves the app.",
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
      text: "`Link` is a real `<a href>`. Crawlers follow it and Cmd-click opens a new tab. A tap navigates. A scroll, a cancel, a release outside the link or a hold longer than `300ms` does not. There is no `onClick`. To navigate after an action, use a [Button](/docs/button) and the [router](/docs/router-api). If `to` is an external URL (a scheme such as `https:` or `mailto:`, or `//`), `Link` renders an `ExternalLink`.",
    },
    {
      type: "code",
      label: "links.tsx",
      lang: "tsx",
      code: `<Link to="/orders/$orderId" params={{ orderId: order.id }}>
  Order {order.number}
</Link>

<Link to="/inbox" smartBack>Inbox</Link>`,
    },
    { type: "h2", text: "Props" },
    {
      type: "props",
      rows: [
        {
          name: "to",
          type: "string",
          required: true,
          description:
            "A route path, or a pattern such as `/orders/$orderId` filled by `params`.",
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
          name: "disabled",
          type: "boolean",
          default: "false",
          description:
            "Block navigation. Sets `aria-disabled` and `tabIndex={-1}`.",
        },
        {
          name: "smartBack",
          type: "boolean",
          default: "false",
          description:
            "On a plain click, go back instead of pushing a new entry when the previous entry is `to`.",
        },
        {
          name: "className",
          type: "string",
          description: "Lands on the `<a>`.",
        },
        {
          name: "children",
          type: "ReactNode",
          description: "The link content.",
        },
      ],
    },
    {
      type: "p",
      text: "Other `<a>` attributes pass through, including `ref`. `smartBack` suits a back button to a static path. It pushes as usual after a deep link or reload, and for patterns such as `/orders/$orderId`.",
    },
    { type: "h2", text: "ExternalLink" },
    {
      type: "p",
      text: 'It renders `<a href target="_blank" rel="noopener noreferrer">`. On iOS and Android a plain click opens the in-app system browser, so the app web view never leaves your app. Modified clicks go to the browser.',
    },
    {
      type: "props",
      rows: [
        {
          name: "href",
          type: "string",
          required: true,
          description: "The URL: `https:`, `mailto:`, `tel:` or other.",
        },
        {
          name: "onClick",
          type: "MouseEventHandler<HTMLAnchorElement>",
          description: "Runs first. `event.preventDefault()` stops the open.",
        },
      ],
    },
    {
      type: "p",
      text: "Other `<a>` attributes pass through, but `target` and `rel` are fixed. `ExternalLink` does not use the press engine, so `active:` is the browser `:active`. When `Link` renders it, `disabled` only sets `aria-disabled` and the URL still opens.",
    },
    { type: "h2", text: "Styling" },
    {
      type: "p",
      text: '`Link` has `data-adaptv="link"`, `ExternalLink` has `data-adaptv="external-link"`. Both start neutral (`text-left no-underline cursor-pointer`) and `className` overrides it. The `touch-action` classes are locked. Style `Link` press state with `active:`, as on [Pressable](/docs/pressable). A disabled `Link` has `aria-disabled="true"`. There is no active-route class: compare against the [router](/docs/router-api) location. For an icon-only `Link`, put `sr-only` text inside.',
    },
    { type: "h2", text: "Where it works" },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "yes",
          note: "`ExternalLink` opens a new tab.",
        },
        {
          target: "Mobile web",
          status: "yes",
          note: "`ExternalLink` opens a new tab.",
        },
        {
          target: "Installed PWA",
          status: "yes",
          note: "`ExternalLink` opens in the default browser.",
        },
        {
          target: "iOS",
          status: "yes",
          note: "`ExternalLink` opens in the in-app browser.",
        },
        {
          target: "Android",
          status: "yes",
          note: "`ExternalLink` opens in a Custom Tab.",
        },
      ],
    },
  ],
}
