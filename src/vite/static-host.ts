import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import type { Plugin } from "vite"
import { staticHostFiles } from "#adaptv/config/web-config.ts"
import type { AdaptvContext } from "#adaptv/vite/adaptv-context.ts"

/**
 * Emit the files a static host needs. -> `DECISIONS.md` B26, `LIFECYCLE.md 1.2`
 *
 * `host: "static"` was documented as a supported deploy target but **nothing
 * emitted these**, so it was not actually deployable. Each file exists for a
 * specific host behaviour - see `staticHostFiles` for the per-file reasoning.
 *
 * The shell is *copied*, never captured from a response: a captured document
 * would be whatever the server rendered for whoever triggered the build, which is
 * user-specific by construction. Copying the generated shell keeps it
 * user-agnostic because it was generated that way.
 */
export function adaptvStaticHostPlugin(context: AdaptvContext): Plugin {
  return {
    name: "adaptv:static-host",
    apply: "build",
    //Only after the LAST environment. `closeBundle` fires once per environment,
    //and the client build finishes first — running then would look for a shell
    //Start has not written yet and fail with a misleading "no shell" error.
    //Mirrors how the service-worker build gates itself.
    applyToEnvironment(environment) {
      return environment.name === "ssr"
    },
    closeBundle() {
      if (context.web?.host !== "static") return

      const clientDir = path.resolve(context.appRoot, "dist/client")
      if (!existsSync(clientDir)) return

      //TanStack Start emits `_shell.html`, and only in SPA mode. That leading
      //underscore is the whole problem: GitHub Pages runs Jekyll, which strips
      //`_`-prefixed files, and Cloudflare Workers Assets looks for /index.html.
      const shellPath = path.join(clientDir, "_shell.html")
      const indexPath = path.join(clientDir, "index.html")
      let shell: string | null = null
      if (existsSync(shellPath)) shell = readFileSync(shellPath, "utf8")
      else if (existsSync(indexPath))
        shell = readFileSync(indexPath, "utf8")

      if (shell === null) {
        //MEASURED, not assumed: with `spa: { enabled: true }` and the Cloudflare
        //adapter, Start emitted NO html at all - not `_shell.html`, not
        //`index.html`. So "copy Start's shell" is not a foundation adaptv can
        //stand on, and `RENDERING.md 3.1.2`'s instruction that adaptv must
        //GENERATE its own shell is load-bearing rather than belt-and-braces.
        throw new Error(
          '[adaptv] host: "static" needs an app shell, and the build produced none ' +
            "(no dist/client/_shell.html, no dist/client/index.html).\n" +
            "TanStack Start does not reliably emit one - it was not written here even " +
            'with `web.render: "spa"`.\n' +
            "adaptv must generate a user-agnostic shell itself; that is not built yet. " +
            'Until it is, use `host: "node"` or `host: "cloudflare"`.',
        )
      }

      for (const [name, contents] of Object.entries(
        staticHostFiles(shell),
      )) {
        writeFileSync(path.join(clientDir, name), contents)
      }
      console.log(
        "[adaptv] static host: wrote index.html, 404.html, .nojekyll, _redirects",
      )
    },
  }
}
