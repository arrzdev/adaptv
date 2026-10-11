import { View } from "adaptv/components"
import { TallyDesktop } from "@/components/showcase/tally-desktop"
import { TallyPhone } from "@/components/showcase/tally-phone"

const LABEL =
  "Tally, a budget app, in a desktop browser window and on a phone: the same app with a sidebar on desktop and a tab bar on the phone."

/**
 * The hero's picture: Tally, one budget app drawn in HTML and CSS, in a desktop browser
 * window with the phone overlapping its bottom-right corner. A still picture: one label for
 * assistive tech, nothing to focus, no pointer events.
 *
 * Both views are laid out at a fixed size and scaled to their box in CSS (`.fit`), and every
 * box's height comes from an aspect ratio, so nothing is measured and nothing moves after the
 * first paint. The web font swaps in late, so a label is one text node (`${a} of ${b}`, not
 * `{a} of {b}`) and text sits left-aligned after a fixed edge: a swap changes widths and
 * moves nothing, and the hero's CLS stays 0.
 */
export function DeviceStage() {
  return (
    <div
      role="img"
      aria-label={LABEL}
      className="stage-in pointer-events-none relative mt-[72px] w-full max-w-[1000px] select-none"
    >
      <View aria-hidden="true" className="relative w-full">
        <div className="aurora absolute -inset-x-16 -top-20 -bottom-16" />
        <div className="@container relative aspect-[1000/580] min-h-0 w-full">
          <TallyDesktop />
        </div>
        {/* on a phone it sits in front, pulled up over the window's bottom-right corner */}
        <TallyPhone className="relative -mt-[30%] w-[46%] self-end md:absolute md:right-0 md:-bottom-14 md:mt-0 md:w-[260px] xl:-right-14" />
      </View>
    </div>
  )
}
