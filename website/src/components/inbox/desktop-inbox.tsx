import { Pressable, ScrollView, View } from "@arrzdev/adaptv/components"
import { cn } from "@arrzdev/adaptv/utils"
import { Archive, FileText, Inbox as InboxIcon, Send, Star } from "lucide-react"
import { Avatar } from "./avatar"
import type { Inbox } from "./inbox-data"

const FOLDERS = [
  { icon: InboxIcon, label: "Inbox", active: true },
  { icon: Star, label: "Starred" },
  { icon: Send, label: "Sent" },
  { icon: FileText, label: "Drafts" },
  { icon: Archive, label: "Archive" },
] as const

/** The same inbox at desktop width: a sidebar, the list, and a reading pane. */
export function DesktopInbox({ inbox }: { inbox: Inbox }) {
  const { selected } = inbox
  return (
    <View row className="h-full text-[13px]">
      <View className="hidden w-44 shrink-0 gap-0.5 border-border border-r bg-sunken p-3 lg:flex">
        <span className="px-2 pt-1 pb-2 font-mono text-[10px] text-muted uppercase tracking-[0.14em]">
          Mail
        </span>
        {FOLDERS.map(({ icon: Icon, label, ...folder }) => (
          <View
            key={label}
            row
            className={cn(
              "items-center gap-2.5 rounded-lg px-2 py-1.5 text-subtle",
              "active" in folder && "bg-raised text-foreground shadow-sm",
            )}
          >
            <Icon className="size-4" />
            {label}
            {"active" in folder ? (
              <span className="ml-auto text-[11px] text-muted">
                {inbox.messages.length}
              </span>
            ) : null}
          </View>
        ))}
      </View>

      <ScrollView className="w-[300px] shrink-0 border-border border-r">
        {inbox.messages.map((message) => (
          <Pressable
            key={message.id}
            onPress={() => inbox.select(message.id)}
            className={cn(
              "flex w-full flex-row items-start gap-3 border-border border-b px-4 py-3 text-left hover:bg-sunken",
              selected?.id === message.id && "bg-sunken",
            )}
          >
            <Avatar message={message} className="size-8" />
            <View className="min-w-0 flex-1 gap-0.5">
              <View row className="items-center justify-between gap-2">
                <span
                  className={cn(
                    "truncate",
                    message.unread ? "font-semibold" : "font-medium",
                  )}
                >
                  {message.from}
                </span>
                <span className="shrink-0 text-[10.5px] text-muted">
                  {message.time}
                </span>
              </View>
              <span className="truncate text-[12px] text-subtle">
                {message.subject}
              </span>
            </View>
          </Pressable>
        ))}
      </ScrollView>

      <View className="min-w-0 flex-1 p-7 md:pr-64">
        {selected ? (
          <View className="gap-5">
            <View row className="items-center gap-3">
              <Avatar message={selected} className="size-10 text-[12px]" />
              <View className="min-w-0 gap-0.5">
                <span className="font-semibold">{selected.from}</span>
                <span className="text-[12px] text-muted">
                  to me · {selected.time}
                </span>
              </View>
              <Pressable
                onPress={() => inbox.archive(selected.id)}
                className="ml-auto flex flex-row items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 font-medium text-[12px] text-subtle hover:text-foreground active:bg-sunken"
              >
                <Archive className="size-3.5" />
                Archive
              </Pressable>
            </View>
            <span className="font-semibold text-[20px] tracking-tight">
              {selected.subject}
            </span>
            <p className="max-w-md text-[14px] text-subtle leading-relaxed">
              {selected.preview}
            </p>
            <View className="max-w-md gap-2 pt-2">
              <span className="h-2 w-full rounded-full bg-sunken" />
              <span className="h-2 w-11/12 rounded-full bg-sunken" />
              <span className="h-2 w-3/5 rounded-full bg-sunken" />
            </View>
          </View>
        ) : (
          <span className="m-auto text-muted">Nothing selected</span>
        )}
      </View>
    </View>
  )
}
