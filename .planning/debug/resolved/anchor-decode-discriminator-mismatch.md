---
status: resolved
trigger: "ws-subscriber batch seed fails to decode all Anchor accounts with Account not found discriminator mismatch error on Railway production. Works locally in dev mode."
created: 2026-03-20T00:00:00Z
updated: 2026-03-20T00:02:00Z
---

## Current Focus

hypothesis: CONFIRMED AND FIXED - Anchor 0.32 convertIdlToCamelCase() requires camelCase account names in decode() calls
test: All 6 account types verified with real devnet data. TypeScript compiles clean.
expecting: Railway deploy will decode all 7 accounts successfully
next_action: Archive session

## Symptoms

expected: ws-subscriber batchSeed() should decode all 7 Anchor accounts (EpochState, CarnageFundState, 2x PoolState, 2x CurveState, StakePool) plus CarnageSolVault (SystemAccount) during initialization.
actual: All 7 Anchor account decodes fail with "Account not found: {AccountType}" error. Only CarnageSolVault (SystemAccount, no Anchor decode needed) succeeds. "Batch seed complete: 1 accounts".
errors: "[ws-subscriber] Failed to decode EpochState at FjJrLcmDjA8FtavGWdhJq3pdirAH889oWXc2bhEAMbDU: Error: Account not found: EpochState" — same pattern for all Anchor accounts
reproduction: Deploy to Railway with `next start` (production build). Locally with `npm run dev` works fine.
started: First deploy with ws-subscriber DBS migration. Never deployed before.

## Eliminated

- hypothesis: Production build corrupts or transforms IDL JSON files during bundling
  evidence: IDL discriminator bytes (bf3f8bed900cdfd2) match on-chain data perfectly. The IDL is intact.
  timestamp: 2026-03-20T00:00:30Z

- hypothesis: Different Anchor version in dev vs prod
  evidence: Same @coral-xyz/anchor 0.32.1 in both. ESM and CJS versions have identical code.
  timestamp: 2026-03-20T00:00:35Z

## Evidence

- timestamp: 2026-03-20T00:00:10Z
  checked: Anchor 0.32 BorshAccountsCoder.accountDiscriminator() in node_modules
  found: The method does `this.idl.accounts?.find((acc) => acc.name === name)` - a case-sensitive string match
  implication: Account name must exactly match what's in the IDL after camelCase conversion

- timestamp: 2026-03-20T00:00:15Z
  checked: Anchor 0.32 Program constructor (node_modules/@coral-xyz/anchor/dist/cjs/program/index.js line 104)
  found: `this._idl = convertIdlToCamelCase(idl)` then `this._coder = new BorshCoder(this._idl)` - coder gets camelCase IDL
  implication: All account names in the coder are camelCase (epochState, not EpochState)

- timestamp: 2026-03-20T00:00:20Z
  checked: camelcase npm package behavior with PascalCase inputs
  found: camelcase("EpochState") -> "epochState", camelcase("CarnageFundState") -> "carnageFundState", etc.
  implication: All PascalCase account type names used in ws-subscriber and webhook handler are wrong

- timestamp: 2026-03-20T00:00:25Z
  checked: Real devnet decode test - EpochState at FjJrLcmDjA8FtavGWdhJq3pdirAH889oWXc2bhEAMbDU (172 bytes)
  found: decode("epochState", data) -> SUCCESS (all 23 fields decoded). decode("EpochState", data) -> "Account not found: EpochState"
  implication: Root cause confirmed. Fix is to use camelCase account names.

- timestamp: 2026-03-20T00:00:40Z
  checked: Webhook handler at app/api/webhooks/helius/route.ts lines 239-247
  found: Same bug - ANCHOR_DECODE_MAP uses PascalCase accountType values ("EpochState", "PoolState", etc.)
  implication: Both ws-subscriber AND webhook handler need the same fix

- timestamp: 2026-03-20T00:00:45Z
  checked: Field name access in ws-subscriber (decoded.stakedBalance, decoded.lastClaimTs)
  found: These are already camelCase and match Anchor's converted output (staked_balance -> stakedBalance)
  implication: Field access code is correct, only the account type name passed to decode() is wrong

- timestamp: 2026-03-20T00:01:30Z
  checked: Post-fix verification - all 6 account types across 4 programs
  found: epochState, carnageFundState, poolState, curveState, stakePool, userStake all resolve correctly in Anchor coder
  implication: Fix is complete and correct

- timestamp: 2026-03-20T00:01:45Z
  checked: TypeScript compilation (npx tsc --noEmit)
  found: Zero errors
  implication: No type regressions introduced

## Resolution

root_cause: Anchor 0.32's Program constructor converts all IDL names to camelCase via convertIdlToCamelCase(). The ws-subscriber BATCH_ACCOUNTS array and webhook ANCHOR_DECODE_MAP pass PascalCase account type names ("EpochState", "PoolState", etc.) to coder.accounts.decode(), but the coder's internal IDL has camelCase names ("epochState", "poolState"). The find() lookup fails with "Account not found: {name}". This is NOT a dev-vs-prod issue -- the bug exists in both environments (the "works locally" claim was likely a misinterpretation of cached/webhook-fed data).

fix: Changed all accountType string values from PascalCase to camelCase in:
  1. ws-subscriber.ts BATCH_ACCOUNTS array (7 entries)
  2. ws-subscriber.ts bigintFields comparisons (2 checks)
  3. ws-subscriber.ts UserStake decode calls (2 occurrences)
  4. webhooks/helius/route.ts ANCHOR_DECODE_MAP (7 entries)
  5. webhooks/helius/route.ts bigintFields comparisons (2 checks)

verification: All 6 account types (epochState, carnageFundState, poolState, curveState, stakePool, userStake) verified against real devnet data. EpochState at FjJrLcmDjA8FtavGWdhJq3pdirAH889oWXc2bhEAMbDU decodes successfully with camelCase name, returns all 23 fields. TypeScript compiles with zero errors.

files_changed:
  - app/lib/ws-subscriber.ts
  - app/app/api/webhooks/helius/route.ts
