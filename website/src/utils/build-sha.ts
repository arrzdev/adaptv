/*
 * The commit a build is from, served as `/version.json` (`{"sha": "<sha>"}`) so a drift
 * check reads exactly what the Worker serves. The deploy builds with GITHUB_SHA set;
 * BUILD_SHA overrides it, and a local build falls back to the checkout's HEAD.
 *
 * No `@/` imports: the build's config loader imports this file and cannot resolve them.
 */
export function buildSha(
  env: { BUILD_SHA?: string; GITHUB_SHA?: string },
  gitHead: () => string,
) {
  return env.BUILD_SHA || env.GITHUB_SHA || gitHead()
}

export function versionFile(sha: string) {
  return `${JSON.stringify({ sha })}\n`
}
