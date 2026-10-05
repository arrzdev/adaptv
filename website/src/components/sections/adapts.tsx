import { BrowserFrame } from "@/components/frames"
import { Recording } from "@/components/recording"
import { Reveal } from "@/components/reveal"
import { Section } from "@/components/section"
import { RECORDINGS, SHOW_DRAFTS } from "@/content/recordings"

/*
 * One playground screen in a browser window that is resized from phone to desktop
 * and back. The frame's width carries the message, so nothing is drawn over the
 * clip, and at 390 it is not cropped to a phone: the resize is the point.
 */
export function Adapts() {
  const clip = RECORDINGS.adapts
  if (!clip && !SHOW_DRAFTS) return null
  return (
    <Section
      title="Adapts to every screen"
      lede="The same React screen fits a phone, a tablet and a desktop."
    >
      <Reveal duration={0.2} className="mx-auto w-full max-w-[1100px]">
        <BrowserFrame url="localhost:5173">
          <div className="aspect-video">
            <Recording
              clip={clip}
              label="One app screen, resized from a phone to a desktop and back"
            />
          </div>
        </BrowserFrame>
      </Reveal>
    </Section>
  )
}
