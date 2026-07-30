import { List } from "@arrzdev/adaptv/components"
import { useCallback, useEffect, useRef, useState } from "react"
import { LabBrief } from "@/components/lab/lab-brief"
import {
  LabActions,
  LabBadge,
  LabButton,
  LabRow,
  LabSection,
} from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"

export const Route = createFileRoute({
  component: LabListPage,
})

type Row = { id: string; index: number }

const PAGE_SIZE = 500

function makeRows(count: number, from = 0): Row[] {
  return Array.from({ length: count }, (_, offset) => ({
    id: `row-${from + offset}`,
    index: from + offset,
  }))
}

function LabListPage() {
  const [rows, setRows] = useState(() => makeRows(2000))
  const [empty, setEmpty] = useState(false)
  const [endReached, setEndReached] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const [domRows, setDomRows] = useState<number | null>(null)

  //the whole claim in one number: how many row elements actually exist
  useEffect(() => {
    const node = containerRef.current
    if (!node) return
    const count = () =>
      setDomRows(node.querySelectorAll("[data-lab-row]").length)
    count()
    const observer = new MutationObserver(count)
    observer.observe(node, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  const onEndReached = useCallback(() => {
    setEndReached((n) => n + 1)
    setRows((current) =>
      current.length >= 4000
        ? current
        : [...current, ...makeRows(PAGE_SIZE, current.length)],
    )
  }, [])

  return (
    <LabPage
      title="List"
      subtitle="A virtualised ScrollView: thousands of rows, a handful of DOM nodes. The number that matters is on the page — if it grows with the data, virtualisation is off."
    >
      <LabBrief
        what="That a 2 000-row list keeps only a windowed handful of elements in the DOM, scrolls smoothly on a real device, fires onEndReached exactly once per arrival at the bottom, and renders its empty state instead of an empty scroller."
        steps={[
          "Read “rows in the DOM” before touching anything: it must be a small number (roughly what fits plus the overscan), never the row count.",
          "Fling the list hard to the bottom. Watch the DOM count — it must stay small the whole way.",
          "Keep scrolling at the bottom: onEndReached fires and 500 more rows are appended, up to 4 000. The counter above must tick up by one per arrival, not continuously.",
          "Check for blank gaps during a fast fling. A row that has not measured yet may flash at the estimated height; a persistent white band is a different thing.",
          "Press “empty the list”. The empty state must replace the scroller entirely — not appear inside it.",
        ]}
        expected={{
          web: {
            verdict: "works",
            note: "Smooth on desktop; the DOM count sits around 15–30 depending on the viewport. Fast flings are effectively instant here, so this target proves correctness rather than performance.",
          },
          pwa: {
            verdict: "works",
            note: "Same as the browser tab. Worth doing on a phone-sized installed app because the window is small and the overscan is proportionally larger.",
          },
          ios: {
            verdict: "works",
            note: "The target that matters for feel: WKWebView momentum is long, so the virtualizer has to keep up through a full fling. Blank bands during a fling are the failure to watch for here.",
          },
          android: {
            verdict: "works",
            note: "Same, and the harsher device: a low-end Android WebView is where a virtualisation regression shows first. Use chrome://inspect's performance panel if a fling stutters.",
          },
        }}
        wrong="The DOM row count tracks the data count — virtualisation is off and a real list will freeze the app. onEndReached fires in a continuous stream rather than once per arrival, which will hammer whatever it is wired to. Or the empty state renders inside a scroller that is still there."
      />

      <LabSection title="Live counters">
        <LabRow label="data rows" value={empty ? 0 : rows.length} />
        <LabRow
          label="rows in the DOM"
          value={
            domRows === null ? (
              <LabBadge tone="muted">counting…</LabBadge>
            ) : (
              <LabBadge
                tone={
                  domRows === 0 ? "muted" : domRows < 80 ? "ok" : "bad"
                }
              >
                {domRows}
              </LabBadge>
            )
          }
          hint="Counted with a MutationObserver over the list container. Anything near the data count means the window is not being applied."
        />
        <LabRow
          label="onEndReached calls"
          value={endReached}
          hint="Fires from an effect once the last row is windowed — so once per arrival at the bottom, not once per scroll event."
        />
        <LabActions>
          <LabButton onClick={() => setEmpty((on) => !on)}>
            {empty ? "refill the list" : "empty the list"}
          </LabButton>
          <LabButton onClick={() => setRows(makeRows(2000))}>
            reset to 2 000
          </LabButton>
        </LabActions>
      </LabSection>

      <LabSection
        title="2 000 rows"
        description="estimateSize is a starting guess; the virtualizer measures each row as it appears and refines from there. Every third row here is deliberately taller, so the estimate is wrong on purpose."
      >
        <div ref={containerRef} className="h-80">
          <List
            data={empty ? [] : rows}
            keyExtractor={(row) => row.id}
            estimateSize={56}
            onEndReached={onEndReached}
            fade
            className="h-full rounded-md bg-background"
            emptyState={
              <div className="flex h-80 items-center justify-center rounded-md bg-secondary text-sm text-muted">
                emptyState — rendered INSTEAD of the scroller
              </div>
            }
            renderItem={(row) => (
              <div
                data-lab-row
                className={
                  row.index % 3 === 0
                    ? "mx-1 my-1 flex items-center justify-between rounded-md bg-surface px-3 py-7 text-sm text-foreground"
                    : "mx-1 my-1 flex items-center justify-between rounded-md bg-surface px-3 py-3 text-sm text-foreground"
                }
              >
                <span className="font-mono">#{row.index}</span>
                <span className="text-muted">
                  {row.index % 3 === 0
                    ? "a taller row, to defeat the estimate"
                    : "row"}
                </span>
              </div>
            )}
          />
        </div>
      </LabSection>
    </LabPage>
  )
}
