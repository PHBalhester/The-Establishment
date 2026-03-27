---
topic: "Token Model"
topic_slug: "token-model"
status: complete
interview_date: 2026-02-20
decisions_count: 10
provides: ["token-model-decisions"]
requires: ["architecture-decisions"]
verification_items: []
---

# Token Model — Decisions

## Summary
The protocol uses a three-token system (CRIME, FRAUD, PROFIT) with fixed supplies, no emissions, and no team allocation. All yield is funded by real trading friction. The CRIME/FRAUD duality creates a soft peg via a fixed-rate conversion vault (100:1), generating persistent arbitrage volume. Token burns via Carnage are deflationary and self-correcting through AMM mechanics. All liquidity is permanent and protocol-owned.

## Decisions

### D1: Three-Token Duality
**Choice:** Three tokens — CRIME and FRAUD as mirrored "IP tokens" with asymmetric taxes, PROFIT as the yield-bearing bridge token.
**Rationale:** A soft peg requires two sides to create directional friction differentials. One taxed token has no "cheap path" to arbitrage. Two tokens with mirrored tax regimes (one cheap side, one expensive side) create a persistent arbitrage loop: buy cheap side (low buy tax) → convert through conversion vault (free, 100:1) → sell expensive side (low sell tax). PROFIT is the mechanical bridge that makes the peg work.
**Alternatives considered:** Single taxed token (no peg possible), two tokens without a bridge (no tax-free arbitrage path).
**Affects docs:** [token-economics-model, project-overview, token-interaction-matrix]

### D2: Fixed Supplies, Mint Authority Burned
**Choice:** 1,000,000,000 CRIME, 1,000,000,000 FRAUD, 20,000,000 PROFIT. All Token-2022 with 6 decimals. Mint authorities burned at initialization.
**Rationale:** Fixed supply ensures no inflation. Burning mint authority is the ultimate trust signal — the protocol cannot dilute holders. 20M PROFIT is allocated 100% to the conversion vault, creating a 100:1 ratio against IP tokens (100 CRIME/FRAUD = 1 PROFIT).
**Note (updated):** PROFIT supply was originally 50M (split 25M/25M across two AMM pools at 10:1 ratio). Reduced to 20M as part of the vault migration. See [DBS-base-profit-redesign.md](../DBS-base-profit-redesign.md).
**Alternatives considered:** Inflationary rewards (rejected — ponzinomics), adjustable supply (rejected — centralisation vector).
**Affects docs:** [token-economics-model, project-overview, data-model, deployment-sequence]

### D3: Zero Team/Treasury Token Allocation
**Choice:** No tokens reserved for team, investors, advisors, or future use. 100% of token supply is allocated to bonding curve sale (46%) and pool seeding (54%).
**Rationale:** Maximum decentralisation and trust. The team earns only through the 1% treasury tax split on ongoing trading volume, not through token holdings.
**Alternatives considered:** Team vesting schedule (rejected — centralisation concern for a fully immutable protocol).
**Affects docs:** [token-economics-model, project-overview, mainnet-readiness-assessment]

### D4: Bonding Curve Launch (CRIME and FRAUD)
**Choice:** 46% of each IP token sold via linear bonding curve. Target raise: 1,000 SOL per curve (2,000 SOL total). Start price 0.0000009 SOL/token, end price 0.00000345 SOL/token (~3.83x). 48-hour deadline with refunds. Per-wallet cap: 20M tokens. Privy whitelist required.
<!-- TODO: Privy removed in v1.1. Determine alternative whitelist verification method before mainnet. -->
**Rationale:** Linear curve provides predictable, auditable price discovery. End price constrained to match pool seeding price (no arbitrage gap at transition). Both curves must fill or both fail — atomic launch. Per-wallet caps + whitelist resist Sybil accumulation.
**Alternatives considered:** Fair launch (no price discovery), Dutch auction (more complex, less predictable), standard IDO (less fair distribution).
**Affects docs:** [token-economics-model, project-overview, frontend-spec, deployment-sequence]

### D5: PROFIT Acquisition Path
**Choice:** PROFIT has no bonding curve. 100% of PROFIT supply (20M) goes to the conversion vault. Users acquire PROFIT only by first acquiring CRIME or FRAUD, then converting through the fixed-rate conversion vault at 100:1 (100 CRIME or FRAUD = 1 PROFIT).
**Rationale:** Forces engagement with the core protocol. You can't have PROFIT without CRIME or FRAUD — thematically and mechanically intentional. The fixed-rate vault ensures PROFIT's price is deterministically linked to CRIME/FRAUD (PROFIT price = CRIME price x 100), eliminating the leverage amplification vulnerability that existed with AMM-based PROFIT pools.
**Alternatives considered:** Separate PROFIT sale (rejected — undermines the "profit requires crime/fraud" thesis). AMM-based PROFIT pools (rejected — leverage amplification vulnerability, see [DBS-base-profit-redesign.md](../DBS-base-profit-redesign.md)).
**Affects docs:** [token-economics-model, project-overview, frontend-spec]

### D6: Volume Sustainability Thesis (No Emissions)
**Choice:** All yield comes from real trading friction (taxes). No emissions, no inflation, no external subsidies. Three mechanical volume drivers sustain baseline activity:
1. Tax regime flips (75% chance every 30 min) create persistent arbitrage opportunities
2. Carnage events (~2/day) create large price dislocations that arb bots correct
3. The soft peg itself creates continuous CRIME↔FRAUD arbitrage via the conversion vault

**Rationale:** When organic trading dries up, mechanical arb maintains a volume floor. The system degrades gracefully to lower APYs rather than death-spiraling. This is the anti-ponzi thesis — the protocol can run indefinitely at any volume level, it just pays less yield when volume is low.
**Alternatives considered:** Emission-based rewards (rejected — ponzinomics, requires infinite growth), external revenue injection (rejected — centralisation).
**Affects docs:** [token-economics-model, project-overview, liquidity-slippage-analysis]

### D7: Deflationary Self-Correction
**Choice:** Carnage burns are permanent and may skew asymmetrically between CRIME and FRAUD (VRF-random target selection). The system self-corrects via AMM mechanics: if one token's supply shrinks faster, its AMM price rises, creating arb incentive to sell the expensive token and buy the cheap one, naturally rebalancing the peg.
**Rationale:** The constant-product AMM formula handles supply imbalances mechanically. No governance or intervention needed. The peg may drift but the arbitrage incentive prevents it from breaking.
**Alternatives considered:** Balanced burn enforcement (rejected — adds complexity, undermines randomness/chaos theme).
**Affects docs:** [token-economics-model, liquidity-slippage-analysis, token-interaction-matrix]

### D8: Permanent Protocol-Owned Liquidity
**Choice:** Both SOL liquidity pools (CRIME/SOL, FRAUD/SOL) are protocol-owned and permanent. No LP tokens exist. Nobody — including the deployer — can ever withdraw liquidity. LP fees (1% SOL pools) compound into pool reserves forever, deepening liquidity over time. The conversion vault is similarly permanent and immutable with zero fees.
**Rationale:** Permanent liquidity is the strongest trust signal. Users know the pools will always exist and grow deeper. Combined with burned mint authorities and burned upgrade authorities, this makes the protocol truly autonomous and unkillable.
**Note (updated):** Originally "four liquidity pools" with 0.5% LP fee on PROFIT pools. PROFIT AMM pools replaced by zero-fee conversion vault. See [DBS-base-profit-redesign.md](../DBS-base-profit-redesign.md).
**Alternatives considered:** LP tokens for pool contributors (rejected — liquidity withdrawal risk, rug pull vector), partial protocol-owned liquidity (rejected — half measures).
**Affects docs:** [token-economics-model, project-overview, security-model, liquidity-slippage-analysis]

### D9: Tax Distribution Split
**Choice:** 71% staking yield escrow, 24% Carnage fund, 5% treasury. Applied to all SOL pool taxes. The conversion vault is untaxed (zero fees).
**Rationale:** 71% to stakers provides strong yield incentive. 24% to Carnage funds the chaos/deflation mechanism. 5% treasury funds operational costs and marketing. The split is hardcoded on-chain and immutable post-burn.
**Note (updated):** Originally "75% staking / 24% Carnage / 1% treasury multisig" with "PROFIT pools are untaxed". Tax split updated to fund trigger bounty mechanism. PROFIT AMM pools replaced by conversion vault (zero fees by design, not by tax exemption).
**Alternatives considered:** Higher treasury cut (rejected — too extractive), zero treasury (rejected — need operational budget for infrastructure/marketing).
**Affects docs:** [token-economics-model, project-overview, operational-runbook]

### D10: Treasury Purpose
**Choice:** The 5% treasury split funds operational costs (infrastructure, RPC, monitoring) and marketing. Held in a Squads multisig.
**Rationale:** Minimal extraction from the protocol to cover real operational needs. The treasury is the only ongoing revenue source for the team since there is no team token allocation.
**Alternatives considered:** No treasury (rejected — need to fund operations somehow), higher percentage (rejected — too extractive for a decentralised protocol).
**Affects docs:** [token-economics-model, operational-runbook, security-model]

### D11: PROFIT Pool to Conversion Vault
**Choice:** Replace PROFIT AMM pools (CRIME/PROFIT and FRAUD/PROFIT constant product pools) with a fixed-rate conversion vault. Rate: 100 CRIME = 1 PROFIT = 100 FRAUD, permanent and immutable. Zero conversion fees.
**Rationale:** Analysis revealed a critical leverage amplification vulnerability in constant product PROFIT pools. As pool ratios drifted from the starting 10:1 toward extreme values (100:1+), PROFIT holders could extract disproportionate amounts of CRIME/FRAUD and dump into SOL pools, draining real liquidity at 3-8x amplification. This is inherent to all AMM curves — StableSwap and CLMM variants made it worse, not better. The fixed-rate vault eliminates leverage entirely (amplification = 1.0x at every buyout level).
**Affects docs:** [token-economics-model, architecture, liquidity-slippage-analysis, deployment-sequence]
**Full analysis:** See [DBS-base-profit-redesign.md](../DBS-base-profit-redesign.md)

## Open Questions
(None — all token model decisions are firm.)

## Raw Notes
- The phrase "you can't have PROFIT without CRIME or FRAUD" captures both the economic design and the thematic intent. Worth using in user-facing documentation.
- The graceful degradation thesis (lower volume = lower APY, not death spiral) is the key differentiator from emission-based yield farms. The Token Economics Model doc should lead with this.
- LP fee compounding means pool depth grows monotonically. Over time, Carnage swaps have progressively less price impact. This is generally positive (less slippage for users) but means Carnage's "chaos" effect diminishes as pools mature. This is a natural evolution, not a bug.
- The 100:1 IP-to-PROFIT conversion rate (100 CRIME/FRAUD = 1 PROFIT) is fixed permanently in the conversion vault. PROFIT price = CRIME price x 100 (deterministic, no AMM drift). This replaced the original 10:1 AMM pool ratio (250M IP : 25M PROFIT per pool) which was vulnerable to leverage amplification.
