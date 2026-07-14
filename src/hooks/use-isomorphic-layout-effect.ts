import { useEffect, useLayoutEffect } from "react"

// useLayoutEffect warns during SSR ("does nothing on the server"); fall back to
// useEffect on the server so theme/shell hooks stay isomorphic without warnings.
export const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect
