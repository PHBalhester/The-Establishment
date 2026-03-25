/**
 * VRF Validation Report Generator
 *
 * Accumulates test results during VRF devnet validation and generates
 * a structured markdown report. Used by the main orchestrator to produce
 * the validation report at scripts/vrf/vrf-validation-report.md.
 *
 * Report sections:
 * - Summary: pass/fail counts for each test category
 * - Epoch Transitions: table with epoch details, tax rates, VRF bytes, TX sigs
 * - Security Tests: anti-reroll, stale randomness, double-commit results
 * - Timeout Recovery: VRF timeout + retry flow results
 * - Swap Verification: post-VRF swap tax rate application
 */

import * as fs from "fs";
import { EpochTransitionResult } from "./vrf-flow";

// ─── Interfaces ────────────────────────────────────────────────────────────

/**
 * Security test result (anti-reroll, stale randomness, double-commit, etc.).
 */
export interface SecurityTestResult {
  /** Test name */
  name: string;
  /** Whether the test passed */
  passed: boolean;
  /** Details or error message */
  details: string;
}

/**
 * Timeout recovery test result.
 */
export interface TimeoutRecoveryResult {
  /** Whether recovery succeeded */
  passed: boolean;
  /** Slot when initial commit was made */
  initialCommitSlot: number;
  /** Number of slots waited */
  slotsWaited: number;
  /** Slot when retry was submitted */
  retrySlot: number;
  /** Final consume TX signature */
  consumeSig: string;
  /** Details or error message */
  details: string;
}

/**
 * Post-VRF swap verification result.
 */
export interface SwapVerificationResult {
  /** Whether the swap correctly applied VRF-derived tax rates */
  passed: boolean;
  /** Pre-swap EpochState tax values */
  expectedTaxBps: number;
  /** Actual tax applied (if measurable) */
  actualTaxBps: number;
  /** Pool used for the swap */
  pool: string;
  /** Swap TX signature */
  swapSig: string;
  /** Details */
  details: string;
}

// ─── Reporter Class ────────────────────────────────────────────────────────

/**
 * Accumulates validation results and generates a structured markdown report.
 *
 * Usage:
 *   const reporter = new ValidationReporter(clusterUrl, walletAddress, 750);
 *   reporter.addEpochTransition(result);
 *   reporter.addSecurityTest({ name: "...", passed: true, details: "..." });
 *   const report = reporter.generate();
 *   reporter.writeToFile("scripts/vrf/vrf-validation-report.md");
 */
export class ValidationReporter {
  private clusterUrl: string;
  private walletAddress: string;
  private slotsPerEpoch: number;
  private startTime: Date;

  private epochTransitions: EpochTransitionResult[] = [];
  private securityTests: SecurityTestResult[] = [];
  private timeoutRecoveries: TimeoutRecoveryResult[] = [];
  private swapVerifications: SwapVerificationResult[] = [];

  constructor(clusterUrl: string, walletAddress: string, slotsPerEpoch: number) {
    this.clusterUrl = clusterUrl;
    this.walletAddress = walletAddress;
    this.slotsPerEpoch = slotsPerEpoch;
    this.startTime = new Date();
  }

  /** Add an epoch transition result. */
  addEpochTransition(result: EpochTransitionResult): void {
    this.epochTransitions.push(result);
  }

  /** Add a security test result. */
  addSecurityTest(result: SecurityTestResult): void {
    this.securityTests.push(result);
  }

  /** Add a timeout recovery test result. */
  addTimeoutRecovery(result: TimeoutRecoveryResult): void {
    this.timeoutRecoveries.push(result);
  }

  /** Add a swap verification result. */
  addSwapVerification(result: SwapVerificationResult): void {
    this.swapVerifications.push(result);
  }

  /** Generate the complete markdown report. */
  generate(): string {
    const endTime = new Date();
    const durationMinutes = ((endTime.getTime() - this.startTime.getTime()) / 60000).toFixed(1);

    const lines: string[] = [];

    // ─── Header ──────────────────────────────────────────────────────
    lines.push("# VRF Devnet Validation Report");
    lines.push("");
    lines.push(`**Generated:** ${endTime.toISOString()}`);
    lines.push(`**Cluster:** ${this.maskApiKey(this.clusterUrl)}`);
    lines.push(`**Wallet:** ${this.walletAddress}`);
    lines.push(`**SLOTS_PER_EPOCH:** ${this.slotsPerEpoch}`);
    lines.push(`**Duration:** ${durationMinutes} minutes`);
    lines.push("");

    // ─── Summary ─────────────────────────────────────────────────────
    lines.push("## Summary");
    lines.push("");

    const epochsPassed = this.epochTransitions.length;
    const epochsTarget = 5;
    const securityPassed = this.securityTests.filter((t) => t.passed).length;
    const securityTotal = this.securityTests.length;
    const timeoutPassed = this.timeoutRecoveries.filter((t) => t.passed).length;
    const timeoutTotal = this.timeoutRecoveries.length;
    const swapPassed = this.swapVerifications.filter((t) => t.passed).length;
    const swapTotal = this.swapVerifications.length;

    lines.push(`| Test Category | Result |`);
    lines.push(`|---------------|--------|`);
    lines.push(
      `| Epoch transitions | ${epochsPassed}/${epochsTarget} passed |`
    );
    if (securityTotal > 0) {
      lines.push(
        `| Security tests | ${securityPassed}/${securityTotal} passed |`
      );
    }
    if (timeoutTotal > 0) {
      lines.push(
        `| Timeout recovery | ${timeoutPassed}/${timeoutTotal} passed |`
      );
    }
    if (swapTotal > 0) {
      lines.push(
        `| Swap verification | ${swapPassed}/${swapTotal} passed |`
      );
    }
    lines.push("");

    // ─── Epoch Transitions ───────────────────────────────────────────
    if (this.epochTransitions.length > 0) {
      lines.push("## Epoch Transitions");
      lines.push("");
      lines.push(
        "| # | Epoch | Cheap Side | Flipped | Low Tax | High Tax | Carnage | Create TX | Commit TX | Consume TX | Duration |"
      );
      lines.push(
        "|---|-------|------------|---------|---------|----------|---------|-----------|-----------|------------|----------|"
      );

      this.epochTransitions.forEach((t, i) => {
        lines.push(
          `| ${i + 1} | ${t.epoch} | ${t.cheapSide} | ${t.flipped ? "Yes" : "No"} | ${t.lowTaxBps} | ${t.highTaxBps} | ${t.carnageTriggered ? "YES" : "No"} | ${this.shortSig(t.createSig)} | ${this.shortSig(t.commitSig)} | ${this.shortSig(t.consumeSig)} | ${(t.durationMs / 1000).toFixed(0)}s |`
        );
      });
      lines.push("");

      // Detailed per-epoch info
      lines.push("### Per-Epoch Details");
      lines.push("");
      this.epochTransitions.forEach((t, i) => {
        lines.push(`**Transition ${i + 1} -- Epoch ${t.epoch}:**`);
        lines.push(`- Cheap Side: ${t.cheapSide} (flipped: ${t.flipped})`);
        lines.push(
          `- Tax Rates: low=${t.lowTaxBps}bps (${(t.lowTaxBps / 100).toFixed(1)}%), high=${t.highTaxBps}bps (${(t.highTaxBps / 100).toFixed(1)}%)`
        );
        lines.push(
          `- CRIME: buy=${t.crimeBuyTaxBps}bps sell=${t.crimeSellTaxBps}bps`
        );
        lines.push(
          `- FRAUD: buy=${t.fraudBuyTaxBps}bps sell=${t.fraudSellTaxBps}bps`
        );
        lines.push(
          `- Carnage triggered: ${t.carnageTriggered ? "YES" : "No"}`
        );
        lines.push(`- Duration: ${(t.durationMs / 1000).toFixed(1)}s`);
        lines.push(`- TX sigs:`);
        lines.push(`  - Create: \`${t.createSig}\``);
        lines.push(`  - Commit+Trigger: \`${t.commitSig}\``);
        lines.push(`  - Reveal+Consume: \`${t.consumeSig}\``);
        lines.push("");
      });
    }

    // ─── Security Tests ──────────────────────────────────────────────
    if (this.securityTests.length > 0) {
      lines.push("## Security Tests");
      lines.push("");
      this.securityTests.forEach((t) => {
        const icon = t.passed ? "PASSED" : "FAILED";
        lines.push(`- **${t.name}:** ${icon} -- ${t.details}`);
      });
      lines.push("");
    }

    // ─── Timeout Recovery ────────────────────────────────────────────
    if (this.timeoutRecoveries.length > 0) {
      lines.push("## Timeout Recovery");
      lines.push("");
      this.timeoutRecoveries.forEach((t) => {
        const icon = t.passed ? "PASSED" : "FAILED";
        lines.push(`- **Result:** ${icon}`);
        lines.push(`- Initial commit at slot: ${t.initialCommitSlot}`);
        lines.push(`- Waited ${t.slotsWaited} slots`);
        lines.push(`- Retry commit at slot: ${t.retrySlot}`);
        lines.push(`- Consume TX: \`${t.consumeSig}\``);
        lines.push(`- ${t.details}`);
      });
      lines.push("");
    }

    // ─── Swap Verification ───────────────────────────────────────────
    if (this.swapVerifications.length > 0) {
      lines.push("## Tax Rate Application (Swap Verification)");
      lines.push("");
      this.swapVerifications.forEach((t) => {
        const icon = t.passed ? "PASSED" : "FAILED";
        lines.push(`- **Result:** ${icon}`);
        lines.push(`- Pool: ${t.pool}`);
        lines.push(`- Expected tax: ${t.expectedTaxBps} bps`);
        lines.push(`- Actual tax: ${t.actualTaxBps} bps`);
        lines.push(`- Swap TX: \`${t.swapSig}\``);
        lines.push(`- ${t.details}`);
      });
      lines.push("");
    }

    // ─── Footer ──────────────────────────────────────────────────────
    lines.push("---");
    lines.push(
      `*Generated by VRF Devnet Validation Script (Phase 35, Plan 02)*`
    );

    return lines.join("\n");
  }

  /** Write the report to a file. */
  writeToFile(filePath: string): void {
    const report = this.generate();
    fs.writeFileSync(filePath, report, "utf-8");
    console.log(`\nReport written to: ${filePath}`);
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  /** Shorten a transaction signature for table display. */
  private shortSig(sig: string): string {
    if (!sig) return "N/A";
    return `${sig.slice(0, 8)}...`;
  }

  /** Mask API key in cluster URL for security. */
  private maskApiKey(url: string): string {
    return url.replace(/api-key=[^&]+/, "api-key=***");
  }
}
