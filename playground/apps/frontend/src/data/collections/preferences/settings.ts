import { useSingleton } from "@repo/synq/react"
import { useCallback } from "react"
import type { Preferences } from "@/data/collections/preferences/preferences.collection"
import { DEFAULT_PREFERENCES } from "@/data/collections/preferences/preferences.collection"
import { store } from "@/data/store"

//preferences (animations, haptics) live in a synq SINGLETON collection.
//`Settings` is kept as the app-facing name for these.
export type Settings = Preferences

export async function getSettings(): Promise<Settings> {
  return store.preferences.get()
}

export function useSettings() {
  const { data } = useSingleton(store.preferences)
  const settings: Settings = data ?? DEFAULT_PREFERENCES

  //preferences are local-only (no push transport): the write lands in the
  //outbox and self-commits on the next sync run — no sync to schedule
  const setSettings = useCallback((patch: Partial<Settings>) => {
    //preferences are a synq singleton that self-commits; they never push/pull,
    //so we must NOT poke the sync controller (it would flip the indicator to
    //"unsynced/offline" for a change that never travels)
    void store.preferences.set(patch)
  }, [])

  return { settings, setSettings }
}
