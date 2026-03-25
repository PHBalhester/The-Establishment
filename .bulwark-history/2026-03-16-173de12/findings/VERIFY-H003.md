# VERIFY-H003: npm Supply Chain Attack
**Status:** FIXED
**Verified:** 2026-03-09
**Previous:** PARTIALLY_FIXED

## Evidence

1. **`.npmrc` exists with `ignore-scripts=true`** -- FIXED (commit 807ba9e). File at project root contains `ignore-scripts=true` with clear documentation comment explaining the security rationale. This blocks all npm lifecycle scripts (`preinstall`, `postinstall`, etc.) by default, preventing malicious packages from executing arbitrary code during `npm install`/`npm ci`.

2. **`package-lock.json` tracked in git** -- FIXED (unchanged from previous verification). `git ls-files package-lock.json` confirms it is tracked. Not listed in `.gitignore`. This ensures deterministic installs via `npm ci` and prevents silent dependency substitution.

3. **Additional supply chain protections**:
   - `engines` field in `package.json` requires `node >= 22`, preventing use on older runtimes.
   - Caret ranges (`^`) in `package.json` are pinned by the committed lockfile -- new versions only enter via explicit `npm update`.
   - Railway/Nixpacks auto-detects `package-lock.json` and uses `npm ci` (deterministic, lockfile-only installs).

## Assessment

The fix is complete. The previously identified gap (missing `.npmrc` with `ignore-scripts=true`) has been addressed in commit 807ba9e. The three layers of protection now in place are: (1) committed lockfile for deterministic installs, (2) `ignore-scripts=true` to block malicious lifecycle scripts, and (3) `npm ci` in CI/CD which refuses to modify the lockfile. No remaining gaps.
