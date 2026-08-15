declare module "virtual:adaptv/secure-storage" {
  /**
   * The Keychain / AndroidKeyStore backend, or `null` when the optional peer
   * `@aparajita/capacitor-secure-storage` is not installed.
   *
   * Typed loosely on purpose: the real types live in a package adaptv does not
   * depend on, and naming them here would reintroduce exactly the compile-time
   * requirement this virtual module exists to avoid.
   */
  export const SecureStorage: unknown
}
