import { Link } from "@tanstack/react-router"
import { ChevronRight } from "lucide-react"
import type { LabGroup } from "@/components/lab/lab-index"
import { LAB_GROUPS } from "@/components/lab/lab-index"
import { LabBadge } from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"

export const Route = createFileRoute({
  component: LabIndexPage,
})

/**
 * The testing index.
 *
 * Every page below carries its own instructions AND the expected result on each
 * of the four targets, so a pass produces a verdict rather than "seemed fine".
 * Walk the same page on a browser tab, an installed PWA, an iOS build and an
 * Android build — the differences are the point, and each page says in advance
 * which differences are correct.
 */
function LabIndexPage() {
  return (
    <LabPage
      title="Testing"
      subtitle="One page per component, per framework behaviour, per capability. Each states what should happen on this target before you touch it."
      backTo="/settings"
    >
      {LAB_GROUPS.map((group) => (
        <LabGroupSection key={group.title} group={group} />
      ))}
    </LabPage>
  )
}

function LabGroupSection({ group }: { group: LabGroup }) {
  return (
    <section className="flex flex-col gap-y-2">
      <h2 className="ps-1 text-sm font-medium text-subtle">
        {group.title}
      </h2>
      <p className="ps-1 text-sm text-muted">{group.summary}</p>
      <ul className="flex flex-col overflow-hidden rounded-md bg-surface">
        {group.entries.map((entry, index) => (
          <li key={entry.to}>
            {index > 0 && (
              <div
                className="mx-4 border-b border-border-subtle"
                aria-hidden
              />
            )}
            <Link
              to={entry.to}
              className="clickable flex w-full items-center gap-x-3 px-4 py-3 text-start"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-y-0.5">
                <div className="flex items-center gap-x-2">
                  <span className="truncate text-base font-medium text-foreground">
                    {entry.title}
                  </span>
                  {entry.isNew && <LabBadge tone="ok">new</LabBadge>}
                </div>
                <span className="truncate text-sm text-muted">
                  {entry.summary}
                </span>
              </div>
              <ChevronRight
                size={18}
                strokeWidth={1.75}
                aria-hidden
                className="shrink-0 text-subtle"
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
