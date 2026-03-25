/**
 * Verify Refunds: Pathway 1 Report Generator
 *
 * Reads pathway1-log.json and computes expected vs actual refund amounts
 * for each wallet. Generates Docs/pathway1-report.md with pass/fail results.
 *
 * Refund math:
 *   expected_refund = floor(wallet_token_balance * refund_pool_lamports / total_outstanding_tokens)
 *
 * Tolerance: 1 lamport (floor rounding may differ by 1 between expected and actual).
 *
 * Usage:
 *   npx tsx scripts/test/verify-refunds.ts
 */

import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Types (mirror pathway1-test.ts)
// ---------------------------------------------------------------------------

interface ActionLog {
  wallet: string;
  walletIndex: number;
  curve: "CRIME" | "FRAUD";
  action: "buy" | "sell";
  solAmount?: number;
  tokenAmount?: number;
  solReceived?: number;
  txSig: string;
  slot: number;
}

interface WalletSnapshot {
  wallet: string;
  walletIndex: number;
  solBalance: number;
  crimeBalance: number;
  fraudBalance: number;
}

interface CurveSnapshot {
  curve: "CRIME" | "FRAUD";
  tokensSold: number;
  solRaised: number;
  taxCollected: number;
  escrowConsolidated: boolean;
  refundPoolLamports: number;
  totalOutstandingTokens: number;
  solVaultBalance: number;
}

interface Pathway1Log {
  timestamp: string;
  deployment: any;
  actions: ActionLog[];
  preClaim: WalletSnapshot[];
  curveSnapshots: CurveSnapshot[];
  postClaim: WalletSnapshot[];
  claimActions: { wallet: string; walletIndex: number; curve: string; txSig: string }[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lamportsToSol(lamports: number): string {
  return (lamports / 1_000_000_000).toFixed(9);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  console.log("=== Pathway 1 Refund Verification ===\n");

  // Load log
  const logPath = path.resolve(process.cwd(), "scripts/test/pathway1-log.json");
  if (!fs.existsSync(logPath)) {
    throw new Error(`Log file not found: ${logPath}\nRun pathway1-test.ts first.`);
  }
  const log: Pathway1Log = JSON.parse(fs.readFileSync(logPath, "utf8"));

  // Build curve snapshot map
  const curveSnapshotMap: Record<string, CurveSnapshot> = {};
  for (const snap of log.curveSnapshots) {
    curveSnapshotMap[snap.curve] = snap;
  }

  // For each wallet, compute expected refund per curve
  interface RefundVerification {
    walletIndex: number;
    wallet: string;
    curve: string;
    tokenBalance: number;
    refundPoolLamports: number;
    totalOutstandingTokens: number;
    expectedRefund: number;
    actualRefund: number;
    delta: number;
    pass: boolean;
  }

  const verifications: RefundVerification[] = [];
  let totalPassed = 0;
  let totalChecked = 0;

  for (let i = 0; i < log.preClaim.length; i++) {
    const pre = log.preClaim[i];
    const post = log.postClaim[i];

    // Track refunds per curve for this wallet
    for (const { curve, balanceField } of [
      { curve: "CRIME", balanceField: "crimeBalance" as const },
      { curve: "FRAUD", balanceField: "fraudBalance" as const },
    ]) {
      const tokenBalance = pre[balanceField];
      if (tokenBalance <= 0) continue;

      const snap = curveSnapshotMap[curve];
      if (!snap) {
        console.error(`  No curve snapshot for ${curve}`);
        continue;
      }

      // expected_refund = floor(wallet_token_balance * refund_pool_lamports / total_outstanding_tokens)
      // Use BigInt for precision
      const expectedRefund = Number(
        BigInt(tokenBalance) * BigInt(snap.refundPoolLamports) / BigInt(snap.totalOutstandingTokens)
      );

      // Actual refund = post_sol - pre_sol
      // Note: claim_refund only transfers SOL (no rent changes since ATA stays open).
      // However, if multiple claims happen, we need to track cumulative SOL change.
      // Since we snapshot pre/post across ALL claims, we compute per-curve refund
      // by subtracting other curve's expected refund. But this is tricky.
      //
      // Simpler approach: total SOL received = post.solBalance - pre.solBalance.
      // For wallets with only one curve, this is the refund amount exactly.
      // For Wallet 4 (both curves), we verify the TOTAL matches sum of expected.
      //
      // We'll compute per-curve expected and compare total.

      verifications.push({
        walletIndex: i,
        wallet: pre.wallet,
        curve,
        tokenBalance,
        refundPoolLamports: snap.refundPoolLamports,
        totalOutstandingTokens: snap.totalOutstandingTokens,
        expectedRefund,
        actualRefund: 0, // computed below
        delta: 0,
        pass: false,
      });
    }
  }

  // Compute actual refunds per wallet (total SOL change)
  // Group verifications by wallet to compute total expected
  const walletGroups: Record<number, RefundVerification[]> = {};
  for (const v of verifications) {
    if (!walletGroups[v.walletIndex]) walletGroups[v.walletIndex] = [];
    walletGroups[v.walletIndex].push(v);
  }

  for (const [walletIdxStr, group] of Object.entries(walletGroups)) {
    const walletIdx = Number(walletIdxStr);
    const pre = log.preClaim[walletIdx];
    const post = log.postClaim[walletIdx];
    const totalSolChange = post.solBalance - pre.solBalance;
    const totalExpected = group.reduce((sum, v) => sum + v.expectedRefund, 0);

    if (group.length === 1) {
      // Single-curve wallet: actual refund = total SOL change
      group[0].actualRefund = totalSolChange;
      group[0].delta = Math.abs(totalSolChange - group[0].expectedRefund);
      group[0].pass = group[0].delta <= 1; // 1 lamport tolerance
    } else {
      // Multi-curve wallet: verify total matches
      // Distribute actual proportionally based on expected
      for (const v of group) {
        const proportion = totalExpected > 0 ? v.expectedRefund / totalExpected : 0;
        v.actualRefund = Math.round(totalSolChange * proportion);
        v.delta = Math.abs(v.actualRefund - v.expectedRefund);
        v.pass = Math.abs(totalSolChange - totalExpected) <= group.length; // N lamports tolerance for N claims
      }
    }
  }

  for (const v of verifications) {
    totalChecked++;
    if (v.pass) totalPassed++;
  }

  // Also compute total SOL refunded across all wallets
  let totalSolRefunded = 0;
  for (let i = 0; i < log.postClaim.length; i++) {
    const change = log.postClaim[i].solBalance - log.preClaim[i].solBalance;
    if (change > 0) totalSolRefunded += change;
  }

  // =========================================================================
  // Generate Report
  // =========================================================================

  const reportLines: string[] = [];
  const allPassed = totalPassed === totalChecked;

  reportLines.push("# Phase 94 Pathway 1 Test Report");
  reportLines.push("");
  reportLines.push(`**Date:** ${new Date().toISOString().split("T")[0]}`);
  reportLines.push(`**Test timestamp:** ${log.timestamp}`);
  reportLines.push(`**Result:** ${allPassed ? "PASS" : "FAIL"} (${totalPassed}/${totalChecked} wallets passed)`);
  reportLines.push("");

  // Deployment info
  reportLines.push("## Deployment Addresses");
  reportLines.push("");
  reportLines.push("| Component | Address |");
  reportLines.push("|-----------|---------|");
  reportLines.push(`| Transfer Hook | \`${log.deployment.programs.transferHook}\` |`);
  reportLines.push(`| Bonding Curve | \`${log.deployment.programs.bondingCurve}\` |`);
  reportLines.push(`| CRIME Mint | \`${log.deployment.mints.crime}\` |`);
  reportLines.push(`| FRAUD Mint | \`${log.deployment.mints.fraud}\` |`);
  reportLines.push("");

  // Actions table
  reportLines.push("## Wallet Actions");
  reportLines.push("");
  reportLines.push("| Wallet | Curve | Action | SOL Amount | Token Amount | TX |");
  reportLines.push("|--------|-------|--------|-----------|-------------|------|");
  for (const action of log.actions) {
    const solAmt = action.solAmount ? lamportsToSol(action.solAmount) : "-";
    const tokAmt = action.tokenAmount ? action.tokenAmount.toString() : "-";
    const txShort = action.txSig.startsWith("FAILED") ? action.txSig : `\`${action.txSig.slice(0, 8)}...\``;
    reportLines.push(`| W${action.walletIndex + 1} | ${action.curve} | ${action.action} | ${solAmt} | ${tokAmt} | ${txShort} |`);
  }
  reportLines.push("");

  // Curve state at consolidation
  reportLines.push("## Curve State (Post-Consolidation)");
  reportLines.push("");
  reportLines.push("| Curve | Tokens Sold | SOL Raised | Tax Collected | Refund Pool | Vault Balance |");
  reportLines.push("|-------|------------|-----------|--------------|------------|--------------|");
  for (const snap of log.curveSnapshots) {
    reportLines.push(
      `| ${snap.curve} | ${snap.tokensSold} | ${lamportsToSol(snap.solRaised)} | ${lamportsToSol(snap.taxCollected)} | ${lamportsToSol(snap.refundPoolLamports)} | ${lamportsToSol(snap.solVaultBalance)} |`,
    );
  }
  reportLines.push("");

  // Refund verification table
  reportLines.push("## Refund Verification");
  reportLines.push("");
  reportLines.push("| Wallet | Curve | Token Balance | Expected Refund (lam) | Actual Refund (lam) | Delta | Result |");
  reportLines.push("|--------|-------|--------------|----------------------|--------------------|---------|----|");
  for (const v of verifications) {
    const result = v.pass ? "PASS" : "FAIL";
    reportLines.push(
      `| W${v.walletIndex + 1} | ${v.curve} | ${v.tokenBalance} | ${v.expectedRefund} | ${v.actualRefund} | ${v.delta} | **${result}** |`,
    );
  }
  reportLines.push("");

  // Summary
  reportLines.push("## Summary");
  reportLines.push("");
  reportLines.push(`- **Wallets tested:** ${log.preClaim.length}`);
  reportLines.push(`- **Refund claims verified:** ${totalChecked}`);
  reportLines.push(`- **Passed:** ${totalPassed}/${totalChecked}`);
  reportLines.push(`- **Total SOL refunded:** ${lamportsToSol(totalSolRefunded)} SOL`);
  reportLines.push(`- **Tolerance:** 1 lamport per claim (floor rounding)`);
  reportLines.push(`- **Overall result:** ${allPassed ? "**PASS**" : "**FAIL**"}`);
  reportLines.push("");

  if (!allPassed) {
    reportLines.push("### Failed Claims");
    reportLines.push("");
    for (const v of verifications.filter((v) => !v.pass)) {
      reportLines.push(`- W${v.walletIndex + 1} ${v.curve}: expected ${v.expectedRefund} lam, got ${v.actualRefund} lam (delta: ${v.delta})`);
    }
    reportLines.push("");
  }

  // Write report
  const reportPath = path.resolve(process.cwd(), "Docs/pathway1-report.md");
  fs.writeFileSync(reportPath, reportLines.join("\n"));
  console.log(`Report written to: ${reportPath}`);
  console.log(`Result: ${allPassed ? "PASS" : "FAIL"} (${totalPassed}/${totalChecked})`);
}

main();
