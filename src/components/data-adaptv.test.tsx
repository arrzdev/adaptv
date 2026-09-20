import { render } from "@testing-library/react"
import type { ReactElement, ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import { Button } from "#adaptv/components/button"
import { Checkbox } from "#adaptv/components/checkbox"
import { Divider } from "#adaptv/components/divider"
import { ExternalLink } from "#adaptv/components/external-link"
import { FieldGroup } from "#adaptv/components/field-group"
import { Fab } from "#adaptv/components/fab"
import { Image } from "#adaptv/components/image"
import { Input } from "#adaptv/components/input"
import { Link } from "#adaptv/components/link"
import { List } from "#adaptv/components/list"
import { UiNotFound } from "#adaptv/components/not-found"
import { Offline } from "#adaptv/components/offline"
import { Pressable } from "#adaptv/components/pressable"
import { PullToRefresh } from "#adaptv/components/pull-to-refresh"
import { ScrollView } from "#adaptv/components/scroll-view"
import { Slider } from "#adaptv/components/slider"
import { Select } from "#adaptv/components/select"
import { Skeleton } from "#adaptv/components/skeleton"
import { Swipeable } from "#adaptv/components/swipeable"
import { Switch } from "#adaptv/components/switch"
import { Text } from "#adaptv/components/text"
import { TextArea } from "#adaptv/components/text-area"
import { View } from "#adaptv/components/view"
import { WheelColumn } from "#adaptv/components/wheel-column"

/*
 * `data-adaptv` — the identity attribute, asserted on every primitive that renders one.
 *
 * The contract each component's own docblock states is "target every X from global CSS
 * with no imports". It only means anything if it is UNIVERSAL: a consumer writing
 * `[data-adaptv="switch"] { … }` in their stylesheet has no way to discover that four
 * components happen to carry it and sixteen do not, so a partial rollout is worse than
 * none — it reads as a working convention right up until the selector they need is the
 * one that was missed. That is how this shipped at 4 of 20.
 *
 * The value is the component the CONSUMER wrote, not the primitive it happens to be
 * built from: `<Button>` is `"button"` even though it is a press target, `<List>` is
 * `"list"` even though its host element is a `ScrollView`. Composition is an
 * implementation detail and must not leak into a styling hook.
 */

//UiNotFound and Link render a real router Link. Same minimal stub the other suites use.
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({
    subscribe: () => () => {},
    state: { location: { pathname: "/", state: { __TSR_index: 0 } } },
    history: { canGoBack: () => false, back: () => {} },
  }),
  Link: ({
    children,
    className,
    ...rest
  }: {
    children?: ReactNode
    className?: string
    to?: string
  }) => (
    <a href="/" className={className} {...rest}>
      {children}
    </a>
  ),
}))

function identityOf(ui: ReactElement): string | null {
  const { container } = render(ui)
  const root = container.firstElementChild as HTMLElement | null
  return root?.getAttribute("data-adaptv") ?? null
}

/*
 * Every primitive with a host element, and the name it must answer to. Minimal props
 * only — this asserts identity, nothing else.
 *
 * Deliberately absent, and each for a reason rather than an oversight:
 *   - `EdgeSwipeGestures` renders no element at all (it is a behaviour component).
 *   - `AvoidKeyboard`, `Drawer` and `PwaSplashOverlay` render through portals or
 *     conditional presence, so `container.firstElementChild` is not their root; they
 *     are covered where their own suites assert their DOM.
 *   - `OrientationGuard` is a conditional host that returns `null` unless the
 *     orientation actually mismatches. Its rendered guard carries the attribute; the
 *     assertion lives with the media-query mocking its own suite already does.
 */
const PRIMITIVES: Array<[string, ReactElement]> = [
  ["view", <View key="view" />],
  ["scroll-view", <ScrollView key="scroll-view" />],
  ["text", <Text key="text">t</Text>],
  ["pressable", <Pressable key="pressable" />],
  ["button", <Button key="button">b</Button>],
  [
    "fab",
    <Fab key="fab" aria-label="f">
      +
    </Fab>,
  ],
  [
    "image",
    <Image key="image" src="/a.png" alt="a" width={10} height={10} />,
  ],
  ["input", <Input key="input" />],
  ["text-area", <TextArea key="text-area" />],
  ["checkbox", <Checkbox key="checkbox" />],
  ["divider", <Divider key="divider" />],
  ["switch", <Switch key="switch" />],
  ["slider", <Slider key="slider" aria-label="s" />],
  [
    "external-link",
    <ExternalLink key="external-link" href="https://a.dev" />,
  ],
  ["field-group", <FieldGroup key="field-group" />],
  [
    "link",
    <Link key="link" to="/">
      l
    </Link>,
  ],
  [
    "list",
    <List
      key="list"
      data={[1]}
      keyExtractor={(n: number) => String(n)}
      renderItem={(n: number) => <span>{n}</span>}
    />,
  ],
  [
    "select",
    <Select key="select" aria-label="s">
      <Select.Trigger />
      <Select.Content>
        <Select.Option value="a">A</Select.Option>
      </Select.Content>
    </Select>,
  ],
  ["swipeable", <Swipeable key="swipeable">s</Swipeable>],
  [
    "pull-to-refresh",
    <PullToRefresh key="ptr" onRefresh={async () => {}}>
      p
    </PullToRefresh>,
  ],
  [
    "wheel-column",
    <WheelColumn
      key="wheel"
      items={[]}
      value={0}
      onChange={() => {}}
      ariaLabel="w"
    />,
  ],
  ["not-found", <UiNotFound key="nf" />],
  ["offline", <Offline key="offline" />],
  ["skeleton", <Skeleton key="skeleton" />],
  //the region is its own scope, not a `data-part` of the box: a consumer styling
  //every placeholder must not also restyle the wrapper that announces them
  ["skeleton-region", <Skeleton.Region key="skeleton-region" loading />],
]

describe("data-adaptv is on every primitive, with the component's own name", () => {
  for (const [name, ui] of PRIMITIVES) {
    it(`<${name}> answers to [data-adaptv="${name}"]`, () => {
      expect(identityOf(ui)).toBe(name)
    })
  }
})

describe("composition does not leak", () => {
  it("List reports itself, not the ScrollView it is built on", () => {
    //if this ever reads "scroll-view", a consumer styling every scroller silently
    //restyles every list too, and there is no selector that separates them
    const { container } = render(
      <List
        data={[1]}
        keyExtractor={(n: number) => String(n)}
        renderItem={(n: number) => <span>{n}</span>}
      />,
    )
    const root = container.firstElementChild as HTMLElement
    expect(root.getAttribute("data-adaptv")).toBe("list")
    //…while the structural scroll marker is still there, because it still IS one
    expect(root.getAttribute("data-scroll-view")).toBe("y")
  })

  it("Link reports itself, not the ExternalLink it delegates to", () => {
    const { container } = render(<Link to="https://a.dev">l</Link>)
    const root = container.firstElementChild as HTMLElement
    expect(root.getAttribute("data-adaptv")).toBe("link")
  })

  it("Fab reports itself, not the Button it is built on", () => {
    //if this ever reads "button", a consumer restyling every button restyles the
    //floating one too, and the corner it floats in is the one thing they wanted to
    //treat differently
    const { container } = render(<Fab aria-label="f">+</Fab>)
    const root = container.firstElementChild as HTMLElement
    expect(root.getAttribute("data-adaptv")).toBe("fab")
    //…while the press engine marker is still there, because it still IS a button
    expect(root.getAttribute("data-press-engine")).not.toBeNull()
  })
})
