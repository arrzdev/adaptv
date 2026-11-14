import { render, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  Button,
  buttonHasFixedWidth,
  useButton,
} from "#adaptv/components/button"
import { Checkbox, useCheckbox } from "#adaptv/components/checkbox"
import { Drawer, useDrawer } from "#adaptv/components/drawer"
import { Image, useImage } from "#adaptv/components/image"
import {
  RadioGroup,
  useRadioGroup,
  useRadioGroupItem,
} from "#adaptv/components/radio-group"
import { Switch, useSwitch } from "#adaptv/components/switch"

/*
 * The context hooks a consumer calls from a custom sub-part (Tier 2, docs/decisions/styling.md)
 * to track the live state of the control around it. Each one is pinned twice: it throws a
 * message naming its parent when used outside it, and inside it reports the root's state.
 */

//the caret repaint is a real DOM side effect irrelevant to the context under test
vi.mock("#adaptv/hooks/use-caret-repaint", () => ({
  beginCaretHold: () => () => {},
  preMuteCaret: () => {},
}))

afterEach(() => {
  vi.restoreAllMocks()
})

/** Renders what `hook` returns as JSON, so a test reads it back from the DOM. */
function Probe({ hook }: { hook: () => unknown }) {
  return <span data-testid="probe">{JSON.stringify(hook())}</span>
}

function read(view: { getByTestId: (id: string) => HTMLElement }) {
  return JSON.parse(view.getByTestId("probe").textContent ?? "null")
}

describe("outside their parent", () => {
  it.each([
    ["useButton", useButton, "useButton must be used within <Button>."],
    [
      "useCheckbox",
      useCheckbox,
      "useCheckbox must be used within <Checkbox>.",
    ],
    ["useSwitch", useSwitch, "useSwitch must be used within <Switch>."],
    ["useImage", useImage, "useImage must be used within <Image>."],
    ["useDrawer", useDrawer, "useDrawer must be used within <Drawer>."],
    [
      "useRadioGroup",
      useRadioGroup,
      "useRadioGroup must be used within <RadioGroup>.",
    ],
    [
      "useRadioGroupItem",
      useRadioGroupItem,
      "useRadioGroupItem must be used within <RadioGroup.Item>.",
    ],
  ] as const)(
    "%s throws a message naming its parent",
    (_, hook, message) => {
      //React logs the uncaught render error before rethrowing it
      vi.spyOn(console, "error").mockImplementation(() => {})
      expect(() => renderHook(hook as () => unknown)).toThrow(message)
    },
  )
})

describe("inside their parent", () => {
  it("useButton reports disabled and a fixed width from the root", () => {
    const view = render(
      <Button disabled className="w-full">
        <Button.Text>
          <Probe hook={useButton} />
        </Button.Text>
      </Button>,
    )
    expect(read(view)).toEqual({ isDisabled: true, hasFixedWidth: true })
  })

  it("useSwitch reports the checked state and size to a thumb wrapper", () => {
    //the switch renders one child, its thumb, so the wrapper is named Switch.Thumb
    function ProbeThumb() {
      return <Probe hook={useSwitch} />
    }
    ProbeThumb.displayName = "Switch.Thumb"
    const view = render(
      <Switch aria-label="Wi-Fi" defaultChecked>
        <ProbeThumb />
      </Switch>,
    )
    expect(read(view)).toMatchObject({
      isChecked: true,
      isDisabled: false,
    })
    expect(typeof read(view).size).toBe("number")
  })

  it("useCheckbox reports checked, indeterminate and disabled", () => {
    const view = render(
      <Checkbox aria-label="Agree" indeterminate disabled>
        <Checkbox.Box>
          <Probe hook={useCheckbox} />
        </Checkbox.Box>
      </Checkbox>,
    )
    expect(read(view)).toMatchObject({
      isIndeterminate: true,
      isDisabled: true,
    })
  })

  it("useRadioGroup and useRadioGroupItem report the group and the item", () => {
    const both = () => ({
      group: useRadioGroup(),
      item: useRadioGroupItem(),
    })
    const view = render(
      <RadioGroup aria-label="Plan" name="plan" defaultValue="yearly">
        <RadioGroup.Item value="yearly">
          <Probe hook={both} />
        </RadioGroup.Item>
      </RadioGroup>,
    )
    expect(read(view)).toMatchObject({
      group: { value: "yearly", name: "plan", isDisabled: false },
      item: { value: "yearly", isChecked: true, isDisabled: false },
    })
  })

  it("useImage reports the invalid overlay for an empty src", () => {
    const view = render(
      <Image src="" alt="" width={10} height={10}>
        <Image.Invalid>
          <Probe hook={useImage} />
        </Image.Invalid>
      </Image>,
    )
    expect(read(view)).toMatchObject({
      isInvalidVisible: true,
      isImageVisible: false,
    })
  })

  it("useDrawer reports a closed drawer with keyboard avoidance on by default", () => {
    const view = render(
      <Drawer>
        <Probe hook={useDrawer} />
      </Drawer>,
    )
    expect(read(view)).toEqual({
      isOpen: false,
      avoidKeyboard: true,
      isKeyboardOpen: false,
    })
  })
})

describe("buttonHasFixedWidth", () => {
  it("is true for an explicit width utility, responsive prefixes included", () => {
    for (const className of [
      "w-full",
      "w-64",
      "w-1/2",
      "w-[220px]",
      "w-screen",
      "px-4 sm:w-full",
    ]) {
      expect(buttonHasFixedWidth(className), className).toBe(true)
    }
  })

  it("is false for content width, other utilities and no class", () => {
    for (const className of [
      undefined,
      "",
      "w-fit",
      "w-auto",
      "px-4 min-w-0",
    ]) {
      expect(buttonHasFixedWidth(className), String(className)).toBe(false)
    }
  })
})
