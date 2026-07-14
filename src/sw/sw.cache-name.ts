/** Namespaced cache bucket — `{bucket}-{buildTag}`. */
export function createCacheName(buildTag: string, bucket: string): string {
  return `${bucket}-${buildTag}`
}
