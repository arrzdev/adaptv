import { View } from "adaptv/components"
import { Check } from "lucide-react"
import type { SVGProps } from "react"
import { Reveal } from "@/components/reveal"
import { Section } from "@/components/section"

/*
 * Platform marks from simple-icons, in one colour. The iOS mark is Apple's
 * wordmark, never the Apple logo; the Android robot is CC BY 3.0 and credited in the
 * footer. Each viewBox is cropped to its glyph so heights line up by eye.
 */
type Mark = (props: SVGProps<SVGSVGElement>) => React.JSX.Element

const IosMark: Mark = (props) => (
  <svg viewBox="0 6 24 12" fill="currentColor" aria-hidden="true" {...props}>
    <path d="M1.1 6.05C.486 6.05 0 6.53 0 7.13A1.08 1.08 0 0 0 1.1 8.21C1.72 8.21 2.21 7.73 2.21 7.13C2.21 6.53 1.72 6.05 1.1 6.05M8.71 6.07C5.35 6.07 3.25 8.36 3.25 12C3.25 15.67 5.35 17.95 8.71 17.95C12.05 17.95 14.16 15.67 14.16 12C14.16 8.36 12.05 6.07 8.71 6.07M19.55 6.07C17.05 6.07 15.27 7.45 15.27 9.5C15.27 11.13 16.28 12.15 18.4 12.64L19.89 13C21.34 13.33 21.93 13.81 21.93 14.64C21.93 15.6 20.96 16.28 19.58 16.28C18.17 16.28 17.11 15.59 17 14.53H15C15.08 16.65 16.82 17.95 19.46 17.95C22.25 17.95 24 16.58 24 14.4C24 12.69 23 11.72 20.68 11.19L19.35 10.89C17.94 10.55 17.36 10.1 17.36 9.34C17.36 8.38 18.24 7.74 19.54 7.74C20.85 7.74 21.75 8.39 21.85 9.46H23.81C23.76 7.44 22.09 6.07 19.55 6.07M8.71 7.82C10.75 7.82 12.06 9.45 12.06 12C12.06 14.57 10.75 16.2 8.71 16.2C6.65 16.2 5.35 14.57 5.35 12C5.35 9.45 6.65 7.82 8.71 7.82M.111 9.31V17.76H2.1V9.31H.11Z" />
  </svg>
)

const AndroidMark: Mark = (props) => (
  <svg
    viewBox="0 5.3 24 13.7"
    fill="currentColor"
    aria-hidden="true"
    {...props}
  >
    <path d="M18.4395 5.5586c-.675 1.1664-1.352 2.3318-2.0274 3.498-.0366-.0155-.0742-.0286-.1113-.043-1.8249-.6957-3.484-.8-4.42-.787-1.8551.0185-3.3544.4643-4.2597.8203-.084-.1494-1.7526-3.021-2.0215-3.4864a1.1451 1.1451 0 0 0-.1406-.1914c-.3312-.364-.9054-.4859-1.379-.203-.475.282-.7136.9361-.3886 1.5019 1.9466 3.3696-.0966-.2158 1.9473 3.3593.0172.031-.4946.2642-1.3926 1.0177C2.8987 12.176.452 14.772 0 18.9902h24c-.119-1.1108-.3686-2.099-.7461-3.0683-.7438-1.9118-1.8435-3.2928-2.7402-4.1836a12.1048 12.1048 0 0 0-2.1309-1.6875c.6594-1.122 1.312-2.2559 1.9649-3.3848.2077-.3615.1886-.7956-.0079-1.1191a1.1001 1.1001 0 0 0-.8515-.5332c-.5225-.0536-.9392.3128-1.0488.5449zm-.0391 8.461c.3944.5926.324 1.3306-.1563 1.6503-.4799.3197-1.188.0985-1.582-.4941-.3944-.5927-.324-1.3307.1563-1.6504.4727-.315 1.1812-.1086 1.582.4941zM7.207 13.5273c.4803.3197.5506 1.0577.1563 1.6504-.394.5926-1.1038.8138-1.584.4941-.48-.3197-.5503-1.0577-.1563-1.6504.4008-.6021 1.1087-.8106 1.584-.4941z" />
  </svg>
)

const PwaMark: Mark = (props) => (
  <svg viewBox="0 7.4 24 9.2" fill="currentColor" aria-hidden="true" {...props}>
    <path d="M20.5967 7.482L24 16.518h-2.5098l-.5816-1.6184h-3.2452l.6933-1.7532h2.0019l-.95-2.6597 1.1881-3.0047zm-8.111 0l1.7722 5.8393L16.75 7.482h2.4154l-3.6433 9.036h-2.3833l-1.6395-5.2366-1.7196 5.2366h-2.377l-1.233-2.1161 1.2144-3.7415 1.342 2.6609 1.9029-5.8393h1.8566zm-8.7453 0c1.0635 0 1.8713.3055 2.4234.9166a2.647 2.647 0 01.2806.3684l-1.0753 3.3128-.3847 1.1854c-.352.1006-.7533.1509-1.204.1509H2.2928v3.102H0V7.482zm-.5816 1.7532h-.866v2.4276h.8597c.5577 0 .9406-.1194 1.1485-.3582.1896-.215.2845-.5058.2845-.8724 0-.364-.1079-.6544-.3235-.8714-.2157-.217-.5834-.3256-1.1032-.3256z" />
  </svg>
)

const CapacitorMark: Mark = (props) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
    <path d="M24 3.7l-5.766 5.766 5.725 5.736-3.713 3.712L5.073 3.742 8.786.03l5.736 5.726L20.284 0 24 3.7zM.029 8.785l3.713-3.713 15.173 15.173-3.713 3.714-5.732-5.726L3.7 24 0 20.285l5.754-5.764L.029 8.785z" />
  </svg>
)

const PLATFORMS: { name: string; mark: Mark | null; size: string }[] = [
  { name: "iOS", mark: IosMark, size: "h-[15px] md:h-[18px]" },
  { name: "Android", mark: AndroidMark, size: "h-5 md:h-6" },
  { name: "PWA", mark: PwaMark, size: "h-[15px] md:h-[18px]" },
  { name: "Capacitor", mark: CapacitorMark, size: "h-[21px] md:h-6" },
]

const WAYS: { title: string; lines: string[] }[] = [
  {
    title: "In a browser tab",
    lines: [
      "Inputs don't zoom the page when they get focus.",
      "Scrolling a list doesn't drag the page behind it.",
    ],
  },
  {
    title: "Installed from the browser",
    lines: [
      "Installs from the browser, no store.",
      "Works offline.",
      "Fixes reach users without a store review.",
    ],
  },
  {
    title: "In the App Store and Google Play",
    lines: [
      "Real iOS and Android builds through Capacitor.",
      "Safe areas and the keyboard are handled.",
      "Android's Back button closes the open sheet first.",
    ],
  },
]

/**
 * Where an adaptv app runs: the four platform marks, then the three ways the same code
 * reaches people and what adaptv fixes in each. Every line is true on `main`; one that
 * stops being true is dropped, not reworded. Each mark carries its name as hidden text,
 * so assistive tech reads a plain list of four.
 */
export function WhereItRuns() {
  return (
    <Section
      title="Where it runs"
      lede="The same code reaches people three ways. adaptv handles what each one gets wrong by default."
    >
      <Reveal className="flex flex-col gap-12">
        <ul className="flex items-center gap-10">
          {PLATFORMS.map(({ name, mark: Mark, size }) => (
            <li
              key={name}
              className="flex h-7 items-center text-foreground opacity-50 transition-opacity duration-200 ease-out hover:opacity-80"
            >
              {Mark ? (
                <>
                  <Mark className={`w-auto ${size}`} />
                  <span className="sr-only">{name}</span>
                </>
              ) : (
                <span
                  className={`font-semibold leading-none tracking-[-0.03em] ${size}`}
                >
                  {name}
                </span>
              )}
            </li>
          ))}
        </ul>
        <div className="grid gap-10 md:grid-cols-3 md:gap-8">
          {WAYS.map((way) => (
            <View key={way.title} className="gap-4">
              <h3 className="font-semibold text-[18px] tracking-[-0.02em]">
                {way.title}
              </h3>
              <ul className="flex flex-col gap-2.5 text-[14.5px] text-muted">
                {way.lines.map((line) => (
                  <li key={line} className="flex items-start gap-2">
                    <Check
                      className="mt-[3px] size-4 shrink-0 text-success"
                      strokeWidth={2.5}
                    />
                    {line}
                  </li>
                ))}
              </ul>
            </View>
          ))}
        </div>
      </Reveal>
    </Section>
  )
}
