import {
  Pressable,
  PullToRefresh,
  ScrollView,
  Swipeable,
  View,
} from "@arrzdev/adaptv/components"
import { cn } from "@arrzdev/adaptv/utils"
import { Archive, Inbox as InboxIcon, Search, Settings2 } from "lucide-react"
import { useRef } from "react"
import { Avatar } from "./avatar"
import type { Inbox } from "./inbox-data"

/** The phone layout. Every gesture in here is adaptv's — nothing is a recording. */
export function PhoneInbox({ inbox }: { inbox: Inbox }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const unread = inbox.messages.filter((message) => message.unread).length

  return (
    <View className="h-full bg-background">
      <View row className="shrink-0 items-end justify-between px-4 pt-2 pb-3">
        <View className="gap-0.5">
          <span className="font-semibold text-[22px] tracking-tight">
            Inbox
          </span>
          <span className="text-[11.5px] text-muted">
            {unread > 0 ? `${unread} unread` : "All caught up"}
          </span>
        </View>
        <span className="mb-1 size-8 rounded-full bg-gradient-to-br from-[#8b95ff] to-[#ff8fb4]" />
      </View>

      <PullToRefresh
        onRefresh={inbox.refresh}
        scrollContainerRef={scrollRef}
        className="min-h-0 flex-1 overflow-hidden"
      >
        <ScrollView ref={scrollRef} fill>
          <Swipeable.Group>
            {inbox.messages.map((message) => (
              <Swipeable key={message.id}>
                <Swipeable.Content>
                  <Pressable
                    onPress={() => inbox.select(message.id)}
                    className="flex w-full flex-row items-start gap-3 border-border border-b bg-background px-4 py-3 text-left active:bg-sunken"
                  >
                    <Avatar message={message} />
                    <View className="min-w-0 flex-1 gap-0.5">
                      <View row className="items-center justify-between gap-2">
                        <span
                          className={cn(
                            "truncate text-[13px]",
                            message.unread ? "font-semibold" : "font-medium",
                          )}
                        >
                          {message.from}
                        </span>
                        <span className="shrink-0 text-[10.5px] text-muted">
                          {message.time}
                        </span>
                      </View>
                      <span className="truncate text-[12px] text-foreground/90">
                        {message.subject}
                      </span>
                      <span className="line-clamp-1 text-[11.5px] text-muted">
                        {message.preview}
                      </span>
                    </View>
                    {message.unread ? (
                      <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand" />
                    ) : null}
                  </Pressable>
                </Swipeable.Content>
                <Swipeable.RightActions>
                  <Pressable
                    onPress={() => inbox.archive(message.id)}
                    aria-label={`Archive the message from ${message.from}`}
                    className="flex h-full w-20 flex-col items-center justify-center gap-1 bg-brand text-brand-foreground"
                  >
                    <Archive className="size-[18px]" />
                    <span className="font-medium text-[10.5px]">Archive</span>
                  </Pressable>
                </Swipeable.RightActions>
              </Swipeable>
            ))}
          </Swipeable.Group>
          {inbox.messages.length === 0 ? (
            <View className="items-center gap-3 px-6 py-16 text-center">
              <span className="text-[13px] text-muted">Inbox zero.</span>
              <Pressable
                onPress={inbox.reset}
                className="rounded-full bg-sunken px-4 py-2 font-medium text-[12px] active:opacity-70"
              >
                Bring them back
              </Pressable>
            </View>
          ) : null}
        </ScrollView>
      </PullToRefresh>

      <View
        row
        className="shrink-0 items-start justify-around border-border border-t bg-background/90 px-6 pt-2.5 pb-6 text-muted backdrop-blur"
      >
        <InboxIcon className="size-5 text-brand" />
        <Search className="size-5" />
        <Settings2 className="size-5" />
      </View>
    </View>
  )
}
