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
 *
 * From 768 px the phone stands beside the window and overlaps only its last 3 %, so it covers
 * the frame and the card's padding but not the Recent table's Amount column (which ends 4.5 %
 * in from the edge at any scale). The window takes what the phone leaves, `(100% - phone) /
 * 0.97`, up to its 1000 px, and the pair is centred as one group, wider than the page column
 * on a large screen.
 */
export function DeviceStage() {
  return (
    <div
      role="img"
      aria-label={LABEL}
      className="stage-in pointer-events-none relative mt-[72px] w-full max-w-[1000px] select-none md:max-w-[calc(970px+var(--phone))] md:[--phone:160px] lg:[--phone:200px] xl:w-[calc(970px+var(--phone))] xl:[--phone:260px]"
    >
      <View aria-hidden="true" className="relative w-full">
        <div className="aurora absolute -inset-x-16 -top-20 -bottom-16" />
        <div className="@container relative aspect-[1000/580] min-h-0 w-full md:w-[calc((100%-var(--phone))/0.97)]">
          <TallyDesktop />
        </div>
        {/* on a phone it sits in front, pulled up over the window's bottom-right corner; from 768 px it stands past the corner, clear of the Amount column */}
        <TallyPhone className="relative -mt-[30%] w-[46%] self-end md:absolute md:right-0 md:-bottom-14 md:mt-0 md:w-[var(--phone)]" />
      </View>
    </div>
  )
}
