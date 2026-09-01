import { render } from "@testing-library/react"
import type { ReactElement, ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import { AvoidKeyboard } from "#adaptv/components/avoid-keyboard"
import { Button } from "#adaptv/components/button"
import { Checkbox } from "#adaptv/components/checkbox"
import { Drawer } from "#adaptv/components/drawer"
import { DRAWER_CONTENT_MAX_HEIGHT_VAR } from "#adaptv/components/drawer/drawer-engine"
import { ExternalLink } from "#adaptv/components/external-link"
import { Image } from "#adaptv/components/image"
import { Input } from "#adaptv/components/input"
import { Link } from "#adaptv/components/link"
import { UiNotFound } from "#adaptv/components/not-found"
import { Offline } from "#adaptv/components/offline"
import { Pressable } from "#adaptv/components/pressable"
import { PullToRefresh } from "#adaptv/components/pull-to-refresh"
import { PwaSplashOverlay } from "#adaptv/components/pwa-splash-overlay"
import { ScrollView } from "#adaptv/components/scroll-view"
import { Swipeable } from "#adaptv/components/swipeable"
import { Switch } from "#adaptv/components/switch"
import { TextArea } from "#adaptv/components/text-area"
import { View } from "#adaptv/components/view"
import { WheelColumn } from "#adaptv/components/wheel-column"

/*
 * docs/decisions/styling.md §2 / bug B8 — the three-layer contract, asserted on EVERY primitive.
 *
 * The contract is one sentence, and it is only worth anything if it holds everywhere:
 *
 *     base  <  className  <  locked          (and baseStyle < style < lockedStyle)
 *
 * The failure this file exists to catch is silent in both directions. A primitive
 * that forgets `locked` looks fine until a consumer's `touch-none` strands a gesture
 * on iOS; a primitive that over-locks looks fine until someone cannot restyle it and
 * files a bug adaptv cannot fix from their side. So each primitive gets both halves:
 * a class that MUST win and a class that MUST lose, plus the inline-style equivalent
 * wherever the primitive takes a `style`.
 *
 * These are class-string assertions rather than computed style on purpose. The whole
 * mechanism is tailwind-merge deciding which class reaches the DOM *before* the
 * cascade sees it (§5.5) — the point is that only ONE of the pair is emitted, and a
 * computed-style check in happy-dom (which compiles no Tailwind) could not see it.
 */

//UiNotFound renders a real `Link`, which needs a router. The same minimal stub
//link.test.tsx uses — the precedence assertions are about class strings, not routing.
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
  }: {
    children: ReactNode
    className?: string
    to: string
  }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}))

/** Class-attribute membership by TOKEN — `flex-col` must not read as `flex`. */
function hasClass(el: HTMLElement | string, token: string): boolean {
  const value = typeof el === "string" ? el : el.getAttribute("class")
  return (value ?? "").split(/\s+/).includes(token)
}

function firstEl(ui: ReactElement): HTMLElement {
  const { container } = render(ui)
  return container.firstElementChild as HTMLElement
}

function classOf(ui: ReactElement): string {
  return firstEl(ui).className
}

/** The rendered node for a selector, as the element type its assertions need. */
function query(ui: ReactElement, selector: string): HTMLElement {
  //`baseElement`, not `container`: Drawer's engine renders its panel through a real
  //portal into document.body, so a container-scoped query would never see it
  const { baseElement } = render(ui)
  const el = baseElement.querySelector(selector)
  expect(el, `no element matched ${selector}`).not.toBeNull()
  return el as HTMLElement
}

describe("View", () => {
  it("className beats base (display)", () => {
    const c = classOf(<View className="grid" />)
    expect(hasClass(c, "grid")).toBe(true)
    expect(hasClass(c, "flex")).toBe(false)
  })

  it("locked safe-area padding beats className", () => {
    const c = classOf(<View safe="bottom" className="pb-0" />)
    expect(c).toContain("pb-safe")
    expect(c).not.toContain("pb-0")
  })
})

describe("ScrollView", () => {
  it("className beats base (layout)", () => {
    const c = classOf(<ScrollView className="block" />)
    expect(hasClass(c, "block")).toBe(true)
    expect(hasClass(c, "flex")).toBe(false)
  })

  //the scroll axis is owned by the `horizontal` / `scrollEnabled` PROPS, so a
  //consumer's overflow utility must not be able to silently un-scroll the surface
  it("locked scroll axis beats a consumer overflow utility", () => {
    const c = classOf(<ScrollView className="overflow-hidden" />)
    expect(c).toContain("overflow-y-auto")
    expect(c).not.toContain("overflow-hidden")
  })

  it("takes the fade depth as a prop, in the inline-style tier", () => {
    //depth is a knob, so it is a prop — there is no `edge-fade-*` utility to fight
    //with, which is the whole reason the utility was removed (§2.1)
    const el = firstEl(<ScrollView fade fadeSize="3rem" />)
    expect(el.style.getPropertyValue("--fade-length")).toBe("3rem")
    expect(el.className).toContain("overflow-y-auto")
  })

  it("still lets a consumer's own variable beat the prop", () => {
    //the documented escape hatch for a depth that changes with a variant
    const el = firstEl(
      <ScrollView
        fade
        fadeSize="3rem"
        style={{ "--fade-length": "9rem" } as React.CSSProperties}
      />,
    )
    expect(el.style.getPropertyValue("--fade-length")).toBe("9rem")
  })
})

//WebKit 240917: `clickable` is the longhand that keeps `pointercancel` alive, which
//is how the gesture engine learns a scroll took over. A `touch-none` from the
//consumer would strand the state machine, so it must lose on every press target.
const pressTargets: Array<[string, ReactElement]> = [
  ["Pressable", <Pressable key="p" className="touch-none" />],
  ["Button", <Button key="b" className="touch-none" />],
  [
    "ExternalLink",
    <ExternalLink
      key="x"
      href="https://example.com"
      className="touch-none"
    />,
  ],
]

describe("press targets lock `clickable`", () => {
  it.each(pressTargets)("%s", (_name, ui) => {
    const c = classOf(ui)
    expect(hasClass(c, "touch-pan-x")).toBe(true)
    expect(hasClass(c, "touch-none")).toBe(false)
  })
})

/*
 * The `active:` marker (docs/decisions/styling.md §3.1, patches.css). The variant compiles to two
 * branches and picks between them on this attribute, so the attribute has to be on
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
    expect(firstEl(ui).hasAttribute("data-press-engine")).toBe(true)
  })

  it("a plain <button> does NOT — it keeps native :active", () => {
    const el = firstEl(
      <button type="button" className="active:scale-95" />,
    )
    expect(el.hasAttribute("data-press-engine")).toBe(false)
  })

  //ExternalLink is the case that makes the two tiers visibly independent: it locks
  //`clickable` (that longhand is about the BROWSER's gesture handling, not adaptv's
  //engine) but runs no engine, so it writes no `data-pressed` and must keep native
  //`:active` — exactly like the consumer's own anchor.
  it("ExternalLink locks `clickable` yet stays on native :active", () => {
    const el = firstEl(<ExternalLink href="https://example.com" />)
    expect(hasClass(el, "touch-pan-x")).toBe(true)
    expect(el.hasAttribute("data-press-engine")).toBe(false)
  })
})

describe("Button", () => {
  it("className beats the base surface", () => {
    const c = classOf(<Button className="bg-red-500" />)
    expect(c).toContain("bg-red-500")
    expect(c).not.toContain("bg-gray-50")
  })

  //§B: no primitive pre-allocates a border. Pre-allocating one cancels the shift ONLY
  //for a border of exactly 1px — a consumer writing `border-2` shifts anyway — while
  //permanently costing 2px of content box on every instance, so a fixed-height control
  //silently stops matching its spec. A mitigation that works in one case and fails
  //silently in the rest manufactures false confidence (VISION.md, layout shift).
  //`outline` is the width-independent primitive for toggled emphasis.
  it("ships no default border width", () => {
    const bare = classOf(<Button />)
    expect(hasClass(bare, "border")).toBe(false)
    expect(hasClass(bare, "border-transparent")).toBe(false)
  })

  it("a disabled button stays scrollable-through when disabled", () => {
    const c = classOf(<Button disabled className="touch-auto" />)
    expect(c).not.toContain("touch-none")
    expect(c).not.toContain("touch-auto")
  })

  it("Button.Leading: className beats base, locked shrink-0 beats className", () => {
    const slot = query(
      <Button>
        <Button.Leading className="justify-start shrink">x</Button.Leading>
      </Button>,
      "span[aria-hidden]",
    )
    expect(slot.className).toContain("justify-start")
    expect(slot.className).not.toContain("justify-center")
    //the content row tweens to a MEASURED width; a shrinking slot measures wrong
    expect(slot.className).toContain("shrink-0")
  })

  it("Button.Text: the width mode is locked", () => {
    const label = query(
      <Button>
        <Button.Text className="block">Run</Button.Text>
      </Button>,
      "span > span",
    )
    expect(label.className).toContain("inline-flex")
    expect(label.className).not.toContain("block")
  })
})

describe("Link / ExternalLink", () => {
  it("ExternalLink: className beats the base look, `clickable` still wins", () => {
    const c = classOf(
      <ExternalLink href="https://example.com" className="underline" />,
    )
    expect(hasClass(c, "underline")).toBe(true)
    expect(hasClass(c, "no-underline")).toBe(false)
    expect(hasClass(c, "touch-pan-x")).toBe(true)
  })

  it("Link: className beats the base colour, `clickable` still wins", () => {
    const c = classOf(
      <Link to="/x" className="text-red-500 touch-none">
        go
      </Link>,
    )
    expect(hasClass(c, "text-red-500")).toBe(true)
    expect(hasClass(c, "text-gray-950")).toBe(false)
    expect(hasClass(c, "touch-pan-x")).toBe(true)
    expect(hasClass(c, "touch-none")).toBe(false)
  })

  it("Link: `disabled` stays scrollable-through when disabled", () => {
    const c = classOf(
      <Link to="/x" disabled className="touch-auto">
        go
      </Link>,
    )
    //the locked pass-through still beats a consumer's `touch-auto` — what changed is
    //WHICH longhand is locked, not whether the consumer can defeat it
    expect(hasClass(c, "touch-pan-x")).toBe(true)
    expect(hasClass(c, "touch-none")).toBe(false)
    expect(hasClass(c, "touch-auto")).toBe(false)
  })
})

describe("Pressable", () => {
  it("forwards the consumer style, and declares no locked inline tier", () => {
    const el = firstEl(<Pressable style={{ color: "rgb(1, 2, 3)" }} />)
    expect(el.style.color).toBe("rgb(1, 2, 3)")
  })
})

describe("Checkbox", () => {
  it("root: className beats base layout, `clickable` still wins", () => {
    const c = classOf(<Checkbox className="flex touch-none" />)
    expect(c).toContain("flex")
    expect(c).not.toContain("inline-flex")
    expect(c).toContain("touch-pan-x")
    expect(c).not.not.toContain("touch-none")
  })

  it("root: a disabled checkbox stays scrollable-through when disabled", () => {
    const c = classOf(<Checkbox disabled className="touch-auto" />)
    expect(c).not.toContain("touch-none")
    expect(c).not.toContain("touch-auto")
  })

  it("root: forwards the consumer style", () => {
    const el = firstEl(<Checkbox style={{ marginTop: "4px" }} />)
    expect(el.style.marginTop).toBe("4px")
  })

  it("Box: className beats base, the size-derived geometry beats an inline style", () => {
    const box = query(
      <Checkbox size={8}>
        <Checkbox.Box
          className="bg-red-500 static"
          style={{ width: "99px" }}
        />
      </Checkbox>,
      "label > span",
    )
    expect(box.className).toContain("bg-red-500")
    expect(box.className).not.toContain("bg-gray-50")
    //`relative` is the box's own positioning contract; `size` owns the edge
    expect(box.className).toContain("relative")
    expect(box.className).not.toContain("static")
    expect(box.style.width).toBe("2rem")
  })

  it("Box: ships no default border width (see the Button §B note)", () => {
    const box = query(<Checkbox className="x" />, "label > span")
    expect(box.className).not.toContain("border-transparent")
  })

  it("Icon: pointer-events-none is locked (a tap must reach the label)", () => {
    const icon = query(
      <Checkbox>
        <Checkbox.Box>
          <Checkbox.Icon className="pointer-events-auto" />
        </Checkbox.Box>
      </Checkbox>,
      "svg",
    )
    expect(icon.getAttribute("class")).toContain("pointer-events-none")
    expect(icon.getAttribute("class")).not.toContain("pointer-events-auto")
  })
})

describe("Switch", () => {
  it("root: className beats the base surface; `relative` and the track size are locked", () => {
    const el = firstEl(
      <Switch
        size={7}
        className="bg-red-500 static"
        style={{ width: "99px" }}
      />,
    )
    expect(el.className).toContain("bg-red-500")
    expect(el.className).not.toContain("bg-gray-50")
    expect(el.className).toContain("relative")
    expect(el.className).not.toContain("static")
    //the thumb's `left` is computed from this width — a consumer inline width
    //would move the track and leave the thumb behind
    expect(el.style.width).toBe("3rem")
  })

  it("root: ships no default border width (see the Button §B note)", () => {
    expect(hasClass(classOf(<Switch />), "border-transparent")).toBe(false)
    expect(hasClass(classOf(<Switch />), "border")).toBe(false)
  })

  it("root: a disabled switch stays scrollable-through when disabled", () => {
    const c = classOf(<Switch disabled className="touch-auto" />)
    expect(c).not.toContain("touch-none")
    expect(c).not.toContain("touch-auto")
  })

  it("Thumb: className beats base, the absolute placement is locked", () => {
    const thumb = query(
      <Switch>
        <Switch.Thumb className="bg-red-500 relative" />
      </Switch>,
      "span[aria-hidden]",
    )
    expect(thumb.className).toContain("bg-red-500")
    expect(thumb.className).not.toContain("bg-gray-950")
    expect(thumb.className).toContain("absolute")
    expect(thumb.className).not.toContain("relative")
  })
})

describe("Input", () => {
  it("bare: className beats the base surface, and no border is pre-allocated", () => {
    const c = classOf(<Input className="bg-red-500" />)
    expect(c).toContain("bg-red-500")
    expect(c).not.toContain("bg-gray-50")
    expect(c).not.toContain("border-transparent")
  })

  it("bare: `border-0` from the consumer still removes the width", () => {
    const c = classOf(<Input className="border-0" />)
    expect(hasClass(c, "border-0")).toBe(true)
    expect(hasClass(c, "border")).toBe(false)
  })

  it("bare: a disabled field stays scrollable-through when disabled", () => {
    const c = classOf(<Input disabled className="touch-auto" />)
    expect(c).not.toContain("touch-none")
    expect(c).not.toContain("touch-auto")
  })

  it("grouped: the slot `order-*` is locked (it IS the visual order)", () => {
    const slot = query(
      <Input>
        <Input.Leading className="order-9 shrink">x</Input.Leading>
      </Input>,
      "label > div",
    )
    expect(slot.className).toContain("order-1")
    expect(slot.className).not.toContain("order-9")
    expect(slot.className).toContain("shrink-0")
  })

  it("grouped: className styles the shell and its base surface is overridable", () => {
    const shell = query(
      <Input className="bg-red-500">
        <Input.Leading>x</Input.Leading>
      </Input>,
      "label",
    )
    expect(shell.className).toContain("bg-red-500")
    expect(shell.className).not.toContain("bg-gray-50")
  })

  it("grouped: the inner field stays chromeless whatever the shell says", () => {
    const field = query(
      <Input className="p-4">
        <Input.Leading>x</Input.Leading>
      </Input>,
      "input",
    )
    //the shell took the padding; the field must not have grown one of its own
    expect(field.className).toContain("p-0")
    expect(field.className).not.toContain("p-4")
  })
})

describe("TextArea", () => {
  it("shell: className beats the base surface; the layout mode is locked", () => {
    const c = classOf(<TextArea className="bg-red-500 box-content" />)
    expect(c).toContain("bg-red-500")
    expect(c).not.toContain("bg-gray-50")
    expect(c).toContain("box-border")
    expect(c).not.toContain("box-content")
  })

  it("shell: ships no default border width (see the Button §B note)", () => {
    expect(hasClass(classOf(<TextArea />), "border-transparent")).toBe(
      false,
    )
    expect(hasClass(classOf(<TextArea />), "border")).toBe(false)
  })

  it("shell: a disabled field stays scrollable-through when disabled", () => {
    const c = classOf(<TextArea disabled className="touch-auto" />)
    expect(c).not.toContain("touch-none")
    expect(c).not.toContain("touch-auto")
  })

  it("inner: stays chromeless — the `placeholder:` channel cannot repaint it", () => {
    const field = query(
      <TextArea className="p-6 placeholder:text-red-500" />,
      "textarea",
    )
    expect(field.className).toContain("p-0")
    expect(field.className).not.toContain("p-6")
    expect(field.className).toContain("placeholder:text-red-500")
  })

  it("Label / Hint / Error take the consumer className unopposed", () => {
    const { container } = render(
      <TextArea>
        <TextArea.Label className="text-red-500">L</TextArea.Label>
        <TextArea.Hint className="text-green-500">H</TextArea.Hint>
        <TextArea.Error className="text-blue-500">E</TextArea.Error>
      </TextArea>,
    )
    expect(container.querySelector("label")?.className).toBe(
      "text-red-500",
    )
    expect(container.querySelector("p")?.className).toBe("text-green-500")
    expect(container.querySelector('p[role="alert"]')?.className).toBe(
      "text-blue-500",
    )
  })
})

describe("UiNotFound", () => {
  it("every slot takes the consumer className over adaptv's base", () => {
    const { container } = render(
      <UiNotFound
        className="bg-red-500"
        codeClassName="text-red-500"
        titleClassName="text-green-500"
        descriptionClassName="text-blue-500"
      />,
    )
    const main = container.querySelector("main") as HTMLElement
    expect(main.className).toContain("bg-red-500")
    expect(main.className).not.toContain("bg-gray-50")
    expect(container.querySelector("span")?.className).toBe("text-red-500")
    expect(container.querySelector("h1")?.className).toBe("text-green-500")
    expect(container.querySelector("p")?.className).toBe("text-blue-500")
  })
})

describe("Offline", () => {
  it("className beats base, and `safe` still wins as a prop", () => {
    const c = classOf(<Offline className="justify-start pb-0" />)
    expect(c).toContain("justify-start")
    expect(c).not.toContain("justify-center")
    //the one structural thing on this screen is View's safe-area padding
    expect(c).toContain("p-safe")
  })
})

describe("PwaSplashOverlay", () => {
  it("coverage box: the full-viewport pin is locked, the paint is not", () => {
    const el = firstEl(
      <PwaSplashOverlay
        className="absolute bg-red-500"
        style={{ opacity: "0.5" }}
      />,
    )
    expect(el.className).toContain("fixed")
    expect(el.className).not.toContain("absolute")
    expect(el.className).toContain("bg-red-500")
    expect(el.className).not.toContain("bg-background")
    expect(el.style.opacity).toBe("0.5")
  })

  it("centering region: `absolute` is locked but the insets stay overridable", () => {
    //the prop exists to CONSTRAIN this region, so locking the insets would delete
    //exactly the override it documents
    const region = query(
      <PwaSplashOverlay centerClassName="static bottom-auto" />,
      "[data-adaptv-splash] > div",
    )
    expect(region.className).toContain("absolute")
    expect(region.className).not.toContain("static")
    expect(region.className).toContain("bottom-auto")
  })
})

describe("Swipeable", () => {
  //the escape-hatch shape (§2): every structural declaration is keyed on
  //`data-swipeable-*` in CSS, so there is no class to lock and none to fight
  it("takes the consumer className and style unopposed", () => {
    const el = firstEl(
      <Swipeable className="rounded-xl" style={{ opacity: "0.5" }}>
        <Swipeable.Content>row</Swipeable.Content>
      </Swipeable>,
    )
    expect(el.className).toBe("rounded-xl")
    expect(el.style.opacity).toBe("0.5")
  })
})

describe("PullToRefresh", () => {
  it("className beats base; `relative` is locked (the spinner is pinned to it)", () => {
    const c = classOf(
      <PullToRefresh onRefresh={async () => {}} className="static shrink">
        <div>rows</div>
      </PullToRefresh>,
    )
    expect(c).toContain("relative")
    expect(c).not.toContain("static")
    expect(c).toContain("shrink")
    expect(c).not.toContain("shrink-0")
  })
})

describe("WheelColumn", () => {
  const items = [
    { value: 1, label: "1" },
    { value: 2, label: "2" },
  ]

  it("locks the scroll axis — every value it reports is read off scrollTop", () => {
    const c = classOf(
      <WheelColumn
        items={items}
        value={1}
        onChange={() => {}}
        ariaLabel="n"
        className="overflow-hidden bg-red-500"
      />,
    )
    expect(c).toContain("overflow-y-auto")
    expect(c).not.toContain("overflow-hidden")
    expect(c).toContain("bg-red-500")
  })

  it("locks the row hit area, leaves the row paint alone", () => {
    const row = query(
      <WheelColumn
        items={items}
        value={1}
        onChange={() => {}}
        ariaLabel="n"
        itemClassName="text-red-500 h-1/2 touch-none"
      />,
      "button",
    )
    expect(row.className).toContain("text-red-500")
    expect(row.className).not.toContain("text-gray-400")
    expect(row.className).toContain("h-full")
    expect(row.className).not.toContain("h-1/2")
    expect(row.className).toContain("touch-pan-x")
    expect(row.className).not.not.toContain("touch-none")
  })
})

describe("AvoidKeyboard", () => {
  it("takes the consumer className, and keeps the reservation above their style", () => {
    const el = firstEl(
      <AvoidKeyboard className="p-4" style={{ color: "rgb(1, 2, 3)" }} />,
    )
    expect(el.className).toBe("p-4")
    expect(el.style.color).toBe("rgb(1, 2, 3)")
    //the measured scalar is published whatever the consumer's style says
    expect(el.style.getPropertyValue("--adaptv-keyboard-height")).not.toBe(
      "",
    )
  })
})

describe("Image", () => {
  //happy-dom reports every <img> as `complete` with `naturalWidth: 0`, which Image
  //correctly reads as a load failure and unmounts the node. Pin `complete` false so
  //the element stays in the tree long enough to assert its classes.
  function withPendingImages<T>(run: () => T): T {
    const spy = vi
      .spyOn(HTMLImageElement.prototype, "complete", "get")
      .mockReturnValue(false)
    try {
      return run()
    } finally {
      spy.mockRestore()
    }
  }

  //There is no standalone mode any more — `Image` always renders its reserved
  //root, so the consumer className lands THERE rather than on the `<img>`, and
  //the `<img>`'s own fit is a prop (`fit`) because the placeholder layer has to
  //mirror it. → docs/design/image.md §7.2, §9.1
  it("root: the consumer className owns the box's look", () => {
    withPendingImages(() => {
      const el = firstEl(
        <Image
          src="/a.png"
          alt="a"
          width={10}
          height={10}
          className="rounded-full bg-red-500"
        />,
      )
      expect(hasClass(el, "rounded-full")).toBe(true)
      expect(hasClass(el, "bg-red-500")).toBe(true)
      expect(hasClass(el, "bg-gray-50")).toBe(false)
      //…but not the stack it establishes
      expect(hasClass(el, "isolate")).toBe(true)
    })
  })

  it("root: the reservation outranks a consumer inline height", () => {
    withPendingImages(() => {
      const el = firstEl(
        <Image
          src="/a.png"
          alt="a"
          width={10}
          height={20}
          style={{ aspectRatio: "3 / 1" }}
        />,
      )
      expect(el.style.aspectRatio).toBe("10 / 20")
    })
  })

  it("composed: the <img> is locked into the stack", () => {
    withPendingImages(() => {
      const el = query(
        <Image src="/a.png" alt="a" width={10} height={10}>
          <Image.Placeholder />
        </Image>,
        "img",
      )
      expect(hasClass(el, "absolute")).toBe(true)
      //object-fit is locked on BOTH layers or the blur→image swap jumps
      expect(el.style.objectFit).toBe("cover")
    })
  })

  it("composed: a slot layer is locked into the stack", () => {
    const layer = query(
      <Image src="/a.png" alt="a" width={10} height={10}>
        <Image.Error className="static bg-red-500">nope</Image.Error>
      </Image>,
      "[data-part='error']",
    )
    expect(layer.className).toContain("absolute")
    expect(layer.className).not.toContain("static")
    expect(layer.className).toContain("bg-red-500")
    expect(layer.className).not.toContain("bg-gray-50")
  })
})

/* =============================================================================
 * DRAWER
 *
 * The parts that read the engine context (Overlay / Content) need a mounted,
 * open Drawer; Shell / Handle / Footer are context-free and render on their own.
 * ============================================================================= */

describe("Drawer", () => {
  it("Content: the panel geometry is locked, the paint is not", () => {
    const panel = query(
      <Drawer defaultOpen>
        <Drawer.Portal>
          <Drawer.Content className="static rounded-none bg-red-500">
            body
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer>,
      "[data-pwa-drawer]",
    )
    expect(panel.className).toContain("fixed")
    expect(panel.className).not.toContain("static")
    expect(panel.className).toContain("bg-red-500")
    expect(panel.className).not.toContain("bg-white")
    expect(panel.className).toContain("rounded-none")
    expect(panel.className).not.toContain("rounded-t-xl")
  })

  //The sheet and the dim are the two surfaces adaptv animates, and both are promoted for
  //as long as they are mounted. The panel's hint is the one that stops WebKit demoting it
  //at transition-end and re-rasterising the text just as the sheet arrives (the settle
  //tremor). It is safe in the one way `docs/design/performance-boost.md` cares about — it grants no
  //containing block that was not already there — because the engine writes
  //`translate3d(...)` on this element from mount, and any non-`none` transform makes it a
  //containing block for fixed/absolute descendants on its own. Verified in both engines:
  //a `position: fixed` child of the panel lands on the SAME pixel with and without the
  //hint, and escapes to the viewport only when the transform itself is removed.
  it("Content: the panel is promoted for as long as it is mounted", () => {
    const panel = query(
      <Drawer defaultOpen>
        <Drawer.Portal>
          <Drawer.Content>body</Drawer.Content>
        </Drawer.Portal>
      </Drawer>,
      "[data-pwa-drawer]",
    )
    expect(panel.className).toContain("will-change-transform")
  })

  //The hint sits in the BASE tier, so a consumer can turn it off — a promoted layer is a
  //trade (memory, and a rasterisation the compositor now owns), and an app that would rather
  //not make it on every sheet gets to say so. tailwind-merge is the load-bearing part: it has
  //no `none` in its `max-h` group (see the panel's `max-h-[none]` above), so "the utilities are
  //in the same group" is not something to assume. If both classes survived here the override
  //would silently do nothing, and compiled source order would decide which one won.
  it("Content: a consumer can turn the promotion hint off, single-variable", () => {
    const panel = query(
      <Drawer defaultOpen>
        <Drawer.Portal>
          <Drawer.Content className="will-change-auto">
            body
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer>,
      "[data-pwa-drawer]",
    )
    expect(panel.className).toContain("will-change-auto")
    expect(panel.className).not.toContain("will-change-transform")
  })

  /*
   * The panel is NOT the sheet — it is the sheet plus the hidden tail below the fold
   * (`bottom: -excessHeight` and a spacer of equal height, ~0.55 viewports). So a height set
   * on it is spent on the tail before it is spent on anything visible. Measured in a real
   * browser at a 900px viewport: `max-h-[85dvh]` on Content produced a 765px panel box with
   * 269px of sheet on screen (~30dvh) and 605px of the scroller below the bottom edge — and
   * nothing said so, because the class landed exactly where it was written.
   *
   * There is no value that reads correctly here, so the property is not the consumer's to
   * pass. `maxHeight` is, and it lands on the box that decides the visible height.
   */
  it("Content: height on the panel is locked away — it would be spent on the hidden tail", () => {
    const panel = query(
      <Drawer defaultOpen>
        <Drawer.Portal>
          <Drawer.Content
            className="h-[500px] max-h-[85dvh] min-h-[600px]"
            style={{ maxHeight: "85dvh" }}
          >
            body
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer>,
      "[data-pwa-drawer]",
    )
    //`max-h-[none]` deliberately, not `max-h-none` — tailwind-merge has no `none` in its
    //`max-h` group, so the readable spelling silently keeps both classes. See drawer.tsx.
    expect(hasClass(panel, "max-h-[none]")).toBe(true)
    expect(hasClass(panel, "max-h-[85dvh]")).toBe(false)
    expect(hasClass(panel, "h-auto")).toBe(true)
    expect(hasClass(panel, "h-[500px]")).toBe(false)
    expect(hasClass(panel, "min-h-0")).toBe(true)
    expect(hasClass(panel, "min-h-[600px]")).toBe(false)
    //…and the inline half, which no class tier could have won against
    expect(panel.style.maxHeight).toBe("none")
  })

  it("Content: `maxHeight` reaches the content box as the cap variable", () => {
    const panel = query(
      <Drawer defaultOpen>
        <Drawer.Portal>
          <Drawer.Content maxHeight="60dvh">body</Drawer.Content>
        </Drawer.Portal>
      </Drawer>,
      "[data-pwa-drawer]",
    )
    //declared on the panel and INHERITED down, so the content box keeps having no consumer
    //style channel of its own — nothing there for the keyboard effect's inline writes to
    //collide with. A number is a px count, the way React's own style prop reads one.
    expect(
      panel.style.getPropertyValue(DRAWER_CONTENT_MAX_HEIGHT_VAR),
    ).toBe("60dvh")
  })

  it("Content: no `maxHeight` declares no variable, so the platform cap stands alone", () => {
    const panel = query(
      <Drawer defaultOpen>
        <Drawer.Portal>
          <Drawer.Content>body</Drawer.Content>
        </Drawer.Portal>
      </Drawer>,
      "[data-pwa-drawer]",
    )
    expect(
      panel.style.getPropertyValue(DRAWER_CONTENT_MAX_HEIGHT_VAR),
    ).toBe("")
  })

  it("Overlay: the full-viewport pin is locked, the dim colour is not", () => {
    const overlay = query(
      <Drawer defaultOpen>
        <Drawer.Portal>
          <Drawer.Overlay className="static bg-red-500" />
          <Drawer.Content>body</Drawer.Content>
        </Drawer.Portal>
      </Drawer>,
      "[data-pwa-drawer-overlay]",
    )
    expect(overlay.className).toContain("fixed")
    expect(overlay.className).not.toContain("static")
    expect(overlay.className).toContain("bg-red-500")
    expect(overlay.className).not.toContain("bg-black/40")
  })

  //The other half of the panel's promotion, and the half that landed first. The dim's opacity
  //is driven by an inline transition (`transitionDrawerBackdropOpacity`) so a fade can be
  //re-aimed mid-flight, and an inline transition is exactly the shape WebKit promotes on start
  //and demotes on end — repainting a full-viewport layer at the moment the sheet arrives. The
  //hint holds the layer across the whole mounted lifetime so there is no end to demote at.
  //
  //It is worth keeping because it is measurably free. Chromium, /lab/drawer at 430x844, layer
  //tree read over CDP: with both hints and with both forced to `auto`, the composited tree is
  //the same 7 layers and the same 15.53MB — the panel is promoted by the engine's own
  //`translate3d` and the dim by being a fixed child of the portal's stacking context, so
  //neither hint creates a layer. Over five open/close cycles the hints cost 27 paints against
  //29 without them. Free, and it removes paints; the WebKit saving is the larger one and is
  //the bug this was opened for.
  it("Overlay: the dim is promoted for as long as it is mounted", () => {
    const overlay = query(
      <Drawer defaultOpen>
        <Drawer.Portal>
          <Drawer.Overlay />
          <Drawer.Content>body</Drawer.Content>
        </Drawer.Portal>
      </Drawer>,
      "[data-pwa-drawer-overlay]",
    )
    expect(overlay.className).toContain("will-change-[opacity]")
  })

  //Same trade as the panel's, same escape hatch, and the same tailwind-merge caveat — except
  //here the base hint is an ARBITRARY value. `will-change-[opacity]` and `will-change-auto`
  //resolve to one group only because tailwind-merge handles the arbitrary form; if they did
  //not, both would survive and compiled source order would pick the winner in silence.
  it("Overlay: a consumer can turn the promotion hint off, single-variable", () => {
    const overlay = query(
      <Drawer defaultOpen>
        <Drawer.Portal>
          <Drawer.Overlay className="will-change-auto" />
          <Drawer.Content>body</Drawer.Content>
        </Drawer.Portal>
      </Drawer>,
      "[data-pwa-drawer-overlay]",
    )
    expect(overlay.className).toContain("will-change-auto")
    expect(overlay.className).not.toContain("will-change-[opacity]")
  })

  it("Footer: `shrink-0` is locked — it must survive the panel's height cap", () => {
    const footer = firstEl(
      <Drawer.Footer className="shrink flex-row">x</Drawer.Footer>,
    )
    expect(hasClass(footer, "shrink-0")).toBe(true)
    expect(hasClass(footer, "shrink")).toBe(false)
    expect(footer.className).toContain("flex-row")
    expect(footer.className).not.toContain("flex-col")
  })

  it("Shell: the flex column is locked (the scroller's cap is measured in it)", () => {
    const shell = firstEl(<Drawer.Shell className="block">x</Drawer.Shell>)
    expect(hasClass(shell, "flex")).toBe(true)
    expect(hasClass(shell, "block")).toBe(false)
  })

  it("Handle: pure decoration — the consumer className wins outright", () => {
    const handle = firstEl(<Drawer.Handle className="h-2 bg-red-500" />)
    expect(hasClass(handle, "h-2")).toBe(true)
    expect(hasClass(handle, "h-1")).toBe(false)
    expect(handle.className).toContain("bg-red-500")
    expect(handle.className).not.toContain("bg-gray-600")
  })
})
