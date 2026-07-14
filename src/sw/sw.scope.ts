/// <reference lib="webworker" />

export function serviceWorkerScope(): ServiceWorkerGlobalScope {
  return self as unknown as ServiceWorkerGlobalScope
}
