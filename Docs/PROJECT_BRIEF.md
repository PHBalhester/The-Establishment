---
project: "Dr. Fraudsworth's Finance Factory"
status: interview_complete
mode: existing
created: 2026-02-20
updated: 2026-02-20
topics_completed: [architecture, token-model, account-structure, cpi-architecture, amm-design, security, frontend, operations, error-handling, testing]
topics_remaining: []
---

# Dr. Fraudsworth's Finance Factory — Project Brief

## Vision
A Solana DeFi protocol using asymmetric taxation, VRF-driven Carnage events, and a three-token system (CRIME/FRAUD/PROFIT) to generate persistent trading volume and real SOL game rewards without ponzinomics.

## Scope
- **In scope (v1):** 6 on-chain programs (AMM, Tax, Epoch/VRF, Staking, Transfer Hook, Conversion Vault), Next.js frontend (swap/stake/dashboard), continuous devnet operation, mainnet deployment
- **Out of scope:** Bonding curve program, governance/DAO, mobile app, cross-chain bridges

## Architecture
- **Stack:** Anchor/Rust on-chain (6 programs, ~28.7K LOC), Next.js 16 frontend (~32.3K LOC), PostgreSQL (Drizzle ORM), Solana wallet-adapter (external wallets), Helius webhooks
- **Components:** AMM SOL pools, asymmetric tax orchestrator, VRF epoch state machine + Carnage fund, PROFIT staking with SOL game rewards, Token-2022 transfer hooks with whitelist, Conversion Vault (CRIME/FRAUD <-> PROFIT)
- **Key pattern:** CPI-composed programs (depth-4 CPI chains), CEI ordering, protocol-wide Address Lookup Table, Switchboard VRF randomness

## Decisions
- [token] Token-2022 for CRIME/FRAUD (transfer hooks), SPL Token for WSOL
- [tax] 71/24/5 tax distribution (staking/Carnage fund/treasury)
- [vrf] Switchboard on-demand VRF with timeout recovery (not gateway rotation)
- [frontend] Zero-dependency Sentry (no @sentry/* packages — breaks Turbopack)
- [hooks] 4 extra accounts per mint for Token-2022 transfer hook validation
- [tx] v0 VersionedTransaction with ALT for oversized Sell path (23 + 8 accounts)
- [scope] Per-doc decision on including planned-but-unbuilt features
- [arch] 6-program split: Token-2022 hook requirement + BPF size limits + upgrade isolation + Conversion Vault leaf node
- [arch] Full immutability: all 6 programs burn upgrade authority post-mainnet
- [arch] Tiered timelock: 2hr at launch → 24hr after 48-72hrs → burn after 2-4 weeks
- [arch] Squads multisig (2-of-3) holds upgrade authority during timelock period
- [arch] No emergency pause — decentralisation over intervention
- [token] 1B CRIME, 1B FRAUD, 20M PROFIT — all fixed supply, mint authorities burned
- [token] Zero team/treasury token allocation — 100% to curve sale (46%) + pool seeding (54%)
- [token] PROFIT only acquirable via CRIME/FRAUD conversion vault (fixed-rate 100:1) — no direct sale
- [token] Bonding curve launch: 500 SOL raise per IP token, linear price, 48hr deadline
- [token] Permanent protocol-owned liquidity, no LP tokens, LP fees compound forever
- [token] Volume floor thesis: mechanical arb sustains baseline volume, graceful APY degradation
- [token] Carnage deflation self-corrects via AMM mechanics — no governance needed
- [token] 5% treasury funds operational costs and marketing only
- [accounts] Minimal on-chain state — derive all analytics off-chain, no new stat fields
- [accounts] Canonical mint ordering enforced on-chain (mint_a < mint_b)
- [accounts] UserStake persists forever (not closed on full unstake)
- [accounts] No account versioning — layouts are final (burn means no migrations)
- [cpi] Depth-4 permanently maxed on all swap paths — no expansion possible or needed
- [cpi] Acyclic CPI graph — reentrancy structurally impossible, AMM guard is defense-in-depth
- [cpi] Manual CPI for Token-2022 hooks (Anchor doesn't forward remaining_accounts)
- [cpi] swap_exempt is Carnage-exclusive — bonding curve is separate from tax/AMM
- [amm] Tax-agnostic pure swap primitive — all economic complexity in Tax Program
- [amm] Fork of solana-uniswap-v2: stripped LP tokens/flash loans/TWAP, added T22/access control
- [amm] Fixed fees: 100 bps SOL pools — conversion vault uses fixed 100:1 rate (0 bps fee)
- [amm] LP fees compound into reserves permanently — pools only get deeper
- [amm] No flash loans/TWAP — emergent MEV resistance via simplicity + tax friction
- [amm] Full bonding curve proceeds seed SOL pools — price continuity at launch
- [security] 5 actor types: users, deployer (pre-burn), crank bot, arb bots, attackers
- [security] AMM admin + whitelist authority burned before upgrade authority burn
- [security] Burn sequence: whitelist auth → AMM admin → tiered timelock → upgrade auth burn
- [security] Sandwich resistance: dual-layer slippage (user + 50% protocol floor) + tax poison pill
- [security] Carnage front-running: atomic path (no window) + fallback 75% slippage floor
- [security] VRF ~3-slot reveal window accepted — arb is desired behaviour
- [security] Transfer hook bypass fully mitigated (transfer_checked only, multi-layer validation)
- [security] Graceful degradation: crank death = stale rates, no fund locks, permissionless recovery
- [security] SVK tooling for auditing, no external auditor, no bug bounty
- [security] Post-burn incident response: users exit, no intervention possible
- [frontend] Single interactive steampunk factory scene — no page navigation, all modals
- [frontend] Layered PNG hotspots: 7 clickable elements → 6 unique modals (swap+chart combined)
- [frontend] Desktop-first, mobile TBD (landscape scene doesn't suit portrait)
- [frontend] Settings: wallet export, explorer pref, priority fee presets, SOL/USD toggle
- [frontend] Nextra docs site deployed separately, linked from in-app "How It Works"
- [frontend] Hook-based state management (no Redux/Zustand), DashboardGrid pattern

- [ops] Crank bot on Railway (same instance as frontend), single instance, built-in container restart
- [ops] Sentry errors + Sentry Crons heartbeat for monitoring (zero-dependency, no npm packages)
- [ops] 1 SOL manual seed for crank bot, bounties sustain gas — priority fee vs bounty needs mainnet validation
- [ops] Single Helius plan for all RPC (crank + frontend + dev), free tier through ~600 DAU
- [ops] RPC polling fix: 91% credit reduction — webhook for Carnage events, network-aware intervals (devnet/mainnet config), dev-mode guard
- [ops] Infra costs: ~$8/mo at launch, ~$75/mo at 1K DAU, ~$550/mo at 10K DAU

- [errors] Distributed error handling — no unified catalog, each program's errors.rs is source of truth
- [errors] Client-side error mapping only — no on-chain CPI error wrapping (immutable programs, flexible frontend)
- [errors] Epoch/Hook errors unmapped on frontend — generic fallback sufficient for crank-only errors
- [errors] Carnage empty-vault = graceful no-op, self-corrects as tax fees accumulate — document for operators
- [errors] Crank catch-up procedure: sequential epoch advancement, ~3 TX per missed epoch, rewards accumulate safely

- [testing] Lightweight GitHub Actions CI on push to main — all local-validator tests
- [testing] Three-tier tests: Fast (cargo test) + Medium (LiteSVM) + Slow (anchor test) in CI; Live (devnet) manual-only
- [testing] Devnet tests are manual validation runbooks, not automated regression
- [testing] Philosophy-based coverage: critical paths tested, no percentage target
- [testing] Formal pre-mainnet checkpoint: all suites green + devnet validation + SVK findings addressed before burn

## Open Questions
- Mainnet deployment timeline and checklist completion
- Bonding curve scope and priority
- Smart swap routing specification (Phase 52)
- Mainnet priority fee economics vs 0.001 SOL crank bounty
