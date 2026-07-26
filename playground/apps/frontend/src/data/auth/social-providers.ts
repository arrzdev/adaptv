import { queryOptions } from "@tanstack/react-query"
import { api } from "@/data/backend-client"

//which oauth providers the backend has configured (both id + secret present).
//drives the login drawer's social buttons, so adding a provider server-side
//lights up its button with zero frontend changes.

export type SocialProvider = "github" | "google"

export const socialProvidersQueryOptions = queryOptions({
  queryKey: ["social-providers"] as const,
  queryFn: async ({ signal }) => {
    const res = await api.api.v1["social-providers"].$get(
      {},
      { init: { signal } },
    )
    if (!res.ok) throw new Error("failed to load social providers")
    const body = await res.json()
    if (body.status !== "success") {
      throw new Error("failed to load social providers")
    }
    return body.data.providers
  },
  staleTime: 5 * 60 * 1000,
})
