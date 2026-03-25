/**
 * Helius Webhook Management Script
 *
 * Lists, creates, updates, and deletes Helius webhooks for the
 * Dr. Fraudsworth deployment. Cluster-aware: uses CLUSTER or
 * NEXT_PUBLIC_CLUSTER env var to select mainnet vs devnet API.
 *
 * The webhook monitors the Tax Program and Epoch Program for swap,
 * epoch transition, and Carnage events. Raw devnet webhooks deliver
 * full transaction data including logMessages, which the webhook
 * handler (app/api/webhooks/helius) parses using Anchor's EventParser.
 *
 * Usage:
 *   npx tsx scripts/webhook-manage.ts list
 *   npx tsx scripts/webhook-manage.ts create
 *   npx tsx scripts/webhook-manage.ts update <webhookId>
 *   npx tsx scripts/webhook-manage.ts delete <webhookId>
 *
 * Environment variables:
 *   HELIUS_API_KEY        - Helius API key (required)
 *   WEBHOOK_URL           - Full webhook URL (required -- no default)
 *   HELIUS_WEBHOOK_SECRET - Auth header value for webhook delivery
 *   CLUSTER               - 'mainnet' or 'devnet' (default: devnet)
 *   NEXT_PUBLIC_CLUSTER   - Fallback for CLUSTER (from .env files)
 */

// =============================================================================
// Configuration
// =============================================================================

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
if (!HELIUS_API_KEY) {
  console.error("Error: HELIUS_API_KEY environment variable is required.");
  process.exit(1);
}

// Cluster detection: CLUSTER env var takes precedence, falls back to
// NEXT_PUBLIC_CLUSTER (useful when sourcing .env files), defaults to devnet.
const cluster = (
  process.env.CLUSTER || process.env.NEXT_PUBLIC_CLUSTER || "devnet"
).toLowerCase();
const isMainnet = cluster === "mainnet" || cluster === "mainnet-beta";

// API base URL: Helius uses different subdomains for mainnet vs devnet.
const HELIUS_API_BASE = isMainnet
  ? "https://api-mainnet.helius-rpc.com/v0"
  : "https://api.helius.xyz/v0";

// Webhook type: Helius requires 'raw' for mainnet, 'rawDevnet' for devnet.
const WEBHOOK_TYPE = isMainnet ? "raw" : "rawDevnet";

console.log(`Cluster: ${cluster} (${isMainnet ? "MAINNET" : "devnet"})`);
console.log(`API Base: ${HELIUS_API_BASE}`);
console.log(`Webhook Type: ${WEBHOOK_TYPE}`);
console.log();

// Program IDs loaded from IDL address fields (auto-synced during deployment)
// - Tax Program: TaxedSwap, UntaxedSwap, ExemptSwap events
// - Epoch Program: EpochTransitionTriggered, TaxesUpdated, CarnageExecuted events
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const __wm_dirname = dirname(fileURLToPath(import.meta.url));
const taxIdlAddr = JSON.parse(readFileSync(join(__wm_dirname, "..", "app", "idl", "tax_program.json"), "utf-8")).address;
const epochIdlAddr = JSON.parse(readFileSync(join(__wm_dirname, "..", "app", "idl", "epoch_program.json"), "utf-8")).address;
const ACCOUNT_ADDRESSES = [taxIdlAddr, epochIdlAddr];

// WEBHOOK_URL is mandatory -- no hardcoded default to prevent environment
// cross-contamination (VH-M001: devnet webhooks accidentally pointing to prod)
const WEBHOOK_URL = process.env.WEBHOOK_URL;
if (!WEBHOOK_URL) {
  console.error("ERROR: WEBHOOK_URL environment variable is required.");
  console.error("Set it to your deployment URL (e.g., https://your-app.up.railway.app/api/webhook)");
  console.error("This prevents accidentally registering devnet webhooks to production.");
  process.exit(1);
}

// =============================================================================
// API Helpers
// =============================================================================

async function heliusRequest(
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const url = `${HELIUS_API_BASE}${path}?api-key=${HELIUS_API_KEY}`;
  const options: RequestInit = { method };
  if (body) {
    options.headers = { "Content-Type": "application/json" };
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    console.error(`Helius API error (${response.status}):`, JSON.stringify(data, null, 2));
    process.exit(1);
  }

  return data;
}

// =============================================================================
// Commands
// =============================================================================

async function listWebhooks(): Promise<void> {
  console.log("Listing all Helius webhooks...\n");
  const webhooks = await heliusRequest("GET", "/webhooks") as Array<{
    webhookID: string;
    webhookURL: string;
    webhookType: string;
    accountAddresses: string[];
  }>;

  if (!Array.isArray(webhooks) || webhooks.length === 0) {
    console.log("No webhooks found.");
    return;
  }

  for (const wh of webhooks) {
    console.log(`  ID:       ${wh.webhookID}`);
    console.log(`  URL:      ${wh.webhookURL}`);
    console.log(`  Type:     ${wh.webhookType}`);
    console.log(`  Accounts: ${wh.accountAddresses?.join(", ") ?? "(none)"}`);
    console.log();
  }

  console.log(`Total: ${webhooks.length} webhook(s)`);
}

async function createWebhook(): Promise<void> {
  const webhookURL = WEBHOOK_URL;
  const authHeader = process.env.HELIUS_WEBHOOK_SECRET;

  console.log("Creating Helius webhook...");
  console.log(`  URL:      ${webhookURL}`);
  console.log(`  Type:     ${WEBHOOK_TYPE}`);
  console.log(`  Accounts: ${ACCOUNT_ADDRESSES.join(", ")}`);
  console.log(`  Auth:     ${authHeader ? "(set)" : "(not set -- webhook will be unauthenticated)"}`);
  console.log();

  const body: Record<string, unknown> = {
    webhookURL,
    webhookType: WEBHOOK_TYPE,
    transactionTypes: ["ANY"],
    accountAddresses: ACCOUNT_ADDRESSES,
  };

  if (authHeader) {
    body.authHeader = authHeader;
  }

  const result = await heliusRequest("POST", "/webhooks", body) as {
    webhookID: string;
  };

  console.log(`Webhook created successfully!`);
  console.log(`  Webhook ID: ${result.webhookID}`);
  console.log();
  console.log("IMPORTANT: Make sure HELIUS_WEBHOOK_SECRET is set in Railway env vars");
  console.log("to match the authHeader used here.");
}

async function updateWebhook(webhookId: string): Promise<void> {
  const webhookURL = WEBHOOK_URL;
  const authHeader = process.env.HELIUS_WEBHOOK_SECRET;

  console.log(`Updating webhook ${webhookId}...`);
  console.log(`  URL:      ${webhookURL}`);
  console.log(`  Type:     ${WEBHOOK_TYPE}`);
  console.log(`  Accounts: ${ACCOUNT_ADDRESSES.join(", ")}`);
  console.log();

  const body: Record<string, unknown> = {
    webhookURL,
    webhookType: WEBHOOK_TYPE,
    transactionTypes: ["ANY"],
    accountAddresses: ACCOUNT_ADDRESSES,
  };

  if (authHeader) {
    body.authHeader = authHeader;
  }

  await heliusRequest("PUT", `/webhooks/${webhookId}`, body);

  console.log("Webhook updated successfully!");
}

async function deleteWebhook(webhookId: string): Promise<void> {
  console.log(`Deleting webhook ${webhookId}...`);

  await heliusRequest("DELETE", `/webhooks/${webhookId}`);

  console.log("Webhook deleted successfully!");
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const command = process.argv[2];
  const arg = process.argv[3];

  switch (command) {
    case "list":
      await listWebhooks();
      break;

    case "create":
      await createWebhook();
      break;

    case "update":
      if (!arg) {
        console.error("Usage: webhook-manage.ts update <webhookId>");
        process.exit(1);
      }
      await updateWebhook(arg);
      break;

    case "delete":
      if (!arg) {
        console.error("Usage: webhook-manage.ts delete <webhookId>");
        process.exit(1);
      }
      await deleteWebhook(arg);
      break;

    default:
      console.log("Helius Webhook Management");
      console.log();
      console.log("Usage:");
      console.log("  npx tsx scripts/webhook-manage.ts list");
      console.log("  npx tsx scripts/webhook-manage.ts create");
      console.log("  npx tsx scripts/webhook-manage.ts update <webhookId>");
      console.log("  npx tsx scripts/webhook-manage.ts delete <webhookId>");
      console.log();
      console.log("Environment variables:");
      console.log("  HELIUS_API_KEY         Helius API key (required)");
      console.log("  WEBHOOK_URL            Webhook URL (required -- no default)");
      console.log("  HELIUS_WEBHOOK_SECRET  Auth header for webhook delivery");
      break;
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
