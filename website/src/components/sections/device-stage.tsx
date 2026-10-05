import { View } from "@arrzdev/adaptv/components"
import starterAndroid from "@/assets/hero/starter-android.png?adaptv-image"
import starterIos from "@/assets/hero/starter-ios.png?adaptv-image"
import { PhoneFrame } from "@/components/frames"

/**
 * The hero's picture: the app `pnpm create adaptv` writes, on two phones. Each screen is
 * one file in src/assets/hero/, today a stand-in rendered by scripts/capture-starter.ts,
 * so a device screenshot of the same screen replaces it without a code change.
 *
 * A plain <img> rather than adaptv's Image: Image keeps the picture hidden until hydration
 * says it loaded, and the iPhone is the page's largest paint.
 */
export function DeviceStage() {
  return (
    <View className="stage-in relative mt-[72px] w-full items-center">
      <div className="aurora pointer-events-none absolute -inset-x-16 -top-20 -bottom-16" />
      <View
        row
        role="img"
        aria-label="The adaptv starter app in an iPhone frame and an Android frame, showing the same home screen."
        className="relative w-full justify-center"
      >
        <PhoneFrame
          platform="android"
          //on a phone the front one is centred and this one shows its left quarter, cut by the screen edge
          className="mt-8 w-[70vw] shrink-0 -rotate-2 max-sm:absolute max-sm:left-[calc(50%-60vw)] sm:-mr-10 sm:w-[280px]"
        >
          <Screen image={starterAndroid} />
        </PhoneFrame>
        <PhoneFrame
          platform="ios"
          className="relative w-[70vw] shrink-0 rotate-2 sm:w-[280px]"
        >
          <Screen image={starterIos} />
        </PhoneFrame>
      </View>
    </View>
  )
}

function Screen({ image }: { image: typeof starterIos }) {
  return (
    <img
      src={image.src}
      width={image.width}
      height={image.height}
      alt=""
      decoding="async"
      draggable={false}
      className="block h-auto w-full select-none bg-[#0a0a0c]"
    />
  )
}
