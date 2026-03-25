# Bonding Curve Pitfalls: Buy + Sell Mechanics on Solana

**Domain:** Bonding curve launch system with sell-back mechanics for an existing 6-program DeFi protocol
**Researched:** 2026-03-03
**Overall confidence:** MEDIUM (analysis based on codebase review + training data; WebSearch unavailable for live exploit verification)

**Critical context:** The existing `Bonding_Curve_Spec.md` specifies "Buy-only (no selling back to curve)" as a hard constraint. Adding sell mechanics is a design evolution that introduces a fundamentally different attack surface. Every pitfall below is specific to the buy+sell design and would not exist under buy-only.

**Source hierarchy for this document:**
- HIGH confidence: Direct analysis of existing codebase (transfer hooks, AMM math, tax math, whitelist, CPI depth)
- MEDIUM confidence: Cross-referencing known Solana patterns against training data (pre-May 2025)
- LOW confidence: Claims about pump.fun/moonshot exploits (training data only, could not verify)

---

## Critical Pitfalls

Mistakes that cause fund loss, drain exploits, or require full rewrite.

---

### PITFALL C-1: SOL Vault Insolvency from Sell-Back

**Severity:** CRITICAL
**Likelihood:** HIGH (if not designed for from day one)

**What goes wrong:** With buy-only curves, `sol_raised` always equals the sum of all SOL deposited -- simple accounting. With sell-back, users extract SOL from the vault. If the sell price calculation does not perfectly mirror the buy price integral, rounding errors accumulate. After many buy/sell cycles, the vault can hold less SOL than the curve math believes it should. At graduation, the vault cannot fund the 1,000 SOL pool seeding because SOL has leaked through rounding.

**Why it happens:** The linear curve uses a quadratic formula to compute tokens per SOL on buy. The inverse operation (SOL per tokens on sell) requires a different integral path. Integer division truncation favors the protocol on buy (user gets slightly fewer tokens) but can favor the user on sell (user gets slightly more SOL) if the rounding direction is not carefully controlled.

**Specific math risk with Dr. Fraudsworth's curve:**
```
P(x) = P_start + (P_end - P_start) * x / 460M

Buy integral: SOL = integral from x1 to x2 of P(x)dx
  = (P_end - P_start)/(2 * 460M) * (x2^2 - x1^2) + P_start * (x2 - x1)

Sell integral: same formula, but solving for SOL returned given tokens_returned
```
With u64/u128 integer arithmetic at 1e12 precision scaling, each buy/sell cycle can leak up to 1 lamport. Over 100K transactions, this is 0.0001 SOL -- negligible. But with adversarial rapid buy/sell cycling at rounding boundaries (buying minimum amounts, selling immediately), the leak rate per TX can be higher.

**Consequences:**
- Vault holds 999.97 SOL when graduation expects 1,000 SOL
- Graduation TX fails
- Users panic, curve potentially times out, triggering refund path
- Refund path may also be insolvent (refunding more SOL than vault holds)

**Prevention:**
1. **Always round against the user on sell.** Sell computation: `SOL_returned = floor(integral)`, never ceiling. Buy computation: `tokens_out = floor(integral)`, as currently specced.
2. **Track `sol_vault_balance` independently of curve math.** The vault's actual lamport balance is the source of truth, not `sol_raised - sol_refunded`.
3. **Cap sell refund at vault balance minus rent-exempt minimum.** Never allow a sell that would drain below rent-exempt.
4. **Enforce: sum(all_sell_returns) <= sum(all_buy_deposits) - rent_exempt_minimum.** This is the master invariant.
5. **Property test:** 10,000 random buy/sell sequences, verify vault_balance >= expected_balance at every step.

**Warning signs:** Unit tests pass but proptest finds insolvency after 500+ cycles at small amounts.

**Test case:** Buy minimum (0.05 SOL) 1000 times, sell all tokens back. Verify vault holds >= 0 SOL (after rent) and <= total_deposited.

**Phase:** Core math implementation (first phase). Must be proven correct before any other work.

---

### PITFALL C-2: Sell-Side Sandwich / MEV Extraction

**Severity:** CRITICAL
**Likelihood:** HIGH (Solana MEV is well-established)

**What goes wrong:** With buy+sell curves, MEV bots can sandwich user purchases:
1. Bot buys large amount on curve (price increases along linear curve)
2. User's buy TX executes at higher price (gets fewer tokens)
3. Bot sells tokens back to curve at a profit (since they bought at lower average price)

Unlike constant-product AMMs where the 18% round-trip tax makes sandwiching uneconomical, **the bonding curve has no sell tax initially** (the 15% sell tax is escrowed separately). If the sell tax is not deducted BEFORE computing the SOL return, the bot can extract value.

**Why this is worse than AMM sandwiching:**
- Linear curve price impact is predictable and calculable (unlike AMM where impact depends on reserves)
- Bot can calculate exact profit before submitting
- No LP fee on the curve to eat into margins
- If sell returns pre-tax SOL and tax is taken separately, the bot gets full curve value back

**Consequences:**
- Users get significantly fewer tokens for their SOL
- Early buyers who sell and rebuy can manipulate their cost basis
- Protocol reputation damage
- Worst case: bot extracts meaningful SOL from the pool if sell returns are generous

**Prevention:**
1. **Deduct 15% sell tax BEFORE computing SOL return.** User sells 100 tokens, 85 tokens worth of SOL is returned, 15 tokens worth of SOL goes to escrow. This makes sandwiching a net loss.
2. **Implement user-specified `minimum_tokens_out` on buy.** Slippage protection. If fewer tokens than expected (due to front-running), TX reverts.
3. **Implement user-specified `minimum_sol_out` on sell.** Same for sell direction.
4. **Consider a small per-transaction fee or cooldown.** Even 0.1% applied at the curve level makes rapid cycling unprofitable for bots.
5. **Protocol-level slippage floor** (like the existing 50% floor in `MINIMUM_OUTPUT_FLOOR_BPS`). For the curve, a tighter floor (90-95%) may be appropriate since the curve is deterministic.
6. **Priority fee awareness:** Solana's local fee markets mean MEV bots must pay priority fees. Ensure the curve's slippage protection is tight enough that the required priority fee exceeds the extractable value.

**Warning signs:** Large buys followed by immediate sells from the same wallet in the first hour.

**Test case:** Simulate sandwich: bot buys 10 SOL, user buys 1 SOL, bot sells all tokens. Verify bot nets negative SOL after sell tax.

**Phase:** Core sell instruction design. Must be addressed in the architecture phase, not bolted on later.

---

### PITFALL C-3: Coupled Graduation Grief Attack

**Severity:** CRITICAL
**Likelihood:** MEDIUM (requires attacker with meaningful capital, but the incentive exists)

**What goes wrong:** Both curves must graduate for transition. An attacker who wants the launch to fail can:

1. **Fill one curve, grief the other:** Buy heavily on CRIME curve (helping it fill), while avoiding or actively discouraging FRAUD purchases. If CRIME fills but FRAUD doesn't by 48 hours, both fail. The attacker gets a full SOL refund on their CRIME purchases. The attacker's cost is zero (ignoring opportunity cost and failed TX fees).

2. **Sell-back grief (new with sell mechanics):** If sell is enabled, an attacker can repeatedly buy and sell on FRAUD to consume block space and create the impression of activity, while actually preventing the curve from progressing. Or worse: buy on FRAUD to push it toward graduation, then sell everything at hour 47 to crash FRAUD back to zero progress.

3. **Strategic failure for refund tax recovery:** The 15% sell tax is escrowed. On failure, the spec says "SOL + tax -> proportional refund by token holdings." If the attacker can force failure, they get back both their purchase SOL AND the sell tax they were charged -- effectively a free round-trip.

**Why it's specific to coupled dual curves with sell:**
- Buy-only with no sell: Grief requires holding capital for 48 hours with no return. Expensive.
- Buy+sell: Attacker can sell back, reducing their capital-at-risk to just the sell tax. If tax is refunded on failure, cost is zero.
- Coupled graduation amplifies this: only need to grief ONE curve to kill both.

**Consequences:**
- Protocol never launches
- Community confidence destroyed
- Legitimate buyers who contributed to the filled curve lose 48 hours of locked capital
- If repeated launch attempts are possible, attacker can grief indefinitely

**Prevention:**
1. **Do NOT refund sell tax on failure.** Sell tax is a cost of trading. Refunding it on failure creates a perverse incentive to force failure. The escrowed tax should be burned or sent to treasury on failure.
2. **Sell reduces your token balance (and thus your refund claim).** After sell, `participant.tokens_purchased` decreases. Refund proportional to current holdings, not peak holdings.
3. **Consider making sell tax non-refundable under ALL circumstances.** This makes grief-selling expensive.
4. **One-way latch near graduation:** Once a curve passes 90% (900 SOL), disable selling. This prevents last-minute dump attacks.
5. **Consider independent graduation:** Even if FRAUD fails, CRIME graduates to a smaller pool. This is a design change but eliminates the coupled grief vector entirely.
6. **Monitor for unusual sell patterns** in the final 6 hours. Alert/pause mechanism (if admin isn't burned yet during launch).

**Warning signs:** Large buys concentrated on one curve only. Large sells near the deadline.

**Test case:** Attacker buys 500 SOL on CRIME curve, sells 500 SOL back at hour 47. Verify: (a) sell tax is NOT refunded to attacker, (b) attacker's refund claim is proportional to remaining tokens, (c) CRIME curve progress decreased correctly.

**Phase:** Spec/design phase. This is an architectural decision that affects the entire refund mechanism.

---

### PITFALL C-4: Refund Mechanism Solvency

**Severity:** CRITICAL
**Likelihood:** HIGH (if sell mechanics not carefully integrated with refund)

**What goes wrong:** The refund mechanism refunds SOL proportional to token holdings. With buy+sell, the accounting is complex:

1. User A buys 100 SOL worth of tokens (gets X tokens)
2. User A sells 50 SOL worth of tokens back (returns Y tokens, gets 42.5 SOL back after 15% tax)
3. Curve fails
4. User A claims refund

**Question:** How much does User A get refunded?
- Option 1: `participant.sol_spent` (100 SOL minus 42.5 SOL returned = 57.5 SOL). But the vault has less than 57.5 SOL allocated to User A because they already took 42.5 back.
- Option 2: Proportional to current token holdings. User A holds (X - Y) tokens out of total_supply. Refund = vault_balance * (X - Y) / total_tokens_in_circulation.
- Option 3: Per the current spec, `refund_amount = participant.sol_spent`. This is WRONG if sell exists, because `sol_spent` doesn't account for SOL already withdrawn.

**The core problem:** `participant.sol_spent` tracks gross purchases. With sell-back, you need `net_sol_at_risk = sol_spent - sol_received_from_sells`. But the sell SOL included tax deduction, so:
- User spent 100 SOL buying
- User received 42.5 SOL selling (85% of 50 SOL value)
- Net at risk: 100 - 42.5 = 57.5 SOL
- But vault only received 100 - 50 = 50 SOL net (the other 7.5 SOL is in the tax escrow)
- If tax escrow is refunded, vault+escrow = 57.5 SOL. This works.
- If tax escrow is NOT refunded, only 50 SOL available. But user claims 57.5. Insolvent.

**Consequences:** Vault cannot cover all refund claims. Last claimers get nothing.

**Prevention:**
1. **Refund based on current token holdings, NOT sol_spent.** `refund = (sol_vault_balance + tax_escrow_balance) * user_tokens / total_tokens_outstanding`. This is always solvent by definition.
2. **Track `tokens_held` rather than `sol_spent` for refund calculation.** Or: the ParticipantState tracks `tokens_purchased` minus `tokens_sold` = current holdings.
3. **Master invariant: vault_balance + tax_escrow >= sum(all_possible_refunds).** Prove this mathematically and with property tests.
4. **Alternatively, use the simple approach:** On failure, refund = `participant.tokens_purchased` evaluated at average curve price. But this has its own issues (average price varies by purchase time).

**The recommended approach:** Token-proportional refund is the cleanest. User refund = `(sol_vault + tax_escrow) * user_current_token_balance / total_tokens_sold_still_outstanding`. This auto-adjusts for sells and is always solvent.

**Warning signs:** `sol_vault.balance < sum(participant.sol_spent) - sum(participant.sol_received)` at any point during the curve.

**Test case:** 3 users buy, 1 user sells half back, curve fails. Verify: sum of all refund claims <= sol_vault + tax_escrow. Each user's refund is proportional to their token holdings.

**Phase:** Refund architecture (early design phase). Cannot be an afterthought.

---

### PITFALL C-5: Linear Curve Quadratic Formula Precision Loss

**Severity:** CRITICAL
**Likelihood:** MEDIUM (depends on precision scaling implementation)

**What goes wrong:** The bonding curve spec uses a quadratic formula with integer square root:

```
dx = (-(a + b*x1) + sqrt((a + b*x1)^2 + 2*b*S)) / b
```

Integer square root (`integer_sqrt`) introduces up to 1 unit of error in the result. With 1e12 precision scaling, this translates to up to 1/1e12 tokens of error per purchase. For buy-only, this is harmless (always rounds against user). For buy+sell, the error compounds:

- Buy: user gets `floor(sqrt(...))` tokens = slightly fewer than exact
- Sell: if inverse formula also uses `floor(sqrt(...))`, user gets slightly fewer SOL = slightly fewer than exact

This is fine individually. The problem: **the buy and sell formulas may not be perfectly inverse**. Buying X SOL and then selling all tokens back should return <= X SOL. But if the buy formula and sell formula have independent rounding, the round-trip can return MORE than X SOL in edge cases.

**Specific risk with the current spec's precision:**
```
PRECISION: u128 = 1_000_000_000_000 (1e12)
P_START: u128 = 900
P_END: u128 = 3450
TOTAL_FOR_SALE: u128 = 460_000_000_000_000 (460M with 6 decimals)
```

The discriminant computation `(a + b*x1)^2 + 2*b*S` involves multiplication of values up to ~1e24 (PRECISION^2). This fits in u128 (max 3.4e38). But if b and S are large, intermediate products can approach u128 limits.

**Consequences:**
- Extractable value through buy/sell cycling at specific `tokens_sold` values
- Potential vault insolvency over time
- Could be weaponized by a bot that finds the worst-case rounding positions

**Prevention:**
1. **Do NOT use quadratic formula for sell.** Instead, compute sell SOL directly from the integral: `SOL_returned = integral from (tokens_sold - tokens_selling) to tokens_sold of P(x)dx`. This is `P_start * tokens + (P_end - P_start) * (tokens_sold^2 - (tokens_sold - tokens)^2) / (2 * TOTAL_FOR_SALE)`. No square root needed for sell.
2. **Verify round-trip property:** For ANY (amount, tokens_sold), buying `amount` SOL and selling the resulting tokens back must return <= `amount` SOL. Property test this with 100K iterations.
3. **Use consistent rounding:** All divisions truncate (floor). Never use ceiling for any user-facing return.
4. **Consider fixed-point library:** Use a dedicated fixed-point math library (e.g., `fixed` crate or custom u128 fixed-point) rather than ad-hoc precision scaling.

**Warning signs:** Property test finds round-trip that returns more SOL than input.

**Test case:** `proptest! { buy(sol) then sell(all_tokens) -> returned_sol <= sol }` for 100,000 iterations across all `tokens_sold` positions.

**Phase:** Core math implementation. Must be the FIRST thing built and proven.

---

## High Pitfalls

Mistakes that cause significant delays, security vulnerabilities, or require major refactoring.

---

### PITFALL H-1: Transfer Hook Whitelist Capacity

**Severity:** HIGH
**Likelihood:** HIGH (known constraint from existing system)

**What goes wrong:** The existing transfer hook whitelist has 14 entries. Each entry whitelists a specific TOKEN ACCOUNT (not wallet). The bonding curve needs new whitelisted accounts:

Per curve (CRIME and FRAUD):
- Curve token vault (holds tokens for sale)
- Curve SOL vault is native SOL, not a token account -- no whitelist needed
- But wait: on sell, the curve receives tokens FROM users. The curve's token vault is the destination. It needs to be whitelisted.

New whitelist entries needed:
1. CRIME curve token vault (for CRIME transfers during buy/sell)
2. FRAUD curve token vault (for FRAUD transfers during buy/sell)
3. Tax escrow token vault (if sell tax is paid in tokens rather than SOL)

**The problem:** Whitelist authority is burned after mainnet launch (Step 4 in burn sequence). If the bonding curve launches BEFORE authority burn, entries can be added. If AFTER, they cannot. This means the bonding curve program MUST be deployed and its vault addresses known BEFORE the whitelist authority is burned.

But wait -- the bonding curve is supposed to happen BEFORE pool seeding. The current deployment sequence is:
1. Deploy programs
2. Initialize PDAs, pools, whitelist (14 entries)
3. Burn whitelist authority
4. Burn AMM admin

If bonding curve vaults need whitelisting, they must be added at step 2, BEFORE burn at step 3.

**Additional complication:** The curve might need to transfer tokens to user wallets. But user wallets are NOT whitelisted. The hook requires `source OR destination` to be whitelisted. On buy (vault -> user), the source (vault) is whitelisted. On sell (user -> vault), the destination (vault) is whitelisted. This works -- but only if the vault token accounts are whitelisted.

**Consequences:**
- If whitelist entries are not added before burn, the curve program cannot transfer tokens at all
- Tokens are permanently stuck in vault (or user wallets can never send to vault)
- Protocol launch fails

**Prevention:**
1. **Add bonding curve vault whitelist entries BEFORE burning whitelist authority.** This means curve program must be deployed and initialized before burn.
2. **Generate curve vault PDAs deterministically.** Seeds like `["curve_token_vault", token_mint]` produce known addresses at deploy time.
3. **Update deployment sequence:** Deploy curve program -> initialize curve vaults -> whitelist curve vaults -> then proceed with existing burn sequence.
4. **Count whitelist entries:** 14 existing + 2 curve vaults = 16 minimum. Verify no whitelist size limit exists (there is none -- each entry is a separate PDA account).

**Warning signs:** `NoWhitelistedParty` error when testing curve buy/sell on devnet.

**Test case:** On localnet, initialize curve with whitelisted vault. Buy tokens. Sell tokens back. Verify hook passes for both directions.

**Phase:** Infrastructure/deployment phase. Must be addressed in deployment sequence before any curve testing.

---

### PITFALL H-2: CPI Depth Exhaustion

**Severity:** HIGH
**Likelihood:** MEDIUM (depends on curve program architecture)

**What goes wrong:** The existing protocol uses CPI depth 4 for user swaps (Tax -> AMM -> Token-2022 -> Hook). The bonding curve is a NEW program. If the curve's buy/sell needs to CPI through Token-2022 for token transfers, the depth chain is:

```
Curve::purchase -> Token-2022::transfer_checked -> Hook::transfer_hook
```

That's only depth 2 (Curve at 0, T22 at 1, Hook at 2). This is fine for standalone curve operations.

**But:** If the curve needs to CPI into the Tax Program or AMM for graduation (execute_transition), the depth chain becomes:

```
Curve::execute_transition -> AMM::initialize_pool -> Token-2022::transfer_checked -> Hook
```

That's depth 3. Still fine.

**The real risk:** If any curve instruction needs to go through Tax Program (e.g., to apply sell tax via the existing tax infrastructure):

```
Curve::sell -> Tax::swap_exempt or similar -> AMM -> Token-2022 -> Hook
```

That's depth 4. And if the sell path needs to do ANYTHING else CPI-wise (like depositing tax to staking), it fails.

**Consequences:**
- Cannot reuse existing tax infrastructure for curve sell tax
- Must implement sell tax math independently in the curve program
- Inconsistency between curve sell tax and AMM sell tax calculations

**Prevention:**
1. **The curve program should handle sell tax independently.** Do NOT CPI into Tax Program. Calculate tax within the curve, transfer SOL to escrow directly.
2. **Keep curve CPI depth to maximum 2** (Curve -> Token-2022 -> Hook). This leaves headroom.
3. **Graduation (execute_transition) may need to be broken into multiple transactions** if it involves multiple pool initializations, each requiring CPI chains.
4. **Use the existing pattern from Conversion Vault** (leaf node, max depth 2) as the template for the curve program.

**Warning signs:** `ExceededMaxInstructions` or similar CPI depth error during integration testing.

**Test case:** Verify sell instruction works with transfer hook accounts at depth 2. Verify graduation CPI chain does not exceed depth 4.

**Phase:** Architecture/design phase. CPI depth constraints must be mapped before any implementation.

---

### PITFALL H-3: Clock/Slot Manipulation at Deadline

**Severity:** HIGH
**Likelihood:** LOW-MEDIUM (Solana slot times are variable)

**What goes wrong:** The 48-hour deadline uses slots: `DEADLINE_SLOTS = 432,000` at 400ms/slot. But Solana slot times are NOT fixed at 400ms:

- Average slot time varies from ~400ms to ~600ms depending on network load
- During high congestion, slot times can spike to 1-2 seconds
- Validators do not guarantee uniform slot progression

This means 432,000 slots could take anywhere from 48 hours (at 400ms) to 72+ hours (at 600ms average). The deadline is not really 48 hours -- it's 432,000 slots.

**48-hour clock edge cases:**
1. **Curve has 999 SOL at slot 431,999:** A purchase TX is submitted in this slot. If Solana is congested, the TX may be delayed to slot 432,001 and fail with `DeadlinePassed`. The user loses their transaction fee and the curve stays at 999 SOL.

2. **Graduation TX submitted but not confirmed:** User submits `execute_transition` at slot 431,990. TX is valid (both curves filled). But if the TX drops (network congestion, insufficient priority fee), the deadline passes and `mark_failed` becomes callable. A griefing attacker can race to call `mark_failed` and force failure even though both curves are filled.

3. **Slot time variability:** If users are told "48 hours" but slots run at 500ms average, the actual deadline is 60 hours. Or if slots run at 350ms (validators are fast), deadline is 42 hours. Users may miss the window.

**Consequences:**
- Curves fail unexpectedly due to slot timing
- Users lose trust in countdown timers
- Race conditions between purchase/graduation and mark_failed

**Prevention:**
1. **Use `Clock::unix_timestamp` instead of slots for the deadline.** Solana provides `Clock::get()?.unix_timestamp`. Set deadline as `start_timestamp + 48 * 3600`. This is wall-clock time, not slot-dependent.
2. **Caveat:** `unix_timestamp` comes from validator voting and can be slightly off (typically within 1-2 seconds). For a 48-hour deadline, this is negligible.
3. **Grace period after fill:** Once a curve reaches `Filled` status, the deadline should be irrelevant for that curve. `mark_failed` should only be callable if the curve is `Active` AND past deadline. A `Filled` curve should never be markable as failed (it already succeeded).
4. **Protect graduation TX:** Once both curves are `Filled`, `mark_failed` should be rejected for BOTH curves, regardless of slot/time. The `Filled` status is the point of no return.
5. **Frontend: display "approximate time remaining"** with a disclaimer, not a precise countdown.

**Warning signs:** Countdown timer in UI doesn't match actual slot progression.

**Test case:** Fill both curves at deadline_slot - 1. Submit `execute_transition` at deadline_slot + 5. Verify it succeeds (Filled status takes precedence over deadline). Also: try `mark_failed` on a `Filled` curve -- must fail.

**Phase:** Core state machine design. Deadline logic is fundamental.

---

### PITFALL H-4: Sell Tax Gaming via Same-Transaction Manipulation

**Severity:** HIGH
**Likelihood:** MEDIUM (requires Solana-specific knowledge but is technically straightforward)

**What goes wrong:** Solana allows multiple instructions in a single transaction. An attacker can:

1. **Instruction 1:** Sell tokens back to curve (pays 15% sell tax, price decreases)
2. **Instruction 2:** Buy tokens from curve at the now-lower price

In one atomic transaction, the attacker has:
- Paid 15% sell tax on the sell
- But bought tokens at a lower price than before the sell

**Is this exploitable?** For a linear curve, selling pushes `tokens_sold` backward (price decreases), then buying pushes it forward (price increases). The net effect depends on whether the price decrease from selling is larger than the tax cost.

**Analysis for the specific curve parameters:**
```
P(x) = 0.0000009 + 0.00000255 * x / 460M

Price at 230M tokens_sold: ~0.00000218 SOL/token
Selling 20M tokens: price drops to P(210M) = ~0.00000206 SOL/token
Buying 20M tokens back at P(210M): costs less than what was received from selling

But: 15% tax on the sell means seller only gets 85% of the curve integral
If 85% of sell integral < buy integral at lower price: attacker loses money
If 85% of sell integral > buy integral at lower price: attacker profits
```

For a linear curve, this is actually a net loss for the attacker because the sell integral (area under the curve from 210M to 230M) is the same as the buy integral (area under the curve from 210M to 230M). The attacker gets back 85% of what they pay to rebuy -- a 15% loss.

**BUT:** If the attacker uses this to manipulate the price for OTHER buyers:
1. Attacker sells 20M tokens (price drops, pays 15% tax)
2. Attacker's friend buys 20M tokens at lower price (gets tokens cheap)
3. Later, curve fills, friend has tokens at a below-average cost

The attacker sacrificed 15% but their friend got a discount. Depending on the discount size, this could be net profitable for the pair.

**Consequences:**
- Price manipulation for insiders
- Legitimate buyers get a worse average price
- Tax escrow accumulates but curve progress reverses

**Prevention:**
1. **Cooldown between sell and buy for same wallet.** At minimum 1 slot (prevents same-TX manipulation). Better: 10-minute cooldown.
2. **Monotonic `tokens_sold` option:** Don't decrease `tokens_sold` on sell. Instead, track sell tokens separately. Price only moves forward. Sell returns SOL based on the AVERAGE price the user paid, not the current curve price. This eliminates curve price manipulation entirely.
3. **Alternative: no sell to curve.** The original spec's "buy-only" design avoids this entirely. If sell-back is desired for user confidence, consider a limited sell (e.g., only within first 24 hours, capped at 50% of purchase).

**Warning signs:** Same wallet doing sell followed by buy in rapid succession.

**Test case:** Same wallet sells 1M tokens then buys 1M tokens in one transaction. Verify net SOL loss > 15% of the sell value.

**Phase:** Sell instruction design. Must decide on the sell model (curve-price-sell vs average-price-sell) early.

---

### PITFALL H-5: Transfer Hook Account Resolution for Curve Program

**Severity:** HIGH
**Likelihood:** HIGH (proven pain point from AMM, Staking, and Vault development)

**What goes wrong:** From MEMORY.md: "Anchor SPL transfer_checked does NOT forward remaining_accounts. Use manual `transfer_checked_with_hook` helper with invoke_signed." Every program that transfers Token-2022 tokens has needed a custom hook helper. The bonding curve will be no different.

For curve buy (vault -> user):
- Source: curve_token_vault (whitelisted)
- Destination: user's token account (NOT whitelisted, but source IS -- hook passes)
- Hook accounts needed: ExtraAccountMetaList PDA, whitelist_source PDA, whitelist_dest PDA, hook program

For curve sell (user -> vault):
- Source: user's token account (NOT whitelisted)
- Destination: curve_token_vault (whitelisted -- hook passes)
- Hook accounts needed: same 4

From MEMORY.md: "Hook accounts per mint = 4." The curve program needs 4 remaining_accounts per transfer. For a sell-then-buy in one instruction, that's 8 remaining_accounts.

**Additional complexity:** The client-side hook resolution uses `createTransferCheckedWithTransferHookInstruction` from SPL, which resolves the 4 accounts automatically. But the browser Buffer polyfill issue (documented in MEMORY.md) may require manual PDA derivation as was done in `hook-resolver.ts`.

**Consequences:**
- Transfer Hook error 3005 (`AccountNotEnoughKeys`) if hook accounts are missing or misordered
- Subtle failures where transfers silently fail in production but work in tests (if tests don't have hooks enabled)
- From MEMORY.md: "Dual-Hook Ordering -- AMM splits remaining_accounts as [INPUT hooks, OUTPUT hooks]. NOT [side A, side B]." The curve needs to follow the same pattern.

**Prevention:**
1. **Copy the existing `hook_helper.rs` from conversion-vault** (already proven working). It's a direct copy of the AMM pattern.
2. **Always test with transfer hooks enabled.** Never skip hook accounts in tests.
3. **Document the remaining_accounts layout:** For buy: `[4 hook accounts for the token being transferred]`. For sell: `[4 hook accounts for the token being transferred]`.
4. **Client-side:** Use the existing `hook-resolver.ts` pattern or the ALT that already contains hook-related addresses.

**Warning signs:** `AccountNotEnoughKeys` (error 3005) during first integration test.

**Test case:** Buy tokens with hook accounts. Sell tokens with hook accounts. Both must succeed. Then: attempt buy WITHOUT hook accounts -- must fail with clear error.

**Phase:** First implementation phase. Use proven hook helper from day one.

---

### PITFALL H-6: execute_transition Account Limit (32 Accounts)

**Severity:** HIGH
**Likelihood:** HIGH (the spec already shows 32 accounts for execute_transition)

**What goes wrong:** The existing `execute_transition` spec lists 32 accounts. This is already at Solana's practical limit for legacy transactions (1232 bytes). With sell mechanics, the transition may need ADDITIONAL accounts:

- Tax escrow vault (for each curve)
- Sell tax distribution targets (staking escrow, carnage fund, treasury)

Adding 4-6 more accounts pushes to 36-38. This exceeds legacy TX limits.

**Additionally:** Each Token-2022 transfer during graduation needs 4 hook remaining_accounts. If graduation involves transferring CRIME (4 hook accounts) + FRAUD (4 hook accounts) + PROFIT (4 hook accounts) + WSOL, that's 12 extra remaining_accounts on top of the 32 named accounts.

32 + 12 = 44 accounts. This absolutely requires an ALT (Address Lookup Table) for v0 VersionedTransaction.

**From MEMORY.md:** "ALT for large TX: Sell path (23 named + 8 remaining) exceeds 1232-byte limit. Use VersionedTransaction v0 with Address Lookup Table."

**Consequences:**
- Graduation TX fails with "Transaction too large"
- Need to split graduation into multiple transactions (losing atomicity)
- Non-atomic graduation introduces race conditions

**Prevention:**
1. **Use ALT + v0 VersionedTransaction for graduation.** The project already has ALT infrastructure (`alt-helper.ts`).
2. **Add curve-specific addresses to the ALT.** Currently 46 addresses. Need to expand.
3. **Consider splitting graduation into phases:**
   - TX 1: Mark both curves as "graduating" (lock state)
   - TX 2: Seed CRIME/SOL pool
   - TX 3: Seed FRAUD/SOL pool
   - TX 4: Seed conversion vault
   - TX 5: Mark transition complete
   Use a state machine (`Graduating` status) to prevent interference between steps.
4. **From MEMORY.md:** "v0 TX skipPreflight: Devnet simulation rejects v0 TX with 'Blockhash not found'. Use skipPreflight: true."

**Warning signs:** "Transaction too large" error when constructing graduation TX.

**Test case:** Build the full graduation TX with all accounts. Measure byte size. If > 1232, verify ALT reduces it to fit.

**Phase:** Graduation architecture. Design the multi-TX graduation sequence early.

---

### PITFALL H-7: Refund Double-Claim via Token Transfer

**Severity:** HIGH
**Likelihood:** LOW (transfer hooks prevent this, but must verify)

**What goes wrong:** The refund is proportional to token holdings. Attack:
1. User A buys 20M CRIME on curve (holds 20M tokens)
2. Curve fails
3. User A claims refund for 20M tokens worth of SOL
4. User A transfers 20M tokens to User B (same person's second wallet)
5. User B claims refund for 20M tokens worth of SOL
6. Total claimed: 40M tokens worth of SOL, from only 20M tokens purchased

**Why transfer hooks help:** CRIME/FRAUD have transfer hooks requiring source OR destination to be whitelisted. User wallet -> User wallet transfer: neither is whitelisted. Transfer fails with `NoWhitelistedParty`. The attack is blocked.

**But there are edge cases:**
- Could the user transfer to a WHITELISTED address (e.g., a pool vault) and then somehow retrieve? No -- pool vaults are PDA-controlled. Users can't withdraw from them.
- Could the user sell to the curve vault (whitelisted), then have another wallet buy from the curve? The sell-then-buy doesn't transfer tokens between users -- it goes user->curve then curve->otherUser. Each is a separate transaction with different token amounts at different prices. No double-refund.

**Remaining risk: refund based on `sol_spent` vs token holdings.**
If refund uses `participant.sol_spent` (as in current spec), the attack doesn't work anyway because `sol_spent` is per-participant. User B has `sol_spent = 0`. Even if they somehow got tokens, they can't claim a sol-spent refund.

If refund uses token-proportional (`user_tokens / total_tokens * vault_balance`), then token transfer would enable the attack. But transfer hooks block it.

**Consequences:** Double-drain of refund vault (if both the refund mechanism AND transfer hook are broken).

**Prevention:**
1. **Transfer hooks already prevent wallet-to-wallet transfers.** Verify this works for curve-purchased tokens.
2. **Refund should mark tokens as "consumed."** After refund, user's tokens should be burned or locked. This prevents any future claim.
3. **Use `refund_claimed` boolean** (already in spec) as a hard gate.
4. **Defense in depth:** Track refund claims separately. `total_refunds_claimed` must never exceed `sol_vault + tax_escrow`.

**Warning signs:** `refund_claimed` flag not checked before processing.

**Test case:** User buys tokens, curve fails, claims refund. Verify: (a) second claim fails with `RefundAlreadyClaimed`, (b) user cannot transfer tokens to another wallet (hook blocks it).

**Phase:** Refund implementation. Standard security testing.

---

### PITFALL H-8: Flash Loan Attack on Token-Proportional Refund

**Severity:** HIGH
**Likelihood:** LOW (transfer hooks block the main vector, but worth analyzing)

**What goes wrong:** If refund is proportional to token holdings at claim time, a flash loan attack could work:
1. Flash loan large amount of CRIME tokens
2. Claim refund (proportional to massive token balance)
3. Repay flash loan
4. Profit: refund SOL minus flash loan fee

**Why this probably doesn't work in practice:**
1. **No existing flash loan source for CRIME/FRAUD.** These tokens only exist on this protocol. No external lending protocols hold them. You can't flash loan what doesn't exist elsewhere.
2. **Transfer hooks block direct transfers.** Even if someone had tokens, they can't transfer them to the attacker's wallet without a whitelisted party.
3. **Solana doesn't have native flash loans** like EVM. Flash loan-like behavior requires CPI chains within a single transaction, and the transfer hook would block unauthorized transfers.

**Remaining vector:** Could someone sell-and-rebuy on the curve to accumulate tokens just before claiming refund? Yes, but:
- Selling reduces `tokens_sold`, so the curve may un-fill
- 15% sell tax makes this expensive
- The refund is proportional -- getting more tokens means the denominator also increases

**Consequences:** If exploitable, attacker drains the entire refund vault.

**Prevention:**
1. **Snapshot token balances at failure time, not claim time.** When `mark_failed` is called, record each participant's `tokens_purchased` (already tracked in `ParticipantState`). Refund based on this snapshot.
2. **Better: use `participant.tokens_purchased - participant.tokens_sold` as the refund basis.** This is already known at state level.
3. **Don't read user's token account balance for refund calculation.** Use the on-chain `ParticipantState` data instead.

**Warning signs:** Refund function reads user's token account balance directly instead of using ParticipantState.

**Test case:** Verify refund amount is calculated from ParticipantState fields, not from live token account balance.

**Phase:** Refund implementation.

---

## Moderate Pitfalls

Mistakes that cause delays, technical debt, or suboptimal security.

---

### PITFALL M-1: Sell at Graduation Boundary Race Condition

**Severity:** MEDIUM
**Likelihood:** MEDIUM

**What goes wrong:** Curve has 999.5 SOL raised. A sell TX and a buy TX are submitted simultaneously:
- Buy TX: adds 1 SOL (total becomes 1000.5 SOL, curve fills)
- Sell TX: removes 0.5 SOL (total becomes 999 SOL, curve stays Active)

If the sell TX is processed first, the buy TX fills the curve. If the buy TX is processed first, the curve fills, then the sell TX fails (curve is Filled, no sells allowed).

**The problem:** What if the sell TX is processed AFTER the curve transitions to `Filled` but the TX was constructed with the `Active` state?

Solana transactions are checked at execution time, not submission time. If the curve is `Filled` when the sell TX executes, the sell should fail with `CurveNotActive`. This is correct behavior.

**Subtler issue:** What if a sell TX arrives in the same slot as the buy TX that fills the curve? Solana serializes transactions touching the same accounts. The order within a slot is determined by the leader validator's transaction ordering algorithm (currently based on priority fee, then FIFO).

**Consequences:**
- Potential for unexpected sell failures near graduation
- User confusion
- If sell IS processed after graduation somehow, vault SOL decreases below 1000 SOL, breaking pool seeding

**Prevention:**
1. **Reject sells when `sol_raised >= TARGET_SOL * 95%` (safety margin).** Or: reject sells when status is `Filled` or `Transitioned`.
2. **Status check at start of sell instruction.** `require!(curve.status == CurveStatus::Active, ...)`.
3. **Consider disabling sells in the final 10% of the curve.** Once sol_raised >= 900 SOL, selling is disabled.
4. **Atomic fill check:** After every buy, check if target is reached. If so, immediately transition to Filled. No window between "last buy" and "status change."

**Warning signs:** Sell TX processed in same slot as fill TX.

**Test case:** Fill curve to exactly TARGET_SOL with one TX. In the same test, submit a sell TX. Verify sell fails.

**Phase:** State machine implementation.

---

### PITFALL M-2: Rent-Exempt Minimum Accounting in SOL Vault

**Severity:** MEDIUM
**Likelihood:** HIGH (this already bit the project -- see MEMORY.md bounty rent bug)

**What goes wrong:** From MEMORY.md: "Bounty rent bug (mitigated): On-chain trigger_epoch_transition checks vault_balance >= TRIGGER_BOUNTY_LAMPORTS without accounting for rent-exempt minimum."

The same issue applies to the bonding curve SOL vault. When calculating available SOL for sells, refunds, or graduation:

```
available_sol = sol_vault.lamports() - rent_exempt_minimum
```

If code uses `sol_vault.lamports()` directly (ignoring rent-exempt), the last refund/sell might drop the vault below rent-exempt, causing the account to be garbage collected.

**Specific numbers:**
- SOL vault is a system account PDA (no data beyond what Anchor allocates)
- Rent-exempt minimum for a 0-data account: ~890,880 lamports (~0.00089 SOL)
- For a small Anchor account (8 discriminator + state): ~1,000,000+ lamports

**Consequences:**
- Last sell or last refund fails because insufficient lamports
- Or worse: vault account is garbage collected, losing ALL remaining SOL

**Prevention:**
1. **Always subtract rent-exempt minimum from available balance.** `available = vault.lamports().saturating_sub(rent_exempt_min)`.
2. **Use the same pattern as Carnage:** `let rent_exempt_min = Rent::get()?.minimum_balance(vault_account_data_len); let available = vault.lamports().checked_sub(rent_exempt_min).unwrap_or(0);`
3. **Property test:** After every operation, `vault.lamports() >= rent_exempt_minimum`.
4. **At graduation, transfer `vault.lamports() - rent_exempt_minimum` to pools,** not `sol_raised`. The vault's actual lamport balance is the source of truth.

**Warning signs:** Final refund claim fails with "insufficient lamports."

**Test case:** Fill curve, then fail. All users claim refunds. Last user's refund should succeed and vault should retain >= rent-exempt-minimum lamports.

**Phase:** Every SOL-handling instruction.

---

### PITFALL M-3: Stale Price Display vs On-Chain State

**Severity:** MEDIUM
**Likelihood:** HIGH (UX issue, not security)

**What goes wrong:** With sell mechanics, the curve price can go BOTH up and down. UI shows "current price" based on last-read `tokens_sold`. Between the read and the user's TX landing:

1. Another user sells -> price decreases -> user gets MORE tokens than expected (positive surprise)
2. Another user buys -> price increases -> user gets FEWER tokens than expected (negative surprise)

This is standard slippage behavior, but it's more confusing with a bonding curve because users expect the price to only go up. Sell-back breaks that mental model.

**Consequences:**
- User confusion ("I thought the price only goes up?")
- Support tickets
- Users setting tight slippage and getting reverts

**Prevention:**
1. **Show "estimated tokens" with a range** (min/max based on slippage tolerance).
2. **Clearly indicate that the curve is bidirectional** ("Price changes based on buys AND sells").
3. **Real-time WebSocket updates** on `tokens_sold` so the UI price is as current as possible.
4. **Slippage defaults:** Default to 2-5% slippage for curve buys (more generous than AMM because price movements are smaller on a linear curve).

**Warning signs:** Users complaining about getting fewer tokens than shown.

**Test case:** Frontend test: display price, simulate concurrent buy by another user, verify price updates within 1 slot.

**Phase:** Frontend implementation.

---

### PITFALL M-4: Sell Tax Escrow Key Management

**Severity:** MEDIUM
**Likelihood:** MEDIUM

**What goes wrong:** The 15% sell tax goes to a separate escrow. This escrow holds SOL that is:
- Distributed to users as part of refund (on failure)
- Distributed to carnage fund (on success)

The escrow needs to be a PDA controlled by the curve program. But on graduation (success), the SOL needs to be transferred OUT of the curve program's PDA to the carnage fund (controlled by epoch program).

**The question:** Can the curve program's PDA signer transfer SOL to another program's PDA?

**Answer:** Yes. PDAs are just accounts. SOL can be transferred between any accounts. The curve program signs as the escrow PDA and uses `system_program::transfer` to send SOL to the carnage fund address.

**But:** The carnage fund is itself a PDA. The curve program needs the correct address. If the carnage fund address is hardcoded (like mint addresses), it must be feature-gated for devnet/mainnet.

**Consequences:**
- Tax escrow SOL stuck if the destination address is wrong
- Graduation partial failure: pools seeded but tax not distributed
- If escrow is controlled by a non-PDA authority, key compromise can drain it

**Prevention:**
1. **Escrow is a PDA** derived from curve program seeds. No keypair authority.
2. **Carnage fund address passed as an account** (not hardcoded), validated via PDA derivation constraints.
3. **On failure:** Escrow SOL included in proportional refund calculation.
4. **On success:** Graduation instruction explicitly transfers escrow SOL to carnage fund.
5. **Test both paths:** success (escrow -> carnage) and failure (escrow -> refund pool).

**Warning signs:** Sell tax SOL accumulates in escrow but is never distributed.

**Test case:** Curve succeeds: verify escrow balance is 0 after graduation (all sent to carnage). Curve fails: verify escrow balance included in refund calculation.

**Phase:** Sell tax and graduation architecture.

---

### PITFALL M-5: Per-Wallet Cap Bypass via Sell-and-Rebuy

**Severity:** MEDIUM
**Likelihood:** LOW (transfer hooks prevent the main vector)

**What goes wrong:** Per-wallet cap is 20M tokens. Can a user:
1. Buy 20M tokens (at cap)
2. Sell 20M tokens (now at 0)
3. Buy 20M tokens again (at cap again)

This is technically "allowed" -- the user sold and rebought. They're still at 20M. But they've now purchased 40M tokens worth of SOL from the curve. Is this a problem?

**Analysis:** Not a direct exploit because:
- User paid 15% sell tax on step 2 (lost ~15% of their SOL)
- User bought back at approximately the same price (linear curve, tokens_sold returned to same level)
- Net effect: user has same tokens but lost ~15% of capital

**BUT:** If the curve tracks `tokens_purchased` as a running total (not current balance), the cap check fails:
```
participant.tokens_purchased = 20M + 20M = 40M > MAX_TOKENS_PER_WALLET
// Second buy rejected!
```

This is WRONG. The user has already sold the first 20M. Their current holding is 0. They should be allowed to buy 20M again.

**Consequences:** If not handled, users who sell cannot rebuy even below cap. This breaks the sell mechanic.

**Prevention:**
1. **Track `tokens_held` = `tokens_purchased - tokens_sold`** rather than cumulative `tokens_purchased`.
2. **Cap check:** `require!(participant.tokens_held + tokens_out <= MAX_TOKENS_PER_WALLET)`.
3. **Update `tokens_held` on both buy and sell.**
4. **Alternatively:** Cap check should be against the user's actual token account balance, but this requires reading the token account which adds an account to the instruction.

**Warning signs:** User sells and cannot rebuy even though they hold 0 tokens.

**Test case:** Buy 20M tokens (at cap), sell all, buy 20M again. Must succeed.

**Phase:** Cap enforcement logic in sell instruction.

---

## Minor Pitfalls

Mistakes that cause annoyance but are fixable.

---

### PITFALL L-1: SOL Dust in Sell Returns

**Severity:** LOW
**Likelihood:** HIGH

**What goes wrong:** Selling small token amounts produces very small SOL returns. After 15% tax, the return might be 0 lamports. The transaction succeeds but the user receives nothing.

Example: Selling 100 tokens at early curve price (~0.0000009 SOL/token):
- Gross SOL: 100 * 0.0000009 = 0.00009 SOL = 90,000 lamports
- Tax (15%): 13,500 lamports
- Net: 76,500 lamports

This is fine. But at very small amounts (1-10 tokens):
- Gross: 10 * 0.0000009 = 9,000 lamports
- Tax: 1,350 lamports
- Net: 7,650 lamports

Still fine, but the minimum sell should be checked.

**Prevention:**
1. **Minimum sell amount** that ensures net return > 0 lamports.
2. **Reject sells where net_return < MIN_SELL_RETURN** (e.g., 5,000 lamports = 0.000005 SOL).
3. **Or: minimum sell amount in tokens** rather than SOL.

**Warning signs:** User sells 1 token and receives 0 SOL.

**Test case:** Sell 1 token at minimum price. Verify net return > 0 or TX rejected with clear error.

**Phase:** Sell instruction constraints.

---

### PITFALL L-2: Event Indexing for Sell Transactions

**Severity:** LOW
**Likelihood:** MEDIUM

**What goes wrong:** The existing event infrastructure indexes `Purchase` events for the curve. With sell mechanics, a new `Sell` event is needed. If the frontend, webhook indexing, and database schema don't account for sells:
- Chart shows only buys (price appears to only go up)
- User history missing sell transactions
- SOL raised calculation wrong (doesn't subtract sells)

**Prevention:**
1. **Add `Sell` event** with: user, token, tokens_sold, sol_received, new_tokens_sold, current_price, slot.
2. **Update webhook indexing** to capture sell events.
3. **Update database schema** with sell_events table.
4. **Chart calculation:** `net_progress = sum(buys) - sum(sells)`.

**Warning signs:** Curve progress bar shows 800 SOL but vault only has 500 SOL.

**Test case:** Buy, sell, buy. Verify all 3 events indexed. Verify net_progress calculation accounts for sell.

**Phase:** Event and frontend integration.

---

### PITFALL L-3: ParticipantState Size Increase

**Severity:** LOW
**Likelihood:** HIGH

**What goes wrong:** Current ParticipantState is 71 bytes (+ 8 discriminator = 79 bytes). With sell tracking, new fields needed:
- `tokens_sold: u64` (8 bytes)
- `sol_received: u64` (8 bytes)
- `sell_count: u32` (4 bytes)

New size: 71 + 20 = 91 bytes (+ 8 = 99 bytes). This means higher rent cost per participant.

At 6.96 lamports/byte, rent-exempt:
- Old: 79 * 6.96 = ~550 lamports + base = ~1,120,000 lamports (~0.00112 SOL)
- New: 99 * 6.96 = ~689 lamports + base = ~1,200,000 lamports (~0.0012 SOL)

Difference is negligible but must be accounted for in `init_if_needed` space allocation.

**Prevention:**
1. **Define ParticipantState size correctly** from the start. Don't add fields later (account realloc is complex).
2. **Include sell fields in initial struct definition.**
3. **Consider `InitSpace` derive macro** for automatic size calculation.

**Warning signs:** `AccountDidNotDeserialize` when reading ParticipantState after size change.

**Test case:** Initialize ParticipantState, buy, sell. Verify all fields update correctly and deserialization works.

**Phase:** State account design (first implementation phase).

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Core math (buy/sell formulas) | C-1, C-5 (insolvency, precision) | Property test round-trip invariant before ANY other code |
| State machine design | C-3 (grief attack), H-3 (deadline), M-1 (graduation race) | Design refund rules and deadline logic as a state machine diagram first |
| Sell instruction | C-2 (MEV), H-4 (tax gaming), M-5 (cap bypass) | Decide sell-tax-before-return model, implement slippage, fix cap tracking |
| Transfer hook integration | H-1 (whitelist), H-5 (hook accounts) | Whitelist vaults BEFORE testing. Copy hook_helper.rs from Vault |
| Refund mechanism | C-4 (solvency), H-7 (double-claim), H-8 (flash loan) | Token-proportional refund, use ParticipantState not live balances |
| Graduation (execute_transition) | H-6 (account limit), M-4 (escrow) | Design multi-TX graduation with ALT. Include escrow distribution. |
| Frontend/events | M-3 (stale price), L-2 (event indexing) | WebSocket updates, new event types for sells |
| Deployment/init | H-1 (whitelist burn timing) | Deploy curve, whitelist vaults, THEN burn authority |

---

## Integration Pitfalls with Existing System

These are specific to adding a bonding curve to the EXISTING 6-program protocol.

### INT-1: Whitelist Authority Burn Timing

The whitelist authority burn is a one-way door. The curve program's token vaults MUST be whitelisted before burn. This forces the deployment sequence to be:

```
1. Deploy curve program (7th program)
2. Initialize curve vaults (PDAs)
3. Add curve vault whitelist entries (2 new entries: CRIME vault, FRAUD vault)
4. NOW burn whitelist authority
5. Then burn AMM admin
6. Then tiered timelock
7. Then burn all upgrade authorities
```

If the curve is deployed AFTER whitelist burn, its vaults can never be whitelisted, and no Token-2022 transfers involving those vaults will work.

### INT-2: ALT Must Be Extended

The existing devnet ALT has 46 addresses. Curve-specific addresses (curve state PDAs, vault addresses, escrow addresses) need to be added. ALT extension is straightforward but must be done BEFORE any v0 TX involving curve accounts.

### INT-3: Carnage Fund Receives Sell Tax on Success

On graduation, sell tax escrow SOL goes to the carnage fund. The carnage fund address (`CarnageFundState.sol_vault`) is a PDA of the epoch program. The curve program needs to know this address to transfer SOL on graduation. Either:
- Pass it as an account and validate via PDA derivation
- Hardcode it (requires feature-gating like mint addresses)

Recommendation: Pass as account with PDA validation (more flexible).

### INT-4: Testing Infrastructure

The existing test suite uses separate validators per test file to avoid PDA conflicts (from MEMORY.md: "StakePool PDA is singleton. Separate test files must run in separate validators"). The curve program adds a new singleton (CurveState) per token. Tests must account for this isolation requirement.

---

## Known Bonding Curve Exploits from Similar Platforms

**Confidence: LOW (training data only, could not verify with WebSearch)**

### pump.fun (Solana)

1. **Front-running via Jito bundles:** MEV operators used Jito bundle auctions to front-run pump.fun curve purchases. Pump.fun mitigated by partnering with Jito for priority ordering. Dr. Fraudsworth should implement slippage protection (minimum_tokens_out on buy) and the 15% sell tax makes round-trip sandwiching expensive.

2. **Graduation snipe:** Bots detected when pump.fun curves hit 100% and immediately sniped the Raydium pool listing, front-running the price discovery. Dr. Fraudsworth mitigates this because graduation goes to protocol-owned pools with known pricing (end_price = pool_price). No external DEX listing to snipe.

3. **Bundled buys across multiple wallets:** Attackers used Jito bundles to buy with 20+ wallets in a single block, bypassing per-TX limits but not per-wallet caps. Dr. Fraudsworth's per-wallet cap (20M tokens) + whitelist requirement mitigates this. Each wallet needs separate whitelist verification.

### moonshot (Solana)

1. **Oracle manipulation for dynamic pricing:** moonshot used external price oracles. Manipulating the oracle affected curve pricing. Dr. Fraudsworth's linear curve uses NO oracles -- price is purely `f(tokens_sold)`. No oracle manipulation vector.

### General bonding curve issues

1. **Integer overflow in cost calculation:** Bonding curves with exponential or polynomial price functions are prone to overflow. Linear curves are simpler but still need u128 intermediates (Dr. Fraudsworth already uses this pattern).

2. **Re-initialization attack:** If curve state can be re-initialized after deployment, attacker resets `tokens_sold` to 0 and buys at starting price. Prevention: `require!(curve.status == CurveStatus::Initialized)` in `fund_curve` and `start_curve` (already in spec).

---

## Sources

- `/Users/mlbob/Projects/Dr Fraudsworth/docs/Bonding_Curve_Spec.md` (current spec, buy-only design)
- `/Users/mlbob/Projects/Dr Fraudsworth/docs/security-model.md` (existing threat model)
- `/Users/mlbob/Projects/Dr Fraudsworth/docs/architecture.md` (CPI depth, account limits, deployment sequence)
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/transfer-hook/src/instructions/transfer_hook.rs` (whitelist logic)
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/amm/src/helpers/math.rs` (existing checked arithmetic patterns)
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/tax-program/src/helpers/tax_math.rs` (tax and slippage floor patterns)
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/conversion-vault/src/helpers/hook_helper.rs` (hook account forwarding pattern)
- `/Users/mlbob/Projects/Dr Fraudsworth/programs/conversion-vault/src/instructions/convert.rs` (leaf node Token-2022 transfer pattern)
- MEMORY.md (known issues: hook forwarding, ALT requirements, rent-exempt bugs, dual-hook ordering)
- Training data (pre-May 2025): pump.fun and moonshot exploit patterns (LOW confidence, unverified)
