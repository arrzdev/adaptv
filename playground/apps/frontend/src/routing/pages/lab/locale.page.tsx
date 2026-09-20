import type { LocaleInfo } from "@arrzdev/adaptv/capabilities"
import { getLocale } from "@arrzdev/adaptv/capabilities"
import { useLocale } from "@arrzdev/adaptv/hooks"
import { createFileRoute } from "@arrzdev/adaptv/router"
import { useEffect, useRef, useState } from "react"
import { LabBrief } from "@/components/lab/lab-brief"
import {
  LabRow,
  LabSection,
  useClientValue,
} from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"

export const Route = createFileRoute("/_providers/lab/locale")({
  component: LabLocalePage,
})

/** The record, field by field, in the order the type declares them. */
const FIELDS = [
  "languageTag",
  "language",
  "script",
  "region",
  "direction",
  "hourCycle",
  "firstWeekday",
  "weekend",
  "decimalSeparator",
  "groupingSeparator",
  "timeZone",
  "calendar",
  "preferred",
] as const satisfies readonly (keyof LocaleInfo)[]

type Field = (typeof FIELDS)[number]

const FIELD_HINT: Partial<Record<Field, string>> = {
  firstWeekday: "1 = Monday … 7 = Sunday.",
  weekend: "Weekday numbers, same scale as firstWeekday.",
  preferred:
    "The user's full ordered list, not just the winner — the browser's language list, the OS's on native.",
}

/** The same instant everywhere, so a screenshot from any target compares. */
const SAMPLE_INSTANT = new Date(2026, 0, 5, 15, 7)

/** One value as the page shows it: arrays joined, `null` named rather than blank. */
function renderField(locale: LocaleInfo, field: Field): string | null {
  const value = locale[field]
  if (value === null) return null
  if (field === "weekend") return (value as number[]).join(",")
  if (field === "preferred") return (value as string[]).join(", ")
  return String(value)
}

function LabLocalePage() {
  const locale = useLocale()
  const { languageTag } = locale
  //everything below formats through Intl, and the engine default is not the
  //server's default: rendered after hydration the way the lab's other
  //browser-only answers are, so the server never commits a string the client
  //has to correct
  const isClient = useClientValue(() => true, false)

  //the live half: a counter that moves only when the tag really moves, and a log
  //of every tag seen so a reload (Android) and an in-place change (browser) look
  //different on the page. The baseline is READ from the capability rather than
  //taken from the first render, because that first render can still be the
  //server snapshot — counting the hydration correction as a change would report
  //a locale switch that never happened.
  const seenRef = useRef<string | null>(null)
  const [changes, setChanges] = useState(0)
  const [log, setLog] = useState<string[]>([])
  useEffect(() => {
    if (seenRef.current === null) {
      const tag = getLocale().languageTag
      seenRef.current = tag
      setLog([tag])
      return
    }
    if (seenRef.current === languageTag) return
    seenRef.current = languageTag
    setChanges((count) => count + 1)
    setLog((entries) => [...entries, languageTag])
  }, [languageTag])

  return (
    <LabPage
      title="Locale"
      subtitle="One record for the language, the direction, the clock, the week and the separators — and a live subscription for the targets that can change it under a running app."
    >
      <LabBrief
        what="Which locale the app is actually running in on this target, whether every derived field (direction, clock, week, separators) agrees with the tag, and whether a change made in Settings reaches the page live, after a reload, or never."
        steps={[
          "Read the record top to bottom and compare it with the OS or browser language setting. The tag must be the one you set, and the derived rows must match what you know about that locale (a 24-hour clock for Portugal, a Saturday week start for Egypt).",
          "Read the formatted samples, then the engine-default control under them. In a browser tab and on iOS the two clocks must agree.",
          "Read the direction paragraph. Under an Arabic or Hebrew tag it must be laid out right-to-left with the number at the right edge, and nothing else on the page may flip — the page never touches the document's own dir.",
          "Change the language: in the browser's settings for a tab or an installed PWA, in Settings › Apps › this app › Language on iOS and Android. Come back to this page without reloading it.",
          "Read the counter and the log. On a target that delivers the change live the counter reads 1 and the log shows both tags; on a target that reloads the page the counter reads 0 and the record is simply right.",
        ]}
        expected={{
          web: {
            verdict: "works",
            note: "Follows the browser's language — navigator.language, the first entry of the browser's list. Changing it in the browser fires `languagechange`: the tag moves, the counter increments, the samples re-format, no reload.",
          },
          pwa: {
            verdict: "works",
            note: "The same: installing changes the shell, not the locale source. The browser's language list still drives the record and the same event still arrives.",
          },
          ios: {
            verdict: "works",
            note: "The app's language — the per-app setting when one is set, the system language otherwise. Whether the switch reaches a running app live or only on relaunch is what step 4 measures here; either way the record is right afterwards.",
          },
          android: {
            verdict: "works",
            note: "The app's per-app language; changing it in Settings reloads the page with the new record. The counter therefore reads 0 afterwards and the log holds one tag — `languagechange` never reaches the app. The engine-default control is the quirk to look at: it stays frozen at the launch locale while the tag moves.",
          },
        }}
        wrong="The tag disagrees with the setting you just made after a reload. Or the two clocks disagree in a browser tab or on iOS — only Android freezes the engine default at launch. Or the direction paragraph stays left-to-right under an Arabic tag, which means every RTL user gets a mirrored app with an un-mirrored layout."
      />

      <LabSection
        title="The record"
        description="Every field of getLocale(), as the hook delivers it. `null` is a real value here (no script or region subtag), not a platform gap."
      >
        {FIELDS.map((field) => (
          <LabRow
            key={field}
            label={field}
            value={<FieldValue locale={locale} field={field} />}
            hint={FIELD_HINT[field]}
          />
        ))}
      </LabSection>

      <LabSection
        title="Formatted through the tag"
        description="The same number, time and date, formatted with the tag above passed to Intl explicitly. These follow the record, so they move when it does."
      >
        {isClient ? (
          <>
            <LabRow
              label="number"
              value={
                <span data-testid="locale-sample-number">
                  {new Intl.NumberFormat(languageTag).format(1234567.89)}
                </span>
              }
            />
            <LabRow
              label="time"
              value={
                <span data-testid="locale-sample-time">
                  {SAMPLE_INSTANT.toLocaleTimeString(languageTag, {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              }
            />
            <LabRow
              label="date"
              value={
                <span data-testid="locale-sample-date">
                  {SAMPLE_INSTANT.toLocaleDateString(languageTag, {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                  })}
                </span>
              }
            />
          </>
        ) : (
          <p className="text-sm text-muted italic">resolving…</p>
        )}
      </LabSection>

      <LabSection
        title="Control: the engine default"
        description="The same time with NO locale passed — whatever the JavaScript engine picked at launch. It is here to show the platform quirk: on Android the default stays frozen at the launch locale while the tag above moves."
      >
        {isClient ? (
          <LabRow
            label="time (undefined locale)"
            value={
              <span data-testid="locale-default-time">
                {SAMPLE_INSTANT.toLocaleTimeString(undefined, {
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
            }
          />
        ) : (
          <p className="text-sm text-muted italic">resolving…</p>
        )}
      </LabSection>

      <LabSection
        title="Direction"
        description="A paragraph with the record's direction on it — not on the document. A leading number makes right-to-left visible in a screenshot."
      >
        <p
          dir={locale.direction}
          data-testid="locale-direction-sample"
          className="rounded-md bg-secondary/40 px-3 py-2 text-sm text-foreground"
        >
          42 messages were counted before this sentence was laid out, and
          in a right-to-left locale that number sits at the right edge.
        </p>
      </LabSection>

      <LabSection
        title="Changes"
        description="Increments each time the tag changes under the running page. Expected 0 after a reload — a target that reloads on a language switch (Android) is right without ever counting."
      >
        <LabRow
          label="changes"
          value={
            <span data-testid="locale-changes">{String(changes)}</span>
          }
        />
        <div className="flex flex-col gap-y-0.5">
          <span className="text-sm text-subtle">tags seen</span>
          <ul
            data-testid="locale-log"
            className="flex max-h-48 flex-col gap-y-1 overflow-y-auto font-mono text-xs text-foreground"
          >
            {log.map((tag, index) => (
              <li key={`${index}-${tag}`} className="shrink-0 truncate">
                {tag}
              </li>
            ))}
          </ul>
        </div>
      </LabSection>
    </LabPage>
  )
}

function FieldValue({
  locale,
  field,
}: {
  locale: LocaleInfo
  field: Field
}) {
  const text = renderField(locale, field)
  return (
    <span
      data-testid={`locale-${field}`}
      className={text === null ? "text-muted italic" : undefined}
    >
      {text ?? "null"}
    </span>
  )
}
