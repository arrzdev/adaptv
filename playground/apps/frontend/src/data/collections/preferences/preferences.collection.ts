import { singletonCollection } from "@repo/synq/core"

//app preferences as a synq SINGLETON collection — one row, local-only (no
//pull/push). add a field + its default here and it's instantly persisted and
//reactive via useSingleton(store.preferences).
export type Preferences = {
  animations: boolean
  haptics: boolean
}

export const DEFAULT_PREFERENCES: Preferences = {
  animations: true,
  haptics: true,
}

export const preferencesCollection = singletonCollection<Preferences>(
  "preferences",
  DEFAULT_PREFERENCES,
)
