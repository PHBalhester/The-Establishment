# Tax Structure as MEV Defense

**Status:** Design rationale documentation (H015 closure)
**Related:** [Tax Specification](./tax-spec.md), [Security Model](./security-model.md)

## Problem: Sandwich Attacks on DEXes

On decentralized exchanges, sandwich bots extract value from users by front-running and back-running their trades. The attack works as follows:

1. **Front-run:** Bot detects a user's pending swap and submits a buy order first, pushing the price up.
2. **User trade:** The user's swap executes at a worse price due to the bot's front-run.
3. **Back-run:** Bot immediately sells, capturing the price difference as profit.

This is especially severe on Solana where block producers (validators) can reorder transactions within a block, making front-running trivial for validators and bots with Jito bundle access.

## How Taxes Defend Against MEV

Dr. Fraudsworth applies a variable epoch-based tax on every SOL pool swap. Tax rates range from approximately 3% to 14%, determined by the current epoch's randomized tax structure (which token has the "high" rate vs "low" rate).

For a sandwich attack to be profitable, the bot must:

1. **Pay tax on the front-run buy** (3-14% of position size)
2. **Pay tax on the back-run sell** (3-14% of position size)

The round-trip tax cost is **at minimum 6%** of the bot's position size (two legs at the minimum 3% rate). In practice, one leg will typically face the higher rate, making the cost 17%+ in many epochs.

For comparison, a typical sandwich profit is 0.1-0.5% of the victim's trade size. The bot's tax cost dwarfs any possible slippage extraction.

### Worked Example

A user submits a 10 SOL swap. A sandwich bot considers attacking with a 50 SOL position:

| | Minimum Tax Epoch | Typical Epoch |
|--|---|---|
| Front-run tax | 1.5 SOL (3%) | 3.5 SOL (7%) |
| Back-run tax | 1.5 SOL (3%) | 7.0 SOL (14%) |
| **Total tax cost** | **3.0 SOL** | **10.5 SOL** |
| Max slippage profit | ~0.25 SOL | ~0.25 SOL |
| **Net result** | **-2.75 SOL loss** | **-10.25 SOL loss** |

The attack is unprofitable under every possible tax configuration.

## Asymmetric Rates Amplify Defense

The epoch-based tax system assigns different rates to buy and sell operations, and these assignments change each epoch via VRF randomness. This creates asymmetric conditions:

- When **buy tax is high** (14%) and **sell tax is low** (3%), the bot pays heavily on the front-run buy.
- When **sell tax is high** (14%) and **buy tax is low** (3%), the bot pays heavily on the back-run sell.
- The bot **always faces worst-case tax on at least one leg** of the sandwich.

Because epoch tax assignments are determined by on-chain VRF (Switchboard randomness), bots cannot predict which leg will be expensive. There is no favorable configuration to wait for — every epoch is unprofitable for sandwich attacks.

## Why This Is Better Than Other MEV Defenses

| Defense Mechanism | Limitation | Dr. Fraudsworth's Advantage |
|---|---|---|
| Jito bundles | Requires integration with Jito infrastructure | Tax is on-chain, works with any validator |
| MEV-aware routing | Relies on off-chain relayers | No off-chain dependency |
| Private mempools | Centralizes transaction ordering | Fully decentralized |
| Commit-reveal schemes | Adds latency and complexity | Single-transaction, no extra steps |

The tax is **on-chain and unavoidable**. It applies to every trade, including bot trades. There is no way to bypass it — the Tax Program wraps every SOL pool swap in an atomic transaction that calculates and collects the tax before executing the AMM swap.

The defense is a **natural property** of the protocol design, not an added feature that could be removed or circumvented.

## Trade-off Acknowledged

Legitimate users also pay the tax on every swap. This is the intended design — the tax is not primarily an MEV defense. Its primary purpose is to:

1. **Fund the yield system:** Tax revenue flows to the PROFIT staking reward pool, providing real SOL yield to stakers.
2. **Power Carnage burns:** A portion of tax revenue funds the Carnage mechanism that burns CRIME and FRAUD tokens, creating deflationary pressure.
3. **Generate protocol revenue:** The tax is the engine that makes the entire yield system sustainable without ponzinomics.

The MEV defense is a beneficial side effect of a tax structure designed for yield generation. Users accept the tax cost because they receive yield, token burns, and a fair trading environment in return.

## References

- **Tax rates and epoch mechanics:** See [Tax Specification](./tax-spec.md)
- **Security model overview:** See [Security Model](./security-model.md)
- **Epoch VRF randomness:** See [Epoch Specification](./epoch-spec.md)
