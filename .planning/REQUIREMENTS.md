# Requirements: Dr. Fraudsworth's Finance Factory

**Defined:** 2026-03-25
**Core Value:** Real SOL yield from real trading friction -- not ponzinomics.

## v1.5 Requirements

Requirements for v1.5 Post-Launch Hardening & Expansion. Each maps to roadmap phases.

### Crank Operations

- [ ] **CRANK-01**: Crank closes recovery-path randomness accounts immediately after VRF consumption (not deferred to startup sweep)
- [ ] **CRANK-02**: Crank startup sweep catches and closes any stale randomness accounts from prior runs
- [ ] **CRANK-03**: Switchboard mainnet gateway reliability investigated with documented findings (oracle topology, failover options, 503 error patterns) and VRF instrumentation collecting per-epoch metrics
- [ ] **CRANK-04**: Crank implements improved retry/timeout handling based on gateway research findings
- [ ] **CRANK-05**: Crank health monitoring with Telegram alert on circuit breaker trip (5 consecutive crank errors)

### Vault Convert-All

- [ ] **VAULT-01**: Conversion Vault has `convert_v2` instruction with sentinel value (`amount_in=0` reads user's on-chain balance)
- [ ] **VAULT-02**: `convert_v2` includes `minimum_output` parameter for on-chain slippage protection
- [ ] **VAULT-03**: Existing `convert` instruction continues to work unchanged (backwards compatible)
- [ ] **VAULT-04**: Multi-hop builder passes `amount_in=0` for vault steps in multi-hop routes
- [ ] **VAULT-05**: Large multi-hop swaps (40+ SOL) simulate cleanly in wallet previews (no Blowfish "malicious" flag)
- [ ] **VAULT-06**: Split route SOL<->PROFIT (4-step) works without intermediate token leakage

### Jupiter/Aggregator Readiness

- [ ] **JUP-01**: Rust SDK crate (`sdk/jupiter-adapter/`) implements Jupiter `Amm` trait with all 10 required methods
- [ ] **JUP-02**: SDK quotes replicate on-chain math exactly (AMM constant-product + dynamic tax rates from EpochState)
- [ ] **JUP-03**: SDK returns correct account metas for Tax Program swap instructions (20-21 named + 4 hook accounts per T22 mint)
- [ ] **JUP-04**: SDK pre-computes all transfer hook accounts from deterministic PDA seeds (zero network calls)
- [ ] **JUP-05**: SDK handles all 4 SOL pool swap directions (buy/sell x CRIME/FRAUD)
- [ ] **JUP-06**: SDK handles vault-based PROFIT acquisition for all 4 directions (CRIME->PROFIT, PROFIT->CRIME, FRAUD->PROFIT, PROFIT->FRAUD) via Conversion Vault at fixed 100:1 rate
- [ ] **JUP-07**: Integration documentation published for Jupiter team submission
- [ ] **JUP-08**: IDLs published to discoverable location for external integrators

## v1.6 Requirements (Deferred)

### USDC Pools

- **USDC-01**: CRIME/USDC and FRAUD/USDC pool initialization in existing AMM
- **USDC-02**: Tax routing for USDC pools (new Tax-USDC program or Tax Program extension -- approach TBD)
- **USDC-03**: USDC tax-to-SOL conversion pipeline for staking rewards
- **USDC-04**: Whitelist additions for new USDC pool vaults
- **USDC-05**: ALT extension for USDC pool accounts
- **USDC-06**: Frontend routing engine updates for USDC pairs
- **USDC-07**: USDC Carnage fund denomination decision and implementation

### Future (v2+)

- Protocol-owned arbitrage (Carnage Fund capture -- needs 2-4 weeks mainnet data)
- Progressive timelock extension (1hr -> 24hr)
- Immunefi bug bounty program
- External audit funded from protocol revenue
- Futarchy rebalancing (four-pool prediction market)

## Out of Scope

| Feature | Reason |
|---------|--------|
| ORAO VRF backup oracle | Only build if Switchboard proves unreliable over months of mainnet operation |
| Custom Jupiter on-chain program | Jupiter calls existing Tax Program -- adapter is off-chain SDK only |
| Permissionless pool creation | Protocol is a curated ecosystem, admin-only via Squads |
| Removing taxes for Jupiter routes | Taxes ARE the yield source -- the product, not an obstacle |
| Gateway rotation for VRF | Each randomness account is bound to a specific oracle (error 0x1780). Use timeout recovery instead. |
| Multi-token pools (3+ assets) | Thin liquidity, complex math. Independent 2-token pools + routing is better. |
| USDC pools in v1.5 | Deferred to v1.6 -- 4+ unresolved design decisions, highest complexity |
| CRIME<->FRAUD direct vault swap | On-chain `compute_output_with_mints` returns `InvalidMintPair`. Jupiter routes CRIME->PROFIT->FRAUD via multi-hop instead. |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CRANK-01 | Phase 105 | Pending |
| CRANK-02 | Phase 105 | Pending |
| CRANK-03 | Phase 105 | Pending |
| CRANK-04 | Phase 105 | Pending |
| CRANK-05 | Phase 105 | Pending |
| VAULT-01 | Phase 106 | Pending |
| VAULT-02 | Phase 106 | Pending |
| VAULT-03 | Phase 106 | Pending |
| VAULT-04 | Phase 106 | Pending |
| VAULT-05 | Phase 106 | Pending |
| VAULT-06 | Phase 106 | Pending |
| JUP-01 | Phase 107 | Pending |
| JUP-02 | Phase 107 | Pending |
| JUP-03 | Phase 107 | Pending |
| JUP-04 | Phase 107 | Pending |
| JUP-05 | Phase 107 | Pending |
| JUP-06 | Phase 107 | Pending |
| JUP-07 | Phase 107 | Pending |
| JUP-08 | Phase 107 | Pending |

**Coverage:**
- v1.5 requirements: 19 total
- Mapped to phases: 19
- Unmapped: 0

---
*Requirements defined: 2026-03-25*
*Last updated: 2026-03-26 -- JUP-03 and JUP-06 updated to reflect vault-based PROFIT (no PROFIT AMM pools) and verified account counts*
