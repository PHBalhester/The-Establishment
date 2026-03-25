# Off-Chain Attack Strategy Catalog

**Project:** Dr. Fraudsworth's Finance Factory
**Generated:** 2026-03-07T17:45:00Z
**Total Strategies:** 132
**Tier:** deep

---

## Strategy Generation Sources

This catalog was generated from:
- 24 focus area off-chain context analyses
- Historical off-chain exploit patterns (OC-001 through OC-312)
- Severity calibration guide and incident timeline
- SOS on-chain audit cross-reference (`.audit/ARCHITECTURE.md`)
- GL documentation cross-reference (`Docs/`)
- Novel architectural analysis

---

## Tier 1: CRITICAL Potential (22 strategies)

---

### H001: Webhook Auth Bypass via Missing Env Var

**Category:** API Security, Data Integrity
**Origin:** KB (OC-144, OC-266)
**Estimated Priority:** Tier 1

**Hypothesis:** An attacker can inject fabricated swap events into the database by POSTing to the unauthenticated webhook endpoint, poisoning price charts and SSE broadcasts.

**Attack Vector:**
1. Attacker discovers webhook URL (hardcoded in source: `scripts/webhook-manage.ts:43`)
2. If `HELIUS_WEBHOOK_SECRET` is not set in Railway, auth check is skipped entirely
3. Attacker POSTs crafted JSON with fake transaction signatures and manipulated amounts
4. Events are written to PostgreSQL, aggregated into candles, broadcast via SSE
5. All connected browsers display false price data

**Target Code:**
| File | Lines | Relevance |
|------|-------|-----------|
| `app/app/api/webhooks/helius/route.ts` | 135-141 | Optional auth check |
| `app/db/candle-aggregator.ts` | 170-175 | Upserts price data from webhook |
| `app/lib/sse-manager.ts` | 30-60 | Broadcasts to all subscribers |

**Potential Impact:**
- **Severity if confirmed:** HIGH
- Price chart manipulation → social engineering users into bad trades
- False carnage events displayed
- Database pollution requiring manual cleanup

**Investigation Approach:**
1. Verify whether `HELIUS_WEBHOOK_SECRET` is set in Railway production
2. Check if webhook validates transaction signatures exist on-chain
3. Check if `onConflictDoNothing` on TX signature prevents duplicate injection
4. Assess whether fake events need valid Anchor event structure or accept arbitrary JSON

---

### H002: Helius API Key Extraction from Client Bundle

**Category:** Secrets & Credentials
**Origin:** KB (OC-004, OC-005, OC-011)
**Estimated Priority:** Tier 1

**Hypothesis:** An attacker extracts the Helius API key from the client JavaScript bundle and uses it to exhaust RPC rate limits or manipulate webhook registrations.

**Attack Vector:**
1. Attacker views page source or inspects bundled JS
2. Extracts API key `[REDACTED-DEVNET-KEY]-...` from RPC URL or constants
3. Uses key to: (a) flood RPC requests exhausting rate limit, (b) call Helius webhook management API to register malicious webhooks or delete legitimate ones
4. Service degraded for all users; data pipeline disrupted

**Target Code:**
| File | Lines | Relevance |
|------|-------|-----------|
| `shared/programs.ts` | 22 | API key in DEVNET_RPC_URL |
| `shared/constants.ts` | 474 | HELIUS_API_KEY export |
| `app/lib/connection.ts` | 33 | Frontend imports the key |
| `scripts/webhook-manage.ts` | 28 | Webhook CRUD with same key |

**Potential Impact:**
- **Severity if confirmed:** HIGH
- RPC rate limit exhaustion → service unavailable for all users
- Webhook registration manipulation → data pipeline compromise
- Key is permanently in git history

**Investigation Approach:**
1. Confirm the key is in the production JS bundle (check build output)
2. Test whether the key grants webhook management API access
3. Check Helius rate limits for free-tier keys
4. Verify if the key can be used to create webhooks pointing to attacker-controlled URLs

---

### H003: npm Supply Chain Attack via Gitignored Lockfile

**Category:** Supply Chain
**Origin:** KB (OC-234, OC-240)
**Estimated Priority:** Tier 1

**Hypothesis:** An attacker publishes a compromised patch version of a caret-ranged dependency, which is silently installed on the next Railway deploy because package-lock.json is gitignored.

**Attack Vector:**
1. Attacker compromises or typosquats a dependency (e.g., `@switchboard-xyz/on-demand ^3.7.3`)
2. Publishes malicious patch (e.g., 3.7.4) to npm
3. Next Railway deploy runs `npm install`, resolves to compromised version
4. Malicious code executes in crank runner (has signing wallet) or web app (has DB access)

**Target Code:**
| File | Lines | Relevance |
|------|-------|-----------|
| `.gitignore` | 9 | `package-lock.json` gitignored |
| `package.json` | 8-14 | Caret ranges on 3 runtime deps |
| `railway.toml` | 3 | Build runs npm install |
| `railway-crank.toml` | 3 | Crank build runs npm install |

**Potential Impact:**
- **Severity if confirmed:** CRITICAL
- Full compromise of crank wallet (signing authority)
- Database credential theft
- Arbitrary code execution on Railway servers

**Investigation Approach:**
1. Confirm package-lock.json is not in git (`git ls-files package-lock.json`)
2. Count caret-ranged dependencies that resolve differently between installs
3. Verify Railway build uses `npm install` not `npm ci`
4. Check if any postinstall scripts could execute attacker code

---

### H004: Crank Wallet Key Compromise via Railway Env Var

**Category:** Secrets & Key Management
**Origin:** KB (OC-002, OC-017)
**Estimated Priority:** Tier 1

**Hypothesis:** The crank wallet private key stored as a Railway environment variable could be extracted via Railway dashboard access compromise, log leakage, or supply chain attack.

**Attack Vector:**
1. Attacker gains Railway dashboard access (credential stuffing, phishing, session hijack)
2. Reads `WALLET_KEYPAIR` env var containing raw 64-byte secret key
3. Imports keypair and drains crank wallet SOL balance
4. Or: Signs malicious epoch transitions, carnage executions, vault top-ups

**Target Code:**
| File | Lines | Relevance |
|------|-------|-----------|
| `scripts/crank/crank-provider.ts` | 41-57 | WALLET_KEYPAIR parsing |
| `scripts/crank/crank-runner.ts` | 176-177 | Logs wallet pubkey and RPC URL |

**Potential Impact:**
- **Severity if confirmed:** CRITICAL
- Crank wallet SOL drained
- Attacker controls epoch transitions and carnage execution
- Protocol halted if crank wallet emptied

**Investigation Approach:**
1. Verify Railway access controls (2FA, team permissions)
2. Check if WALLET_KEYPAIR value appears in any logs
3. Verify crank-runner startup logs don't leak the secret key (only pubkey)
4. Check if any npm dependency could access process.env and exfiltrate

---

### H005: Keypairs Committed to Git Repository

**Category:** Secrets & Key Management
**Origin:** KB (OC-001, OC-016)
**Estimated Priority:** Tier 1

**Hypothesis:** Program deploy keypairs and devnet wallet committed to the git repository could be used to impersonate program authorities if the same keys are reused on mainnet.

**Attack Vector:**
1. Attacker clones or views the repository
2. Extracts keypair files from `keypairs/` directory (12 files tracked in git)
3. If mainnet uses the same keypairs, attacker has full signing authority
4. Can call any instruction requiring these keypairs as signer

**Target Code:**
| File | Lines | Relevance |
|------|-------|-----------|
| `keypairs/` | directory | 12 keypair files in git |
| `scripts/deploy/deploy.sh` | varies | Uses keypair files for deploy |

**Potential Impact:**
- **Severity if confirmed:** CRITICAL (if reused on mainnet)
- Program upgrade authority compromise
- Bonding curve authority (already ANY signer, but keypairs enable other admin ops)
- Complete protocol takeover

**Investigation Approach:**
1. List all keypair files tracked by git
2. Check if any are used as program deploy authorities
3. Verify mainnet deployment plan uses different keypairs
4. Check if program upgrade authorities will be burned before mainnet

---

### H006: Webhook Timing Attack on Secret Comparison

**Category:** Cryptographic Operations
**Origin:** KB (OC-148, OC-291)
**Estimated Priority:** Tier 1

**Hypothesis:** The webhook secret comparison uses `!==` (not timing-safe), potentially allowing an attacker to progressively leak the secret byte-by-byte.

**Attack Vector:**
1. Attacker sends many requests with progressively correct Authorization headers
2. Measures response timing differences to determine correct bytes
3. Eventually reconstructs the full webhook secret
4. Uses the secret to forge authenticated webhook requests

**Target Code:**
| File | Lines | Relevance |
|------|-------|-----------|
| `app/app/api/webhooks/helius/route.ts` | 138 | `authHeader !== webhookSecret` |

**Potential Impact:**
- **Severity if confirmed:** MEDIUM (network jitter makes this difficult)
- Webhook secret leaked → authenticated data injection
- Combined with H001 → full data pipeline compromise

**Investigation Approach:**
1. Verify the comparison uses `!==` not `crypto.timingSafeEqual`
2. Assess whether Railway's proxy introduces enough jitter to prevent timing attacks
3. Check secret length (longer secrets are harder to timing-attack)

---

### H007: Cross-Epoch Tax Arbitrage via VRF Observation

**Category:** Cross-Boundary (On-Chain/Off-Chain)
**Origin:** Novel (from SOS ARCHITECTURE.md novel #3)
**Estimated Priority:** Tier 1

**Hypothesis:** An attacker monitors the Switchboard VRF reveal transaction, predicts new tax rates, and front-runs `consume_randomness` to execute trades at old (favorable) rates.

**Attack Vector:**
1. Attacker monitors Switchboard oracle transactions for VRF reveals
2. VRF bytes are public before `consume_randomness` processes them
3. Attacker pre-computes new epoch's tax rates from VRF output
4. Executes swaps at old rates if new rates are higher (or vice versa)
5. `taxes_confirmed` is intentionally unchecked by Tax program (design choice A-10)

**Target Code:**
| File | Lines | Relevance |
|------|-------|-----------|
| `scripts/crank/crank-runner.ts` | VRF lifecycle | consume_randomness timing |
| `app/hooks/useEpochState.ts` | varies | Displays tax rates |

**Potential Impact:**
- **Severity if confirmed:** HIGH
- Tax rate arbitrage on every epoch transition
- Protocol loses expected tax revenue
- Unique to this protocol's per-epoch asymmetric tax design

**Investigation Approach:**
1. Verify VRF reveal bytes are publicly visible before consume_randomness
2. Determine time window between VRF reveal and consume_randomness
3. Check if off-chain crank processes consume_randomness atomically with the reveal
4. Calculate maximum extractable value per epoch transition

---

### H008: SSE Amplification DoS via Webhook Flooding

**Category:** Denial of Service, API Security
**Origin:** Novel
**Estimated Priority:** Tier 1

**Hypothesis:** An attacker combines unauthenticated webhook access with unbounded SSE subscribers to create a novel amplification attack that exhausts server resources.

**Attack Vector:**
1. Attacker opens 1000 SSE connections to `/api/sse/candles` (no auth, no limit)
2. Attacker POSTs batch of 100 fake transactions to webhook (if unauthed)
3. Each transaction triggers 6 candle upserts × 1000 subscriber broadcasts = 600,000 messages
4. Server CPU and memory exhausted; Railway container killed

**Target Code:**
| File | Lines | Relevance |
|------|-------|-----------|
| `app/lib/sse-manager.ts` | 30 | Unbounded subscriber Set |
| `app/app/api/sse/candles/route.ts` | 38 | No auth, no connection limit |
| `app/app/api/webhooks/helius/route.ts` | 135-141 | Optional auth |

**Potential Impact:**
- **Severity if confirmed:** HIGH
- Complete service outage for all users
- Railway container restart loop (3 retries then down)
- Database may be overwhelmed by 600 concurrent upserts

**Investigation Approach:**
1. Confirm SSE manager has no subscriber cap
2. Measure memory per SSE connection
3. Test webhook → candle → SSE broadcast chain for amplification factor
4. Check if Railway's container limits would prevent catastrophic memory exhaustion

---

### H009: Devnet Fallback Causing Mainnet Transaction Failure

**Category:** Infrastructure, Cross-Boundary
**Origin:** Novel
**Estimated Priority:** Tier 1

**Hypothesis:** If `NEXT_PUBLIC_RPC_URL` is not set in a mainnet Railway deployment, the frontend silently falls back to devnet RPC, causing mainnet-signed transactions to be sent to the wrong network.

**Attack Vector:**
1. Deploy to mainnet but forget to set `NEXT_PUBLIC_RPC_URL`
2. Frontend falls back to `DEVNET_RPC_URL` from `shared/programs.ts`
3. Users sign mainnet transactions but they're submitted to devnet
4. Transactions fail silently; users see confusing errors
5. Or: devnet state displayed as mainnet prices → user confusion

**Target Code:**
| File | Lines | Relevance |
|------|-------|-----------|
| `app/lib/connection.ts` | 33 | Fallback to DEVNET_RPC_URL |
| `app/providers/providers.tsx` | 35 | Same fallback chain |
| `shared/programs.ts` | 22 | Hardcoded devnet URL |

**Potential Impact:**
- **Severity if confirmed:** HIGH
- All user transactions fail on mainnet
- Users may think protocol is broken
- No runtime detection of the misconfiguration

**Investigation Approach:**
1. Verify the fallback chain in connection.ts
2. Check if any mainnet guard exists (cluster detection, URL validation)
3. Review mainnet-checklist.md for this item
4. Check if CLUSTER_URL for crank has the same issue

---

### H010: Bonding Curve Authority Theft (Cross-Boundary)

**Category:** Cross-Boundary (On-Chain/Off-Chain)
**Origin:** Novel (from SOS finding)
**Estimated Priority:** Tier 1

**Hypothesis:** The SOS audit found that bonding curve instructions accept ANY signer. An attacker can call `withdraw_graduated_sol` directly, stealing ~1000 SOL per curve (~2000 SOL total). The off-chain graduation script provides no protection.

**Attack Vector:**
1. Wait for both curves to reach `Filled` status
2. Call `prepare_transition` (any signer accepted)
3. Call `withdraw_graduated_sol` for both CRIME and FRAUD curves
4. ~2000 SOL transferred to attacker's wallet
5. Can be bundled atomically in a single transaction

**Target Code:**
| File | Lines | Relevance |
|------|-------|-----------|
| `scripts/graduation/graduate.ts` | 320-366 | Legitimate graduation flow |
| SOS: `programs/bonding_curve/` | Various | ANY signer on 6 instructions |

**Potential Impact:**
- **Severity if confirmed:** CRITICAL
- ~2000 SOL direct theft
- Protocol graduation disrupted
- Users locked out of trading during recovery

**Investigation Approach:**
1. Verify SOS finding still holds (check if authority was added post-audit)
2. Check if off-chain monitoring exists to detect unauthorized graduation
3. Verify the graduation script's expected flow vs attacker's direct call
4. Calculate exact SOL at risk based on curve parameters

---

### H011: Database Connection Without TLS

**Category:** Data Security
**Origin:** KB (OC-156)
**Estimated Priority:** Tier 1

**Hypothesis:** The PostgreSQL connection from the Next.js app and migration runner does not enforce TLS, potentially allowing eavesdropping on database traffic containing swap events and candle data.

**Attack Vector:**
1. If Railway's internal network allows traffic interception (unlikely but possible)
2. Or: DATABASE_URL is changed to point to an external Postgres without SSL
3. All swap event data, candle prices, and migration SQL visible in plaintext

**Target Code:**
| File | Lines | Relevance |
|------|-------|-----------|
| `app/db/connection.ts` | 51 | `postgres(connectionString, { max: 10 })` — no SSL option |
| `app/db/migrate.ts` | 42 | Same pattern |

**Potential Impact:**
- **Severity if confirmed:** MEDIUM
- Swap event data visible in transit (not PII but financial data)
- Migration SQL visible (schema disclosure)
- Railway typically provides SSL — severity depends on Railway's default

**Investigation Approach:**
1. Check if Railway's DATABASE_URL includes `?sslmode=require`
2. Test connection with and without SSL parameter
3. Verify Railway's Postgres instances enforce TLS by default

---

### H012: Float-to-Integer Precision Loss in Swap Amounts

**Category:** Financial Logic
**Origin:** KB (OC-305, OC-310)
**Estimated Priority:** Tier 1

**Hypothesis:** The `Math.floor(parseFloat(amount) * 10 ** decimals)` pattern loses precision for common decimal values, causing users to submit amounts that are 1 lamport/unit less than intended.

**Attack Vector:**
1. User enters 0.1 SOL in swap input
2. `parseFloat("0.1") * 1e9 = 99999999.99999999` (IEEE 754)
3. `Math.floor(99999999.99999999) = 99999999` (should be 100000000)
4. User submits 99999999 lamports instead of 100000000
5. 1 lamport difference — minor per trade but systematic

**Target Code:**
| File | Lines | Relevance |
|------|-------|-----------|
| `app/hooks/useSwap.ts` | 297-300 | toBaseUnits conversion |
| `app/hooks/useStaking.ts` | 499 | Same pattern |
| `app/components/launch/BuyForm.tsx` | 84-86 | BigInt(Math.floor(...)) |

**Potential Impact:**
- **Severity if confirmed:** MEDIUM
- Users systematically lose 1 unit on certain amounts
- Affects all swap and staking operations
- Cumulative impact across many users/trades

**Investigation Approach:**
1. Enumerate which decimal inputs produce precision loss
2. Verify the on-chain impact (does 1 lamport matter?)
3. Check if BuyForm's BigInt conversion has the same issue
4. Propose string-based decimal parsing as fix

---

### H013: Crank Vault Top-Up Without Spending Limit

**Category:** Automation & Bot Security
**Origin:** KB (OC-247, OC-256)
**Estimated Priority:** Tier 1

**Hypothesis:** The crank runner's vault top-up mechanism has no upper spending limit per operation or per epoch, enabling unlimited SOL drainage if the crank logic is exploited.

**Attack Vector:**
1. Attacker manipulates on-chain state to make vault appear perpetually underfunded
2. Crank repeatedly tops up vault with no per-operation cap
3. Crank wallet SOL drained
4. Or: compromised npm dependency triggers excessive top-ups

**Target Code:**
| File | Lines | Relevance |
|------|-------|-----------|
| `scripts/crank/crank-runner.ts` | varies | Vault top-up logic |
| `scripts/crank/crank-runner.ts` | 213-216 | Balance warning but no halt |

**Potential Impact:**
- **Severity if confirmed:** HIGH
- Crank wallet drained of all SOL
- Protocol operations halt (no SOL for fees)
- No alerting to detect the drain

**Investigation Approach:**
1. Find the vault top-up code and check for spending caps
2. Verify if there's a maximum top-up amount per cycle
3. Check if the balance warning at line 213 triggers any action beyond logging
4. Assess whether on-chain state manipulation could trigger excessive top-ups

---

### H014: Quote-Engine Number Overflow on AMM Math

**Category:** Financial Logic
**Origin:** KB (OC-305, OC-307)
**Estimated Priority:** Tier 1

**Hypothesis:** The AMM quote engine uses JavaScript `number` for intermediate calculations that already exceed `Number.MAX_SAFE_INTEGER` at current pool sizes, producing silently incorrect slippage bounds.

**Attack Vector:**
1. Pool reserves: 290M tokens (2.9e14 base units) and 2.5 SOL (2.5e9 lamports)
2. `reserveOut * effectiveInput = 2.9e14 * 2.5e9 = 7.25e23`
3. `Number.MAX_SAFE_INTEGER = 9.007e15` — exceeded by 80,000x
4. Result: silent precision loss in computed output
5. `minimumOutput` set incorrectly → wider slippage window → MEV extraction

**Target Code:**
| File | Lines | Relevance |
|------|-------|-----------|
| `app/lib/swap/quote-engine.ts` | 54-62 | `calculateSwapOutput` uses Number |
| `app/hooks/useSwap.ts` | 407 | minimumOutput from quote |

**Potential Impact:**
- **Severity if confirmed:** HIGH
- Users accept worse rates than intended
- MEV bots exploit the wider slippage window
- Affects every AMM swap operation

**Investigation Approach:**
1. Calculate exact precision loss for typical swap sizes
2. Compare off-chain quote vs on-chain execution for test swaps
3. Determine if the precision loss always favors the protocol (safe) or can go either direction
4. Assess migration to BigInt feasibility

---

### H015: Sandwich Attack on User Swaps (No MEV Protection)

**Category:** MEV & Transaction Ordering
**Origin:** KB (OC-127, OC-128, OC-258)
**Estimated Priority:** Tier 1

**Hypothesis:** User swap transactions are submitted via standard Helius RPC without MEV protection, enabling sandwich attacks especially given the default 5% slippage tolerance.

**Attack Vector:**
1. MEV bot monitors Solana mempool/leader schedule
2. Detects user's swap TX with 5% slippage tolerance
3. Front-runs with buy, user's TX executes at worse rate
4. Back-runs with sell, capturing the spread
5. Default 5% slippage gives MEV bot up to 5% of trade value

**Target Code:**
| File | Lines | Relevance |
|------|-------|-----------|
| `app/hooks/useProtocolWallet.ts` | 87-121 | sendRawTransaction (standard RPC) |
| `app/providers/SettingsProvider.tsx` | varies | Default 5% slippage (500 BPS) |
| `app/hooks/useSwap.ts` | 407 | minimumOutput computation |

**Potential Impact:**
- **Severity if confirmed:** HIGH
- Up to 5% of every swap value extractable by MEV bots
- Thin liquidity pools (bonding curve → AMM graduation) amplify impact
- Users receive significantly less than quoted

**Investigation Approach:**
1. Verify default slippage BPS value
2. Check if any MEV-protection RPCs are configured (Jito, etc.)
3. Assess pool liquidity depth and typical trade sizes
4. Calculate expected MEV extraction per trade

---

### H016: Transfer Hook Init Front-Running (Cross-Boundary)

**Category:** Cross-Boundary
**Origin:** Novel (from SOS finding S005)
**Estimated Priority:** Tier 1

**Hypothesis:** The transfer hook's `initialize_authority` instruction uses a first-caller-wins pattern. An attacker who front-runs deployment could capture the authority, holding all token transfers hostage.

**Attack Vector:**
1. Attacker monitors deployment transactions
2. Calls `initialize_authority` before the legitimate deployer
3. Attacker now controls the whitelist authority
4. Can ransom the authority or brick all token transfers by refusing to whitelist

**Target Code:**
| File | Lines | Relevance |
|------|-------|-----------|
| SOS: Transfer Hook program | initialize_authority | First-caller-wins pattern |
| `scripts/deploy/initialize.ts` | varies | Legitimate init flow |

**Potential Impact:**
- **Severity if confirmed:** CRITICAL
- All CRIME/FRAUD token transfers blocked
- Protocol completely unusable
- No recovery without program redeployment

**Investigation Approach:**
1. Verify SOS finding still applies (S005 NOT FIXED per ARCHITECTURE.md)
2. Check if initialize.ts has any protection against front-running
3. Assess mainnet deployment plan for atomicity
4. Verify if authority can be transferred or only burned

---

### H017: Staking Escrow Rent Depletion (Cross-Boundary)

**Category:** Cross-Boundary
**Origin:** Novel (from SOS finding S001)
**Estimated Priority:** Tier 1

**Hypothesis:** The last staking reward claimer could drain the escrow PDA below rent-exempt minimum, destroying it. Next `deposit_rewards` CPI fails, halting all swap tax distribution.

**Attack Vector:**
1. Attacker claims rewards such that escrow balance falls below rent-exempt minimum
2. Solana runtime destroys the account
3. Tax program's `deposit_rewards` CPI fails (account doesn't exist)
4. All swap taxes accumulate in the tax program with nowhere to go
5. Staking rewards halt for all users

**Target Code:**
| File | Lines | Relevance |
|------|-------|-----------|
| `app/hooks/useStaking.ts` | varies | Claim flow |
| SOS: Staking program | deposit_rewards | CPI target |

**Potential Impact:**
- **Severity if confirmed:** HIGH
- Staking rewards permanently halted
- Tax distribution broken
- Requires program upgrade to fix

**Investigation Approach:**
1. Verify SOS finding status (S001 NOT FIXED per ARCHITECTURE.md)
2. Check if crank has any escrow monitoring
3. Determine minimum rent-exempt balance for escrow PDA
4. Calculate if a single claim can trigger the condition

---

### H018: Graduation Script State File Tampering

**Category:** Business Logic
**Origin:** Novel
**Estimated Priority:** Tier 1

**Hypothesis:** The graduation state file (`graduation-state.json`) has no integrity protection. An attacker with filesystem access could mark steps as completed to skip critical graduation steps.

**Attack Vector:**
1. Attacker gains access to admin machine filesystem
2. Modifies `graduation-state.json` to mark pool creation steps as complete
3. Admin re-runs graduation script, which skips pool creation
4. Protocol stuck in graduated state without AMM pools
5. Users cannot trade

**Target Code:**
| File | Lines | Relevance |
|------|-------|-----------|
| `scripts/graduation/graduate.ts` | 147 | State file read |
| `scripts/graduation/graduate.ts` | 320-366 | Step 2 is irreversible |

**Potential Impact:**
- **Severity if confirmed:** MEDIUM (requires filesystem access)
- Protocol stuck in partially graduated state
- No rollback mechanism
- Users locked out of trading

**Investigation Approach:**
1. Check if state file has any HMAC or signature
2. Verify file permissions
3. Assess whether the script validates completed steps against on-chain state
4. Determine if the irreversible step 2 makes this worse

---

### H019: Crank No Kill Switch or Circuit Breaker

**Category:** Automation & Bot Security
**Origin:** KB (OC-248, OC-256)
**Estimated Priority:** Tier 1

**Hypothesis:** The crank runner has no emergency shutdown mechanism. If a bug or exploit causes the crank to repeatedly submit harmful transactions, there's no way to stop it without Railway access.

**Attack Vector:**
1. On-chain state enters unexpected condition (e.g., carnage loop)
2. Crank repeatedly submits transactions that worsen the situation
3. Each iteration costs SOL from crank wallet
4. No kill switch, no circuit breaker, no spending limit
5. 30-second retry loop continues indefinitely

**Target Code:**
| File | Lines | Relevance |
|------|-------|-----------|
| `scripts/crank/crank-runner.ts` | 308-314 | Catch-all retry |
| `scripts/crank/crank-runner.ts` | varies | No circuit breaker |

**Potential Impact:**
- **Severity if confirmed:** HIGH
- Crank wallet drained
- Unintended on-chain state mutations
- No automated alerting

**Investigation Approach:**
1. Map all transaction types the crank submits
2. Identify which could be harmful if repeated
3. Check for any per-epoch or per-cycle spending limits
4. Verify SIGTERM handler actually stops operations cleanly

---

### H020: IDL Supply Chain Attack via Build Pipeline

**Category:** Supply Chain
**Origin:** Novel
**Estimated Priority:** Tier 1

**Hypothesis:** The `sync-idl.mjs` predev/prebuild hook copies IDL files from `target/idl/` to the frontend. A compromised Rust dependency could generate tampered IDL files that cause the frontend to construct malicious transactions.

**Attack Vector:**
1. Compromised Rust crate in Cargo.lock modifies IDL output during `anchor build`
2. `sync-idl.mjs` copies tampered IDLs to `app/idl/`
3. Frontend deserializes on-chain accounts using wrong type definitions
4. Transaction construction uses wrong instruction arguments
5. Users see correct-looking UI but transactions do something different

**Target Code:**
| File | Lines | Relevance |
|------|-------|-----------|
| `app/scripts/sync-idl.mjs` | varies | IDL copy hook |
| `app/idl/*.json` | varies | Consumed by Anchor client |

**Potential Impact:**
- **Severity if confirmed:** HIGH
- Wrong balances displayed
- Malformed transactions constructed
- Requires Rust supply chain compromise (mitigated by committed Cargo.lock)

**Investigation Approach:**
1. Verify Cargo.lock is committed (confirmed by DEP-01)
2. Check if IDL files are validated against expected schema
3. Verify if IDL changes trigger any human review
4. Assess whether committed IDLs match deployed program IDLs

---

### H021: Patch-Mint-Addresses as Trust Amplifier

**Category:** Supply Chain, Business Logic
**Origin:** Novel
**Estimated Priority:** Tier 1

**Hypothesis:** `patch-mint-addresses.ts` modifies Rust source code at build time based on keypair files on disk. A compromised keypair file would cause wrong mint addresses to be compiled into production programs.

**Attack Vector:**
1. Attacker replaces a mint keypair file in `scripts/deploy/mint-keypairs/`
2. `patch-mint-addresses.ts` reads the compromised keypair
3. Wrong mint address compiled into `constants.rs` files
4. Programs deployed with attacker-controlled mint addresses
5. All token operations reference wrong mints

**Target Code:**
| File | Lines | Relevance |
|------|-------|-----------|
| `scripts/deploy/patch-mint-addresses.ts` | 234-236 | Writes to Rust source |
| `scripts/deploy/build.sh` | 52-58 | Calls patch script before build |

**Potential Impact:**
- **Severity if confirmed:** CRITICAL (if keypair files compromised)
- All token operations use wrong mints
- Funds sent to attacker-controlled addresses
- Requires filesystem access (mitigated by deployment security)

**Investigation Approach:**
1. Check keypair file integrity verification (checksums, signatures)
2. Verify keypair files are properly secured
3. Check if the script validates keypair file format before use
4. Assess deployment machine security posture

---

### H022: Sell Path Zero AMM Slippage (Cross-Boundary)

**Category:** Cross-Boundary
**Origin:** Novel (from SOS finding S010)
**Estimated Priority:** Tier 1

**Hypothesis:** Tax Program passes `minimum_amount_out=0` to AMM on the sell path. The 50% output floor is the only protection, creating a gap between 50% and the user's actual minimum that is extractable by MEV.

**Attack Vector:**
1. User submits sell with 1% slippage (99% of expected output)
2. Tax program passes 0 to AMM for the swap step
3. MEV bot sandwiches the swap
4. On-chain: AMM accepts any output above 0 (50% floor the only real check)
5. Gap between 50% floor and user's 99% minimum is extractable

**Target Code:**
| File | Lines | Relevance |
|------|-------|-----------|
| SOS: Tax program | swap_sol_sell | Passes 0 to AMM |
| `app/hooks/useSwap.ts` | 407 | Client computes minimumOutput |

**Potential Impact:**
- **Severity if confirmed:** HIGH
- Up to 50% of sell output extractable (50% floor to user's actual minimum)
- Affects all sell operations
- On-chain design decision that off-chain cannot compensate for

**Investigation Approach:**
1. Verify SOS finding (S010 MITIGATED but sell path still passes 0)
2. Trace the sell flow: client → Tax program → AMM
3. Calculate the maximum extractable gap
4. Check if the 50% floor is per-swap or aggregate

---

## Tier 2: HIGH Potential (45 strategies)

---

### H023: SSE Connection Exhaustion DoS

**Category:** Denial of Service
**Origin:** KB (OC-143, OC-281)
**Estimated Priority:** Tier 2

**Hypothesis:** SSE endpoint accepts unlimited connections without auth or rate limiting, enabling memory/FD exhaustion.

**Target Code:** `app/lib/sse-manager.ts:30`, `app/app/api/sse/candles/route.ts:38`

**Investigation Approach:** Check subscriber Set for cap; measure per-connection memory; test Railway container limits.

---

### H024: No Rate Limiting on Any API Endpoint

**Category:** Denial of Service
**Origin:** KB (OC-133, OC-135)
**Estimated Priority:** Tier 2

**Hypothesis:** All 6 API routes lack rate limiting, enabling resource exhaustion or abuse.

**Target Code:** `app/app/api/*/route.ts` — all 6 routes

**Investigation Approach:** Verify no middleware rate limiting exists; test concurrent request handling; assess Railway's built-in protections.

---

### H025: CSP unsafe-inline Enabling XSS Escalation

**Category:** Web Security
**Origin:** KB (OC-091)
**Estimated Priority:** Tier 2

**Hypothesis:** `script-src 'unsafe-inline'` in CSP allows inline script execution, negating XSS protection if any injection point exists.

**Target Code:** `app/next.config.ts:9`

**Investigation Approach:** Search for injection vectors (dangerouslySetInnerHTML, innerHTML); check if nonce-based CSP is feasible with Next.js 16.

---

### H026: Missing HSTS Header

**Category:** Transport Security
**Origin:** KB (OC-093, OC-226)
**Estimated Priority:** Tier 2

**Hypothesis:** No HSTS header means first-visit SSL stripping attacks are possible.

**Target Code:** `app/next.config.ts:58-86` (HSTS absent)

**Investigation Approach:** Check if Railway's proxy adds HSTS; verify the header stack.

---

### H027: Iframe Sandbox Weakness (allow-scripts + allow-same-origin)

**Category:** Web Security
**Origin:** KB (OC-092, OC-195)
**Estimated Priority:** Tier 2

**Hypothesis:** DocsModal iframe has `allow-scripts + allow-same-origin` with same-origin source, allowing the iframe to remove its own sandbox.

**Target Code:** `app/components/launch/DocsModal.tsx:107`, `app/components/station/DocsStation.tsx:66`

**Investigation Approach:** Verify iframe source origins; check if docs deployment could be compromised.

---

### H028: Health Endpoint Information Disclosure

**Category:** Information Disclosure
**Origin:** KB (OC-132, OC-134)
**Estimated Priority:** Tier 2

**Hypothesis:** `/api/health` exposes dependency topology (Postgres, Solana RPC) to unauthenticated callers.

**Target Code:** `app/app/api/health/route.ts:28-56`

**Investigation Approach:** Review response body; assess reconnaissance value.

---

### H029: Crank Infinite Retry Without Backoff

**Category:** Automation
**Origin:** KB (OC-249, OC-265)
**Estimated Priority:** Tier 2

**Hypothesis:** Crank retries every 30s on any error without exponential backoff, potentially overwhelming RPC during outages.

**Target Code:** `scripts/crank/crank-runner.ts:308-314`

**Investigation Approach:** Check retry logic; assess RPC rate limit impact; verify error classification.

---

### H030: VRF Wait Loop Potential Infinite Loop

**Category:** Error Handling
**Origin:** KB (OC-268, OC-269)
**Estimated Priority:** Tier 2

**Hypothesis:** `waitForSlotAdvance` in VRF lifecycle could loop infinitely if slot never advances.

**Target Code:** `scripts/crank/crank-runner.ts` (VRF slot polling)

**Investigation Approach:** Find the slot polling code; check for timeout/max iterations.

---

### H031: No unhandledRejection Handler in Crank

**Category:** Error Handling
**Origin:** KB (OC-268, OC-269)
**Estimated Priority:** Tier 2

**Hypothesis:** Crank runner has no global `unhandledRejection` or `uncaughtException` handler; unhandled async errors could crash the process silently.

**Target Code:** `scripts/crank/crank-runner.ts` (global handlers)

**Investigation Approach:** Search for process.on('unhandledRejection'); check if Railway restarts cover this.

---

### H032: WebSocket Reconnection Loss of Events

**Category:** State Synchronization
**Origin:** KB (OC-125)
**Estimated Priority:** Tier 2

**Hypothesis:** No WebSocket reconnection logic means dropped connections lose on-chain events, causing stale state display.

**Target Code:** `app/hooks/useEpochState.ts`, `app/hooks/useCurveState.ts`

**Investigation Approach:** Check WebSocket subscription code for reconnection/recovery.

---

### H033: Candle Close Price Ordering from Out-of-Order Webhooks

**Category:** Race Conditions
**Origin:** KB (OC-271, OC-275)
**Estimated Priority:** Tier 2

**Hypothesis:** Concurrent webhooks from different Helius nodes may deliver swap events out of order, causing candle close price to reflect an earlier trade.

**Target Code:** `app/db/candle-aggregator.ts:170-175`

**Investigation Approach:** Check if close price uses timestamp ordering or last-write-wins.

---

### H034: Double-Submit in useSwap Without Guard

**Category:** Race Conditions
**Origin:** KB (OC-271, OC-272)
**Estimated Priority:** Tier 2

**Hypothesis:** No double-submit guard in useSwap allows users to accidentally submit the same swap twice if they click rapidly.

**Target Code:** `app/hooks/useSwap.ts` (submit handler)

**Investigation Approach:** Check for isSubmitting guard; verify status state prevents reentry.

---

### H035: DB Connection Pool Exhaustion

**Category:** Denial of Service
**Origin:** KB (OC-158, OC-281)
**Estimated Priority:** Tier 2

**Hypothesis:** Max 10 connections with 6 parallel candle writes per webhook could exhaust the pool during high-volume periods.

**Target Code:** `app/db/connection.ts` (max: 10), `app/db/candle-aggregator.ts` (6 parallel)

**Investigation Approach:** Calculate max concurrent queries per webhook; assess pool saturation point.

---

### H036: Staking Rewards Comment Math Error

**Category:** Financial Logic
**Origin:** KB (OC-312)
**Estimated Priority:** Tier 2

**Hypothesis:** Comment in rewards.ts claims `5e17 < 9e15` which is mathematically wrong. If a future developer relies on this to remove BigInt safety, precision loss could occur.

**Target Code:** `app/lib/staking/rewards.ts:79-82`

**Investigation Approach:** Verify the comment; check if any code relies on the claim; confirm BigInt pipeline is intact.

---

### H037: Mixed-Denomination Fee Display

**Category:** Business Logic
**Origin:** KB (OC-310)
**Estimated Priority:** Tier 2

**Hypothesis:** Sell fee percentage in useSwap sums SOL-denominated tax and token-denominated LP fee, producing misleading display.

**Target Code:** `app/hooks/useSwap.ts:434-435`

**Investigation Approach:** Trace the fee calculation; compare with route-engine BPS approach.

---

### H038: Split Route Zero Fee Display

**Category:** Business Logic
**Origin:** KB (OC-300)
**Estimated Priority:** Tier 2

**Hypothesis:** Split routes hardcode `totalLpFee: 0` and `totalTax: 0`, potentially confusing downstream consumers.

**Target Code:** `app/hooks/useRoutes.ts:176-177`

**Investigation Approach:** Check if any code checks these values for decisions vs display.

---

### H039: skipPreflight on Bonding Curve Transactions

**Category:** Transaction Construction
**Origin:** KB (OC-108)
**Estimated Priority:** Tier 2

**Hypothesis:** BuyForm and SellForm use `skipPreflight: true` unnecessarily for legacy transactions, wasting user SOL on failed TXs.

**Target Code:** `app/components/launch/BuyForm.tsx:188-189`, `app/components/launch/SellForm.tsx`

**Investigation Approach:** Verify if skipPreflight is needed for bonding curve TXs (legacy, not v0).

---

### H040: Default 5% Slippage Too High for Thin Pools

**Category:** MEV
**Origin:** KB (OC-129)
**Estimated Priority:** Tier 2

**Hypothesis:** Default 500 BPS slippage tolerance is excessive for thin liquidity pools, especially post-graduation with small initial seed.

**Target Code:** `app/providers/SettingsProvider.tsx` (default slippageBps)

**Investigation Approach:** Check default value; assess pool liquidity at graduation; calculate MEV opportunity.

---

### H041: No Compute Budget on Bonding Curve Transactions

**Category:** Transaction Construction
**Origin:** KB (OC-112)
**Estimated Priority:** Tier 2

**Hypothesis:** Bonding curve purchase/sell transactions don't set compute budget, risking compute exhaustion failures.

**Target Code:** `app/components/launch/BuyForm.tsx`, `app/components/launch/SellForm.tsx`

**Investigation Approach:** Check if setComputeUnitLimit/setComputeUnitPrice instructions are added.

---

### H042: Graduation Env Override Without Bounds Validation

**Category:** Business Logic
**Origin:** KB (OC-304)
**Estimated Priority:** Tier 2

**Hypothesis:** `Number(process.env.SOL_POOL_SEED_SOL_OVERRIDE)` accepts any value without bounds checking, including 0 or NaN.

**Target Code:** `scripts/graduation/graduate.ts:102-107`

**Investigation Approach:** Test with edge-case values; check fallback behavior for NaN.

---

### H043: WALLET Env Var Path Traversal

**Category:** Path Traversal
**Origin:** KB (OC-062)
**Estimated Priority:** Tier 2

**Hypothesis:** WALLET env var used as file path without directory containment check. Could read arbitrary files if env var is controlled.

**Target Code:** `scripts/crank/crank-provider.ts:60-73`, `scripts/deploy/lib/connection.ts:69-84`

**Investigation Approach:** Verify path.resolve usage; check if file contents must be valid JSON keypair.

---

### H044: Sentry DSN Spam via Client Exposure

**Category:** Information Disclosure
**Origin:** KB (OC-202)
**Estimated Priority:** Tier 2

**Hypothesis:** Exposed Sentry DSN in client bundle allows attacker to flood the Sentry project with garbage events.

**Target Code:** `app/instrumentation-client.ts:37`, `app/lib/sentry.ts:30`

**Investigation Approach:** Check if Sentry has rate limiting configured; assess quota impact.

---

### H045: No Server-Side Error Reporting

**Category:** Monitoring
**Origin:** KB (OC-269)
**Estimated Priority:** Tier 2

**Hypothesis:** Server-side `instrumentation.ts` is a no-op. Server errors only visible in Railway logs with no alerting.

**Target Code:** `app/instrumentation.ts:6`

**Investigation Approach:** Verify the no-op; assess impact on incident detection time.

---

### H046: RPC Response Not Validated for Financial Data

**Category:** RPC Security
**Origin:** KB (OC-114, OC-116)
**Estimated Priority:** Tier 2

**Hypothesis:** Pool reserve data from RPC is used directly for quote calculations without validation.

**Target Code:** `app/hooks/usePoolPrices.ts`, `app/lib/swap/quote-engine.ts`

**Investigation Approach:** Check if RPC responses are validated for reasonable ranges; assess spoofing risk.

---

### H047: Single RPC Provider (Helius) No Failover

**Category:** RPC Security
**Origin:** KB (OC-115)
**Estimated Priority:** Tier 2

**Hypothesis:** The entire protocol depends on Helius RPC with no failover. Helius outage = complete service disruption.

**Target Code:** `app/lib/connection.ts`, `scripts/crank/crank-provider.ts`

**Investigation Approach:** Verify no secondary RPC configured; assess Helius uptime history.

---

### H048: Sign-Then-Send Bypasses Wallet Simulation

**Category:** Transaction Construction
**Origin:** KB (OC-108, OC-111)
**Estimated Priority:** Tier 2

**Hypothesis:** `signTransaction()` + `sendRawTransaction()` bypasses wallet's built-in simulation, hiding transaction errors from users.

**Target Code:** `app/hooks/useProtocolWallet.ts:87-121`

**Investigation Approach:** Verify the sign-then-send flow; check if any pre-submission simulation exists.

---

### H049: Webhook No Replay Protection

**Category:** API Security
**Origin:** KB (OC-145)
**Estimated Priority:** Tier 2

**Hypothesis:** Webhook handler has no timestamp validation, allowing replay of previously captured legitimate webhook payloads.

**Target Code:** `app/app/api/webhooks/helius/route.ts`

**Investigation Approach:** Check for timestamp/nonce in webhook payload validation.

---

### H050: Webhook No Body Size Limit

**Category:** Denial of Service
**Origin:** KB (OC-135, OC-280)
**Estimated Priority:** Tier 2

**Hypothesis:** No explicit body size limit on webhook POST; large payloads could exhaust server memory.

**Target Code:** `app/app/api/webhooks/helius/route.ts`

**Investigation Approach:** Check Next.js default body size limits; test with large payloads.

---

### H051: CustomEvent Balance Sync as RPC DoS

**Category:** Denial of Service, Frontend
**Origin:** Novel
**Estimated Priority:** Tier 2

**Hypothesis:** Malicious browser extension or XSS could rapidly dispatch `token-balances-refresh` events, triggering massive RPC request bursts.

**Target Code:** `app/hooks/useTokenBalances.ts:172`

**Investigation Approach:** Check if there's a debounce on the event handler; assess RPC rate limit impact.

---

### H052: Version Mismatch @solana/web3.js Between Workspaces

**Category:** Supply Chain
**Origin:** KB (OC-242)
**Estimated Priority:** Tier 2

**Hypothesis:** Root uses `@solana/web3.js ^1.95.5` while app uses `1.98.4`. Different versions could produce different PDA derivations or TX serialization.

**Target Code:** `package.json` vs `app/package.json`

**Investigation Approach:** Compare version resolutions; test PDA derivation consistency.

---

### H053: Pool Reserve Read Without Owner Check (Cross-Boundary)

**Category:** Cross-Boundary
**Origin:** Novel (from SOS finding)
**Estimated Priority:** Tier 2

**Hypothesis:** `execute_carnage` reads pool reserves at raw byte offsets without verifying AMM program ownership. Spoofed reserves could set invalid slippage floor.

**Target Code:** SOS: Epoch program (execute_carnage), Tax program (read_pool_reserves)

**Investigation Approach:** Verify if off-chain code also uses raw byte reads; check owner verification.

---

### H054: Carnage Fallback MEV Sandwich (Cross-Boundary)

**Category:** Cross-Boundary, MEV
**Origin:** Novel (from SOS)
**Estimated Priority:** Tier 2

**Hypothesis:** After the 50-slot lock expires, the Carnage fallback path is permissionless and sandwichable by MEV bots.

**Target Code:** `scripts/crank/crank-runner.ts` (carnage execution), SOS: `execute_carnage`

**Investigation Approach:** Verify the 50-slot lock mechanism; check fallback path timing.

---

### H055: No CI/CD Pipeline or Automated Testing on PR

**Category:** Supply Chain
**Origin:** KB (OC-243)
**Estimated Priority:** Tier 2

**Hypothesis:** No `.github/workflows/`, no automated tests on PR, no dependency scanning. All quality gates are manual.

**Target Code:** Project-wide absence

**Investigation Approach:** Verify no CI/CD config exists; assess deployment review process.

---

### H056: Deprecated npm Packages with Known Vulnerabilities

**Category:** Supply Chain
**Origin:** KB (OC-238)
**Estimated Priority:** Tier 2

**Hypothesis:** 7 deprecated transitive packages including `glob` (security vulnerabilities) remain in the dependency tree.

**Target Code:** `package-lock.json` (on disk, not committed)

**Investigation Approach:** Run `npm audit`; assess glob vulnerability applicability.

---

### H057: 11 Install Script Packages Without --ignore-scripts

**Category:** Supply Chain
**Origin:** KB (OC-240, OC-216)
**Estimated Priority:** Tier 2

**Hypothesis:** 11 packages run postinstall hooks during npm install without `--ignore-scripts`. A compromised package could execute arbitrary code.

**Target Code:** `package-lock.json` (install scripts), Railway build process

**Investigation Approach:** List packages with install scripts; assess risk of each; check for `--ignore-scripts` usage.

---

### H058: Unredacted RPC URL in Crank Logs

**Category:** Information Disclosure
**Origin:** KB (OC-172)
**Estimated Priority:** Tier 2

**Hypothesis:** Crank runner logs `CLUSTER_URL` raw at startup, potentially exposing the Helius API key in Railway logs.

**Target Code:** `scripts/crank/crank-runner.ts:177`

**Investigation Approach:** Check if CLUSTER_URL contains API key; compare with VRF validator redaction pattern.

---

### H059: COMMITMENT Env Var Unsafe Cast

**Category:** Error Handling
**Origin:** KB (OC-221)
**Estimated Priority:** Tier 2

**Hypothesis:** `process.env.COMMITMENT as anchor.web3.Commitment` performs an unsafe TypeScript cast. Invalid values propagate to RPC.

**Target Code:** `scripts/crank/crank-provider.ts:37`

**Investigation Approach:** Check what happens with invalid commitment values at runtime.

---

### H060: pda-manifest.json Contains API Key

**Category:** Secrets
**Origin:** KB (OC-016)
**Estimated Priority:** Tier 2

**Hypothesis:** Generated manifest file contains full Helius RPC URL with API key, potentially committed to git.

**Target Code:** `scripts/deploy/pda-manifest.json:3`

**Investigation Approach:** Check if file is git-tracked; verify git history.

---

### H061: No Negative Amount Guards on Quote Primitives

**Category:** Financial Logic
**Origin:** KB (OC-301, OC-311)
**Estimated Priority:** Tier 2

**Hypothesis:** `quoteSolBuy` and `quoteSolSell` don't validate that inputs are positive. Negative values produce reversed calculations.

**Target Code:** `app/lib/swap/quote-engine.ts:132-156`

**Investigation Approach:** Test with negative inputs; verify all calling paths validate first.

---

### H062: Candle Aggregator Float Price Precision

**Category:** Financial Logic
**Origin:** KB (OC-306)
**Estimated Priority:** Tier 2

**Hypothesis:** Candle price computed via float division accumulates rounding errors over time.

**Target Code:** `app/db/candle-aggregator.ts:170-175`

**Investigation Approach:** Assess impact of accumulated float errors on chart display.

---

### H063: Demo Mode Hook Violation

**Category:** Frontend
**Origin:** KB (OC-299)
**Estimated Priority:** Tier 2

**Hypothesis:** `useCurveState.ts:211` returns before useState calls when DEMO_MODE is true, violating React's rules-of-hooks.

**Target Code:** `app/hooks/useCurveState.ts:168-218`

**Investigation Approach:** Verify if DEMO_MODE is build-time constant; check for runtime toggle risk.

---

### H064: ALT Cache Stale Data

**Category:** Transaction Construction
**Origin:** KB (OC-116)
**Estimated Priority:** Tier 2

**Hypothesis:** Address Lookup Table cached in `alt-address.json` could become stale if ALT is closed/recreated, causing TX construction failures.

**Target Code:** `scripts/e2e/lib/alt-helper.ts:48`

**Investigation Approach:** Check ALT validation before use; assess staleness detection.

---

### H065: WSOL ATA Race Condition

**Category:** Transaction Construction
**Origin:** KB (OC-271)
**Estimated Priority:** Tier 2

**Hypothesis:** WSOL ATA creation/close in swap path could race with concurrent swaps from the same wallet.

**Target Code:** `app/hooks/useSwap.ts` (WSOL handling)

**Investigation Approach:** Check for concurrent swap protection; verify ATA lifecycle.

---

### H066: Dependency Confusion on @dr-fraudsworth/shared

**Category:** Supply Chain
**Origin:** KB (OC-237)
**Estimated Priority:** Tier 2

**Hypothesis:** An attacker could publish `@dr-fraudsworth/shared` to public npm, potentially confusing npm resolution.

**Target Code:** `app/package.json:18` (workspace dependency)

**Investigation Approach:** Check if package name is registered on npm; verify workspace resolution priority.

---

### H067: Railway Migration Injection

**Category:** Infrastructure
**Origin:** Novel
**Estimated Priority:** Tier 2

**Hypothesis:** `preDeployCommand: npx tsx app/db/migrate.ts` runs migrations before the new version starts. Malicious migration files could execute arbitrary SQL.

**Target Code:** `railway.toml:5`, `app/db/migrate.ts`

**Investigation Approach:** Check migration file validation; assess git access controls.

---

## Tier 3: MEDIUM-LOW Potential (65 strategies)

---

### H068: BuyForm Cap Check Validation Race

**Category:** Business Logic
**Origin:** KB (OC-271)
**Estimated Priority:** Tier 3

**Hypothesis:** BuyForm balance check may clear validation error before cap check runs due to debounce timing.

**Target Code:** `app/components/launch/BuyForm.tsx:122-144`

---

### H069: No Minimum Sell Amount in SellForm

**Category:** Business Logic
**Origin:** KB (OC-309)
**Estimated Priority:** Tier 3

**Hypothesis:** SellForm has no minimum token sell amount, allowing dust sells that waste TX fees.

**Target Code:** `app/components/launch/SellForm.tsx:100-158`

---

### H070: EPOCH_DURATION_SECONDS Hardcoded to Devnet

**Category:** Financial Logic
**Origin:** KB (OC-306)
**Estimated Priority:** Tier 3

**Hypothesis:** `EPOCH_DURATION_SECONDS = 40` is devnet-specific. Wrong APR display on mainnet if not updated.

**Target Code:** `app/lib/staking/rewards.ts:108-114`

---

### H071: React Override Forces React 19 Globally

**Category:** Supply Chain
**Origin:** KB (OC-242)
**Estimated Priority:** Tier 3

**Hypothesis:** `overrides: { react: "19.2.3" }` forces React 19 across all workspace packages, potentially breaking incompatible transitive dependencies.

**Target Code:** `package.json:26-28`

---

### H072: Price Impact Additive Not Multiplicative

**Category:** Financial Logic
**Origin:** KB (OC-306)
**Estimated Priority:** Tier 3

**Hypothesis:** Multi-hop price impact is summed (additive) instead of compounded (multiplicative), slightly underestimating impact.

**Target Code:** `app/lib/swap/route-engine.ts:322-325`

---

### H073: DB Connection Singleton Race on Cold Start

**Category:** Race Conditions
**Origin:** KB (OC-274)
**Estimated Priority:** Tier 3

**Hypothesis:** Lazy Proxy DB connection singleton could race on cold start with concurrent API requests.

**Target Code:** `app/db/connection.ts:37-79`

---

### H074: No localStorage Cleanup on Wallet Disconnect

**Category:** Frontend
**Origin:** KB (OC-188)
**Estimated Priority:** Tier 3

**Hypothesis:** Settings persist across wallet sessions. Future sensitive data additions would inherit this gap.

**Target Code:** `app/components/wallet/WalletButton.tsx:54-59`

---

### H075: 100% Slippage Allowed

**Category:** Transaction Construction
**Origin:** KB (OC-129)
**Estimated Priority:** Tier 3

**Hypothesis:** No upper bound on slippage setting. 100% (10000 BPS) effectively disables slippage protection.

**Target Code:** `app/providers/SettingsProvider.tsx` (slippage validation)

---

### H076: Crank Logs Wallet Balance

**Category:** Information Disclosure
**Origin:** KB (OC-172)
**Estimated Priority:** Tier 3

**Hypothesis:** Wallet balance logged every cycle to Railway stdout. Provides operational intelligence.

**Target Code:** `scripts/crank/crank-runner.ts:213-216`

---

### H077: Railway No Resource Limits

**Category:** Infrastructure
**Origin:** KB (OC-211)
**Estimated Priority:** Tier 3

**Hypothesis:** No memory/CPU limits in Railway TOML configs. Runaway processes consume entire plan allocation.

**Target Code:** `railway.toml`, `railway-crank.toml`, `railway-docs.toml`

---

### H078: No Structured Logging

**Category:** Monitoring
**Origin:** KB (OC-176)
**Estimated Priority:** Tier 3

**Hypothesis:** Raw console.log/console.error makes log parsing and alerting difficult.

**Target Code:** All TypeScript files (674 console.log occurrences)

---

### H079: SOL Price Proxy 60s Cache Staleness

**Category:** Data Integrity
**Origin:** KB (OC-116)
**Estimated Priority:** Tier 3

**Hypothesis:** SOL price cache expires every 60s. During volatile markets, displayed USD values could be misleading.

**Target Code:** `app/app/api/sol-price/route.ts` (60s cache)

---

### H080: No X-Permitted-Cross-Domain-Policies Header

**Category:** Web Security
**Origin:** KB (OC-094)
**Estimated Priority:** Tier 3

**Hypothesis:** Missing header allows Flash/PDF cross-domain policy exploitation (low impact in modern browsers).

**Target Code:** `app/next.config.ts:58-86`

---

### H081: connect-src Missing CoinGecko/Binance

**Category:** Web Security
**Origin:** KB (OC-090)
**Estimated Priority:** Tier 3

**Hypothesis:** CSP connect-src doesn't include CoinGecko/Binance domains. Currently safe (server-side proxy) but fragile.

**Target Code:** `app/next.config.ts:19`

---

### H082: Logger logFilePath Parameter Not Validated

**Category:** Path Traversal
**Origin:** KB (OC-063)
**Estimated Priority:** Tier 3

**Hypothesis:** `createLogger(logFilePath?)` accepts optional path without validation. Currently safe (no callers pass it).

**Target Code:** `scripts/deploy/lib/logger.ts:64`

---

### H083: IDL Name Parameter Not Validated Against Allowlist

**Category:** Path Traversal
**Origin:** KB (OC-062)
**Estimated Priority:** Tier 3

**Hypothesis:** `loadIdl(name)` concatenates name into path. Currently safe (all callers use hardcoded strings).

**Target Code:** `scripts/crank/crank-provider.ts:114`

---

### H084: Shared Constants Drift from On-Chain

**Category:** Cross-Boundary
**Origin:** Novel
**Estimated Priority:** Tier 3

**Hypothesis:** `shared/constants.ts` constants (fee BPS, conversion rate) could drift from on-chain values during upgrades.

**Target Code:** `shared/constants.ts`, `app/lib/curve/curve-constants.ts`

---

### H085: Health Endpoint Always Returns 200

**Category:** Monitoring
**Origin:** KB (OC-132)
**Estimated Priority:** Tier 3

**Hypothesis:** Degraded state returns HTTP 200. Monitoring tools relying on status codes miss failures.

**Target Code:** `app/app/api/health/route.ts:49-55`

---

### H086: No Crank Health Check in Railway

**Category:** Automation
**Origin:** KB (OC-251)
**Estimated Priority:** Tier 3

**Hypothesis:** Crank service has no health check. If it hangs without crashing, Railway won't restart it.

**Target Code:** `railway-crank.toml` (no healthCheckPath)

---

### H087: Shared Package exports raw TypeScript

**Category:** Supply Chain
**Origin:** KB (OC-245)
**Estimated Priority:** Tier 3

**Hypothesis:** `shared/package.json` uses `main: "index.ts"`. Can only be consumed via Next.js transpilePackages. Fragile.

**Target Code:** `shared/package.json:6`

---

### H088: Auto-Reset Timer in useSwap

**Category:** Business Logic
**Origin:** KB (OC-271)
**Estimated Priority:** Tier 3

**Hypothesis:** 10-second auto-reset timer after confirmed state. If timer fires during new swap setup, state confusion.

**Target Code:** `app/hooks/useSwap.ts:774-776`

---

### H089: Error Truncation to 300 Characters

**Category:** Error Handling
**Origin:** KB (OC-267)
**Estimated Priority:** Tier 3

**Hypothesis:** Error messages truncated to 300 chars lose diagnostic information for complex errors.

**Target Code:** Various error handlers

---

### H090: Client Fetch Without Timeouts

**Category:** Error Handling
**Origin:** KB (OC-283)
**Estimated Priority:** Tier 3

**Hypothesis:** Some client-side fetch calls don't set AbortSignal.timeout, hanging indefinitely on unresponsive servers.

**Target Code:** Various hooks using fetch

---

### H091: No Distributed Lock for Crank

**Category:** Race Conditions
**Origin:** KB (OC-264)
**Estimated Priority:** Tier 3

**Hypothesis:** If multiple crank instances run, they could race on epoch transitions and VRF operations.

**Target Code:** `scripts/crank/crank-runner.ts`

---

### H092: SSE Single-Process Only

**Category:** Infrastructure
**Origin:** KB (OC-277)
**Estimated Priority:** Tier 3

**Hypothesis:** SSE manager uses in-memory state. Horizontal scaling would break SSE broadcasts.

**Target Code:** `app/lib/sse-manager.ts:8`

---

### H093: NEXT_PUBLIC_SENTRY_DSN Spam

**Category:** Information Disclosure
**Origin:** KB (OC-202)
**Estimated Priority:** Tier 3

**Hypothesis:** Exposed Sentry DSN enables garbage event flooding, exhausting quota.

**Target Code:** `app/lib/sentry.ts:30`

---

### H094: Crank Manifest Poisoning

**Category:** Automation
**Origin:** KB (OC-265)
**Estimated Priority:** Tier 3

**Hypothesis:** PDA manifest loaded from env var or file. Poisoned manifest could cause crank to operate on wrong PDAs.

**Target Code:** `scripts/crank/crank-provider.ts:146-154`

---

### H095: Deploy Scripts Source .env with set -a

**Category:** Infrastructure
**Origin:** KB (OC-221)
**Estimated Priority:** Tier 3

**Hypothesis:** `set -a && source .env` exports ALL variables to child processes, potentially exposing secrets.

**Target Code:** `scripts/deploy/deploy-all.sh`

---

### H096: BN to Number Conversion for Event Amounts

**Category:** Financial Logic
**Origin:** KB (OC-307)
**Estimated Priority:** Tier 3

**Hypothesis:** `bn.toNumber()` in event-parser.ts could lose precision for very large swap amounts.

**Target Code:** `app/lib/event-parser.ts:161-174`

---

### H097: Graduation Irreversibility Window

**Category:** Business Logic
**Origin:** Novel
**Estimated Priority:** Tier 3

**Hypothesis:** Between step 2 (graduation committed) and steps 7-8 (pools created), users cannot trade. Extended window = DoS.

**Target Code:** `scripts/graduation/graduate.ts:320-366`

---

### H098: Quote Engine Stale Data from Processed Commitment

**Category:** State Synchronization
**Origin:** KB (OC-117, OC-126)
**Estimated Priority:** Tier 3

**Hypothesis:** Pool reserves read at "confirmed" commitment could be rolled back, producing wrong quotes.

**Target Code:** `app/hooks/usePoolPrices.ts`, `app/lib/connection.ts`

---

### H099: No Max Trade Size Limit

**Category:** Financial Logic
**Origin:** KB (OC-255)
**Estimated Priority:** Tier 3

**Hypothesis:** No maximum trade size in AMM quote/swap path. Extremely large trades could cause unexpected behavior.

**Target Code:** `app/hooks/useSwap.ts`, `app/lib/swap/quote-engine.ts`

---

### H100: Dual Seed Registry Drift

**Category:** Cross-Boundary
**Origin:** KB (OC-130)
**Estimated Priority:** Tier 3

**Hypothesis:** PDA seeds defined in both on-chain constants and off-chain code could drift if one side changes.

**Target Code:** `scripts/deploy/lib/pda-manifest.ts`, `shared/constants.ts`

---

### H101: WSOL Intermediary DoS (Cross-Boundary)

**Category:** Cross-Boundary
**Origin:** Novel (from SOS novel #7)
**Estimated Priority:** Tier 3

**Hypothesis:** If swap_authority PDA lamports drained below rent-exempt for WSOL intermediary, all sell operations halt.

**Target Code:** SOS: Tax program (swap_sol_sell)

---

### H102: Cross-Program Upgrade Cascade (Cross-Boundary)

**Category:** Cross-Boundary
**Origin:** Novel (from SOS novel #8)
**Estimated Priority:** Tier 3

**Hypothesis:** Fixing one program requires rebuilding all programs that reference its ID. Non-atomic upgrade window.

**Target Code:** `scripts/deploy/deploy-all.sh`, `scripts/deploy/build.sh`

---

### H103: Bounty Rent-Exempt Gap (Cross-Boundary)

**Category:** Cross-Boundary
**Origin:** Novel (from SOS H001)
**Estimated Priority:** Tier 3

**Hypothesis:** `trigger_epoch_transition` checks `vault_balance >= TRIGGER_BOUNTY_LAMPORTS` without accounting for rent-exempt minimum. Crank auto-tops-up as mitigation.

**Target Code:** `scripts/crank/crank-runner.ts` (vault top-up)

---

### H104: EpochState Layout Coupling (Cross-Boundary)

**Category:** Cross-Boundary
**Origin:** Novel (from SOS)
**Estimated Priority:** Tier 3

**Hypothesis:** Tax Program's EpochState mirror uses raw byte offsets. Layout changes silently corrupt tax rate reads.

**Target Code:** SOS: Tax program EpochState mirror

---

### H105: Mainnet Pubkey::default() Placeholders

**Category:** Cross-Boundary
**Origin:** Novel (from SOS A-9)
**Estimated Priority:** Tier 3

**Hypothesis:** 8+ `Pubkey::default()` placeholders across 3 programs must be replaced before mainnet deploy.

**Target Code:** SOS: Tax, BondingCurve, ConversionVault programs

---

### H106: No Emergency Pause Mechanism (Cross-Boundary)

**Category:** Cross-Boundary
**Origin:** Novel (from SOS)
**Estimated Priority:** Tier 3

**Hypothesis:** Zero pause/freeze/emergency mechanisms across all 7 programs. Relies on program upgrade for emergency response.

**Target Code:** All 7 on-chain programs

---

### H107: Dual-Curve Grief Attack (Cross-Boundary)

**Category:** Cross-Boundary
**Origin:** Novel (from SOS novel #4)
**Estimated Priority:** Tier 3

**Hypothesis:** Strategically prevent one curve from filling to force both into refund mode. Costs only gas.

**Target Code:** SOS: BondingCurve program (mark_failed)

---

### H108: Carnage VRF Predictability Window (Cross-Boundary)

**Category:** Cross-Boundary
**Origin:** Novel (from SOS novel #6)
**Estimated Priority:** Tier 3

**Hypothesis:** VRF reveal bytes are public on Switchboard before consume_randomness. MEV can front-run Carnage.

**Target Code:** `scripts/crank/crank-runner.ts` (VRF lifecycle)

---

### H109: Conversion Vault Whitelist Before Authority Burn

**Category:** Cross-Boundary
**Origin:** Novel (from SOS A-8)
**Estimated Priority:** Tier 3

**Hypothesis:** If conversion vault not whitelisted before transfer hook authority burned, all vault conversions brick.

**Target Code:** `scripts/deploy/initialize.ts`

---

### H110: No Timelock on Admin Actions

**Category:** Cross-Boundary
**Origin:** Novel (from SOS)
**Estimated Priority:** Tier 3

**Hypothesis:** No timelock on any admin operation. Compromised admin key = immediate action with no delay.

**Target Code:** All admin-gated instructions

---

### H111: RPC Fallback to devnet in Crank

**Category:** Infrastructure
**Origin:** KB (OC-221)
**Estimated Priority:** Tier 3

**Hypothesis:** Crank's `CLUSTER_URL` defaults to `http://localhost:8899` if unset. Wrong network operations.

**Target Code:** `scripts/crank/crank-provider.ts:35`

---

### H112: Audio Manager Math.random() (False Positive Check)

**Category:** Cryptographic Operations
**Origin:** KB (OC-286) — Expected false positive
**Estimated Priority:** Tier 3

**Hypothesis:** Math.random() used in audio-manager.ts for playlist shuffling. Verify it's not used for security purposes.

**Target Code:** `app/lib/audio-manager.ts:343,353`

---

### H113: Split Route MEV Observability

**Category:** MEV
**Origin:** Novel
**Estimated Priority:** Tier 3

**Hypothesis:** Split route ratio visible in atomic TX. MEV bot can front-run the larger leg.

**Target Code:** `app/lib/swap/split-router.ts`, `app/hooks/useSwap.ts`

---

### H114: globalThis Singleton HMR Leak

**Category:** Frontend
**Origin:** KB (OC-277)
**Estimated Priority:** Tier 3

**Hypothesis:** globalThis caching for HMR could leak state between requests in production edge cases.

**Target Code:** `app/db/connection.ts:53`, `app/lib/sse-manager.ts`

---

### H115: No CORS Configuration (Verify Correctness)

**Category:** Web Security
**Origin:** KB (OC-088)
**Estimated Priority:** Tier 3

**Hypothesis:** No explicit CORS config. Verify this is correct (all API calls are same-origin).

**Target Code:** `app/next.config.ts`

---

### H116: Privy Chain Configuration

**Category:** Wallet Integration
**Origin:** KB (OC-120)
**Estimated Priority:** Tier 3

**Hypothesis:** Privy `chain: "solana:devnet"` must be changed for mainnet. Missing change = mainnet TX failures.

**Target Code:** Wallet integration code

---

### H117: Webhook Transaction Signature Uniqueness

**Category:** Data Integrity
**Origin:** KB (OC-146)
**Estimated Priority:** Tier 3

**Hypothesis:** `onConflictDoNothing` on TX signature prevents duplicate events but doesn't validate signatures exist on-chain.

**Target Code:** `app/db/candle-aggregator.ts`

---

### H118: SOL Price Proxy Timeout Handling

**Category:** Error Handling
**Origin:** KB (OC-283)
**Estimated Priority:** Tier 3

**Hypothesis:** SOL price proxy has 5s timeout but falls back to Binance. Cascading failure if both down.

**Target Code:** `app/app/api/sol-price/route.ts:24-29`

---

### H119: Fee Calculation Zero for Dust Amounts

**Category:** Financial Logic
**Origin:** KB (OC-309)
**Estimated Priority:** Tier 3

**Hypothesis:** `calculateTax(24, 400) = 0` — dust amounts below 25 lamports pay zero tax. Minimum purchase guard prevents this for buys.

**Target Code:** `app/lib/swap/quote-engine.ts:calculateTax`

---

### H120: Borsh Deserialization of Untrusted Data

**Category:** Data Integrity
**Origin:** KB (OC-069)
**Estimated Priority:** Tier 3

**Hypothesis:** event-parser.ts deserializes on-chain log messages. Malformed data could cause parsing errors.

**Target Code:** `app/lib/event-parser.ts`

---

### H121: No Source Maps in Production (Verify)

**Category:** Information Disclosure
**Origin:** KB (OC-175)
**Estimated Priority:** Tier 3

**Hypothesis:** Verify source maps are not served in production build.

**Target Code:** `app/next.config.ts`

---

### H122: Dead Code in rewards.ts

**Category:** Code Quality
**Origin:** KB (OC-299)
**Estimated Priority:** Tier 3

**Hypothesis:** `calculateRewardRate` APR calculation is dead code. Could be activated accidentally.

**Target Code:** `app/lib/staking/rewards.ts:96-115`

---

### H123: Solana CLI v3 --keypair Flag Broken

**Category:** Infrastructure
**Origin:** Novel (from MEMORY.md)
**Estimated Priority:** Tier 3

**Hypothesis:** Known issue with Solana CLI v3 `--keypair` flag. Verify deploy scripts don't rely on it.

**Target Code:** `scripts/deploy/deploy.sh`

---

### H124: BuyForm BigInt Conversion via Number Intermediate

**Category:** Financial Logic
**Origin:** KB (OC-307)
**Estimated Priority:** Tier 3

**Hypothesis:** `BigInt(Math.floor(crimeBalance * Number(TOKEN_DECIMAL_FACTOR)))` — Number intermediate for large balances.

**Target Code:** `app/components/launch/BuyForm.tsx:84-86`

---

### H125: Demo Mode BigInt via Number Intermediate

**Category:** Financial Logic
**Origin:** KB (OC-307)
**Estimated Priority:** Tier 3

**Hypothesis:** `BigInt(Math.floor(Number(TOTAL_FOR_SALE) * progress))` — Number intermediate for demo state.

**Target Code:** `app/hooks/useCurveState.ts:191-192`

---

### H126: No Anti-Flicker Protection on Route Selection

**Category:** Business Logic
**Origin:** Novel
**Estimated Priority:** Tier 3

**Hypothesis:** Route anti-flicker (10 BPS threshold) could mask significant price changes in fast-moving markets.

**Target Code:** `app/hooks/useRoutes.ts` (FLICKER_THRESHOLD_BPS)

---

### H127: Wallet-Adapter autoConnect Internal State

**Category:** Frontend
**Origin:** KB (OC-188)
**Estimated Priority:** Tier 3

**Hypothesis:** wallet-adapter's autoConnect may persist connection state in its own storage across sessions.

**Target Code:** `app/providers/providers.tsx:43`

---

### H128: SellForm Correct Slippage on Net (Verify)

**Category:** Financial Logic
**Origin:** KB (OC-305) — Verify correct pattern
**Estimated Priority:** Tier 3

**Hypothesis:** SellForm applies slippage to net SOL after tax. Verify this matches on-chain check.

**Target Code:** `app/components/launch/SellForm.tsx:177-178`

---

### H129: Vault Conversion Rate Hardcoded at 100

**Category:** Cross-Boundary
**Origin:** KB (OC-300)
**Estimated Priority:** Tier 3

**Hypothesis:** `VAULT_CONVERSION_RATE = 100` hardcoded in shared. Verify it matches on-chain vault program.

**Target Code:** `shared/constants.ts`, Vault program constants

---

### H130: No Feature Flags for Mainnet Switch Points

**Category:** Infrastructure
**Origin:** Novel
**Estimated Priority:** Tier 3

**Hypothesis:** Multiple devnet-specific values scattered across codebase. No centralized feature flag for mainnet switch.

**Target Code:** Various files with "MAINNET TODO" comments

---

### H131: Webhook URL Discoverable in Source

**Category:** API Security
**Origin:** Novel
**Estimated Priority:** Tier 3

**Hypothesis:** Webhook URL hardcoded in `scripts/webhook-manage.ts:43`. Attacker doesn't need to find it.

**Target Code:** `scripts/webhook-manage.ts:43`

---

### H132: Railway Dashboard as Single Point of Access

**Category:** Infrastructure
**Origin:** KB (OC-020)
**Estimated Priority:** Tier 3

**Hypothesis:** Railway dashboard access = full control of env vars, deploys, logs. Verify 2FA and access controls.

**Target Code:** Railway configuration (external)

---

---

## Cross-Strategy Analysis

### Potentially Related Strategies

| Strategy A | Strategy B | Potential Combination |
|------------|------------|----------------------|
| H001 (webhook auth bypass) | H008 (SSE amplification) | Unauthenticated webhook + unlimited SSE = amplified DoS |
| H002 (API key exposure) | H001 (webhook bypass) | Extracted key → register malicious webhook → inject data |
| H003 (npm supply chain) | H004 (crank wallet) | Compromised dependency → exfiltrate WALLET_KEYPAIR env var |
| H014 (Number overflow) | H015 (sandwich attack) | Wider slippage from precision loss → more MEV extraction |
| H005 (committed keypairs) | H010 (BC authority theft) | Keypairs in git + any-signer BC = trivial theft |
| H009 (devnet fallback) | H111 (crank devnet fallback) | Both frontend and crank silently on wrong network |

### Off-Chain → On-Chain Chains

| Off-Chain Strategy | On-Chain Finding | Combined Attack |
|-------------------|------------------|-----------------|
| H004 (crank wallet) | BC authority gap | Crank key compromise → call withdraw_graduated_sol |
| H014 (Number overflow) | Sell path 0 slippage | Wrong minimumOutput + 0 AMM slippage = maximum extraction |
| H003 (npm supply chain) | Any admin instruction | Compromised dep → access signing keys → call any instruction |
| H009 (devnet fallback) | N/A | Users interact with wrong network entirely |
| H002 (API key) | N/A | Webhook manipulation → fake events → user confusion → bad trades |

### Investigation Priority Order

**Tier 1 (Investigate First) — 22 strategies:**
H001-H022: Critical potential findings covering webhook auth, API key exposure, supply chain, crank safety, financial precision, MEV, cross-boundary issues.

**Tier 2 (High Priority) — 45 strategies:**
H023-H067: High-priority findings covering DoS, web security, transport security, business logic, race conditions, monitoring gaps.

**Tier 3 (Standard) — 65 strategies:**
H068-H132: Medium-low priority covering validation edge cases, code quality, cross-boundary observations, infrastructure hardening.

---

## Statistics

| Category | Count | Tier 1 | Tier 2 | Tier 3 | KB | Novel |
|----------|-------|--------|--------|--------|-----|-------|
| Secrets & Key Mgmt | 10 | 4 | 4 | 2 | 7 | 3 |
| API & Webhook Security | 12 | 3 | 5 | 4 | 7 | 5 |
| Supply Chain | 10 | 2 | 5 | 3 | 8 | 2 |
| Transaction Construction | 9 | 2 | 5 | 2 | 6 | 3 |
| Financial Logic | 15 | 2 | 5 | 8 | 10 | 5 |
| MEV & Ordering | 6 | 2 | 1 | 3 | 3 | 3 |
| Automation & Bots | 8 | 3 | 3 | 2 | 5 | 3 |
| Infrastructure & Config | 12 | 1 | 5 | 6 | 8 | 4 |
| Web & Frontend Security | 10 | 0 | 4 | 6 | 8 | 2 |
| Cross-Boundary | 18 | 3 | 2 | 13 | 0 | 18 |
| Data Security & Integrity | 8 | 1 | 3 | 4 | 6 | 2 |
| Monitoring & Observability | 5 | 0 | 2 | 3 | 3 | 2 |
| Error Handling & Resilience | 9 | 0 | 3 | 6 | 7 | 2 |
| **TOTAL** | **132** | **22** | **45** | **65** | **78** | **54** |

**Novel strategy percentage:** 41% (54/132) — exceeds 20% minimum target

**Origin Breakdown:**
| Origin | Count | % |
|--------|-------|---|
| KB (pattern-based) | 78 | 59% |
| Novel (creative/architectural) | 54 | 41% |
| RECHECK (stacked) | 0 | 0% (first audit) |

---

## Notes for Investigators

### General Guidance

- Each strategy should be investigated independently
- Reference `.bulwark/ARCHITECTURE.md` for context
- Write findings to `.bulwark/findings/H{XXX}.md`
- Don't skip strategies even if they seem unlikely
- Note any discoveries that suggest NEW strategies
- For cross-boundary strategies (H007, H010, H016, H017, H022, H053, H054, H084, H097-H110), reference `.audit/ARCHITECTURE.md` for on-chain context

### Status Definitions

- **CONFIRMED**: Vulnerability exists and is exploitable
- **POTENTIAL**: Could be vulnerable under specific conditions
- **NOT VULNERABLE**: Protected against this attack
- **NEEDS MANUAL REVIEW**: Couldn't determine, needs expert

### Off-Chain Severity Calibration

When assessing off-chain findings, consider:
- **Fund loss** via key compromise, transaction manipulation, or bot exploitation → CRITICAL
- **Data breach** of PII, keys, or credentials → CRITICAL/HIGH
- **Remote code execution** via injection, deserialization, SSRF → CRITICAL
- **Authentication bypass** gaining unauthorized access → HIGH
- **API abuse** causing financial or operational damage → HIGH/MEDIUM
- **Information disclosure** of internal state or config → MEDIUM
- **Denial of service** to off-chain components → MEDIUM/LOW

---

## Supplemental Strategies (generated from Tier 1 CONFIRMED findings)

---

### S001: Chained Webhook + Supply Chain Attack

**Category:** Multi-Vector Chain
**Origin:** H001 + H003 + H002
**Estimated Priority:** Tier 1

**Hypothesis:** Attacker compromises an npm dependency (H003, no lockfile), which exfiltrates the Helius API key (H002, hardcoded) and uses it to delete the legitimate webhook and register a malicious one. Combined with fail-open webhook auth (H001), the attacker controls the entire data pipeline.

**Target Code:** `shared/constants.ts:474`, `.gitignore:9`, `app/app/api/webhooks/helius/route.ts:135-141`

OUTPUT FILE: .bulwark/findings/S001.md

---

### S002: Crank Drain Amplification Loop

**Category:** Multi-Vector Chain
**Origin:** H004 + H013 + H019
**Estimated Priority:** Tier 1

**Hypothesis:** RPC MITM or on-chain manipulation triggers H013 (vault top-up without limit). H019 (no circuit breaker) ensures continuous drain. If crank wallet drained, H004 (no spending cap, no alerting) means no detection until protocol halts.

**Target Code:** `scripts/crank/crank-runner.ts:225-241`, `scripts/crank/crank-runner.ts:308-314`

OUTPUT FILE: .bulwark/findings/S002.md

---

### S003: MEV Extraction via Precision + Slippage Stack

**Category:** Multi-Vector Chain
**Origin:** H014 + H015 + H022
**Estimated Priority:** Tier 1

**Hypothesis:** H014 (Number overflow) produces lower-than-intended minimumOutput. H015 (5% default slippage) widens the MEV window further. H022 (sell path passes 0 to AMM) removes on-chain slippage protection. Combined, MEV bots extract significantly more than any single vulnerability allows.

**Target Code:** `app/lib/swap/quote-engine.ts:54-62`, `app/providers/SettingsProvider.tsx:77`, `programs/tax-program/src/instructions/swap_sol_sell.rs:147`

OUTPUT FILE: .bulwark/findings/S003.md

---

### S004: Mainnet Launch Day Attack Bundle

**Category:** Multi-Vector Chain
**Origin:** H005 + H010 + H016 + H009
**Estimated Priority:** Tier 1

**Hypothesis:** Attacker uses committed keypairs (H005) to front-run transfer hook init (H016), then uses the deploy-init window to call bonding curve withdraw (H010). If devnet fallback (H009) causes confusion, admin response is delayed.

**Target Code:** `keypairs/`, `scripts/deploy/deploy-all.sh`, `scripts/graduation/graduate.ts`

OUTPUT FILE: .bulwark/findings/S004.md

---

### S005: Staking + Crank Monitor Gap

**Category:** Cross-Boundary Chain
**Origin:** H017 + H019
**Estimated Priority:** Tier 2

**Hypothesis:** Attacker drains escrow below rent-exempt (H017). Crank has no escrow monitoring (only carnage vault). Next deposit_rewards CPI fails. Crank retries infinitely (H019) wasting SOL on failed TXs. Tax distribution permanently halted.

**Target Code:** `scripts/crank/crank-runner.ts:220-241`, `app/hooks/useStaking.ts:541-553`

OUTPUT FILE: .bulwark/findings/S005.md

---

### S006: Webhook Data Poisoning + Number Overflow for Chart Manipulation

**Category:** Multi-Vector Chain
**Origin:** H001 + H014
**Estimated Priority:** Tier 2

**Hypothesis:** Attacker injects fake webhook events (H001) with extreme price values. Candle aggregator stores them. Frontend's Number overflow (H014) compounds the display error. Users see wildly wrong charts and make bad trading decisions.

**Target Code:** `app/app/api/webhooks/helius/route.ts:135-141`, `app/db/candle-aggregator.ts:121-122`

OUTPUT FILE: .bulwark/findings/S006.md

---

### S007: Supply Chain → Crank Key Exfiltration

**Category:** Multi-Vector Chain
**Origin:** H003 + H004
**Estimated Priority:** Tier 1

**Hypothesis:** npm supply chain compromise (H003) gets code running in the crank runner process. Exfiltrates WALLET_KEYPAIR from process.env. Attacker now has the signing key and can drain the wallet or execute malicious transactions from their own infrastructure.

**Target Code:** `.gitignore:9`, `scripts/crank/crank-provider.ts:41-57`

OUTPUT FILE: .bulwark/findings/S007.md

---

### S008: Helius Key + Webhook Deletion for Data Pipeline Kill

**Category:** Multi-Vector Chain
**Origin:** H002 + H001
**Estimated Priority:** Tier 2

**Hypothesis:** Attacker extracts Helius API key from client bundle (H002). Uses webhook management API to delete the legitimate webhook. If webhook auth is fail-open (H001), attacker registers their own webhook URL to intercept all transaction notifications and selectively withhold or modify them.

**Target Code:** `shared/constants.ts:474`, `scripts/webhook-manage.ts:28-54`

OUTPUT FILE: .bulwark/findings/S008.md

---

### S009: Graduation Race — Authority + Keypair Combo

**Category:** Cross-Boundary Chain
**Origin:** H010 + H005 + H016
**Estimated Priority:** Tier 1

**Hypothesis:** Attacker uses committed keypairs (H005) for PDA derivation knowledge. Monitors for bonding curves reaching Filled. Atomically calls prepare_transition + withdraw_graduated_sol (H010 — any signer). Front-runs init_authority on redeployment (H016). Extracts ~2000 SOL and controls transfer hooks.

**Target Code:** `keypairs/`, `scripts/graduation/graduate.ts:354-362`

OUTPUT FILE: .bulwark/findings/S009.md

---

### S010: VRF Recovery Path Non-Atomic Carnage Window

**Category:** Novel (from H007 incidental discovery)
**Origin:** H007 incidental
**Estimated Priority:** Tier 2

**Hypothesis:** H007 investigation found that VRF recovery path (`vrf-flow.ts:533`) does NOT bundle carnage atomically unlike the normal path. If an attacker forces VRF timeout (e.g., by DoSing the Switchboard gateway), the recovery path creates a window where VRF is revealed but carnage hasn't executed — enabling MEV.

**Target Code:** `scripts/vrf/lib/vrf-flow.ts:533`, `scripts/crank/crank-runner.ts`

OUTPUT FILE: .bulwark/findings/S010.md

---

**This catalog is the input for Phase 4: Parallel Investigation**
