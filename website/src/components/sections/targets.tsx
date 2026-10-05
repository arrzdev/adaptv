import { type SVGProps, useState } from "react"

/*
 * Marks only where the owner allows them: the Android robot (CC BY 3.0, credited in the
 * footer) and the PWA logo (CC0). Apple's and Google's other marks need a licence, and
 * the store badges are only for a published app, so those targets are named in text.
 */
function AndroidMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M18.4395 5.5586c-.675 1.1664-1.352 2.3318-2.0274 3.498-.0366-.0155-.0742-.0286-.1113-.043-1.8249-.6957-3.484-.8-4.42-.787-1.8551.0185-3.3544.4643-4.2597.8203-.084-.1494-1.7526-3.021-2.0215-3.4864a1.1451 1.1451 0 0 0-.1406-.1914c-.3312-.364-.9054-.4859-1.379-.203-.475.282-.7136.9361-.3886 1.5019 1.9466 3.3696-.0966-.2158 1.9473 3.3593.0172.031-.4946.2642-1.3926 1.0177C2.8987 12.176.452 14.772 0 18.9902h24c-.119-1.1108-.3686-2.099-.7461-3.0683-.7438-1.9118-1.8435-3.2928-2.7402-4.1836a12.1048 12.1048 0 0 0-2.1309-1.6875c.6594-1.122 1.312-2.2559 1.9649-3.3848.2077-.3615.1886-.7956-.0079-1.1191a1.1001 1.1001 0 0 0-.8515-.5332c-.5225-.0536-.9392.3128-1.0488.5449zm-.0391 8.461c.3944.5926.324 1.3306-.1563 1.6503-.4799.3197-1.188.0985-1.582-.4941-.3944-.5927-.324-1.3307.1563-1.6504.4727-.315 1.1812-.1086 1.582.4941zM7.207 13.5273c.4803.3197.5506 1.0577.1563 1.6504-.394.5926-1.1038.8138-1.584.4941-.48-.3197-.5503-1.0577-.1563-1.6504.4008-.6021 1.1087-.8106 1.584-.4941z" />
    </svg>
  )
}

function PwaMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M20.5967 7.482L24 16.518h-2.5098l-.5816-1.6184h-3.2452l.6933-1.7532h2.0019l-.95-2.6597 1.1881-3.0047zm-8.111 0l1.7722 5.8393L16.75 7.482h2.4154l-3.6433 9.036h-2.3833l-1.6395-5.2366-1.7196 5.2366h-2.377l-1.233-2.1161 1.2144-3.7415 1.342 2.6609 1.9029-5.8393h1.8566zm-8.7453 0c1.0635 0 1.8713.3055 2.4234.9166a2.647 2.647 0 01.2806.3684l-1.0753 3.3128-.3847 1.1854c-.352.1006-.7533.1509-1.204.1509H2.2928v3.102H0V7.482zm-.5816 1.7532h-.866v2.4276h.8597c.5577 0 .9406-.1194 1.1485-.3582.1896-.215.2845-.5058.2845-.8724 0-.364-.1079-.6544-.3235-.8714-.2157-.217-.5834-.3256-1.1032-.3256z" />
    </svg>
  )
}

const TARGETS = [
  { name: "Safari on iOS" },
  { name: "Chrome on Android", mark: AndroidMark },
  { name: "Desktop browsers" },
  { name: "Home screen (PWA)", mark: PwaMark },
  { name: "App Store" },
  { name: "Google Play" },
] as const

function TargetRow({ as: Tag }: { as: "ul" | "span" }) {
  const Item = Tag === "ul" ? "li" : "span"
  return (
    <Tag className="marquee-list">
      {TARGETS.map((target) => {
        const Mark = "mark" in target ? target.mark : null
        return (
          <Item
            key={target.name}
            className="flex shrink-0 items-center gap-2.5 whitespace-nowrap font-medium text-[17px] text-subtle"
          >
            {Mark && <Mark className="size-6" />}
            {target.name}
          </Item>
        )
      })}
    </Tag>
  )
}

/**
 * The six places adaptv runs, as one slow line. The line is a toggle button so touch and
 * keyboard users can stop it too (WCAG 2.2.2); its copies are hidden from assistive tech,
 * which reads the plain list instead. Under reduced motion that list is the one you see.
 */
export function Targets() {
  const [paused, setPaused] = useState(false)
  return (
    <section className="sheet">
      <div className="flex flex-col gap-5 px-6 py-10 md:flex-row md:items-center md:gap-10 md:px-10">
        <p className="shrink-0 text-[14px] text-muted">Runs on</p>
        <div className="min-w-0 flex-1">
          <div className="marquee-static">
            <TargetRow as="ul" />
          </div>
          <button
            type="button"
            aria-pressed={paused}
            aria-label="Pause the platforms line"
            onClick={() => setPaused((value) => !value)}
            className="marquee"
          >
            <span className="marquee-viewport" aria-hidden="true">
              <span className="marquee-track">
                <TargetRow as="span" />
                <TargetRow as="span" />
              </span>
            </span>
          </button>
        </div>
      </div>
    </section>
  )
}
