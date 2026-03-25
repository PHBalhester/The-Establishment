# VERIFY-H034: Double-Submit Without Guard
**Status:** FIXED
**Verified:** 2026-03-09
**Previous:** FIXED

## Evidence
No regression. `app/components/station/BigRedButton.tsx` still has `isTransacting` guard that disables the button during TX lifecycle (building/signing/sending/confirming). The `handleClick` function only fires `onSwap()` when `status === 'idle'`.

## Assessment
Fix confirmed and stable.
