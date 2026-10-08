import {
  BootError,
  Collapsible,
  Divider,
  Icon,
  Image,
  Offline,
  OrientationGuard,
  ProgressBar,
  PwaSplashOverlay,
  ScrollView,
  Skeleton,
  Spinner,
  Text,
  UiNotFound,
  UpdateRequired,
  View,
} from "adaptv/components"
import { createFileRoute } from "adaptv/router"
import { Star } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { flushSync } from "react-dom"
import {
  LabActions,
  LabButton,
  LabRow,
  LabSection,
} from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"

export const Route = createFileRoute("/_providers/lab/stress-display")({
  component: LabStressDisplayPage,
})

/*
 * The display cluster's stress harness. Nothing here is a demo: every control
 * exists because `e2e/stress-*.spec.ts` presses it, and the numbers the specs
 * assert are read from the DOM, not from this page. The page renders its fields
 * empty on the server so hydration costs nothing, and every field is sized by a
 * button so a spec can put 100 images or 200 spinners on screen in one press.
 */

/** Everything the mount/unmount cycle can put up and take down again. */
const CYCLE_TARGETS = [
  "image",
  "collapsible",
  "skeleton",
  "spinner",
  "progress-bar",
  "text",
  "text-plain",
  "text-clamp",
  "text-scale",
  "view",
  "divider",
  "icon",
  "offline",
  "not-found",
  "boot-error",
  "update-required",
  "orientation-guard",
  "splash",
] as const

type CycleTarget = (typeof CYCLE_TARGETS)[number]

const CYCLE_COUNT = 300

/** Stable keys for every field, so no row is keyed by its index. */
const SLOTS = Array.from({ length: 200 }, (_, i) => `slot-${i}`)

/** A 10 000-character string that wraps like prose, deterministic so a rerun measures the same text. */
const LONG_TEXT = Array.from(
  { length: 1400 },
  (_, i) => `word${(i * 7919) % 1000}`,
)
  .join(" ")
  .slice(0, 10_000)

const RTL_TEXT =
  "هذا نص طويل جدًا يُستخدم لاختبار اقتطاع الأسطر في اتجاه الكتابة من اليمين إلى اليسار، ويجب أن يظهر القطع في نهاية السطر الأخير وليس في بدايته. ".repeat(
    6,
  )

const CJK_TEXT =
  "これは行の切り詰めを検証するための長い日本語の文章です。句読点や漢字とかなが混在していても、指定した行数で省略記号が表示されなければなりません。".repeat(
    6,
  )

/** One card of the image field: a fresh URL per nonce so a swap is a real new request. */
function StressImage({
  index,
  mode,
  nonce,
  loading,
}: {
  index: number
  mode: string
  nonce: number
  loading: "lazy" | "eager"
}) {
  return (
    <Image
      src={`/lab/stress-image/${mode}/${nonce}-${index}.png`}
      width={64}
      height={48}
      alt=""
      loading={loading}
      placeholder={false}
      className="rounded-sm"
    >
      <Image.Placeholder>
        <span className="text-[10px] text-subtle">…</span>
      </Image.Placeholder>
      <Image.Error>
        <span className="text-[10px] text-danger">×</span>
      </Image.Error>
    </Image>
  )
}

function CycleSubject({ target }: { target: CycleTarget }) {
  switch (target) {
    case "image":
      return <StressImage index={0} mode="ok" nonce={0} loading="eager" />
    case "collapsible":
      return (
        <Collapsible defaultOpen>
          <Collapsible.Trigger>cycle</Collapsible.Trigger>
          <Collapsible.Panel>
            <p>cycled panel</p>
          </Collapsible.Panel>
        </Collapsible>
      )
    case "skeleton":
      return (
        <Skeleton.Region loading label="Loading cycle">
          <Skeleton className="h-4 w-24" />
        </Skeleton.Region>
      )
    case "spinner":
      return <Spinner label="Loading cycle" />
    case "progress-bar":
      return <ProgressBar label="Cycling" />
    case "text":
      return (
        <Text numberOfLines={1} scaleWithSystem>
          cycled text
        </Text>
      )
    //the three below split `text` by prop, so a counter that moves on `text`
    //can be attributed to the clamp, to the scale, or to the element itself
    case "text-plain":
      return <Text>cycled text</Text>
    case "text-clamp":
      return <Text numberOfLines={1}>cycled text</Text>
    case "text-scale":
      return <Text scaleWithSystem>cycled text</Text>
    case "view":
      return (
        <View safe="bottom">
          <ScrollView className="h-8" fade>
            <p>cycled scroll</p>
          </ScrollView>
        </View>
      )
    case "divider":
      return <Divider />
    case "icon":
      return <Icon render={<Star />} label="Cycled star" scaleWithSystem />
    case "offline":
      return <Offline onRetry={() => {}} />
    case "not-found":
      return <UiNotFound />
    case "boot-error":
      return <BootError />
    case "update-required":
      return <UpdateRequired afterDays={14} />
    case "orientation-guard":
      return <OrientationGuard manifestPath="/manifest.json" />
    case "splash":
      return (
        <PwaSplashOverlay className="pointer-events-none opacity-0">
          <span>cycled splash</span>
        </PwaSplashOverlay>
      )
  }
}

function LabStressDisplayPage() {
  //image field
  const [imageCount, setImageCount] = useState(0)
  const [imageMode, setImageMode] = useState("ok")
  const [imageNonce, setImageNonce] = useState(0)
  const [imageLoading, setImageLoading] = useState<"lazy" | "eager">(
    "eager",
  )

  //collapsible
  const [open, setOpen] = useState(false)
  const [lines, setLines] = useState(3)

  //fields
  const [skeletons, setSkeletons] = useState(0)
  const [spinners, setSpinners] = useState(0)

  //progress bar
  const [progress, setProgress] = useState<number | undefined>(0.25)
  const [driveFrames, setDriveFrames] = useState<number | null>(null)
  const driving = useRef<number | null>(null)

  //text
  const [clamp, setClamp] = useState(0)

  //cycles
  const [subject, setSubject] = useState<CycleTarget | null>(null)
  const [cycled, setCycled] = useState<Record<string, number>>({})

  useEffect(
    () => () => {
      if (driving.current !== null) cancelAnimationFrame(driving.current)
    },
    [],
  )

  /** Drive the bar for 5 s: `next(frame)` decides each frame's value. */
  function drive(next: (frame: number) => number | undefined) {
    if (driving.current !== null) cancelAnimationFrame(driving.current)
    setDriveFrames(null)
    const start = performance.now()
    let frames = 0
    const tick = (now: number) => {
      frames += 1
      setProgress(next(frames))
      if (now - start < 5_000) {
        driving.current = requestAnimationFrame(tick)
      } else {
        driving.current = null
        setDriveFrames(frames)
      }
    }
    driving.current = requestAnimationFrame(tick)
  }

  /** Mount and unmount `target` CYCLE_COUNT times, each one a committed render. */
  function cycle(target: CycleTarget) {
    for (let i = 0; i < CYCLE_COUNT; i++) {
      flushSync(() => setSubject(target))
      flushSync(() => setSubject(null))
    }
    setCycled((done) => ({
      ...done,
      [target]: (done[target] ?? 0) + CYCLE_COUNT,
    }))
  }

  return (
    <LabPage
      title="Display stress"
      subtitle="The display cluster under load: fields of a hundred images and two hundred spinners, a bar driven every frame, a panel toggled faster than it animates, and three hundred mount cycles of every component. Driven by the stress specs; the numbers live in the DOM."
    >
      <LabSection
        title="Image field"
        description="Every card requests a distinct URL under /lab/stress-image/<mode>/<nonce>-<i>.png, which a spec answers however it likes: bytes, a 404, or bytes after five seconds."
      >
        <LabActions>
          {[0, 1, 100].map((count) => (
            <LabButton
              key={count}
              pressed={imageCount === count}
              onClick={() => setImageCount(count)}
              data-testid={`stress-image-count-${count}`}
            >
              {count} images
            </LabButton>
          ))}
          {["ok", "missing", "slow"].map((mode) => (
            <LabButton
              key={mode}
              pressed={imageMode === mode}
              onClick={() => setImageMode(mode)}
              data-testid={`stress-image-mode-${mode}`}
            >
              {mode}
            </LabButton>
          ))}
          <LabButton
            onClick={() => setImageNonce((n) => n + 1)}
            data-testid="stress-image-swap"
          >
            swap src (nonce {imageNonce})
          </LabButton>
          <LabButton
            onClick={() =>
              setImageLoading((l) => (l === "lazy" ? "eager" : "lazy"))
            }
            data-testid="stress-image-loading"
          >
            loading: {imageLoading}
          </LabButton>
        </LabActions>
        <div
          className="grid grid-cols-8 gap-1"
          data-testid="stress-image-field"
        >
          {SLOTS.slice(0, imageCount).map((slot, i) => (
            <StressImage
              key={slot}
              index={i}
              mode={imageMode}
              nonce={imageNonce}
              loading={imageLoading}
            />
          ))}
        </div>
      </LabSection>

      <LabSection
        title="Collapsible"
        description="Controlled, so a spec can toggle it faster than its 200 ms transition; the content grows and shrinks by whole lines while it animates."
      >
        <LabActions>
          <LabButton
            onClick={() => setOpen((o) => !o)}
            data-testid="stress-collapsible-toggle"
          >
            toggle ({open ? "open" : "closed"})
          </LabButton>
          <LabButton
            onClick={() => setLines((n) => n + 5)}
            data-testid="stress-collapsible-grow"
          >
            grow (+5 lines)
          </LabButton>
          <LabButton
            onClick={() => setLines((n) => Math.max(1, n - 5))}
            data-testid="stress-collapsible-shrink"
          >
            shrink (−5 lines)
          </LabButton>
        </LabActions>
        <Collapsible
          open={open}
          onOpenChange={setOpen}
          className="rounded-md bg-secondary p-3"
          data-testid="stress-collapsible"
        >
          <Collapsible.Trigger className="text-sm font-medium">
            {lines} lines inside
          </Collapsible.Trigger>
          <Collapsible.Panel>
            <div data-testid="stress-collapsible-content">
              {SLOTS.slice(0, lines).map((slot, i) => (
                <p key={slot} className="text-sm">
                  line {i + 1}
                </p>
              ))}
            </div>
          </Collapsible.Panel>
        </Collapsible>
      </LabSection>

      <LabSection
        title="Skeleton and Spinner fields"
        description="Two hundred of each at once, on screen, so the idle cost of the pulse and the turn can be measured against an empty page and against one of each."
      >
        <LabActions>
          {[0, 1, 200].map((count) => (
            <LabButton
              key={`sk-${count}`}
              pressed={skeletons === count}
              onClick={() => setSkeletons(count)}
              data-testid={`stress-skeleton-count-${count}`}
            >
              {count} skeletons
            </LabButton>
          ))}
          {[0, 1, 200].map((count) => (
            <LabButton
              key={`sp-${count}`}
              pressed={spinners === count}
              onClick={() => setSpinners(count)}
              data-testid={`stress-spinner-count-${count}`}
            >
              {count} spinners
            </LabButton>
          ))}
        </LabActions>
        <Skeleton.Region
          loading={skeletons > 0}
          label="Loading the field"
          className="grid grid-cols-10 gap-1"
          data-testid="stress-skeleton-field"
        >
          {SLOTS.slice(0, skeletons).map((slot) => (
            <Skeleton key={slot} className="h-4 rounded-sm" />
          ))}
        </Skeleton.Region>
        <div
          className="grid grid-cols-10 gap-1"
          data-testid="stress-spinner-field"
        >
          {SLOTS.slice(0, spinners).map((slot) => (
            <Spinner key={slot} className="size-4" />
          ))}
        </div>
      </LabSection>

      <LabSection
        title="ProgressBar"
        description="Out-of-range and non-finite values, and a value written on every animation frame for five seconds."
      >
        <LabActions>
          {(
            [
              ["0", 0],
              ["1", 1],
              ["NaN", Number.NaN],
              ["-1", -1],
              ["1.5", 1.5],
              ["none", undefined],
            ] as const
          ).map(([name, value]) => (
            <LabButton
              key={name}
              onClick={() => setProgress(value)}
              data-testid={`stress-progress-set-${name}`}
            >
              {name}
            </LabButton>
          ))}
          <LabButton
            onClick={() => drive((frame) => (frame % 120) / 120)}
            data-testid="stress-progress-drive"
          >
            drive 5 s
          </LabButton>
          <LabButton
            onClick={() =>
              drive((frame) => (frame % 2 === 0 ? undefined : 0.5))
            }
            data-testid="stress-progress-flip"
          >
            flip mode 5 s
          </LabButton>
        </LabActions>
        <ProgressBar
          value={progress}
          label="Stress progress"
          data-testid="stress-progress"
        />
        <LabRow
          label="frames driven"
          value={
            <output data-testid="stress-progress-frames">
              {driveFrames === null ? "—" : driveFrames}
            </output>
          }
        />
      </LabSection>

      <LabSection
        title="Text"
        description="Ten thousand characters, and right-to-left and CJK samples under numberOfLines."
      >
        <LabActions>
          {[0, 1, 2, 3].map((n) => (
            <LabButton
              key={n}
              pressed={clamp === n}
              onClick={() => setClamp(n)}
              data-testid={`stress-text-clamp-${n}`}
            >
              {n === 0 ? "no clamp" : `${n} line${n > 1 ? "s" : ""}`}
            </LabButton>
          ))}
        </LabActions>
        <Text
          numberOfLines={clamp}
          render={<p />}
          className="text-sm"
          data-testid="stress-text-long"
        >
          {LONG_TEXT}
        </Text>
        <Text
          numberOfLines={clamp}
          render={<p dir="rtl" />}
          className="text-sm"
          data-testid="stress-text-rtl"
        >
          {RTL_TEXT}
        </Text>
        <Text
          numberOfLines={clamp}
          render={<p lang="ja" />}
          className="text-sm"
          data-testid="stress-text-cjk"
        >
          {CJK_TEXT}
        </Text>
      </LabSection>

      <LabSection
        title="Nested scrollers"
        description="A vertical ScrollView holding a horizontal one, under a safe-area padded View; the page itself must never scroll sideways."
      >
        <View safe="bottom" data-testid="stress-view-safe">
          <ScrollView className="h-40 rounded-md bg-secondary" fade>
            <div
              className="flex flex-col gap-y-2 p-3"
              data-testid="stress-scroll-outer"
            >
              <ScrollView
                horizontal
                fade
                className="rounded-md bg-background"
              >
                <div
                  className="flex w-[3000px] gap-x-2 p-2"
                  data-testid="stress-scroll-inner"
                >
                  {SLOTS.slice(0, 30).map((slot, i) => (
                    <span key={slot} className="shrink-0 text-sm">
                      column {i + 1}
                    </span>
                  ))}
                </div>
              </ScrollView>
              {SLOTS.slice(0, 30).map((slot, i) => (
                <p key={slot} className="text-sm">
                  row {i + 1}
                </p>
              ))}
            </div>
          </ScrollView>
        </View>
      </LabSection>

      <LabSection
        title="Mount cycles"
        description={`Each button mounts and unmounts its component ${CYCLE_COUNT} times, every one a committed render, then leaves nothing mounted. A spec compares the heap and the listener counts before and after.`}
      >
        <LabActions>
          {CYCLE_TARGETS.map((target) => (
            <LabButton
              key={target}
              onClick={() => cycle(target)}
              data-testid={`stress-cycle-${target}`}
            >
              {target} ({cycled[target] ?? 0})
            </LabButton>
          ))}
        </LabActions>
        <div
          className="relative min-h-8 overflow-hidden rounded-md bg-secondary"
          data-testid="stress-cycle-stage"
        >
          {subject && <CycleSubject target={subject} />}
        </div>
      </LabSection>

      <LabSection
        title="Screens"
        description="The full-screen components rendered in place, each in a full-bleed box exactly the viewport's width, so a spec can shrink the viewport and grow the font and measure the screen at the size it would really get."
      >
        <div
          className="relative left-1/2 h-[480px] w-screen -translate-x-1/2 overflow-hidden bg-background"
          data-testid="stress-screen-not-found"
        >
          <UiNotFound />
        </div>
        <div
          className="relative left-1/2 h-[480px] w-screen -translate-x-1/2 overflow-hidden bg-background"
          data-testid="stress-screen-boot-error"
        >
          <BootError />
        </div>
        <div
          className="relative left-1/2 h-[480px] w-screen -translate-x-1/2 overflow-hidden bg-background"
          data-testid="stress-screen-offline"
        >
          <Offline onRetry={() => {}} />
        </div>
      </LabSection>
    </LabPage>
  )
}
