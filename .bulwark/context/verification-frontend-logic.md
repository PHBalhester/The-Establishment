# Verification: Frontend, Error & Logic Findings (Stacked Audit #2)

**Auditor**: Claude Opus 4.6 (1M context)
**Date**: 2026-03-21
**Scope**: Re-verify 6 findings from Audit #1 against current codebase state

---

## H015 — Default Slippage 500 BPS (5%)

**Original Severity**: HIGH | **Original Status**: NOT_FIXED
**File**: `app/providers/SettingsProvider.tsx:170`

### Verification

**CONFIRMED STILL PRESENT** — Line 170 still reads:
```typescript
slippageBps: 500,
```

The default slippage for all new users (no localStorage) is 5%. This is aggressive for a memecoin AMM where liquidity may be thin.

**Mitigating factors observed**:
- Users CAN change slippage via `SlippageConfig` component (presets: 0.5%, 1%, 2%, plus custom input).
- The UI warns when slippage exceeds 5% (`highSlippage = slippageBps > 500` at `SlippageConfig.tsx:88`).
- Setting persists to localStorage after first change.
- On-chain swap instructions enforce `minimumTokensOut` / `minimumSolOut` so the user never receives less than `amount * (10000 - slippageBps) / 10000`.

**Assessment**: The 5% default is high but the user has full control. The warning threshold is >5%, meaning the default sits exactly at the threshold boundary (5% itself does NOT trigger the warning). This is a UX concern, not a security vulnerability — the user is protected by on-chain slippage enforcement. A more conservative default (e.g., 100-200 BPS) would be better.

**Verdict**: **STILL VALID (LOW severity, downgraded from HIGH)**. The on-chain slippage guard makes this a UX issue, not a funds-at-risk issue.

---

## H041 — No ComputeBudgetProgram on Bonding Curve TXs

**Original Severity**: LOW | **Original Status**: NOT_FIXED
**File**: `app/lib/curve/curve-tx-builder.ts`

### Verification

**CONFIRMED STILL PRESENT** — The entire `curve-tx-builder.ts` file (226 lines) contains three instruction builders (`buildPurchaseInstruction`, `buildSellInstruction`, `buildClaimRefundInstruction`). None include `ComputeBudgetProgram.setComputeUnitLimit()` or `ComputeBudgetProgram.setComputeUnitPrice()` instructions.

Searched all files in `app/lib/curve/` — zero references to `ComputeBudgetProgram`.

**Context**: Other protocol TX builders DO include compute budget instructions:
- `app/lib/swap/multi-hop-builder.ts` — uses ComputeBudgetProgram
- `app/lib/staking/staking-builders.ts` — uses ComputeBudgetProgram
- `app/lib/swap/swap-builders.ts` — uses ComputeBudgetProgram

The bonding curve builders return raw `TransactionInstruction` objects, not full transactions. The caller could theoretically add compute budget instructions, but no caller currently does.

**Assessment**: Missing priority fees means bonding curve TXs may be deprioritized during congestion. Missing CU limit means the runtime default (200K CU) applies, which is likely sufficient for these instructions but wastes CU budget.

**Verdict**: **STILL VALID (LOW)**. Not a security issue but an operational reliability concern during network congestion.

---

## H048 — Sign-then-Send Pattern

**Original Severity**: LOW | **Original Status**: ACCEPTED_RISK
**File**: `app/hooks/useProtocolWallet.ts`

### Verification

**CONFIRMED STILL PRESENT** — `useProtocolWallet.ts` (lines 87-121) implements sign-then-send:
1. `signTransaction(tx)` — wallet signs
2. `signed.serialize()` — serialize
3. `connection.sendRawTransaction(serialized, ...)` — submit via project's Helius RPC

The file header (lines 16-24) documents exactly WHY this pattern is used: Phantom's `signAndSendTransaction` sends via Phantom's own RPC, which silently drops devnet TXs.

**Assessment**: Sign-then-send is an intentional, well-documented design decision. The tradeoff is:
- **Pro**: Full control over which RPC receives the TX (Helius).
- **Con**: The signed TX could theoretically be intercepted and submitted by a different party (but Solana TXs are signed and cannot be modified, so this is not an attack vector — the same TX would land regardless of who submits it).
- **Con**: No Blowfish simulation through Phantom's pipeline (but the wallet popup still shows TX details for user review).

**Verdict**: **STILL VALID (LOW, ACCEPTED_RISK)**. Intentional design with documented rationale. No change needed.

---

## H125 — Demo Mode BigInt via Number

**Original Severity**: LOW | **Original Status**: FIXED
**File**: Demo code / DB schema

### Verification

**ASSESSED** — The finding references "demo code" for BigInt-via-Number issues. Searching the codebase:

1. **No demo mode exists**: There is no `demoMode`, `isDemoMode`, or `DEMO_MODE` flag anywhere in the app. The only "demo" reference is `app/app/kit/page.tsx`, which is a UI component showcase page with no BigInt operations.

2. **DB schema uses `mode: "number"`**: `app/db/schema.ts` declares all bigint columns with `{ mode: "number" }` (Drizzle ORM). This means PostgreSQL `bigint` values are returned as JavaScript `number` — which loses precision above `Number.MAX_SAFE_INTEGER` (9,007,199,254,740,991 = ~9 quadrillion). For lamports, this overflows at ~9 billion SOL. For token base units at 6 decimals, this overflows at ~9 billion tokens. With 1B token supplies, this is within safe range but has limited headroom.

3. **`app/instrumentation-client.ts:15`** does `Number((big >> BigInt(32)) & mask32)` — this is a hashing operation on 32-bit chunks, which is safe.

**Assessment**: If the original H125 was about a specific demo mode that has since been removed, then it is FIXED. The DB schema `mode: "number"` pattern is a separate concern (the values stay within safe integer range for this protocol's parameters).

**Verdict**: **FIXED** — no demo mode code with BigInt-via-Number issues exists.

---

## H097 — Graduation Irreversibility

**Original Severity**: MED | **Original Status**: ACCEPTED_RISK
**File**: `scripts/graduation/graduate.ts`

### Verification

**CONFIRMED STILL PRESENT** — The graduation script:

1. **Step 2 (`prepareTransition`)** is explicitly marked **IRREVERSIBLE** (lines 43-44, 370-371). Once called, both curves transition to `Graduated` status permanently.
2. The script prints a red warning: `"*** IRREVERSIBLE: Transitioning both curves to Graduated ***"` (line 370).
3. **No confirmation prompt**: The script does NOT ask the admin to confirm before executing. It proceeds automatically through all 13 steps after launch.
4. **Checkpoint/resume**: Progress saves to `graduation-state.json`, so a partial failure can resume. But Step 2 cannot be reversed once committed.
5. **On-chain**: The `CurveStatus::Graduated` enum variant is a terminal state with no reverse transition defined in the bonding curve program.

**Mitigating factors**:
- This is an admin-only script, not user-facing.
- The script verifies both curves are `Filled` before proceeding (Step 1).
- Graduation is an expected one-time protocol lifecycle event.
- The script is well-documented about its irreversibility.

**Assessment**: The irreversibility is by design — graduation is supposed to be permanent. The real risk is accidental execution. Adding a y/N confirmation prompt before Step 2 would be a simple safeguard.

**Verdict**: **STILL VALID (MED, ACCEPTED_RISK)**. Irreversibility is intentional but a confirmation prompt would reduce operator error risk.

---

## H106 — No Emergency Pause Mechanism

**Original Severity**: HIGH | **Original Status**: ACCEPTED_RISK
**All programs**

### Verification

**CONFIRMED STILL PRESENT** — Comprehensive search across all Rust program source files:
- `is_paused` / `paused` — zero matches in program source code
- `emergency` / `pause` / `freeze` / `halt` — only found in test files (freeze authority in mint construction) and one comment in `staking/src/helpers/math.rs` about transaction halting. No actual pause functionality.
- No program state account contains a paused/frozen flag.
- No instruction exists to toggle a pause state.

The protocol has **no mechanism to halt trading, staking, epoch transitions, or carnage execution** in response to a discovered vulnerability or market emergency.

**Mitigating factors**:
- Upgrade authority is retained (behind Squads multisig with timelock), so a patched program could be deployed — but this takes time (timelock delay + build + deploy).
- The Transfer Hook whitelist could be used to de-whitelist pool vaults, which would block all token transfers through those pools. This is an indirect pause mechanism but would require separate whitelist update TXs per vault.
- AMM AdminConfig is retained, potentially allowing pool parameter manipulation as an indirect control.

**Assessment**: This is a genuine architectural gap. A dedicated pause instruction (admin-gated, per-program or global) would allow immediate response to exploits. The current mitigation path (program upgrade or whitelist manipulation) has significant latency.

**Verdict**: **STILL VALID (HIGH, ACCEPTED_RISK)**. No emergency pause exists across any of the 7 programs. The retained upgrade authority provides a slow path to remediation but not immediate circuit-breaking.

---

## Summary Table

| ID | Severity | Status | Verdict |
|----|----------|--------|---------|
| H015 | HIGH->LOW | NOT_FIXED | Still present. 5% default slippage is a UX issue; on-chain guards prevent actual loss. Downgrade to LOW. |
| H041 | LOW | NOT_FIXED | Still present. Bonding curve TXs lack ComputeBudgetProgram. Other builders have it. |
| H048 | LOW | ACCEPTED_RISK | Still present. Intentional sign-then-send for RPC control. Well-documented. |
| H125 | LOW | FIXED | Demo mode code no longer exists. DB schema mode:"number" is separate concern within safe range. |
| H097 | MED | ACCEPTED_RISK | Still present. Graduation irreversibility is by design. Missing y/N confirmation prompt. |
| H106 | HIGH | ACCEPTED_RISK | Still present. Zero pause mechanism across all 7 programs. Upgrade authority is slow mitigation. |
