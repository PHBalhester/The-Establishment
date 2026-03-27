# Dr. Fraudsworth's Finance Factory - Security Context Document

## Executive Summary

Dr. Fraudsworth's Finance Factory is a Solana DeFi protocol implementing asymmetric taxation, VRF-driven epoch transitions, buyback-and-burn ("Carnage") events, and PROFIT staking for real SOL yield. Built from 7 on-chain Anchor/Rust programs (~30K+ LOC) composed via CPI, a Next.js frontend, and off-chain crank infrastructure. Post-launch, all upgrade authorities are burned -- the protocol becomes immutable, autonomous, and ungovernable.

**What makes it unique:** No emissions, no ponzinomics, no team allocation. All yield derives from trading friction (1-14% dynamic tax). Three tokens (CRIME, FRAUD, PROFIT) with transfer hooks, a Switchboard VRF oracle for randomness, and permanent protocol-owned liquidity with no LP tokens.

---

## Technology Stack

| Component | Technology | Version/Details |
|-----------|-----------|----------------|
| On-chain programs | Anchor/Rust | Anchor 0.32.1, 7 programs |
| Token standard | Token-2022 | Transfer hooks on CRIME, FRAUD, PROFIT |
| SOL representation | SPL Token | WSOL (native mint) |
| Randomness | Switchboard On-Demand VRF | Feature-gated devnet/mainnet PIDs |
| Frontend | Next.js 16 | docs-site/, Turbopack, Privy wallet |
| Deployment | Railway | Backend + crank runner |
| Analytics | Helius Webhooks | Transaction indexing to PostgreSQL |
| Test framework | ts-mocha + Anchor test | Integration + security tests |

### Key Dependencies (Rust)
| Crate | Purpose | Security Notes |
|-------|---------|----------------|
| anchor-lang 0.32.1 | Framework | PDA derivation, account validation |
| anchor-spl | Token interfaces | Manual CPI for hook forwarding |
| spl-token-2022 | T22 transfers | Must use transfer_checked (never transfer) |
| switchboard-on-demand | VRF reads | Owner validation feature-gated |

---

## Architecture

```
                     +------------------+
                     | Switchboard VRF  |
                     | (3rd party)      |
                     +--------+---------+
                              |
                              | read randomness
                              v
+---------+  swap_exempt  +----------+  update_cumulative  +----------+
|   AMM   | <-----------  |  Epoch   | -----------------> | Staking  |
|         |               | Program  |                    |          |
+----^----+               +----------+                    +-----^----+
     |                                                          |
     | swap_sol_pool CPI            deposit_rewards CPI         |
     |                          +-------------------------------+
     +--------------------------+      Tax Program              |
                                | (14 CPI call sites)           |
                                +------^------------------------+
                                       |
                                       | user entry (buy/sell)
                                +------+-------+
                                |    User      |
                                +------+-------+
                                       |
            +-----------+--------------+---------------+
            v           v                              v
     +-----------+ +-----------+              +------------------+
     | Bonding   | | Convers.  |              | Transfer Hook    |
     | Curve     | | Vault     |              | (terminal, no    |
     | (launch)  | | (leaf)    |              |  outbound CPI)   |
     +-----------+ +-----------+              +------------------+

CPI Depth Ceiling (Carnage path):
  Epoch::execute_carnage_atomic (depth 0)
    -> Tax::swap_exempt (depth 1)
      -> AMM::swap_sol_pool (depth 2)
        -> Token-2022::transfer_checked (depth 3)
          -> Transfer Hook::execute (depth 4 -- SOLANA LIMIT)
```

### Programs

| Program | ID | LOC (est.) | Role |
|---------|-----|-----------|------|
| AMM | EsbMMZty... | ~3K | Constant-product swaps (Uniswap V2) |
| Transfer Hook | FnwnSxgi... | ~2K | Whitelist-gated transfer enforcement |
| Tax Program | Eufdhhek... | ~4K | Asymmetric tax + SOL distribution |
| Epoch Program | 5q1X9zGs... | ~6K | VRF epochs + Carnage buyback-burn |
| Staking | HLVyXH5Q... | ~3K | PROFIT staking for SOL yield |
| Conversion Vault | EA1tKNmH... | ~1.5K | Fixed 100:1 token conversion |
| Bonding Curve | AGhdAzP6... | ~10K | Linear price discovery + launch |

---

## Trust Boundaries

### Boundary 1: User -> Tax Program (Entry Point)
- **Type:** Authentication boundary
- **Controls:** User wallet signature required
- **Risks:** Sandwich attacks (mitigated by 50% output floor), tax evasion (mitigated by CPI-only AMM access)

### Boundary 2: Tax Program -> AMM (SwapAuthority PDA)
- **Type:** CPI access control gate
- **Controls:** `seeds::program = TAX_PROGRAM_ID` on AMM side
- **Risks:** Account substitution (mitigated by vault/mint/token-program validation)

### Boundary 3: Epoch Program -> Tax Program (CarnageSigner PDA)
- **Type:** CPI access control gate
- **Controls:** `seeds::program = EPOCH_PROGRAM_ID` on Tax side
- **Risks:** VRF manipulation (mitigated by anti-reroll binding)

### Boundary 4: Tax/Epoch -> Staking (TaxAuthority/StakingAuthority PDAs)
- **Type:** CPI access control gates
- **Controls:** Dual PDA gates from two source programs
- **Risks:** Double-update (mitigated by epoch number check), reward inflation (mitigated by dead stake + escrow reconciliation)

### Boundary 5: AMM -> Token-2022 -> Transfer Hook (Implicit)
- **Type:** Token program hook invocation
- **Controls:** WhitelistEntry PDA existence check
- **Risks:** Hook bypass (mitigated by always using transfer_checked, never transfer)

### Boundary 6: User -> Bonding Curve (Launch Phase)
- **Type:** Direct user interaction
- **Controls:** Wallet cap (20M tokens), min purchase (0.05 SOL), deadline (48hr), slippage protection
- **Risks:** Sybil (partially mitigated by wallet cap), front-running, sell-back abuse (15% tax)

### Boundary 7: Switchboard VRF (External Oracle)
- **Type:** Third-party integration
- **Controls:** Owner check on randomness account, anti-reroll binding, timeout recovery
- **Risks:** Oracle downtime (graceful degradation with stale rates), gateway rotation failure

---

## Entry Points

### User-Facing Instructions

| Program | Instruction | Auth | Input | Security Notes |
|---------|-------------|------|-------|----------------|
| Tax Program | swap_sol_buy | User wallet | sol_amount, min_tokens_out | 50% output floor, dynamic tax |
| Tax Program | swap_sol_sell | User wallet | token_amount, min_sol_out | WSOL intermediary cycle |
| Conversion Vault | convert | User wallet | amount, direction | Fixed rate, zero fees |
| Staking | stake | User wallet | amount + hook accounts | Min stake enforced |
| Staking | unstake | User wallet | amount + hook accounts | Auto-full unstake below min |
| Staking | claim | User wallet | none | SOL from escrow |
| Bonding Curve | purchase | User wallet | sol_amount, min_tokens_out | Wallet cap, min purchase |
| Bonding Curve | sell | User wallet | tokens_to_sell, min_sol_out | 15% tax, Active status only |
| Bonding Curve | claim_refund | User wallet | none | Failed/partner-failed only |

### Admin-Only Instructions

| Program | Instruction | Auth | Purpose |
|---------|-------------|------|---------|
| AMM | initialize_admin | Upgrade authority | One-time admin setup |
| AMM | initialize_pool | Admin signer | Pool creation |
| AMM | burn_admin | Admin signer | Permanent admin removal |
| Transfer Hook | initialize_authority | Upgrade authority | One-time setup |
| Transfer Hook | add_whitelist_entry | Authority signer | Add whitelist address |
| Transfer Hook | burn_authority | Authority signer | Permanent authority removal |
| Epoch Program | initialize_epoch_state | Admin | Genesis config |
| Epoch Program | initialize_carnage_fund | Admin | Carnage vault setup |
| Staking | initialize_stake_pool | Admin | Pool + dead stake setup |
| Conversion Vault | initialize | Admin | Vault + token account setup |
| Bonding Curve | initialize_curve | Admin | Per-token curve creation |
| Bonding Curve | start_curve | Admin | Activate curve |
| Bonding Curve | prepare_transition | Admin | Filled -> Graduated |
| Bonding Curve | withdraw_graduated_sol | Admin | SOL withdrawal post-grad |
| Bonding Curve | close_token_vault | Admin | Recover rent |

### Permissionless (Crank) Instructions

| Program | Instruction | Trigger | Notes |
|---------|-------------|---------|-------|
| Epoch Program | trigger_epoch_transition | Epoch boundary | 0.001 SOL bounty |
| Epoch Program | consume_randomness | VRF revealed | Sets new tax rates |
| Epoch Program | execute_carnage_atomic | Carnage pending | 0-50 slot lock window |
| Epoch Program | execute_carnage (fallback) | 50-300 slots | Lower slippage floor |
| Epoch Program | expire_carnage | >300 slots | Clears stale state |
| Epoch Program | retry_epoch_vrf | VRF timeout | Fresh randomness account |
| Epoch Program | force_carnage | Debug only | Feature-gated |
| Bonding Curve | mark_failed | Deadline + grace | Anyone can call |
| Bonding Curve | distribute_tax_escrow | Post-graduation | Tax -> Carnage fund |
| Bonding Curve | consolidate_for_refund | Refund-eligible | Escrow -> SOL vault |

---

## Critical Data Flows

### Flow 1: User Buy (SOL -> CRIME/FRAUD)
```
User signs TX with SOL amount
  -> Tax Program: calculate tax (1-14%), split distribution
    -> system_transfer x3: staking(71%), carnage(24%), treasury(5%)
    -> deposit_rewards CPI: Staking.pending_rewards += staking_portion
    -> swap_sol_pool CPI: AMM executes constant-product swap
      -> Token-2022.transfer_checked: WSOL user->vault (SPL, no hook)
      -> Token-2022.transfer_checked: Token vault->user (T22 + hook)
        -> Transfer Hook: whitelist check (vault is whitelisted, pass)
```

### Flow 2: Carnage Buyback-Burn
```
Crank calls execute_carnage_atomic
  -> Read VRF decision (target=CRIME/FRAUD, action=Burn/Sell)
  -> If holdings exist + Burn: Token-2022.burn (no hook triggered)
  -> Wrap SOL: system_transfer + SyncNative (depth 0)
  -> swap_exempt CPI -> Tax Program (no tax, depth 1)
    -> swap_sol_pool CPI -> AMM (depth 2)
      -> Token-2022.transfer_checked (depth 3)
        -> Transfer Hook (depth 4, SOLANA LIMIT)
```

### Flow 3: Epoch Transition
```
Crank calls trigger_epoch_transition
  -> Validate epoch boundary (current_slot >= epoch_start + SLOTS_PER_EPOCH)
  -> Pay bounty from Carnage SOL vault
  -> Client bundles: Switchboard commit + reveal
Crank calls consume_randomness
  -> Read Switchboard RandomnessAccountData (owner check)
  -> Anti-reroll: must use pending_randomness_account bound at commit
  -> derive_taxes: 5 VRF bytes -> new tax rates
  -> Carnage decision: bytes 5-7 -> trigger/action/target
  -> update_cumulative CPI: Staking finalizes epoch rewards
```

### Flow 4: Bonding Curve Purchase
```
User calls purchase(sol_amount, min_tokens_out)
  -> Validate: Active status, slot < deadline
  -> Math: walk linear price curve, compute tokens for SOL input
  -> Enforce: wallet cap (20M tokens via ATA balance check)
  -> Enforce: slippage (tokens_out >= min_tokens_out)
  -> SOL transfer: user -> sol_vault (system_transfer)
  -> Token transfer: token_vault -> user (T22 + hook via remaining_accounts)
  -> If tokens_sold >= TARGET_TOKENS: status = Filled
```

---

## Security Controls

| Control | Implementation | Location | Verification |
|---------|----------------|----------|-------------|
| PDA-gated CPI | 4 cross-program PDAs with seeds::program | All CPI interfaces | Anchor constraint checks |
| Reentrancy guard | pool.locked boolean (belt-and-suspenders) | AMM swap_sol_pool | Defense-in-depth over acyclic DAG |
| Anti-reroll VRF | pending_randomness_account binding | Epoch consume_randomness | Account pubkey comparison |
| Output floor | 50% minimum (5000 bps) | Tax Program swaps | Constant in tax constants.rs |
| Checked arithmetic | .checked_add/sub/mul/div throughout | All math operations | Returns error on overflow |
| K-invariant | new_k >= old_k post-swap | AMM math.rs | Proptest 10K iterations |
| Dead stake | 1M base units at init | Staking initialize | Prevents first-depositor attack |
| Canonical ordering | mint_a < mint_b enforced | AMM initialize_pool | Prevents duplicate pools |
| EpochState spoofing | Owner + discriminator + initialized check | Tax Program reads | 3-layer validation |
| Vault substitution | constraint = vault.key() == pool.vault_a | AMM swap accounts | Direct pubkey comparison |
| Token program validation | constraint = token_program.key() == pool.token_program_a | AMM swap accounts | Stored at init |
| Transfer hook enforcement | Always transfer_checked, never transfer | AMM/Staking helpers | Manual CPI construction |
| Wallet cap (bonding) | ATA balance check, 20M token limit | Bonding curve purchase | Per-purchase validation |
| Sell tax escrow | 15% held in separate PDA | Bonding curve sell | Separate from SOL vault |
| Atomic graduation | Both curves must fill | prepare_transition | Partner status check |
| Deadline enforcement | slot > deadline + grace buffer | mark_failed | Permissionless trigger |

---

## PDA Derivation Summary (24 PDA types)

| PDA | Seeds | Program | Instances |
|-----|-------|---------|-----------|
| AdminConfig | ["admin"] | AMM | 1 |
| PoolState | ["pool", mint_a, mint_b] | AMM | 2 |
| VaultA/B | ["vault", pool, "a"/"b"] | AMM | 4 |
| SwapAuthority* | ["swap_authority"] | Tax | 1 (cross-program) |
| TaxAuthority* | ["tax_authority"] | Tax | 1 (cross-program) |
| WsolIntermediary | ["wsol_intermediary"] | Tax | 1 |
| WhitelistAuthority | ["authority"] | Hook | 1 |
| WhitelistEntry | ["whitelist", address] | Hook | 14 |
| ExtraAccountMetaList | ["extra-account-metas", mint] | Hook | 3 |
| EpochState | ["epoch_state"] | Epoch | 1 |
| CarnageFundState | ["carnage_fund"] | Epoch | 1 |
| CarnageSolVault | ["carnage_sol_vault"] | Epoch | 1 |
| CarnageCrime/FraudVault | ["carnage_*_vault"] | Epoch | 2 |
| CarnageSigner* | ["carnage_signer"] | Epoch | 1 (cross-program) |
| StakingAuthority* | ["staking_authority"] | Epoch | 1 (cross-program) |
| StakePool | ["stake_pool"] | Staking | 1 |
| EscrowVault | ["escrow_vault"] | Staking | 1 |
| StakeVault | ["stake_vault"] | Staking | 1 |
| UserStake | ["user_stake", user] | Staking | unbounded |
| VaultConfig | ["vault_config"] | Vault | 1 |
| VaultTokenAccounts | ["vault", mint] | Vault | 3 |
| CurveState | ["curve", mint] | Bonding | 2 |
| CurveTokenVault | ["curve_token_vault", mint] | Bonding | 2 |
| CurveSolVault | ["curve_sol_vault", mint] | Bonding | 2 |
| TaxEscrow | ["tax_escrow", mint] | Bonding | 2 |

**Total: ~42 singleton + unbounded UserStake + 8 bonding curve accounts**

---

## Test Infrastructure

| Category | Files | Coverage Area |
|----------|-------|---------------|
| Anchor integration | tests/integration/*.test.ts | Lifecycle, CPI chains, access control, carnage, smoke |
| Security tests | tests/security.ts, tests/security-account-validation.ts | Account substitution, unauthorized access |
| Staking isolation | tests/staking.ts | Stake/unstake/claim |
| Token flow | tests/token-flow.ts | Transfer hook + whitelist |
| Rust unit tests | programs/*/tests/*.rs | Pool init, swap math, CPI access, transfer routing, refunds |
| Proptest | programs/*/src/*.rs (inline) | Math invariants, conservation laws |
| E2E devnet | scripts/e2e/*.ts | Smoke, carnage hunter, overnight runner |
| VRF validation | scripts/vrf/*.ts | Devnet VRF flow |

---

## Areas Requiring Focus

### High Risk
1. **Bonding Curve math.rs (75K lines)** - Large math module with 44 unwrap/expect calls. Linear curve arithmetic, precision scaling (1e12), and edge cases around curve completion boundaries need thorough review.
2. **CPI depth ceiling at 4** - Carnage path is permanently at Solana's CPI limit. Any accidental addition of CPI to this path would silently fail or cause runtime errors.
3. **Cross-program layout sync** - Tax Program's EpochStateReader must match EpochState byte-for-byte. Static assertions catch size drift but NOT field reordering.
4. **WSOL intermediary lifecycle** - 4-step atomic sequence (transfer, close, distribute, recreate) in swap_sol_sell. Failure partway through could strand SOL.
5. **Bonding curve sell-back** - Walking the curve backward with 15% tax. Sell refund math must be consistent with purchase math to prevent arbitrage.

### Medium Risk
6. **VRF timeout recovery** - Fresh randomness account may get same (broken) oracle. Gateway rotation proven not to work (MEMORY.md).
7. **Transfer Hook remaining_accounts partitioning** - Input hooks before output hooks in AMM, but Carnage sell+buy partitions [sell(4), buy(4)]. Client must construct correctly.
8. **Bounty rent bug (mitigated)** - trigger_epoch_transition checks vault_balance >= TRIGGER_BOUNTY without rent-exempt minimum. Crank auto-tops-up.
9. **Bonding curve deadline race** - Purchases landing after deadline but before mark_failed is called. Grace buffer (150 slots) mitigates.

### Low Risk (but noteworthy)
10. **UserStake never closed** - Permanent ~0.00114 SOL rent per user. No close instruction, by design.
11. **Legacy counters in CarnageFundState** - 4 write-only fields wasting space. Harmless.
12. **Feature-gated program IDs** - Mainnet placeholders are Pubkey::default(). Must be set before mainnet build.

---

## Open Questions

- [ ] Bonding curve math: Are there precision loss edge cases near TARGET_TOKENS boundary where the last purchase could overshoot?
- [ ] Can a user front-run mark_failed to purchase right before deadline, then claim_refund for arbitrage?
- [ ] What happens if both curves fill but prepare_transition is never called (admin key lost)?
- [ ] Is distribute_tax_escrow exploitable if called before Carnage SOL vault exists?
- [ ] Mainnet priority fees vs 0.001 SOL crank bounty -- is the bounty sufficient?
- [ ] Bonding curve sell: does selling reduce tokens_sold correctly to maintain curve integrity?

---

## Deployment Artifacts

| Artifact | Location | Purpose |
|----------|----------|---------|
| Devnet wallet | keypairs/devnet-wallet.json | 8kPzhQ... |
| ALT address | scripts/deploy/alt-address.json | 8Vv3Zs... (46 addresses) |
| Deploy pipeline | scripts/deploy/deploy-all.sh | 5-phase deployment |
| Initialize script | scripts/deploy/initialize.ts | Idempotent protocol init |
| Graduation script | scripts/graduation/graduate.ts | Bonding -> AMM transition |
| Crank runner | scripts/crank/crank-runner.ts | Epoch transitions |
| Mint keypairs | Generated at deploy Phase 0 | Build-before-deploy |

---

*Generated by CodeRecon on 2026-03-05. Based on codebase analysis of 7 on-chain programs, 59 Docs files, and supporting infrastructure.*
