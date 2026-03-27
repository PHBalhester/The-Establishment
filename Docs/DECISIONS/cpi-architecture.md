---
topic: "CPI Architecture"
topic_slug: "cpi-architecture"
status: complete
interview_date: 2026-02-20
decisions_count: 6
provides: ["cpi-architecture-decisions"]
requires: ["architecture-decisions", "account-structure-decisions"]
verification_items: []
---

# CPI Architecture — Decisions

## Summary
The protocol's 6 programs compose via a directed acyclic CPI graph that reaches Solana's depth-4 limit on every swap path. Reentrancy is structurally impossible due to the acyclic topology. Access control between programs uses PDA-gated `seeds::program` constraints. Token-2022 hook forwarding requires manual CPI helpers because Anchor's built-in transfer_checked does not forward remaining_accounts. Conversion Vault is a leaf node with no CPI surface -- direct user calls only via `convert` instruction. It calls Token-2022 `transfer_checked` internally but receives no incoming CPIs.

## Decisions

### D1: Depth-4 Is the Permanent Ceiling
**Choice:** All swap paths (user swaps and Carnage) hit Solana's CPI depth-4 limit: Entry → Tax → AMM → Token-2022 → Transfer Hook. No additional CPI calls can ever be added to any swap path.
**Rationale:** This is a hard Solana runtime constraint. The depth was consumed by the architectural requirement of Tax orchestration (depth 1) + AMM execution (depth 2) + Token-2022 transfer_checked (depth 3) + Transfer Hook validation (depth 4). No remaining roadmap items (Phases 50-52) require additional CPI depth. Post-burn, the programs are frozen — the depth budget is permanently spent.
**Alternatives considered:** Merging AMM+Tax to save one CPI hop (rejected in architecture decisions — loses independent deployability and couples concerns).
**Affects docs:** [cpi-interface-contract, architecture, security-model]

### D2: Acyclic CPI Graph — Reentrancy Structurally Impossible
**Choice:** No reentrancy guards needed for Tax, Epoch, or Staking programs. The CPI graph is a DAG: Epoch → Tax → AMM → Token-2022 → Transfer Hook (terminal). No downstream program ever CPIs back upstream.
**Rationale:** Transfer Hook is the terminal node (makes zero CPIs). Token-2022 only calls Hook. AMM only calls Token-2022. Tax calls AMM, System, and Staking::deposit_rewards (which makes no outbound CPIs). No cycle exists, so reentrancy is impossible by construction.
**AMM exception:** The AMM retains a `pool.locked` reentrancy guard as defense-in-depth. This guard can never actually trigger given the current graph, but it's harmless and conventional for AMMs.
**Alternatives considered:** Adding reentrancy guards to all programs (rejected — unnecessary complexity for structurally impossible condition).
**Affects docs:** [cpi-interface-contract, security-model]

### D3: Manual CPI for Token-2022 Transfer Hooks
**Choice:** All Token-2022 `transfer_checked` calls use manual `invoke_signed` with hook accounts appended, rather than Anchor's built-in `transfer_checked` CPI helper.
**Rationale:** Anchor's SPL token CPI helpers do not forward `remaining_accounts` to `invoke_signed`. Token-2022 transfer hooks require extra accounts (ExtraAccountMetaList, whitelist PDAs, hook program) to be passed alongside the transfer. A custom `transfer_checked_with_hook` helper function builds the raw instruction with hook accounts appended to both `ix.accounts` and `account_infos`.
**Alternatives considered:** Patching Anchor (upstream dependency, fragile), using raw solana_program throughout (loses Anchor account validation benefits).
**Affects docs:** [cpi-interface-contract, token-interaction-matrix]

### D4: Dual-Hook Ordering for PROFIT Pools (Historical)
**Status:** Historical -- PROFIT AMM pools have been removed and replaced by the Conversion Vault, which uses standard Token-2022 `transfer_checked` without hooks. This decision is retained for reference only.
**Choice:** For PROFIT pools (both sides were Token-2022 with hooks), client sent 8 remaining_accounts as `[input_hooks(4), output_hooks(4)]`. AMM split at the midpoint. Input = the token being sold into the pool; output = the token received.
**Rationale:** The AMM needed hook accounts for both the input transfer (user -> vault) and output transfer (vault -> user). The ordering was `[INPUT, OUTPUT]` not `[side_A, side_B]`, which meant Buy (AtoB) sent `[A_hooks, B_hooks]` but Sell (BtoA) sent `[B_hooks, A_hooks]`. Getting this wrong caused Transfer Hook error 3005 (AccountNotEnoughKeys).
**Superseded by:** Conversion Vault uses PDA-derived token accounts and standard transfers. No hook accounts are needed because vault token accounts are whitelisted (no transfer hook validation required for vault-held tokens).
**Affects docs:** [cpi-interface-contract, token-interaction-matrix, frontend-spec]

### D5: PDA-Gated Access Control via seeds::program
**Choice:** Cross-program call authorization uses Anchor's `seeds::program` constraint. Each CPI-callable instruction validates that the caller is a specific PDA derived from a specific program.
**Rationale:** Only the owning program can produce a valid PDA signer for its seeds. This is cryptographically enforced by ed25519 — no program can forge another program's PDA signature. Four cross-program PDA gates exist:
- AMM validates `swap_authority` from Tax Program
- Tax validates `carnage_authority` from Epoch Program
- Staking validates `tax_authority` from Tax Program
- Staking validates `staking_authority` from Epoch Program
**Alternatives considered:** Caller program ID checks (weaker — any instruction in the caller program could invoke), admin-managed whitelists (centralisation vector).
**Affects docs:** [cpi-interface-contract, security-model]

### D6: swap_exempt Is Carnage-Exclusive
**Choice:** The Tax Program's `swap_exempt` instruction is permanently restricted to the Carnage signer PDA (`seeds::program = epoch_program_id()`). No other caller can perform tax-free swaps.
**Rationale:** Tax-exempt swaps are a privilege that must be tightly scoped. Only Carnage needs them (protocol-owned rebalancing). The bonding curve is a separate program that sells tokens directly — it never touches the AMM or tax system. Post-burn, no new callers can be added.
**Alternatives considered:** Extensible caller list (rejected — adding callers to a tax bypass is a security risk and violates the immutability principle).
**Affects docs:** [cpi-interface-contract, security-model, token-economics-model]

## Open Questions
(None — all CPI architecture decisions are firm.)

## Raw Notes
- The CPI call graph has 23 unique call sites across the 5 CPI-connected programs. Tax Program is the busiest caller (14 CPI calls) as the orchestrator of all taxed swaps. Conversion Vault is disconnected from the CPI graph (no incoming or outgoing CPIs to other protocol programs; it only calls Token-2022 directly).
- SOL wrapping (system_program::transfer + sync_native) for Carnage executes at depth 0 BEFORE entering the swap chain — this is critical to staying within depth-4.
- Token-2022 burn does NOT trigger transfer hooks, so Carnage burn actions don't consume CPI depth.
- The `transfer_checked_with_hook` helper pattern is used in both AMM (swap output) and Staking (stake/unstake). It's the same pattern in both places.
- 4 hook accounts per mint: extra_account_meta_list PDA, whitelist_source PDA, whitelist_destination PDA, hook program ID.
