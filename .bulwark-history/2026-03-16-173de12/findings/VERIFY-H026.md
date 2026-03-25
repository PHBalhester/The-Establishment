# VERIFY-H026: Missing HSTS
**Status:** FIXED
**Verified:** 2026-03-09
**Previous:** NOT_FIXED

## Evidence
`app/next.config.ts` lines 84-89 configure the HSTS header in the `headers()` function:

```ts
{
  key: "Strict-Transport-Security",
  value: "max-age=63072000; includeSubDomains; preload",
}
```

This is applied to all routes via the `source: "/(.*)"` pattern. The configuration includes:
- `max-age=63072000` -- 2 years (recommended maximum)
- `includeSubDomains` -- applies to all subdomains
- `preload` -- eligible for browser preload lists

## Assessment
Fix is complete. The HSTS header follows best practices (2-year max-age, subdomain inclusion, preload eligibility). Applied globally to all routes. This prevents SSL-stripping downgrade attacks.
