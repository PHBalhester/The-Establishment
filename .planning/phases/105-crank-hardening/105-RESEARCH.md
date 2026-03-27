# Phase 105: Crank Hardening - Research

**Researched:** 2026-03-25
**Domain:** Off-chain crank operations (Node.js/TypeScript), Telegram Bot API, Switchboard VRF
**Confidence:** HIGH

## Summary

Phase 105 hardens the crank runner for sustained mainnet reliability. The scope is entirely off-chain: two TypeScript files (`scripts/crank/crank-runner.ts` and `scripts/vrf/lib/vrf-flow.ts`) plus a new Telegram alerting module. No on-chain program changes.

The existing codebase is well-structured with clear patterns (circuit breaker, spending cap, health server, JSON log lines). The changes decompose into five distinct areas: (1) inline randomness cleanup in recovery paths, (2) periodic sweep safety net, (3) VRF instrumentation fields, (4) exponential backoff tuning, and (5) Telegram alerting.

**Primary recommendation:** Use zero-dependency `fetch()` for Telegram (matching the Sentry pattern), extend `EpochTransitionResult` with instrumentation fields, and fix TWO identified randomness account leak paths in vrf-flow.ts.

## Standard Stack

### Core (already in project)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@switchboard-xyz/on-demand` | ^3.7.3 | VRF randomness + closeIx | Already used; provides `Randomness.closeIx()` |
| `@solana/web3.js` | existing | RPC, transactions, getProgramAccounts | Already used everywhere |
| `@coral-xyz/anchor` | existing | Program interaction, IDL parsing | Already used |

### Supporting (new for this phase)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Node.js built-in `fetch()` | native | Telegram Bot API calls | For sendMessage alerts (zero-dependency) |
| Node.js built-in `http` | native | Health server | Already used in crank-runner.ts |

### NOT Using
| Library | Reason |
|---------|--------|
| `node-telegram-bot-api` | Heavy dependency; project pattern is zero-dependency for external services (see lib/sentry.ts) |
| `telegraf` | Framework overkill; we only need sendMessage |
| `exponential-backoff` npm | Trivial to implement inline; no need for a dependency for 5 lines of math |

**Installation:** No new npm packages needed.

## Architecture Patterns

### Recommended Module Structure
```
scripts/
├── crank/
│   ├── crank-runner.ts     # Main loop (MODIFY: periodic sweep, backoff, alert trigger)
│   ├── crank-provider.ts   # Provider/programs/manifest loader (NO CHANGES)
│   └── lib/
│       └── telegram.ts     # NEW: Zero-dependency Telegram alert module
└── vrf/
    └── lib/
        └── vrf-flow.ts     # MODIFY: inline cleanup, instrumentation fields, backoff
```

### Pattern 1: Zero-Dependency External Service Client
**What:** Raw `fetch()` POST to external API, matching existing lib/sentry.ts pattern
**When to use:** Telegram alerting
**Example:**
```typescript
// Zero-dependency Telegram alert (mirrors lib/sentry.ts approach)
async function sendTelegramAlert(
  botToken: string,
  chatId: string,
  text: string,
): Promise<boolean> {
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "HTML", // Use HTML not MarkdownV2 -- fewer escaping headaches
        }),
      }
    );
    return res.ok;
  } catch {
    return false; // Best-effort -- never block crank
  }
}
```

### Pattern 2: Extend Return Type for Instrumentation
**What:** Add optional fields to `EpochTransitionResult` for VRF timing metrics
**When to use:** Instrumentation data piped through the existing return path
**Example:**
```typescript
export interface EpochTransitionResult {
  // ... existing fields ...
  /** VRF instrumentation (CRANK-03) */
  gatewayMs?: number;         // revealIx() response time
  revealAttempts?: number;    // Number of reveal retries
  recoveryTimeMs?: number;    // Total recovery path wall-clock time (0 = happy path)
  commitToRevealSlots?: number; // Slot delta between commit TX and successful reveal
}
```

### Pattern 3: Exponential Backoff with Cap
**What:** Replace linear delays with exponential (base * 2^attempt), capped at max
**When to use:** tryReveal() backoff and cycle error backoff
**Example:**
```typescript
// Exponential: 1s, 2s, 4s, 8s, 16s (5 attempts, ~31s total)
const delay = Math.min(baseMs * Math.pow(2, attempt), maxMs);
await sleep(delay);
```

### Pattern 4: Cooldown-Gated Alert
**What:** Prevent alert spam with timestamp-based cooldown
**When to use:** Circuit breaker trip alerts
**Example:**
```typescript
let lastAlertTimestamp = 0;
const ALERT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

function shouldAlert(): boolean {
  const now = Date.now();
  if (now - lastAlertTimestamp < ALERT_COOLDOWN_MS) return false;
  lastAlertTimestamp = now;
  return true;
}
```

### Anti-Patterns to Avoid
- **MarkdownV2 for Telegram alerts:** MarkdownV2 requires escaping 21 special characters (`_*[]()~>#+=-|{}.!`). Use HTML parse_mode instead -- `<b>`, `<code>`, `<pre>` are simpler and less error-prone for dynamic content like error messages.
- **Blocking on Telegram API failure:** Alert sends MUST be wrapped in try/catch with no rethrow. A Telegram outage must never halt the crank.
- **Modifying `closeRandomnessAccount()` signature:** The existing function is correct and battle-tested. Add inline calls to it, don't change its API.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Telegram message sending | Custom HTTP client class | Raw fetch() POST | One endpoint, one method. Zero dependency matches project pattern. |
| Randomness account close | Custom close instruction builder | `sb.Randomness.closeIx()` via existing `closeRandomnessAccount()` | Existing function handles existence checks, IDL fetch, error suppression |
| getProgramAccounts filter | Custom RPC query | Existing `sweepStaleRandomnessAccounts()` | Already works in production; memcmp at offset 8 is verified correct |
| Exponential backoff | npm library | 1-line formula: `Math.min(base * 2**attempt, max)` | Too trivial for a dependency |

**Key insight:** All the building blocks exist. This phase is wiring, tuning, and extending -- not building from scratch.

## Common Pitfalls

### Pitfall 1: TWO Stale Account Leak Paths (Not One)
**What goes wrong:** Recovery paths in vrf-flow.ts create fresh randomness accounts but never close the original stale account. There are TWO distinct leak paths:
1. **vrfPending recovery (timeout retry, ~line 498-612):** `stalePubkey` (the original pending randomness from a prior failed cycle) leaks when `retryRngKp` replaces it. `recoveryRandomnessPubkey` is updated to `retryRngKp.publicKey`, so crank-runner closes the fresh one but the stale one leaks.
2. **Happy path timeout recovery (~line 743-839):** The original `rngKp` (created in TX1 of the current cycle) leaks when oracle fails and `retryRngKp` replaces it. `activeRngKp` is updated, so crank-runner closes the fresh one.
**Why it happens:** The return type only has one `randomnessPubkey` field, so only one account can be closed by the caller.
**How to avoid:** Close the stale/original account inline in vrf-flow.ts BEFORE returning, then return the fresh account pubkey for the caller to close.
**Warning signs:** Accumulating Switchboard accounts owned by the crank wallet (visible via getProgramAccounts).

### Pitfall 2: MarkdownV2 Escaping in Dynamic Content
**What goes wrong:** Error messages contain characters like `.`, `!`, `(`, `)` that must be escaped in MarkdownV2.
**Why it happens:** MarkdownV2 requires escaping 21 characters: `_*[]()~>#+=-|{}.!`
**How to avoid:** Use `parse_mode: "HTML"` instead. HTML only needs `<`, `>`, `&` escaping, which `text.replace(/&/g, "&amp;").replace(/</g, "&lt;")` handles.
**Warning signs:** Telegram API returns 400 "Bad Request: can't parse entities" errors.

### Pitfall 3: Telegram Bot Token in Logs
**What goes wrong:** Bot token is accidentally logged when constructing the API URL.
**Why it happens:** Debug logging of the full URL during development.
**How to avoid:** Never log the full Telegram API URL. Log only "Telegram alert sent: ok/failed".
**Warning signs:** Bot token visible in Railway logs.

### Pitfall 4: Periodic Sweep Races with Active Cycle
**What goes wrong:** The periodic sweep (every 50 cycles) runs between cycles and tries to close a randomness account that the current cycle is actively using.
**Why it happens:** The sweep uses getProgramAccounts which returns ALL accounts owned by the crank wallet, including the one currently being committed/revealed.
**How to avoid:** Track the "active" randomness pubkey and skip it during sweep. Or simpler: only sweep at the START of each 50th cycle (before TX1 creates a new account).
**Warning signs:** "Account does not exist" errors during sweep, or worse, closing an account needed by the next reveal.

### Pitfall 5: Exponential Backoff Total Time Mismatch
**What goes wrong:** Changing backoff intervals changes total cycle time, which may exceed the expected epoch slot window.
**Why it happens:** With 5 reveal attempts at 1s/2s/4s/8s/16s, total is ~31s. But with 10 attempts (as currently used in happy path tryReveal), total would be 1+2+4+8+16+32+64+128+256+512 = ~1023s (17 min). That is way too long.
**How to avoid:** Keep reveal attempt count at 5 when switching to exponential backoff (CONTEXT.md specifies 5 attempts). The happy path currently uses 10 attempts with linear backoff (total ~165s); switching to 5 attempts with exponential (total ~31s) is a deliberate reduction. The recovery path (tryReveal with 10 attempts) should keep a higher attempt count with capped delays.
**Warning signs:** Cycle durations exceeding expected epoch length.

### Pitfall 6: Alert Cooldown State Lost on Railway Restart
**What goes wrong:** Railway restarts the crank (crash-loop, deploy, etc.), and the in-memory cooldown timestamp resets to 0, allowing immediate re-alerting.
**Why it happens:** Cooldown state is in-memory only.
**How to avoid:** This is acceptable -- the 5-minute cooldown is specifically designed for crash-loop scenarios. If Railway restarts every 30 seconds, we get one alert per restart (one every 30s). The CONTEXT.md accepts this behavior and calls for a "5-minute cooldown between duplicate alerts" which handles the normal case. Crash-loops will produce alerts, which is desirable (you want to know about crash-loops).
**Warning signs:** Multiple alerts in rapid succession during Railway restarts. This is by design.

## Code Examples

### Inline Stale Account Close (Recovery Path Fix)
```typescript
// After recovery succeeds but BEFORE returning the result,
// close the stale account if a fresh one was used:
if (recoveryRandomnessPubkey.toBase58() !== stalePubkey.toBase58()) {
  // Fresh randomness was used -- close the stale one inline
  console.log(`  [recovery] Closing stale randomness ${stalePubkey.toBase58().slice(0, 12)}...`);
  const closeSig = await closeRandomnessAccount(provider, stalePubkey);
  if (closeSig) {
    console.log(`  [recovery] Stale account closed. TX: ${closeSig.slice(0, 16)}...`);
  } else {
    console.log(`  [recovery] WARNING: Stale account close failed (startup sweep will catch it)`);
  }
}
```

### Happy Path Timeout Recovery -- Close Original Account
```typescript
// In the else branch (~line 743), after recovery succeeds:
// Close the original rngKp account that was orphaned by timeout recovery
console.log(`  [recovery] Closing original randomness ${rngKp.publicKey.toBase58().slice(0, 12)}...`);
const origCloseSig = await closeRandomnessAccount(provider, rngKp.publicKey);
if (origCloseSig) {
  console.log(`  [recovery] Original account closed. TX: ${origCloseSig.slice(0, 16)}...`);
}
```

### Telegram Alert Module (scripts/crank/lib/telegram.ts)
```typescript
/**
 * Zero-dependency Telegram alerting for crank operations.
 * Uses raw fetch() to POST to Telegram Bot API (mirrors lib/sentry.ts pattern).
 * Best-effort: never throws, never blocks crank operation.
 */

const ALERT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

let lastAlertTs = 0;

interface AlertContext {
  event: string;
  lastError: string;
  epoch: number;
  walletBalanceSol: number;
  consecutiveErrors: number;
  uptimeSeconds: number;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildAlertMessage(ctx: AlertContext): string {
  const truncatedError = ctx.lastError.slice(0, 200);
  return [
    `<b>CRANK ALERT: ${escapeHtml(ctx.event)}</b>`,
    ``,
    `<b>Epoch:</b> ${ctx.epoch}`,
    `<b>Balance:</b> ${ctx.walletBalanceSol.toFixed(3)} SOL`,
    `<b>Consecutive errors:</b> ${ctx.consecutiveErrors}`,
    `<b>Uptime:</b> ${Math.floor(ctx.uptimeSeconds / 3600)}h ${Math.floor((ctx.uptimeSeconds % 3600) / 60)}m`,
    ``,
    `<b>Last error:</b>`,
    `<code>${escapeHtml(truncatedError)}</code>`,
  ].join("\n");
}

export async function sendAlert(ctx: AlertContext): Promise<boolean> {
  // Cooldown check
  const now = Date.now();
  if (now - lastAlertTs < ALERT_COOLDOWN_MS) {
    console.log("[alert] Cooldown active, skipping Telegram alert");
    return false;
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) {
    console.log("[alert] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set, skipping alert");
    return false;
  }

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: buildAlertMessage(ctx),
          parse_mode: "HTML",
        }),
      }
    );
    lastAlertTs = now;
    if (!res.ok) {
      console.log(`[alert] WARNING: Telegram API returned ${res.status}`);
    }
    return res.ok;
  } catch (err) {
    console.log(`[alert] WARNING: Telegram send failed: ${String(err).slice(0, 100)}`);
    return false;
  }
}
```

### VRF Instrumentation Fields
```typescript
// In tryReveal(), capture timing:
const revealStartMs = Date.now();
let revealAttempts = 0;
// ... in loop ...
revealAttempts++;
// After success:
const gatewayMs = Date.now() - revealStartMs;

// In advanceEpochWithVRF(), capture commit-to-reveal slot delta:
const commitSlot = await connection.getSlot(); // right after TX2
// ... after reveal succeeds ...
const revealSlot = await connection.getSlot();
const commitToRevealSlots = revealSlot - commitSlot;
```

### Exponential Backoff for tryReveal()
```typescript
// Current (linear): 3000 * (i + 1) = 3s, 6s, 9s, 12s, 15s
// New (exponential from 1s): 1000 * 2^i = 1s, 2s, 4s, 8s, 16s
// Cap at 16s per attempt
const baseDelayMs = 1000;
const maxDelayMs = 16_000;
const delay = Math.min(baseDelayMs * Math.pow(2, i), maxDelayMs);
await sleep(delay);
```

### Exponential Backoff for Cycle Errors
```typescript
// Current: flat ERROR_RETRY_DELAY_MS (30s)
// New: 15s * 2^(consecutiveErrors - 1), capped at 240s
// Attempt 1: 15s, Attempt 2: 30s, Attempt 3: 60s, Attempt 4: 120s, Attempt 5: 240s (circuit breaker)
const baseErrorDelayMs = 15_000;
const maxErrorDelayMs = 240_000;
const errorDelay = Math.min(baseErrorDelayMs * Math.pow(2, consecutiveErrors - 1), maxErrorDelayMs);
```

### Periodic Sweep Integration
```typescript
// In main loop, at start of each cycle:
const PERIODIC_SWEEP_INTERVAL = 50;
if (cycleCount > 0 && cycleCount % PERIODIC_SWEEP_INTERVAL === 0) {
  console.log(`[crank] Periodic sweep (every ${PERIODIC_SWEEP_INTERVAL} cycles)...`);
  await sweepStaleRandomnessAccounts(provider);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Linear backoff (3s, 6s, 9s) | Exponential backoff (1s, 2s, 4s...) | This phase | Faster initial retries, reasonable total wait |
| Flat 30s error retry | Exponential error retry (15s-240s) | This phase | More responsive on first failure, longer cooldown on persistent failures |
| Stale accounts deferred to startup sweep | Inline close + periodic sweep | This phase | Immediate rent reclaim, reduced orphan accumulation |
| No alerting (log-only) | Telegram push for circuit breaker trips | This phase | Immediate awareness of crank failures |

**Comment on existing code quality:** The crank-runner and vrf-flow code are well-structured with clear separation of concerns. The circuit breaker, spending cap, and health server patterns are solid. The comment on line 268 of vrf-flow.ts says "Exponential backoff" but the formula is actually linear -- this phase fixes the discrepancy.

## Open Questions

1. **tryReveal attempt count for recovery paths**
   - What we know: CONTEXT.md specifies 5 attempts for reveal backoff (1s, 2s, 4s, 8s, 16s = ~31s). Happy path currently uses 10 attempts. Recovery paths also use 5 and 10 attempts.
   - What's unclear: Should recovery path tryReveal calls also switch to 5 attempts, or keep 10 with capped delay? Recovery is already expensive (waited 300 slots), so more reveal attempts might be worthwhile.
   - Recommendation: Use 5 attempts with exponential backoff for the initial happy-path reveal (total ~31s). For recovery paths, keep 10 attempts but with exponential backoff capped at 16s (total ~93s -- still reasonable since we've already waited 2+ minutes for timeout).

2. **Periodic sweep vs active account collision**
   - What we know: Periodic sweep runs every 50 cycles using getProgramAccounts. If it runs between TX1 (create) and the successful close, it would find the active randomness account.
   - What's unclear: Can `closeRandomnessAccount()` close an account that still has pending randomness?
   - Recommendation: Run periodic sweep at the START of each 50th cycle (before TX1), not after the epoch transition. The existing `closeRandomnessAccount()` checks account existence before closing, and Switchboard's closeIx likely rejects closing accounts with pending state, but placing the sweep before TX1 avoids the question entirely.

3. **Recovery path instrumentation completeness**
   - What we know: Recovery paths should also populate instrumentation fields.
   - What's unclear: The recovery path already records `durationMs`. The `gatewayMs` and `revealAttempts` need to be tracked separately for the stale reveal attempt vs the fresh reveal attempt.
   - Recommendation: Set `recoveryTimeMs` to total recovery wall-clock time, `gatewayMs` to the SUCCESSFUL reveal timing (whether stale or fresh), and `revealAttempts` to cumulative across both attempts.

## Sources

### Primary (HIGH confidence)
- **Existing codebase** (scripts/crank/crank-runner.ts, scripts/vrf/lib/vrf-flow.ts) -- Full read of both files, verified line numbers and patterns
- **Telegram Bot API** (https://core.telegram.org/bots/api) -- sendMessage params, parse_mode options, 4096 char limit, error response format
- **Project MEMORY.md** -- VRF gateway rotation failure (0x1780), authority offset 8, closeIx rent reclaim (~0.008 SOL), VRF timeout 300 slots

### Secondary (MEDIUM confidence)
- **Telegram rate limits** -- 1 msg/sec per chat, 30 msg/sec global. For circuit breaker alerts with 5-min cooldown, well within limits.
- **Switchboard on-demand SDK** (@switchboard-xyz/on-demand ^3.7.3) -- closeIx() method confirmed working in production startup sweep

### Tertiary (LOW confidence)
- None. All findings verified against existing working code or official docs.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- All tools already in project, no new dependencies
- Architecture: HIGH -- Extending existing patterns (zero-dep fetch, return type extension)
- Pitfalls: HIGH -- Two leak paths verified by reading actual recovery code paths
- Instrumentation: MEDIUM -- Fields are straightforward but recovery path timing needs careful design
- Telegram: HIGH -- Simple REST API, well-documented, HTML parse_mode avoids escaping issues

**Research date:** 2026-03-25
**Valid until:** 2026-04-25 (stable -- off-chain changes, no library version sensitivity)
