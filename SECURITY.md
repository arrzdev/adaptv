# Security policy

## Supported versions

adaptv is pre-1.0 and in alpha. Only the latest commit on `main` and the latest published alpha
receive security fixes.

## Reporting a vulnerability

**Do not open a public issue, pull request or discussion for a security problem.**

Report it privately through GitHub's security advisories:
[**Report a vulnerability**](https://github.com/arrzdev/adaptv/security/advisories/new) (the
*Security* tab of the repository).

Please include:

- what is affected (the module, CLI command or generated file) and on which targets (web, PWA, iOS,
  Android);
- steps or a minimal project that reproduces it;
- the impact you expect: what an attacker can read, change or run.

You will get an acknowledgement within 7 days. We will agree a disclosure date with you, fix the
problem in a private fork, and publish the advisory with the fix. Credit is given in the advisory
unless you ask otherwise.

## Scope

In scope: code in `src/` and `bin/`, and what they generate into an app (the service worker, native
projects, the over-the-air update channel and its signing, secure storage).

Out of scope: `playground/` and `scripts/`, which never ship; vulnerabilities in a dependency with no
adaptv-specific impact (report those upstream); and the web tier of secure storage, which is
documented as best-effort, not secure.
