# Phase 40: Wallet Connection - Context

**Gathered:** 2026-02-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Connect users to the protocol via standard browser wallets (Phantom, Solflare, Backpack) or Privy embedded wallets (phone, email, Google login), display token balances, and provide a unified signing interface. One wallet active at a time.

**Note:** Phase 39 (Privy v0 TX Validation) merged into this phase. Analysis showed all user-facing transactions (buy, sell, swap, stake, unstake, claim) fit in legacy transactions -- v0 TX + ALT is only needed for Carnage, which is server-cranked. Privy v0 signing is not a blocker. A Privy smoke test is the first task in this phase instead.

</domain>

<decisions>
## Implementation Decisions

### Phase 39 Merge Rationale
- Regular user sell: 20 named accounts + 4 transfer hook remaining = 24 total (fits legacy TX)
- Carnage sell: 23 named + 8 remaining = 31 total (needs v0 TX + ALT, but server-cranked -- not user-signed)
- All user-facing paths (buy, sell, PROFIT pool swap, stake, unstake, claim) fit in legacy transactions
- Privy v0 TX support is NOT blocking for user transactions
- Privy smoke test moved to first task of this phase

### Wallet Connection Model
- One wallet active at a time -- disconnect to switch
- Two paths in connection modal: "External Wallet" (Phantom/Solflare/Backpack) or "Sign In" (Privy: phone/email/Google)
- External wallet users do NOT need a Privy account -- wallet connection alone is sufficient
- Unified `useProtocolWallet()` hook: `{ publicKey, signTransaction, signAllTransactions }` regardless of wallet type

### Social Login Methods (Main Site / v0.8)
- Phone (SMS) -- returning bonding curve users can reconnect to same embedded wallet
- Email -- new sign-up path
- Google -- one-click convenience
- No Twitter/X for now

### Privy Commitment
- Privy is non-negotiable -- if something doesn't work, it's our problem to fix, not a reason to drop Privy
- No fallback strategy needed -- debug until it works
- Privy is the gold standard for embedded wallets

### UX Quality Bar
- "Working" means: signs + confirms on devnet + smooth UX (not just technically functional)
- Fix Privy UX quirks where possible (custom modals, pre-loading, caching) -- don't just accept rough edges
- User-friendly error messages: map Anchor error codes to human-readable messages ("Slippage exceeded", "Insufficient balance")

### Devnet Testing
- Manual faucet link for funding wallets -- only 2-3 testers, auto-funding not worth building
- Show "Fund your wallet" link with faucet instructions

### Claude's Discretion
- Smoke test scope (minimal SOL transfer is likely sufficient -- protocol-specific testing happens in Phase 42)
- Privy signing flow detail level (what Privy shows in approval modal vs what our UI shows pre-sign)
- Exact wallet adapter configuration and modal styling
- Loading states and connection error handling

</decisions>

<specifics>
## Specific Ideas

- Bonding curve users who used phone login must be able to re-log into the main site and find their tokens in the same Privy embedded wallet -- seamless transition
- Connection modal pattern: two clear paths, not a cluttered list of options. External wallets on one side, social login on the other.
- Privy embedded wallets have exportable private keys -- users can import into Phantom later if they want (this is standard Privy behavior, not something we need to build)

</specifics>

<deferred>
## Deferred Ideas

- **Bonding curve login mode (v0.9+):** Phone-only Privy login, no external wallets, sybil resistance for cheap token phase. When bonding curve ships, the frontend will have a separate mode with restricted login options.
- **Auto-funding new wallets:** Server-side SOL airdrop to new Privy wallets. Not needed for 2-3 testers. Revisit for public launch.
- **Twitter/X login:** Natural fit for crypto audience but not needed for tech prototype.

</deferred>

---

*Phase: 40-wallet-connection*
*Context gathered: 2026-02-15*
