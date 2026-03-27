# Installed AI Skills Guide

Skills installed from the [Solana Foundation's awesome-solana-ai](https://github.com/solana-foundation/awesome-solana-ai) repository, ranked by relevance to the Dr. Fraudsworth project. All skills are loaded automatically in Claude Code sessions.

> **Date installed:** 2026-03-05
> **Source:** awesome-solana-ai + sendaifun/skills + individual repos

---

## Tier 1: Core Infrastructure (Score 8-9)

### switchboard-skill (9/10)
**Source:** [sendaifun/skills/switchboard](https://github.com/sendaifun/skills/tree/main/skills/switchboard)
**What it does:** Complete Switchboard Oracle Protocol integration — price feeds, on-demand data, VRF randomness, Oracle Quotes, and Surge WebSocket streaming.

**Why we need it:** Switchboard VRF is the backbone of our epoch system (tax regime flips, Carnage triggers). We've had significant pain with gateway rotation bugs, timeout recovery, and oracle assignment issues. This skill gives Claude deep knowledge of the latest Switchboard APIs and patterns.

**When to use it:**
- Debugging VRF issues (commit/reveal failures, oracle assignment)
- Adding Switchboard Surge for real-time epoch state streaming (could replace polling)
- Implementing Oracle Quotes for sub-second latency data (90% cost reduction)
- Reviewing our VRF timeout recovery logic against latest best practices

---

### Solana Developer MCP (9/10)
**Status:** Already installed as `mcp__solana-mcp-server`
**What it does:** Model Context Protocol server maintained by Solana Foundation. Provides `Ask_Solana_Anchor_Framework_Expert`, `Solana_Documentation_Search`, and `Solana_Expert__Ask_For_Help`.

**Why we need it:** Every Solana/Anchor question I answer benefits from being able to query the latest documentation. This is already active and used automatically.

**When to use it:**
- Claude uses this automatically when answering Solana questions
- No action needed — already configured

---

### solana-dev-skill (8/10) — PRE-EXISTING
**Status:** Already installed as `solana-dev`
**Source:** [solana-foundation/solana-dev-skill](https://github.com/solana-foundation/solana-dev-skill)
**What it does:** End-to-end Solana development playbook — Anchor/Pinocchio programs, Solana Kit, LiteSVM/Mollusk testing, security checklists, wallet connections.

**Why we need it:** Foundation-level knowledge for all Anchor development. Already guides Claude's approach to our 6-program codebase.

**When to use it:**
- Already active in all sessions
- Reference for testing patterns (LiteSVM/Mollusk for unit tests)
- Security checklist validation before mainnet

---

### helius-skill (8/10)
**Source:** [sendaifun/skills/helius](https://github.com/sendaifun/skills/tree/main/skills/helius)
**What it does:** Comprehensive Helius integration — RPC nodes, DAS API, Enhanced Transactions, Priority Fees, Webhooks, ZK Compression, LaserStream gRPC, and the Helius SDK.

**Why we need it:** Helius is our RPC and webhook infrastructure. Priority fees are critical for mainnet (crank transactions need to land reliably). LaserStream gRPC could give us real-time event streaming.

**When to use it:**
- Setting up priority fee estimation for crank transactions (mainnet)
- Configuring LaserStream gRPC for real-time epoch/Carnage event monitoring
- Enhanced Transaction parsing for the frontend activity feed
- Webhook configuration for off-chain indexing improvements
- DAS API for any token metadata queries

---

### vulnhunter-skill (8/10)
**Source:** [sendaifun/skills/vulnhunter](https://github.com/sendaifun/skills/tree/main/skills/vulnhunter)
**What it does:** Security vulnerability detection and variant analysis. Hunts dangerous APIs, footgun patterns, error-prone configurations, and vulnerability variants.

**Why we need it:** We're explicitly not doing an external professional audit (OtterSec/Neodyme). Every additional security scanning tool adds a layer of confidence. Complements our existing SVK tools (SOS, DB, BOK).

**When to use it:**
- Pre-mainnet security sweep of all 6 programs
- After any CPI interface changes (our programs are heavily interconnected)
- Variant analysis: "if we found bug X in the AMM, does the same pattern exist in the tax program?"
- Dangerous API hunting across our 29K LOC Rust codebase

---

## Tier 2: Development & Security (Score 6-7)

### code-recon-skill (7/10)
**Source:** [sendaifun/skills/zz-code-recon](https://github.com/sendaifun/skills/tree/main/skills/zz-code-recon)
**What it does:** Deep architectural context building for security audits. Maps trust boundaries, analyzes vulnerability surfaces, builds context before hunting.

**Why we need it:** Our 6-program CPI architecture has complex trust boundaries (Tax -> AMM, Epoch -> Tax -> AMM, etc.). Understanding which PDAs trust which callers is critical for security. This skill maps those boundaries systematically.

**When to use it:**
- Before running vulnhunter or SOS — build architectural context first
- After adding new CPI paths (e.g., bonding curve -> AMM integration)
- Mapping which accounts are mutable across instruction boundaries
- Validating that PDA seeds + bump derivations are consistent

---

### solana-skills-plugin — Security Module (7/10)
**Source:** [tenequm/claude-plugins/solana/skills/solana-security](https://github.com/tenequm/claude-plugins/tree/main/solana/skills/solana-security)
**What it does:** Anchor/native Rust security auditing with vulnerability detection, attack vector analysis, and audit report generation.

**Why we need it:** Another security scanning perspective. Different tools catch different things. This one is specifically designed for Anchor programs, which is our exact stack.

**When to use it:**
- Complement SOS/DB audits with a third-party perspective
- Generate structured audit reports for documentation
- Cross-validate findings from vulnhunter

---

### jupiter-skill (7/10)
**Source:** [jup-ag/agent-skills/integrating-jupiter](https://github.com/jup-ag/agent-skills/tree/main/skills/integrating-jupiter)
**What it does:** Jupiter Ultra swaps, limit orders, DCA, perpetuals, lending, and token APIs.

**Why we need it:** Jupiter is Solana's dominant swap aggregator. For mainnet, our pools could be discoverable through Jupiter routing. The token API provides reliable price data. Ultra swaps could be relevant if we want to offer Jupiter-routed trading as an alternative path.

**When to use it:**
- Mainnet: investigate getting our AMM pools indexed by Jupiter
- Token API for price data display on the frontend
- Understanding how Jupiter routes affect our pool liquidity
- Potential future feature: Jupiter-routed limit orders for CRIME/FRAUD

---

### meteora-skill (6/10)
**Source:** [sendaifun/skills/meteora](https://github.com/sendaifun/skills/tree/main/skills/meteora)
**What it does:** Meteora DeFi SDK — liquidity pools, AMMs, bonding curves, vaults, token launches.

**Why we need it:** Meteora builds the exact same primitives we do (AMMs, bonding curves, vaults). Their implementation is production-tested on mainnet with significant TVL. Useful as a reference architecture.

**When to use it:**
- Cross-referencing our bonding curve design against Meteora's battle-tested implementation
- Learning from their vault patterns for our conversion vault
- Understanding how mainnet AMMs handle edge cases we might not have considered
- Launch mechanics reference for our 48-hour bonding curve

---

### solana-anchor-claude-skill (6/10)
**Source:** [quiknode-labs/solana-anchor-claude-skill](https://github.com/quiknode-labs/solana-anchor-claude-skill)
**What it does:** End-to-end Anchor + Solana Kit development, focusing on modern, minimal, readable code with native test runners or LiteSVM.

**Why we need it:** Provides a second perspective on Anchor best practices alongside solana-dev-skill. The emphasis on "minimal, readable code" aligns with our anti-over-engineering philosophy.

**When to use it:**
- When writing new Anchor instructions (bonding curve program)
- Alternative testing patterns with native JS test runners
- Code review: "is there a simpler way to write this?"

---

### Exo AI Audits (6/10)
**Status:** Web tool — NOT installable as a skill
**URL:** https://ai-audits.exotechnologies.xyz
**What it does:** AI-powered smart contract auditing specifically for Solana programs.

**Why we need it:** Free additional audit layer. Upload our programs and get another AI's perspective on vulnerabilities.

**When to use it:**
- Pre-mainnet: submit each of our 6 programs for review
- After major refactors
- Cross-validate against our SVK audit results

---

## Tier 3: Reference & Future Use (Score 5)

### pyth-skill (5/10)
**Source:** [sendaifun/skills/pyth](https://github.com/sendaifun/skills/tree/main/skills/pyth)
**What it does:** Pyth Network oracle — real-time price feeds with confidence intervals and EMA prices.

**Why we need it:** We use Switchboard for VRF, but Pyth could provide SOL/USD price feeds for the frontend (showing dollar values) or for future features requiring external price data.

**When to use it:**
- Adding USD price display on the frontend trading terminal
- If we ever need external price verification for our AMM pools
- Potential arbitrage bot documentation showing price feed integration

---

### raydium-skill (5/10)
**Source:** [sendaifun/skills/raydium](https://github.com/sendaifun/skills/tree/main/skills/raydium)
**What it does:** Raydium Protocol — CLMM, CPMM, AMM pools, LaunchLab token launches, farming, Trade API.

**Why we need it:** Raydium's CPMM is the same constant-product model we forked. Their LaunchLab token launches are a reference for our bonding curve. The Trade API could provide useful analytics.

**When to use it:**
- Comparing our AMM edge cases against Raydium's production CPMM
- LaunchLab reference for our bonding curve launch mechanics
- Trade API for potential analytics integration

---

### solana-kit-skill (5/10)
**Source:** [sendaifun/skills/solana-kit](https://github.com/sendaifun/skills/tree/main/skills/solana-kit)
**What it does:** Complete guide for @solana/kit — the modern, tree-shakeable, zero-dependency JavaScript SDK from Anza.

**Why we need it:** @solana/web3.js v1 is deprecated. We'll need to migrate eventually. This skill prepares Claude to write new client code using the modern SDK.

**When to use it:**
- When writing NEW client code (consider using @solana/kit instead of web3.js)
- Planning the migration from web3.js v1.x
- Understanding the new SDK patterns (tree-shaking, RPC subscriptions)

---

### solana-kit-migration-skill (5/10)
**Source:** [sendaifun/skills/solana-kit-migration](https://github.com/sendaifun/skills/tree/main/skills/solana-kit-migration)
**What it does:** Migration guide from @solana/web3.js v1.x to @solana/kit — API mappings, edge cases, common pitfalls.

**Why we need it:** Our entire frontend + scripts (~32K LOC TypeScript) use web3.js v1. When we migrate, this skill maps every API change.

**When to use it:**
- When we decide to migrate (likely post-mainnet launch for stability)
- Understanding which web3.js APIs have 1:1 equivalents vs need refactoring
- These two skills (solana-kit + solana-kit-migration) work best together

---

### octav-api-skill (5/10)
**Source:** [Octav-Labs/octav-api-skill](https://github.com/Octav-Labs/octav-api-skill)
**What it does:** Octav API — portfolio tracking, transaction history, DeFi positions, token analytics.

**Why we need it:** Could power analytics/dashboard features on our frontend. Transaction history for users to see their trades, staking positions, and yield earned.

**When to use it:**
- Building a transaction history view in the frontend
- Portfolio tracking for users (staked PROFIT, SOL yield earned)
- Token analytics for the trading terminal (volume, price history)

---

## Installation Summary

| Skill | Directory | Lines | Status |
|-------|-----------|-------|--------|
| switchboard-skill | `.claude/skills/switchboard-skill/` | 437 | Installed |
| Solana Developer MCP | MCP server | — | Pre-existing |
| solana-dev | `.claude/skills/solana-dev/` | — | Pre-existing |
| helius-skill | `.claude/skills/helius-skill/` | 680 | Installed |
| vulnhunter-skill | `.claude/skills/vulnhunter-skill/` | 307 | Installed |
| code-recon-skill | `.claude/skills/code-recon-skill/` | 487 | Installed |
| solana-skills-plugin | `.claude/skills/solana-skills-plugin/` | 325 | Installed |
| jupiter-skill | `.claude/skills/jupiter-skill/` | 368 | Installed |
| meteora-skill | `.claude/skills/meteora-skill/` | 1479 | Installed |
| solana-anchor-claude-skill | `.claude/skills/solana-anchor-claude-skill/` | 360 | Installed |
| pyth-skill | `.claude/skills/pyth-skill/` | 545 | Installed |
| raydium-skill | `.claude/skills/raydium-skill/` | 326 | Installed |
| solana-kit-skill | `.claude/skills/solana-kit-skill/` | 509 | Installed |
| solana-kit-migration-skill | `.claude/skills/solana-kit-migration-skill/` | 346 | Installed |
| octav-api-skill | `.claude/skills/octav-api-skill/` | 401 | Installed |

**Total new skills installed:** 12
**Pre-existing skills confirmed:** 3 (solana-dev, Solana Developer MCP, plus existing SVK security suite)

## Recommended Usage Patterns

### Pre-Mainnet Security Sweep
Run in this order:
1. **code-recon-skill** — Map trust boundaries and architectural context
2. **vulnhunter-skill** — Hunt vulnerabilities with context from step 1
3. **solana-skills-plugin** — Anchor-specific security audit
4. **Exo AI Audits** (web) — External AI audit for cross-validation
5. Existing SVK tools (SOS, DB) — Full adversarial audit

### Building New Features (e.g., Bonding Curve)
- **solana-dev** + **solana-anchor-claude-skill** — Anchor patterns
- **meteora-skill** — Reference bonding curve implementation
- **switchboard-skill** — If VRF integration is involved

### Mainnet Preparation
- **helius-skill** — Priority fees, LaserStream gRPC, webhook tuning
- **jupiter-skill** — Pool discoverability, routing integration
- **solana-kit-skill** + **migration-skill** — Plan SDK migration timeline

### Analytics & Frontend
- **octav-api-skill** — Transaction history, portfolio tracking
- **pyth-skill** — USD price display
- **helius-skill** — Enhanced transaction parsing for activity feeds
