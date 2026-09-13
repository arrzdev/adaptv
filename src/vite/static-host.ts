import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import type { Plugin } from "vite"
import { appShellFile } from "#adaptv/config/sw-helpers.ts"
import { staticHostFiles } from "#adaptv/config/web-config.ts"
import type { AdaptvContext } from "#adaptv/vite/adaptv-context.ts"
import {
  captureClientOutDir,
  requireClientOutDir,
} from "#adaptv/vite/adaptv-context.ts"

/**
 * Emit the files a static host needs. -> `docs/decisions/register.md` B26, `docs/decisions/rendering-and-delivery.md §2`, `docs/design/lifecycle.md 1.2`
 *
 * Gated on `render: "spa"`, not on a nominated host. A SPA build produces a bucket
 * of files and has no idea which platform will serve them; each of these four is
 * read by one platform and ignored by the others, so emitting all four is correct
 * wherever it lands. See `staticHostFiles` for the per-file reasoning.
 *
 * The shell is *copied*, never captured from a response: a captured document
 * would be whatever the server rendered for whoever triggered the build, which is
 * user-specific by construction. Copying the generated shell keeps it
 * user-agnostic because it was generated that way.
 */
export function adaptvStaticHostPlugin(context: AdaptvContext): Plugin {
  let base = "/"
  return {
    name: "adaptv:static-host",
    apply: "build",
    configResolved(resolved) {
      captureClientOutDir(context, resolved)
      base = resolved.base
    },
    //`buildApp`, `order: "post"` — the app-level hook, after every environment
    //and after any deploy plugin has finished assembling the output. Mirrors how
    //the shell emitter and the service-worker build gate themselves; the ordering
    //between the three is load-bearing. → `adaptv-plugin.ts`
    buildApp: {
      order: "post",
      async handler() {
        emitStaticHostFiles(context, base)
      },
    },
  }
}

function emitStaticHostFiles(context: AdaptvContext, base: string): void {
  //SSR is excluded deliberately, and not just because it needs no fallback:
  //`_redirects` would answer every navigation from a static file and take it
  //away from the server that was built to render it.
  if (context.web?.render !== "spa") return

  const clientDir = requireClientOutDir(context)
  if (!existsSync(clientDir)) return

  //`index.html` under spa — but resolve it through the same helper the emitter
  //uses rather than restating the name here, where a drift would only show up
  //as a blank deploy.
  const shellFile = appShellFile("spa")
  const shellPath = path.join(clientDir, shellFile)
  if (!existsSync(shellPath)) {
    throw new Error(
      `[adaptv] a spa build needs the app shell, and ${shellFile} is missing from ${clientDir} — ` +
        "the shell-emit plugin must run before this one",
    )
  }
  const shell = readFileSync(shellPath, "utf8")

  for (const [name, contents] of Object.entries(
    staticHostFiles(shell, base),
  )) {
    writeFileSync(path.join(clientDir, name), contents)
  }
  console.log(
    "[adaptv] wrote index.html, 404.html, .nojekyll, _redirects (static host)",
  )
}
