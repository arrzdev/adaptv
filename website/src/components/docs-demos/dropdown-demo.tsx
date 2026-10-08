import { Dropdown, View } from "adaptv/components"
import { ChevronDown } from "lucide-react"
import { useState } from "react"

const ACTIONS = ["Rename", "Duplicate", "Archive"] as const

export function DropdownDemo() {
  const [last, setLast] = useState<string | null>(null)

  return (
    <View row className="items-center gap-4">
      <Dropdown placement="bottom-start">
        <Dropdown.Trigger
          aria-label="File actions"
          className="flex cursor-pointer items-center gap-2 rounded-lg bg-surface px-3 py-2 text-[14px] font-medium text-foreground outline outline-1 -outline-offset-1 outline-border-strong"
        >
          Actions
          <ChevronDown size={14} aria-hidden className="text-muted" />
        </Dropdown.Trigger>
        <Dropdown.Content
          aria-label="File actions"
          className="min-w-44 rounded-lg bg-raised ring-border-strong"
        >
          {ACTIONS.map((action) => (
            <Dropdown.Item
              key={action}
              onSelect={() => setLast(action)}
              className="rounded-md text-[14px] hover:bg-sunken"
            >
              {action}
            </Dropdown.Item>
          ))}
          <Dropdown.Item disabled className="rounded-md text-[14px]">
            Move to…
          </Dropdown.Item>
          <Dropdown.Item
            onSelect={() => setLast("Delete")}
            className="rounded-md text-[14px] text-danger hover:bg-sunken"
          >
            Delete
          </Dropdown.Item>
        </Dropdown.Content>
      </Dropdown>
      <span className="font-mono text-[13px] text-muted">
        onSelect: {last ?? "nothing yet"}
      </span>
    </View>
  )
}
