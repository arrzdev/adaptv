import { View } from "@arrzdev/adaptv/components"
import { BrowserFrame, PhoneFrame } from "@/components/frames"
import { DesktopInbox } from "@/components/inbox/desktop-inbox"
import { useInbox } from "@/components/inbox/inbox-data"
import { PhoneInbox } from "@/components/inbox/phone-inbox"

/**
 * The hero's argument, made by running it: one inbox, rendered twice. Both frames hold
 * real adaptv components over ONE piece of state, so archiving a message on the phone
 * takes it out of the browser window too.
 */
export function DeviceStage() {
  const inbox = useInbox()
  return (
    <View className="stage-in relative mt-16 w-full max-w-[1040px] items-center sm:mt-20">
      <div className="aurora pointer-events-none absolute -inset-x-16 -top-20 -bottom-16" />

      <BrowserFrame
        url="inbox.example.com"
        className="relative hidden h-[580px] w-full text-left md:flex"
      >
        <DesktopInbox inbox={inbox} />
      </BrowserFrame>

      <View className="relative w-[78%] max-w-[300px] text-left md:absolute md:-right-6 md:-bottom-14 md:w-[256px] lg:-right-10">
        <PhoneFrame>
          <PhoneInbox inbox={inbox} />
        </PhoneFrame>
      </View>

      <p className="relative mt-8 text-left text-[14px] text-muted md:absolute md:-bottom-14 md:left-0 md:mt-0">
        Live components. Swipe a row, pull to refresh, archive in either window.
      </p>
    </View>
  )
}
