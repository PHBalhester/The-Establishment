/**
 * WebSocket Subscriber -- Server-Side Data Pipeline
 *
 * Feeds the protocol store with real-time protocol account data via multiple
 * delivery mechanisms, ordered by latency:
 *
 * 1. Solana WS accountSubscribe (sub-second) -- PRIMARY real-time path
 *    Each BATCH_ACCOUNT PDA gets an onAccountChange subscription. When the
 *    account data changes on-chain, the Solana validator pushes the update
 *    via WebSocket. This delivers curve state, pool state, epoch state, etc.
 *    within ~400ms of on-chain confirmation.
 *
 * 2. HTTP account poll (30s fallback) -- SAFETY NET
 *    Periodically re-fetches all BATCH_ACCOUNTS via getMultipleAccountsInfo.
 *    Catches any updates missed by WS (e.g., WS reconnection gaps). Uses
 *    protocolStore dedup to avoid redundant SSE broadcasts.
 *
 * 3. Helius Enhanced Webhook (external) -- BONUS ACCELERATOR
 *    If configured, Helius pushes account changes to /api/webhooks/helius.
 *    This is an independent path that supplements WS subscriptions.
 *
 * Other pipelines:
 *   Helius WS ──onSlotChange──▸ protocolStore("__slot")
 *   HTTP poll ──getTokenSupply──▸ protocolStore("__supply:CRIME"/"__supply:FRAUD")
 *   HTTP poll ──getProgramAccounts──▸ protocolStore("__staking:globalStats")
 *
 * Feature-flagged via WS_SUBSCRIBER_ENABLED env var.
 * Initialized from instrumentation.ts on server boot.
 */

import { AccountInfo, Connection, PublicKey } from "@solana/web3.js";
import { getConnection } from "@/lib/connection";
import { protocolStore } from "@/lib/protocol-store";
import { creditCounter } from "@/lib/credit-counter";
import {
  DEVNET_PDAS,
  DEVNET_PDAS_EXTENDED,
  DEVNET_POOLS,
  DEVNET_CURVE_PDAS,
  MINTS,
  PROGRAM_IDS,
} from "@/lib/protocol-config";
import {
  getAmmProgram,
  getBondingCurveProgram,
  getEpochProgram,
  getStakingProgram,
} from "@/lib/anchor";
import { anchorToJson, CURVE_BIGINT_FIELDS, STAKING_BIGINT_FIELDS } from "@/lib/bigint-json";
import { COOLDOWN_SECONDS } from "@dr-fraudsworth/shared";

// =============================================================================
// Types + Constants
// =============================================================================

interface WsSubscriberState {
  initialized: boolean;
  wsConnected: boolean;
  latestSlot: number;
  lastSlotReceivedAt: number;
  lastSlotBroadcastAt: number;
  slotSubscriptionId: number | null;
  supplyPollTimer: ReturnType<typeof setInterval> | null;
  stakerPollTimer: ReturnType<typeof setInterval> | null;
  stalenessTimer: ReturnType<typeof setInterval> | null;
  slotFallbackTimer: ReturnType<typeof setInterval> | null;
  accountPollTimer: ReturnType<typeof setInterval> | null;
  /** Subscription IDs from onAccountChange, for cleanup if needed */
  accountSubscriptionIds: number[];
}

/** UserStake account discriminator (base58) from staking IDL. */
const USER_STAKE_DISCRIMINATOR_B58 = "J6ZWGMgjwQC";

/**
 * Maps each protocol PDA to its Anchor account type and program.
 * CarnageSolVault is a SystemAccount (native SOL) — accountType is null.
 *
 * Account type names are camelCase to match Anchor 0.32's internal convention.
 * The Program constructor calls convertIdlToCamelCase() which converts all IDL
 * names (including account types) from PascalCase to camelCase. The coder's
 * decode() method does a case-sensitive lookup, so we must use camelCase here.
 */
const BATCH_ACCOUNTS: Array<{
  pubkey: PublicKey;
  accountType: string | null;
  program: "amm" | "bondingCurve" | "epoch" | "staking" | "system";
}> = [
  // Epoch program
  { pubkey: DEVNET_PDAS.EpochState, accountType: "epochState", program: "epoch" },
  { pubkey: DEVNET_PDAS.CarnageFund, accountType: "carnageFundState", program: "epoch" },
  { pubkey: DEVNET_PDAS.CarnageSolVault, accountType: null, program: "system" },
  // AMM pools
  { pubkey: DEVNET_POOLS.CRIME_SOL.pool, accountType: "poolState", program: "amm" },
  { pubkey: DEVNET_POOLS.FRAUD_SOL.pool, accountType: "poolState", program: "amm" },
  // Bonding curves
  { pubkey: DEVNET_CURVE_PDAS.crime.curveState, accountType: "curveState", program: "bondingCurve" },
  { pubkey: DEVNET_CURVE_PDAS.fraud.curveState, accountType: "curveState", program: "bondingCurve" },
  // Staking
  { pubkey: DEVNET_PDAS_EXTENDED.StakePool, accountType: "stakePool", program: "staking" },
];

// =============================================================================
// globalThis Singleton State
// =============================================================================

const globalForWsSub = globalThis as unknown as {
  wsSubscriber: WsSubscriberState | undefined;
};

const state: WsSubscriberState = globalForWsSub.wsSubscriber ?? {
  initialized: false,
  wsConnected: false,
  latestSlot: 0,
  lastSlotReceivedAt: 0,
  lastSlotBroadcastAt: 0,
  slotSubscriptionId: null,
  supplyPollTimer: null,
  stakerPollTimer: null,
  stalenessTimer: null,
  slotFallbackTimer: null,
  accountPollTimer: null,
  accountSubscriptionIds: [],
};

globalForWsSub.wsSubscriber = state;

// =============================================================================
// Shared Decode Helper
//
// Decodes a raw AccountInfo into a JSON-safe plain object for a given
// BATCH_ACCOUNTS entry. Used by batchSeed, startAccountPoll, and
// startAccountSubscriptions to avoid duplicating decode logic.
//
// IMPORTANT: The returned object must NOT include volatile fields like
// `updatedAt: Date.now()`. The protocolStore dedup guard compares serialized
// data -- volatile fields defeat dedup and cause redundant SSE broadcasts.
// =============================================================================

type Programs = {
  amm: ReturnType<typeof getAmmProgram>;
  bondingCurve: ReturnType<typeof getBondingCurveProgram>;
  epoch: ReturnType<typeof getEpochProgram>;
  staking: ReturnType<typeof getStakingProgram>;
};

function decodeAccountInfo(
  info: AccountInfo<Buffer>,
  entry: (typeof BATCH_ACCOUNTS)[number],
  programs: Programs,
): Record<string, unknown> | null {
  const { accountType, program: programKey } = entry;

  if (accountType === null) {
    // SystemAccount — store lamports only
    return { lamports: info.lamports };
  }

  const program = programs[programKey as keyof Programs];
  if (!program) return null;

  const decoded = program.coder.accounts.decode(accountType, info.data);
  const bigintFields =
    accountType === "curveState" ? CURVE_BIGINT_FIELDS
    : accountType === "stakePool" ? STAKING_BIGINT_FIELDS
    : undefined;
  return anchorToJson(decoded, bigintFields ? { bigintFields } : undefined);
}

function createPrograms(connection: Connection): Programs {
  return {
    amm: getAmmProgram(connection),
    bondingCurve: getBondingCurveProgram(connection),
    epoch: getEpochProgram(connection),
    staking: getStakingProgram(connection),
  };
}

// =============================================================================
// Batch Seed
// =============================================================================

async function batchSeed(connection: Connection): Promise<void> {
  const pubkeys = BATCH_ACCOUNTS.map((a) => a.pubkey);
  const accountInfos = await connection.getMultipleAccountsInfo(pubkeys);
  creditCounter.recordCall("getMultipleAccountsInfo");

  const programs = createPrograms(connection);

  let seededCount = 0;
  for (let i = 0; i < BATCH_ACCOUNTS.length; i++) {
    const info = accountInfos[i];
    if (!info) continue;

    const entry = BATCH_ACCOUNTS[i];
    try {
      const data = decodeAccountInfo(info, entry, programs);
      if (!data) continue;
      protocolStore.setAccountStateQuiet(entry.pubkey.toBase58(), data);
      seededCount++;
    } catch (err) {
      console.error(
        `[ws-subscriber] Failed to decode ${entry.accountType ?? "SystemAccount"} at ${entry.pubkey.toBase58()}:`,
        err,
      );
    }
  }

  // Fetch token supply (2 parallel calls)
  const [crimeSupply, fraudSupply] = await Promise.all([
    connection.getTokenSupply(MINTS.CRIME),
    connection.getTokenSupply(MINTS.FRAUD),
  ]);
  creditCounter.recordCall("getTokenSupply");
  creditCounter.recordCall("getTokenSupply");

  protocolStore.setAccountStateQuiet("__supply:CRIME", {
    amount: crimeSupply.value.amount,
    decimals: crimeSupply.value.decimals,
    uiAmount: crimeSupply.value.uiAmount,
  });
  protocolStore.setAccountStateQuiet("__supply:FRAUD", {
    amount: fraudSupply.value.amount,
    decimals: fraudSupply.value.decimals,
    uiAmount: fraudSupply.value.uiAmount,
  });

  // Fetch current slot
  const slot = await connection.getSlot();
  creditCounter.recordCall("getSlot");
  protocolStore.setAccountStateQuiet("__slot", { slot });
  state.latestSlot = slot;
  state.lastSlotReceivedAt = Date.now();
  state.lastSlotBroadcastAt = Date.now();

  // H011: Seed slot watermarks for all protocol accounts so that webhook
  // replays of pre-startup data are rejected immediately. Without this,
  // the watermark starts at 0 after a restart and any replay is accepted.
  for (const entry of BATCH_ACCOUNTS) {
    protocolStore.setLastSlot(entry.pubkey.toBase58(), slot);
  }

  // Fetch staker stats via gPA (full data for locked/unlocked classification)
  const stakerGpaAccounts = await connection.getProgramAccounts(
    PROGRAM_IDS.STAKING,
    {
      filters: [
        {
          memcmp: {
            offset: 0,
            bytes: USER_STAKE_DISCRIMINATOR_B58,
          },
        },
      ],
    },
  );
  creditCounter.recordCall("getProgramAccounts");

  const stakingProgram = programs.staking;
  const nowSec = Date.now() / 1000;
  let unlockedProfit = 0;
  let lockedProfit = 0;
  let activeStakers = 0;

  for (const { account } of stakerGpaAccounts) {
    try {
      const decoded = stakingProgram.coder.accounts.decode("userStake", account.data);
      const balance = decoded.stakedBalance.toNumber();
      if (balance === 0) continue;
      activeStakers++;
      const lastClaimTs = decoded.lastClaimTs.toNumber();
      const isUnlocked =
        lastClaimTs === 0 || (nowSec - lastClaimTs) >= COOLDOWN_SECONDS;
      if (isUnlocked) {
        unlockedProfit += balance;
      } else {
        lockedProfit += balance;
      }
    } catch {
      // Skip malformed accounts
    }
  }

  protocolStore.setAccountStateQuiet("__staking:globalStats", {
    stakerCount: activeStakers,
    unlockedProfit,
    lockedProfit,
  });

  console.log(
    `[ws-subscriber] Batch seed complete: ${seededCount} accounts, slot ${slot}, ${activeStakers} stakers`,
  );
}

// =============================================================================
// Slot Subscription (WS)
// =============================================================================

function startSlotSubscription(connection: Connection): void {
  const BROADCAST_INTERVAL = parseInt(
    process.env.SLOT_BROADCAST_INTERVAL_MS ?? "5000",
    10,
  );

  state.slotSubscriptionId = connection.onSlotChange((slotInfo) => {
    state.latestSlot = slotInfo.slot;
    state.lastSlotReceivedAt = Date.now();
    state.wsConnected = true;

    // D5 throttle: only broadcast every BROADCAST_INTERVAL ms
    const now = Date.now();
    if (now - state.lastSlotBroadcastAt >= BROADCAST_INTERVAL) {
      protocolStore.setAccountState("__slot", { slot: slotInfo.slot });
      state.lastSlotBroadcastAt = now;
    }
  });

  console.log(
    `[ws-subscriber] Slot subscription started (broadcast every ${BROADCAST_INTERVAL}ms)`,
  );
}

// =============================================================================
// Slot Fallback Poll (HTTP — activated when WS goes stale)
// =============================================================================

function startSlotFallbackPoll(
  connection: Connection,
  interval: number,
): void {
  state.slotFallbackTimer = setInterval(async () => {
    try {
      const slot = await connection.getSlot();
      creditCounter.recordCall("getSlot");
      state.latestSlot = slot;
      protocolStore.setAccountState("__slot", { slot });
      state.lastSlotBroadcastAt = Date.now();
    } catch (err) {
      console.error("[ws-subscriber] Slot fallback poll error:", err);
    }
  }, interval);
}

// =============================================================================
// Staleness Monitor (detects WS death, activates fallback)
// =============================================================================

function startStalenessMonitor(connection: Connection): void {
  const STALENESS_CHECK_INTERVAL = 10_000;
  const STALENESS_THRESHOLD = 15_000;
  const FALLBACK_POLL_INTERVAL = 5_000;

  state.stalenessTimer = setInterval(() => {
    const elapsed = Date.now() - state.lastSlotReceivedAt;

    if (elapsed > STALENESS_THRESHOLD && !state.slotFallbackTimer) {
      console.warn(
        `[ws-subscriber] Slot subscription stale (${elapsed}ms). Starting fallback poll.`,
      );
      state.wsConnected = false;
      startSlotFallbackPoll(connection, FALLBACK_POLL_INTERVAL);
    }

    if (elapsed <= STALENESS_THRESHOLD && state.slotFallbackTimer) {
      console.log(
        "[ws-subscriber] Slot subscription recovered. Stopping fallback poll.",
      );
      clearInterval(state.slotFallbackTimer);
      state.slotFallbackTimer = null;
    }
  }, STALENESS_CHECK_INTERVAL);
}

// =============================================================================
// Supply Poll (HTTP — 60s interval)
// =============================================================================

function startSupplyPoll(connection: Connection): void {
  const interval = parseInt(
    process.env.TOKEN_SUPPLY_POLL_INTERVAL_MS ?? "60000",
    10,
  );

  const pollSupply = async () => {
    try {
      const [crimeSupply, fraudSupply] = await Promise.all([
        connection.getTokenSupply(MINTS.CRIME),
        connection.getTokenSupply(MINTS.FRAUD),
      ]);
      creditCounter.recordCall("getTokenSupply");
      creditCounter.recordCall("getTokenSupply");

      protocolStore.setAccountState("__supply:CRIME", {
        amount: crimeSupply.value.amount,
        decimals: crimeSupply.value.decimals,
        uiAmount: crimeSupply.value.uiAmount,
      });
      protocolStore.setAccountState("__supply:FRAUD", {
        amount: fraudSupply.value.amount,
        decimals: fraudSupply.value.decimals,
        uiAmount: fraudSupply.value.uiAmount,
      });
    } catch (err) {
      console.error("[ws-subscriber] Supply poll error:", err);
    }
  };

  // batchSeed already did the initial fetch — first poll fires after interval
  state.supplyPollTimer = setInterval(pollSupply, interval);
  console.log(`[ws-subscriber] Supply poll started (every ${interval}ms)`);
}

// =============================================================================
// Staker Count Poll (gPA — 30s interval)
// =============================================================================

function startStakerPoll(connection: Connection): void {
  const interval = parseInt(
    process.env.STAKER_COUNT_POLL_INTERVAL_MS ?? "30000",
    10,
  );

  const pollStakers = async () => {
    try {
      const program = getStakingProgram(connection);
      const accounts = await connection.getProgramAccounts(
        PROGRAM_IDS.STAKING,
        {
          filters: [
            {
              memcmp: {
                offset: 0,
                bytes: USER_STAKE_DISCRIMINATOR_B58,
              },
            },
          ],
          // No dataSlice — fetch full account data for decode
        },
      );
      creditCounter.recordCall("getProgramAccounts");

      const nowSec = Date.now() / 1000;
      let unlockedProfit = 0;
      let lockedProfit = 0;
      let activeStakers = 0;

      for (const { account } of accounts) {
        try {
          const decoded = program.coder.accounts.decode("userStake", account.data);
          const balance = decoded.stakedBalance.toNumber();
          if (balance === 0) continue;

          activeStakers++;
          const lastClaimTs = decoded.lastClaimTs.toNumber();
          const isUnlocked =
            lastClaimTs === 0 || (nowSec - lastClaimTs) >= COOLDOWN_SECONDS;

          if (isUnlocked) {
            unlockedProfit += balance;
          } else {
            lockedProfit += balance;
          }
        } catch {
          // Skip malformed accounts
        }
      }

      protocolStore.setAccountState("__staking:globalStats", {
        stakerCount: activeStakers,
        unlockedProfit,
        lockedProfit,
      });
    } catch (err) {
      console.error("[ws-subscriber] Staker poll error:", err);
    }
  };

  // batchSeed already did the initial fetch — first poll fires after interval
  state.stakerPollTimer = setInterval(pollStakers, interval);
  console.log(`[ws-subscriber] Staker poll started (every ${interval}ms)`);
}

// =============================================================================
// Account Subscriptions (WS — sub-second real-time)
//
// Uses Solana's onAccountChange WebSocket subscription for each BATCH_ACCOUNT
// PDA. When account data changes on-chain, the validator pushes the update via
// WebSocket within ~400ms of confirmation. This is the PRIMARY real-time
// delivery mechanism for all protocol state including bonding curve PDAs.
//
// Each callback Anchor-decodes the raw data and calls setAccountState() which
// broadcasts to SSE clients (with dedup to prevent redundant pushes if the
// same data arrives via both WS and the account poll).
// =============================================================================

function startAccountSubscriptions(connection: Connection): void {
  const programs = createPrograms(connection);

  for (const entry of BATCH_ACCOUNTS) {
    const subId = connection.onAccountChange(
      entry.pubkey,
      (accountInfo) => {
        try {
          const data = decodeAccountInfo(accountInfo, entry, programs);
          if (!data) return;
          protocolStore.setAccountState(entry.pubkey.toBase58(), data);
        } catch (err) {
          console.error(
            `[ws-subscriber] WS account decode error for ${entry.accountType ?? "SystemAccount"} at ${entry.pubkey.toBase58()}:`,
            err,
          );
        }
      },
      { commitment: "confirmed" },
    );
    state.accountSubscriptionIds.push(subId);
  }

  console.log(
    `[ws-subscriber] Account subscriptions started (${BATCH_ACCOUNTS.length} PDAs via onAccountChange)`,
  );
}

// =============================================================================
// Account State Poll (HTTP — 30s fallback)
//
// Safety net that periodically re-fetches ALL BATCH_ACCOUNTS via
// getMultipleAccountsInfo. Catches any updates missed during WebSocket
// reconnection gaps or transient WS failures.
//
// The protocolStore dedup guard (serialized comparison) prevents redundant SSE
// broadcasts when data hasn't changed — so this poll is essentially free when
// the WS subscriptions are working correctly.
//
// Default interval is 30s (configurable via ACCOUNT_POLL_INTERVAL_MS).
// =============================================================================

function startAccountPoll(connection: Connection): void {
  const interval = parseInt(
    process.env.ACCOUNT_POLL_INTERVAL_MS ?? "30000",
    10,
  );

  const pollAccounts = async () => {
    try {
      const pubkeys = BATCH_ACCOUNTS.map((a) => a.pubkey);
      const accountInfos = await connection.getMultipleAccountsInfo(pubkeys);
      creditCounter.recordCall("getMultipleAccountsInfo");

      const programs = createPrograms(connection);

      for (let i = 0; i < BATCH_ACCOUNTS.length; i++) {
        const info = accountInfos[i];
        if (!info) continue;

        const entry = BATCH_ACCOUNTS[i];
        try {
          const data = decodeAccountInfo(info, entry, programs);
          if (!data) continue;
          // setAccountState broadcasts via SSE (with dedup — no-op if unchanged)
          protocolStore.setAccountState(entry.pubkey.toBase58(), data);
        } catch (err) {
          console.error(
            `[ws-subscriber] Account poll decode error for ${entry.accountType ?? "SystemAccount"} at ${entry.pubkey.toBase58()}:`,
            err,
          );
        }
      }
    } catch (err) {
      console.error("[ws-subscriber] Account poll error:", err);
    }
  };

  // batchSeed already did the initial fetch — first poll fires after interval
  state.accountPollTimer = setInterval(pollAccounts, interval);
  console.log(`[ws-subscriber] Account poll started (every ${interval}ms)`);
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Initialize the WebSocket subscriber and start all data pipelines.
 *
 * Batch-seeds protocolStore with all protocol accounts, then starts:
 * - WS account subscriptions (onAccountChange for all protocol PDAs, sub-second)
 * - WS slot subscription (onSlotChange, throttled to 5s broadcasts)
 * - HTTP account poll (getMultipleAccountsInfo, 30s safety net)
 * - Token supply polling (getTokenSupply, 60s)
 * - Staker count polling (gPA, 30s)
 * - Staleness monitor (fallback to HTTP slot polling if WS dies)
 *
 * Guarded against double-init (globalThis state + initialized flag).
 * Feature-flagged via WS_SUBSCRIBER_ENABLED env var.
 */
export async function init(): Promise<void> {
  if (process.env.WS_SUBSCRIBER_ENABLED !== "true") {
    console.log("[ws-subscriber] Disabled via WS_SUBSCRIBER_ENABLED");
    return;
  }

  if (state.initialized) {
    console.log("[ws-subscriber] Already initialized, skipping");
    return;
  }

  console.log("[ws-subscriber] Initializing...");
  const connection = getConnection();

  // Batch seed protocolStore before starting ongoing subscriptions.
  // Must complete before init() returns so SSE clients get full snapshot.
  await batchSeed(connection);

  // Start ongoing subscriptions/polls
  startAccountSubscriptions(connection);  // PRIMARY: sub-second via WS
  startSlotSubscription(connection);
  startAccountPoll(connection);           // FALLBACK: 30s safety net
  startSupplyPoll(connection);
  startStakerPoll(connection);
  startStalenessMonitor(connection);

  state.initialized = true;
  console.log("[ws-subscriber] Initialized successfully");
}

/**
 * Get subscriber health status (for /api/health, Phase 3).
 */
export function getStatus(): {
  initialized: boolean;
  wsConnected: boolean;
  latestSlot: number;
  lastSlotReceivedAt: number;
  fallbackActive: boolean;
} {
  return {
    initialized: state.initialized,
    wsConnected: state.wsConnected,
    latestSlot: state.latestSlot,
    lastSlotReceivedAt: state.lastSlotReceivedAt,
    fallbackActive: state.slotFallbackTimer !== null,
  };
}
