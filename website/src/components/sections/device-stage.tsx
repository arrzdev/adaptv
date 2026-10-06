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
      {/* items-start: stretched, the iPhone would grow to the Android frame's offset height */}
      <View row className="relative w-full items-start justify-center">
        <PhoneFrame
          platform="android"
          //on a phone the front one is centred and this one shows its left quarter, cut by the screen edge
          className="mt-8 w-[70vw] shrink-0 -rotate-2 max-sm:absolute max-sm:left-[calc(50%-60vw)] sm:-mr-10 sm:w-[280px]"
        >
          <Screen
            image={starterAndroid}
            alt="The adaptv starter app's home screen in an Android frame."
          />
        </PhoneFrame>
        <PhoneFrame
          platform="ios"
          className="relative w-[70vw] shrink-0 rotate-2 sm:w-[280px]"
        >
          <Screen
            image={starterIos}
            alt="The adaptv starter app's home screen in an iPhone frame."
            priority
          />
        </PhoneFrame>
      </View>
    </View>
  )
}

function Screen({
  image,
  alt,
  priority = false,
}: {
  image: typeof starterIos
  alt: string
  /** The page's largest paint: fetched first and decoded in step with the paint. */
  priority?: boolean
}) {
  return (
    <img
      src={image.src}
      width={image.width}
      height={image.height}
      alt={alt}
      fetchPriority={priority ? "high" : undefined}
      decoding={priority ? undefined : "async"}
      draggable={false}
      //a failed image shows its alt on the dark screen, not only the broken-image icon
      className="block h-auto w-full select-none bg-[#0a0a0c] text-white/70 text-xs"
    />
  )
}
