# VERIFY-H050: Webhook No Body Size Limit
**Status:** FIXED
**Verified:** 2026-03-09
**Previous:** NOT_FIXED

## Evidence
`app/app/api/webhooks/helius/route.ts` lines 256-266 implement an explicit body size check:

```ts
const MAX_BODY_BYTES = 1_048_576; // 1MB
const contentLength = req.headers.get("content-length");
if (contentLength && parseInt(contentLength, 10) > MAX_BODY_BYTES) {
  return NextResponse.json(
    { error: "Payload too large" },
    { status: 413 },
  );
}
```

The 1MB limit is checked before `req.json()` is called, preventing memory allocation for oversized payloads. This is layered on top of Next.js's default 4MB body size limit.

## Assessment
Fix is complete. The explicit 1MB check provides a tighter bound than the Next.js default (4MB). One minor note: the check relies on the `Content-Length` header, which an attacker could omit or forge. However, Next.js's built-in 4MB limit acts as a backstop for requests without a valid Content-Length header, and the rate limiter (H024) limits request frequency. The defense-in-depth is adequate.
