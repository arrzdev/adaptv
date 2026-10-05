import { render } from "@testing-library/react"
import type { CSSProperties, ReactElement, ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { AvoidKeyboard } from "#adaptv/components/avoid-keyboard"
import { Button } from "#adaptv/components/button"
import { Checkbox } from "#adaptv/components/checkbox"
import { Divider } from "#adaptv/components/divider"
import { Drawer } from "#adaptv/components/drawer"
import { DRAWER_CONTENT_MAX_HEIGHT_VAR } from "#adaptv/components/drawer/drawer-engine"
import { ExternalLink } from "#adaptv/components/external-link"
import { Fab, fabPositionStyle } from "#adaptv/components/fab"
import { Icon } from "#adaptv/components/icon"
import { Image } from "#adaptv/components/image"
import { Input } from "#adaptv/components/input"
import { Link } from "#adaptv/components/link"
import { UiNotFound } from "#adaptv/components/not-found"
import { Offline } from "#adaptv/components/offline"
import { Pressable } from "#adaptv/components/pressable"
import { PullToRefresh } from "#adaptv/components/pull-to-refresh"
import { PwaSplashOverlay } from "#adaptv/components/pwa-splash-overlay"
import { RadioGroup } from "#adaptv/components/radio-group"
import { ScrollView } from "#adaptv/components/scroll-view"
import { Skeleton } from "#adaptv/components/skeleton"
import { ProgressBar, Spinner } from "#adaptv/components/spinner"
import { Swipeable } from "#adaptv/components/swipeable"
import { Switch } from "#adaptv/components/switch"
import { Text } from "#adaptv/components/text"
import { TextArea } from "#adaptv/components/text-area"
import { View } from "#adaptv/components/view"
import { WheelColumn } from "#adaptv/components/wheel-column"

/*
 * docs/decisions/styling.md §2 / bug B8 — the three tiers, asserted on EVERY primitive.
 *
 *     default (@layer adaptv.components)  <  consumer className / style  <  locked (inline)
 *
 * Since TUD-225 the precedence is the cascade's, not tailwind-merge's: the default is a
 * rule keyed on `[data-adaptv][data-part]`, and the lock is inline style the primitive
 * writes last. Whether those rules WIN is computed style, which happy-dom cannot
 * resolve — `playground/e2e/style-precedence.spec.ts` measures it in both engines, with
 * a plain-CSS class and with a Tailwind utility. What this file pins is the mechanism
 * that outcome rests on, for every part:
 *
 * 1. **No class of adaptv's.** The `class` attribute is exactly the consumer's. One
 *    adaptv class back on the element and the default is again something a consumer
 *    class can collide with (§5.5) — the reason tailwind-merge existed.
 * 2. **The identity pair.** The default rule is keyed on it; without it the part
 *    renders unstyled.
 * 3. **The lock is inline and outranks the consumer's `style`.** A lock that is not
 *    inline loses to any unlayered consumer rule (§2); one that the consumer's `style`
 *    can replace is not a lock.
 *
 * Consumer class names here are plain (`consumer-*`), never utilities: adaptv's
 * `@source` scans its own tests, so a utility named here would ship to every app.
 */

//UiNotFound renders a real `Link`, which needs a router. The same minimal stub
//link.test.tsx uses.
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({
    subscribe: () => () => {},
    state: { location: { pathname: "/", state: { __TSR_index: 0 } } },
    history: { canGoBack: () => false, back: () => {} },
  }),
  Link: ({
    children,
    className,
    to,
    ...rest
  }: {
    children: ReactNode
    className?: string
    to: string
  }) => (
    <a href={to} className={className} {...rest}>
      {children}
    </a>
  ),
}))

const PRESS_LOCK = "pan-x pan-y pinch-zoom"

/** The rendered node for a selector. `baseElement`: the Drawer portals into body. */
function query(ui: ReactElement, selector: string): HTMLElement {
  const { baseElement } = render(ui)
  const el = baseElement.querySelector(selector)
  expect(el, `no element matched ${selector}`).not.toBeNull()
  return el as HTMLElement
}

/** The element's inline declarations, as React wrote them. */
function inline(el: HTMLElement): Record<string, string> {
  return Object.fromEntries(
    (el.getAttribute("style") ?? "")
      .split(";")
      .map((decl) => decl.trim())
      .filter(Boolean)
      .map((decl) => {
        const colon = decl.indexOf(":")
        return [decl.slice(0, colon).trim(), decl.slice(colon + 1).trim()]
      }),
  )
}

/**
 * Inline declarations from the server render — for values happy-dom's CSSOM drops
 * (`var()`), which is exactly what View's safe-area lock writes.
 */
function serverInline(ui: ReactElement, selector: string) {
  const host = document.createElement("div")
  host.innerHTML = renderToStaticMarkup(ui)
  const el = host.querySelector(selector)
  expect(el, `no element matched ${selector}`).not.toBeNull()
  return inline(el as HTMLElement)
}

type Row = {
  name: string
  /** Renders the primitive with `className="consumer-class"` on the measured part. */
  ui: (props: { className: string; style?: CSSProperties }) => ReactElement
  selector: string
  /** [css property, react style key, value the primitive locks] */
  lock?: [string, keyof CSSProperties, string]
  /** The part takes no consumer `style`, so only the class half applies. */
  noStyle?: boolean
}

const ROWS: Row[] = [
  {
    name: "Pressable",
    ui: (p) => <Pressable {...p} />,
    selector: '[data-adaptv="pressable"][data-part="root"]',
    lock: ["touch-action", "touchAction", PRESS_LOCK],
  },
  {
    name: "Button",
    ui: (p) => <Button {...p}>go</Button>,
    selector: '[data-adaptv="button"][data-part="root"]',
    lock: ["touch-action", "touchAction", PRESS_LOCK],
  },
  {
    name: "Button.Leading",
    ui: ({ className }) => (
      <Button>
        <Button.Leading className={className}>x</Button.Leading>
      </Button>
    ),
    selector: '[data-adaptv="button"][data-part="leading"]',
    //the content row tweens to a MEASURED width; a shrinking slot measures wrong
    lock: ["flex-shrink", "flexShrink", "0"],
    noStyle: true,
  },
  {
    name: "Button.Text",
    ui: ({ className }) => (
      <Button>
        <Button.Text className={className}>Run</Button.Text>
      </Button>
    ),
    selector: '[data-adaptv="button"][data-part="label"]',
    lock: ["display", "display", "inline-flex"],
    noStyle: true,
  },
  {
    name: "Fab",
    ui: (p) => (
      <Fab aria-label="f" {...p}>
        +
      </Fab>
    ),
    selector: '[data-adaptv="fab"][data-part="root"]',
    //the hide/show motion is the behaviour, not a look
    lock: ["transition-property", "transitionProperty", "translate"],
  },
  {
    name: "Link",
    ui: (p) => (
      <Link to="/x" {...p}>
        go
      </Link>
    ),
    selector: '[data-adaptv="link"]',
    lock: ["touch-action", "touchAction", PRESS_LOCK],
  },
  {
    name: "ExternalLink",
    ui: (p) => <ExternalLink href="https://example.com" {...p} />,
    selector: '[data-adaptv="external-link"]',
    lock: ["touch-action", "touchAction", PRESS_LOCK],
  },
  {
    name: "Text selectable",
    ui: (p) => (
      <Text selectable {...p}>
        t
      </Text>
    ),
    selector: '[data-adaptv="text"]',
    lock: ["user-select", "userSelect", "text"],
  },
  {
    name: "Icon",
    ui: (p) => <Icon render={<svg />} {...p} />,
    selector: '[data-adaptv="icon"]',
  },
  {
    name: "ScrollView",
    ui: (p) => <ScrollView {...p} />,
    selector: '[data-adaptv="scroll-view"][data-part="root"]',
    //the axis is owned by the `horizontal` / `scrollEnabled` PROPS
    lock: ["overflow-y", "overflowY", "auto"],
  },
  {
    name: "Spinner",
    ui: (p) => <Spinner {...p} />,
    selector: '[data-adaptv="spinner"][data-part="root"]',
  },
  {
    name: "ProgressBar",
    ui: (p) => <ProgressBar {...p} />,
    selector: '[data-adaptv="progress-bar"][data-part="root"]',
    //the sweep stays clipped and the parts stay anchored
    lock: ["overflow", "overflow", "hidden"],
  },
  {
    name: "Skeleton",
    ui: (p) => <Skeleton {...p} />,
    selector: '[data-adaptv="skeleton"]',
  },
  {
    name: "Divider",
    ui: (p) => <Divider {...p} />,
    selector: '[data-adaptv="divider"]',
  },
  {
    name: "Checkbox",
    ui: (p) => <Checkbox {...p} />,
    selector: '[data-adaptv="checkbox"][data-part="root"]',
    lock: ["position", "position", "relative"],
  },
  {
    name: "Checkbox.Box",
    ui: (p) => (
      <Checkbox>
        <Checkbox.Box {...p} />
      </Checkbox>
    ),
    selector: '[data-adaptv="checkbox"][data-part="box"]',
    lock: ["overflow", "overflow", "hidden"],
  },
  {
    name: "Checkbox.Icon",
    ui: (p) => (
      <Checkbox>
        <Checkbox.Box>
          <Checkbox.Icon {...p} />
        </Checkbox.Box>
      </Checkbox>
    ),
    selector: '[data-adaptv="checkbox"][data-part="icon"]',
    //a tap must reach the label
    lock: ["pointer-events", "pointerEvents", "none"],
  },
  {
    name: "RadioGroup.Item",
    ui: (p) => (
      <RadioGroup>
        <RadioGroup.Item value="a" {...p}>
          a
        </RadioGroup.Item>
      </RadioGroup>
    ),
    selector: '[data-part="item"]',
    lock: ["position", "position", "relative"],
  },
  {
    name: "RadioGroup.Box",
    ui: (p) => (
      <RadioGroup>
        <RadioGroup.Item value="a">
          <RadioGroup.Box {...p} />
        </RadioGroup.Item>
      </RadioGroup>
    ),
    selector: '[data-part="box"]',
    lock: ["position", "position", "relative"],
  },
  {
    name: "RadioGroup.Indicator",
    ui: (p) => (
      <RadioGroup>
        <RadioGroup.Item value="a">
          <RadioGroup.Box>
            <RadioGroup.Indicator {...p} />
          </RadioGroup.Box>
        </RadioGroup.Item>
      </RadioGroup>
    ),
    selector: '[data-part="indicator"]',
    lock: ["pointer-events", "pointerEvents", "none"],
  },
  {
    name: "Switch",
    ui: (p) => <Switch {...p} />,
    selector: '[data-adaptv="switch"][data-part="root"]',
    lock: ["position", "position", "relative"],
  },
  {
    name: "Switch.Thumb",
    ui: (p) => (
      <Switch>
        <Switch.Thumb {...p} />
      </Switch>
    ),
    selector: '[data-adaptv="switch"][data-part="thumb"]',
    lock: ["position", "position", "absolute"],
  },
  {
    name: "Input",
    ui: (p) => <Input disabled {...p} />,
    selector: '[data-adaptv="input"][data-part="root"]',
    //a disabled field stays scrollable-through (disabled-scroll.spec.ts)
    lock: ["touch-action", "touchAction", PRESS_LOCK],
  },
  {
    name: "Input.Leading",
    ui: ({ className }) => (
      <Input>
        <Input.Leading className={className}>x</Input.Leading>
      </Input>
    ),
    selector: '[data-adaptv="input"][data-part="leading"]',
    //the slot `order` IS the visual order
    lock: ["order", "order", "1"],
    noStyle: true,
  },
  {
    name: "TextArea",
    ui: (p) => <TextArea {...p} />,
    selector: '[data-adaptv="text-area"][data-part="root"]',
    lock: ["box-sizing", "boxSizing", "border-box"],
  },
  {
    name: "Image",
    ui: (p) => (
      <Image src="/a.png" alt="a" width={10} height={20} {...p} />
    ),
    selector: '[data-adaptv="image"][data-part="root"]',
    lock: ["position", "position", "relative"],
  },
  {
    name: "PullToRefresh",
    ui: (p) => (
      <PullToRefresh onRefresh={async () => {}} {...p}>
        <div>rows</div>
      </PullToRefresh>
    ),
    selector: '[data-adaptv="pull-to-refresh"][data-part="root"]',
    //the spinner is pinned to it
    lock: ["position", "position", "relative"],
  },
  {
    name: "WheelColumn",
    ui: (p) => (
      <WheelColumn
        items={[
          { value: 1, label: "1" },
          { value: 2, label: "2" },
        ]}
        value={1}
        onChange={() => {}}
        ariaLabel="n"
        {...p}
      />
    ),
    selector: '[data-adaptv="wheel-column"][data-part="root"]',
    //every value it reports is read off scrollTop
    lock: ["overflow-y", "overflowY", "auto"],
  },
  {
    name: "PwaSplashOverlay",
    ui: (p) => <PwaSplashOverlay {...p} />,
    selector: "[data-adaptv-splash]",
    lock: ["position", "position", "fixed"],
  },
  {
    name: "Drawer.Content",
    ui: (p) => (
      <Drawer defaultOpen>
        <Drawer.Portal>
          <Drawer.Content {...p}>body</Drawer.Content>
        </Drawer.Portal>
      </Drawer>
    ),
    selector: '[data-adaptv="drawer"][data-part="content"]',
    lock: ["position", "position", "fixed"],
  },
  {
    name: "Drawer.Overlay",
    ui: (p) => (
      <Drawer defaultOpen>
        <Drawer.Portal>
          <Drawer.Overlay {...p} />
          <Drawer.Content>body</Drawer.Content>
        </Drawer.Portal>
      </Drawer>
    ),
    selector: '[data-adaptv="drawer"][data-part="overlay"]',
    lock: ["position", "position", "fixed"],
  },
  {
    name: "Drawer.Footer",
    ui: (p) => <Drawer.Footer {...p}>x</Drawer.Footer>,
    selector: '[data-adaptv="drawer"][data-part="footer"]',
    //it must survive the panel's height cap
    lock: ["flex-shrink", "flexShrink", "0"],
  },
  {
    name: "Drawer.Shell",
    ui: (p) => <Drawer.Shell {...p}>x</Drawer.Shell>,
    selector: '[data-adaptv="drawer"][data-part="shell"]',
    //the scroller's cap is measured in it
    lock: ["display", "display", "flex"],
  },
  {
    name: "Drawer.Handle",
    ui: (p) => <Drawer.Handle {...p} />,
    selector: '[data-adaptv="drawer"][data-part="handle"]',
  },
  {
    name: "Offline",
    ui: (p) => <Offline {...p} />,
    selector: '[data-adaptv="offline"]',
  },
  {
    name: "UiNotFound",
    ui: (p) => <UiNotFound {...p} />,
    selector: '[data-adaptv="not-found"]',
  },
]

describe.each(ROWS)("$name", (row) => {
  it("carries the identity pair and no class of adaptv's", () => {
    const el = query(row.ui({ className: "consumer-class" }), row.selector)
    expect(el.getAttribute("class")).toBe("consumer-class")
    expect(el.closest("[data-adaptv]")).not.toBeNull()
    expect(
      el.hasAttribute("data-part") || el.hasAttribute("data-adaptv"),
    ).toBe(true)
  })

  it("writes no class at all when the consumer passes none", () => {
    const el = query(row.ui({ className: "" }), row.selector)
    expect(el.getAttribute("class") ?? "").toBe("")
  })

  if (row.lock) {
    const [property, key, value] = row.lock
    it(`locks ${property} inline, above the consumer's style`, () => {
      const style = row.noStyle ? undefined : { [key]: "unset" }
      const el = query(
        row.ui({ className: "consumer-class", style }),
        row.selector,
      )
      expect(inline(el)[property]).toBe(value)
    })
  }
})

describe("View", () => {
  it("the safe-area padding is an inline lock the consumer's style cannot lift", () => {
    const decls = serverInline(
      <View
        safe="bottom"
        className="consumer-class"
        style={{ paddingBottom: 0 }}
      />,
      '[data-adaptv="view"]',
    )
    expect(decls["padding-bottom"]).toBe("var(--adaptv-inset-bottom, 0px)")
  })
})

describe("press targets", () => {
  //a disabled target keeps the SAME pass-through, plus no selection (press-core.ts)
  it.each([
    ["Button", <Button key="b" disabled />, '[data-adaptv="button"]'],
    [
      "Link",
      <Link key="l" to="/x" disabled>
        go
      </Link>,
      '[data-adaptv="link"]',
    ],
    [
      "Checkbox",
      <Checkbox key="c" disabled />,
      '[data-adaptv="checkbox"][data-part="root"]',
    ],
    [
      "Switch",
      <Switch key="s" disabled />,
      '[data-adaptv="switch"][data-part="root"]',
    ],
    [
      "TextArea",
      <TextArea key="t" disabled />,
      '[data-adaptv="text-area"][data-part="root"]',
    ],
  ])(
    "%s disabled stays scrollable-through and unselectable",
    (_name, ui, selector) => {
      const decls = inline(query(ui, selector))
      expect(decls["touch-action"]).toBe(PRESS_LOCK)
      expect(decls["user-select"]).toBe("none")
    },
  )
})

/*
 * The `active:` marker (docs/decisions/styling.md §3.1, patches.css). The variant compiles
 * to two branches and picks between them on this attribute, so the attribute has to be on
 * exactly the elements the gesture engine drives — and on nothing else, or a plain
 * `<button className="active:scale-95">` silently stops responding.
 */
describe("data-press-engine marks exactly the engine-driven elements", () => {
  const engineDriven: Array<[string, ReactElement]> = [
    ["Pressable", <Pressable key="p" />],
    ["Button", <Button key="b" />],
    //both of these drive the engine from their <label>
    ["Checkbox", <Checkbox key="c" />],
    ["Switch", <Switch key="s" />],
  ]

  it.each(engineDriven)("%s carries it", (_name, ui) => {
    const { container } = render(ui)
    expect(
      (container.firstElementChild as HTMLElement).hasAttribute(
        "data-press-engine",
      ),
    ).toBe(true)
  })

  //ExternalLink is the case that makes the two tiers visibly independent: it locks the
  //touch longhand (that is about the BROWSER's gesture handling, not adaptv's engine)
  //but runs no engine, so it must keep native `:active` like the consumer's own anchor.
  it("ExternalLink locks the touch longhand yet stays on native :active", () => {
    const el = query(
      <ExternalLink href="https://example.com" />,
      '[data-adaptv="external-link"]',
    )
    expect(inline(el)["touch-action"]).toBe(PRESS_LOCK)
    expect(el.hasAttribute("data-press-engine")).toBe(false)
  })
})

describe("inline channels that are props, not locks", () => {
  it("ScrollView takes the fade depth as a prop, and a consumer variable still beats it", () => {
    const own = render(<ScrollView fade fadeSize="3rem" />).container
      .firstElementChild as HTMLElement
    expect(own.style.getPropertyValue("--fade-length")).toBe("3rem")
    const theirs = render(
      <ScrollView
        fade
        fadeSize="3rem"
        style={{ "--fade-length": "9rem" } as CSSProperties}
      />,
    ).container.firstElementChild as HTMLElement
    expect(theirs.style.getPropertyValue("--fade-length")).toBe("9rem")
  })

  it("ProgressBar's value variable is locked above the consumer's style", () => {
    const el = query(
      <ProgressBar
        value={0.2}
        style={{ ["--progress-value" as string]: 0.8 }}
      />,
      '[data-adaptv="progress-bar"][data-part="root"]',
    )
    expect(el.style.getPropertyValue("--progress-value")).toBe("0.2")
  })

  it("Fab forwards the consumer style, and the position keys stay the component's", () => {
    const el = query(
      <Fab
        aria-label="f"
        style={{
          color: "rgb(1, 2, 3)",
          position: "absolute",
          pointerEvents: "auto",
        }}
        hidden
      >
        +
      </Fab>,
      '[data-adaptv="fab"]',
    )
    expect(el.style.color).toBe("rgb(1, 2, 3)")
    const own = fabPositionStyle({
      placement: "end",
      avoidKeyboard: true,
      gap: 4,
      hidden: true,
    })
    expect(el.style.position).toBe("fixed")
    expect(el.style.insetInlineEnd).toBe(own.insetInlineEnd)
    expect(el.style.pointerEvents).toBe("none")
  })

  it("Image's reservation outranks a consumer inline aspect ratio", () => {
    const el = query(
      <Image
        src="/a.png"
        alt="a"
        width={10}
        height={20}
        style={{ aspectRatio: "3 / 1" }}
      />,
      '[data-adaptv="image"]',
    )
    expect(el.style.aspectRatio).toBe("10 / 20")
  })

  it("Switch.Thumb moves on transform, never on its layout inset", () => {
    //a `left` that changes is a layout shift on every toggle (theme-shift.spec.ts)
    const thumbOf = (checked: boolean) =>
      render(
        <Switch checked={checked} size={7} />,
      ).container.querySelector('[data-part="thumb"]') as HTMLElement
    const off = thumbOf(false)
    const on = thumbOf(true)
    expect(on.style.left).toBe(off.style.left)
    expect(off.style.transform).toBe("translateX(0rem)")
    expect(on.style.transform).toBe("translateX(1.25rem)")
  })

  it("AvoidKeyboard keeps the reservation above the consumer's style", () => {
    const { container } = render(
      <AvoidKeyboard
        className="consumer-class"
        style={{ color: "rgb(1, 2, 3)" }}
      />,
    )
    const el = container.firstElementChild as HTMLElement
    expect(el.getAttribute("class")).toBe("consumer-class")
    expect(el.style.color).toBe("rgb(1, 2, 3)")
    expect(el.style.getPropertyValue("--adaptv-keyboard-height")).not.toBe(
      "",
    )
  })

  it("Swipeable takes the consumer className and style unopposed", () => {
    const { container } = render(
      <Swipeable className="consumer-class" style={{ opacity: "0.5" }}>
        <Swipeable.Content>row</Swipeable.Content>
      </Swipeable>,
    )
    const el = container.firstElementChild as HTMLElement
    expect(el.getAttribute("class")).toBe("consumer-class")
    expect(el.style.opacity).toBe("0.5")
  })
})

/* =============================================================================
 * DRAWER — the panel is NOT the sheet: it is the sheet plus the hidden tail below the
 * fold, so a height on it is spent on the tail first. Measured at a 900px viewport:
 * `max-height: 85dvh` on Content gave 269px of visible sheet. There is no value that
 * reads correctly there, so height is locked away and `maxHeight` is the prop.
 * ============================================================================= */
describe("Drawer.Content height", () => {
  it("height on the panel is locked away — it would be spent on the hidden tail", () => {
    const panel = query(
      <Drawer defaultOpen>
        <Drawer.Portal>
          <Drawer.Content style={{ maxHeight: "85dvh", height: "500px" }}>
            body
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer>,
      "[data-pwa-drawer]",
    )
    const decls = inline(panel)
    expect(decls["max-height"]).toBe("none")
    expect(decls.height).toBe("auto")
    expect(decls["min-height"]).toBe("0")
  })

  it("`maxHeight` reaches the content box as the cap variable", () => {
    const panel = query(
      <Drawer defaultOpen>
        <Drawer.Portal>
          <Drawer.Content maxHeight="60dvh">body</Drawer.Content>
        </Drawer.Portal>
      </Drawer>,
      "[data-pwa-drawer]",
    )
    expect(
      panel.style.getPropertyValue(DRAWER_CONTENT_MAX_HEIGHT_VAR),
    ).toBe("60dvh")
  })
})
