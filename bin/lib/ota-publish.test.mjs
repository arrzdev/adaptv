// @vitest-environment node
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * `adaptv build web` publishes the update channel, and it is correct only because
 * of an ORDER that nothing in the code's shape enforces.
 *
 * An app has two bundles — the site, and the SPA a native WebView runs — and both
 * builds write `dist/client`. The archive installed apps will download therefore
 * has to be taken *before* the site build overwrites that directory. Move the two
 * steps around and the command still runs, still prints a tag, and publishes the
 * SITE as if it were the native bundle: an update every device downloads and none
 * can boot, discovered only by the rollback.
 *
 * A source guard rather than a behavioural test, for the reason `native-web-shell`
 * gives: the hazard lives between two real `vite build`s that a unit test cannot
 * stand up. What CAN be pinned is the order they appear in, and the invariants
 * that would otherwise only be visible in a comment.
 */

const source = readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "adaptv.mjs",
  ),
  "utf8",
)

/** The body of one function, up to the next top-level declaration. */
function bodyOf(name) {
  const start = source.search(
    new RegExp(`^(async )?function ${name}\\(`, "m"),
  )
  expect(start).toBeGreaterThan(-1)
  const rest = source.slice(start + 1)
  const end = rest.search(/\n(async )?function \w+\(/)
  return end === -1 ? rest : rest.slice(0, end)
}

const publish = bodyOf("buildWebDeploy")
const stage = bodyOf("stageOtaBundle")
const signing = bodyOf("resolveChannelSigning")
const keygen = bodyOf("genOtaKeys")

describe("publishing the update channel", () => {
  it("archives the native bundle before the site build overwrites dist", () => {
    const staged = publish.indexOf("stageOtaBundle(")
    const siteBuild = publish.indexOf('viteCommand(appRoot, ["build"])')
    expect(staged).toBeGreaterThan(-1)
    expect(siteBuild).toBeGreaterThan(-1)
    expect(staged).toBeLessThan(siteBuild)
  })

  it("writes the channel after that build, into what the deploy uploads", () => {
    //Before it, and the site build erases the channel it just wrote.
    const siteBuild = publish.indexOf('viteCommand(appRoot, ["build"])')
    expect(publish.indexOf("writeChannel(")).toBeGreaterThan(siteBuild)
    expect(publish).toContain("clientDir: path.join(appRoot, CAP_WEB_DIR)")
  })

  it("publishes even when the build is unchanged", () => {
    //A deploy replaces the whole site. Skipping the write for an unchanged build
    //does not leave the old channel in place — it deletes it, and every installed
    //app starts 404ing. `reused` may only affect what is REPORTED.
    const reusedMentions = publish
      .split("\n")
      .filter((line) => line.includes("plan.reused"))
    expect(reusedMentions).toHaveLength(1)
    expect(reusedMentions[0]).toContain("already live")
  })

  it("never fails the build over an unreachable channel", () => {
    //A first deploy 404s by definition. `fetchDeployedManifest` swallows
    //everything; this pins that nothing here re-raises it.
    expect(publish).not.toMatch(/fetchDeployedManifest[\s\S]{0,120}throw/)
  })
})

describe("signing what gets published", () => {
  it("settles the key before it builds anything", () => {
    //Two builds is a long way to travel to find out there was never a key. It
    //also puts the refusal at the one moment nothing has been written yet.
    const settled = publish.indexOf("resolveChannelSigning(")
    expect(settled).toBeGreaterThan(-1)
    expect(settled).toBeLessThan(publish.indexOf("stageOtaBundle("))
  })

  it("hands that key to the channel", () => {
    //Without this line every field still lands in the manifest, the build still
    //passes, and the signature that makes any of it trustworthy is simply absent.
    expect(publish).toContain("privateKey: signing.privateKey")
  })

  it("refuses every way a channel can end up unverifiable", () => {
    //Four states, each of which publishes a channel devices reject while CI stays
    //green. The last is the only place a mismatched pair is catchable at all.
    expect(signing).toContain("!ota.publicKey")
    expect(signing).toContain("isUsableOtaPublicKey(ota.publicKey)")
    expect(signing).toContain("!privateKey")
    expect(signing).toContain(
      "signingKeyMatches(ota.publicKey, privateKey)",
    )
  })

  it("lets an unsigned channel through only where signing is off", () => {
    //The one sanctioned unsigned publish, and it takes two environment variables
    //to reach. Any OTHER early exit here is a hole in the four checks above.
    const early = signing.indexOf("return { privateKey }")
    expect(early).toBeGreaterThan(-1)
    expect(signing.slice(0, early)).toContain("!ota.requireSignature")
  })

  it("keeps no copy of the private key it generates", () => {
    //A key adaptv stores is a key adaptv can lose, and losing it costs a store
    //release: every installed app verifies against the public half in its binary.
    expect(keygen).not.toContain("writeFileSync")
    expect(keygen).not.toContain("ADAPTV_DIR")
  })
})

describe("the bundle cache", () => {
  it("keys on more than the app's own sources", () => {
    //`fingerprint()` skips node_modules — right for `dev`, wrong here: upgrading
    //adaptv would hit this cache and publish a bundle built by the old version to
    //every installed device.
    const key = bodyOf("otaCacheKey")
    expect(key).toContain("nativeFingerprint")
    expect(key).toContain("cliSourceFingerprint")
  })

  it("is asked exactly once for the key, so the two ends cannot drift", () => {
    //Read on the way in, written on the way out. Spelling the hash twice is how
    //those two stop agreeing, and the failure is a cache that never hits — or,
    //worse, one that always does.
    expect(stage.match(/otaCacheKey\(/g)).toHaveLength(2)
  })

  it("keeps the archive out of dist, which is about to be rebuilt", () => {
    expect(stage).toContain('path.join(appRoot, ADAPTV_DIR, "ota")')
  })
})
