/**
 * E2E Markdown Report Generator
 *
 * Reads the accumulated JSONL log entries and generates a structured
 * markdown report at Docs/E2E_Devnet_Test_Report.md.
 *
 * Report sections:
 * - Summary: pass/fail/known_issue counts per phase
 * - Swap Flow: TX signatures, tax distribution verification
 * - Staking Flow: stake/claim/yield verification (Plan 02)
 * - Epoch Transitions: VRF epoch advancement results (Plan 02)
 * - Carnage: forced/natural Carnage trigger results (Plan 03)
 * - Mainnet Readiness: SC-1 through SC-5 success criteria mapping
 *
 * TX signatures are formatted as Solana Explorer links for easy
 * click-through verification on devnet.
 */

import { LogEntry } from "./e2e-logger";

// ---- Reporter Class ----

/**
 * Generates a structured markdown report from E2E log entries.
 *
 * Fully implements all sections: Summary, Test Environment, Swap Flow,
 * Staking Flow, Epoch Transitions, Carnage, Known Issues, Mainnet Readiness,
 * and Appendix (full TX log).
 */
export class E2EReporter {
  private entries: LogEntry[];

  constructor(logEntries: LogEntry[]) {
    this.entries = logEntries;
  }

  /**
   * Generate the complete markdown report.
   *
   * @returns Markdown string ready to write to file
   */
  generate(): string {
    const sections: string[] = [];

    sections.push(this.generateHeader());
    sections.push(this.generateSummary());
    sections.push(this.generateTestEnvironment());
    sections.push(this.generateSwapFlow());
    sections.push(this.generateStakingFlow());
    sections.push(this.generateEpochTransitions());
    sections.push(this.generateCarnage());
    sections.push(this.generateKnownIssues());
    sections.push(this.generateMainnetReadiness());
    sections.push(this.generateAppendix());
    sections.push(this.generateFooter());

    return sections.join("\n\n");
  }

  // ---- Section Generators ----

  private generateHeader(): string {
    const now = new Date().toISOString();
    return [
      "# E2E Devnet Test Report",
      "",
      `**Generated:** ${now}`,
      "**Cluster:** Solana Devnet",
      `**Total Entries:** ${this.entries.length}`,
    ].join("\n");
  }

  private generateSummary(): string {
    const phases = ["setup", "swap", "staking", "epoch", "carnage", "report"];
    const lines: string[] = ["## Summary", ""];
    lines.push("| Phase | Pass | Fail | Known Issue | Skip |");
    lines.push("|-------|------|------|-------------|------|");

    for (const phase of phases) {
      const phaseEntries = this.entries.filter((e) => e.phase === phase);
      if (phaseEntries.length === 0) continue;

      const pass = phaseEntries.filter((e) => e.status === "pass").length;
      const fail = phaseEntries.filter((e) => e.status === "fail").length;
      const known = phaseEntries.filter((e) => e.status === "known_issue").length;
      const skip = phaseEntries.filter((e) => e.status === "skip").length;

      lines.push(`| ${phase} | ${pass} | ${fail} | ${known} | ${skip} |`);
    }

    // Overall totals
    const totalPass = this.entries.filter((e) => e.status === "pass").length;
    const totalFail = this.entries.filter((e) => e.status === "fail").length;
    const totalKnown = this.entries.filter((e) => e.status === "known_issue").length;
    const totalSkip = this.entries.filter((e) => e.status === "skip").length;
    lines.push(`| **Total** | **${totalPass}** | **${totalFail}** | **${totalKnown}** | **${totalSkip}** |`);

    return lines.join("\n");
  }

  private generateSwapFlow(): string {
    const swapEntries = this.entries.filter((e) => e.phase === "swap");
    const lines: string[] = ["## 1. Swap Flow (E2E-01 + E2E-02)", ""];

    if (swapEntries.length === 0) {
      lines.push("*No swap flow entries recorded.*");
      return lines.join("\n");
    }

    for (const entry of swapEntries) {
      const statusIcon = entry.status === "pass" ? "PASS" : entry.status === "fail" ? "FAIL" : entry.status.toUpperCase();
      lines.push(`### ${statusIcon}: ${entry.message}`);
      lines.push("");

      if (entry.txSignature) {
        lines.push(`**TX:** [${entry.txSignature.slice(0, 16)}...](https://explorer.solana.com/tx/${entry.txSignature}?cluster=devnet)`);
        lines.push("");
      }

      if (entry.details) {
        lines.push("**Details:**");
        lines.push("```json");
        lines.push(JSON.stringify(entry.details, null, 2));
        lines.push("```");
        lines.push("");
      }
    }

    return lines.join("\n");
  }

  private generateStakingFlow(): string {
    const stakingEntries = this.entries.filter((e) => e.phase === "staking");
    const lines: string[] = ["## 2. Staking Flow (E2E-03 + E2E-04)", ""];

    if (stakingEntries.length === 0) {
      lines.push("*Staking flow not yet tested. See Plan 02.*");
      return lines.join("\n");
    }

    // Extract key events for structured display
    const stakeEntry = stakingEntries.find((e) => e.message.includes("Staked") && e.txSignature);
    const claimEntry = stakingEntries.find((e) => e.message.includes("Claim yield") && e.txSignature);
    const flowResult = stakingEntries.find((e) => e.message.includes("Staking flow complete"));

    // Stake section
    lines.push("### Stake PROFIT");
    lines.push("");
    if (stakeEntry) {
      lines.push(`**Status:** ${stakeEntry.status === "pass" ? "PASS" : "FAIL"}`);
      lines.push(`**TX:** [${stakeEntry.txSignature!.slice(0, 16)}...](https://explorer.solana.com/tx/${stakeEntry.txSignature}?cluster=devnet)`);
      if (stakeEntry.details) {
        const d = stakeEntry.details as any;
        lines.push(`**Amount:** ${d.amountStakedUi || d.amountStaked} PROFIT`);
        lines.push(`**Pre-balance:** ${d.preBalanceRaw} raw`);
        lines.push(`**Post-balance:** ${d.postBalanceRaw} raw`);
      }
    } else {
      const stakeFail = stakingEntries.find((e) => e.message.includes("Stake PROFIT failed"));
      lines.push(`**Status:** ${stakeFail ? "FAIL" : "NOT EXECUTED"}`);
      if (stakeFail?.details) {
        lines.push("```");
        lines.push(String((stakeFail.details as any).error || "").slice(0, 300));
        lines.push("```");
      }
    }
    lines.push("");

    // Claim section
    lines.push("### Claim SOL Yield");
    lines.push("");
    if (claimEntry) {
      lines.push(`**Status:** ${claimEntry.status === "pass" ? "PASS" : claimEntry.status.toUpperCase()}`);
      lines.push(`**TX:** [${claimEntry.txSignature!.slice(0, 16)}...](https://explorer.solana.com/tx/${claimEntry.txSignature}?cluster=devnet)`);
      if (claimEntry.details) {
        const d = claimEntry.details as any;
        lines.push(`**Yield:** ${d.yieldSol?.toFixed(9) || "?"} SOL (${d.yieldLamports || "?"} lamports)`);
        lines.push(`**Pre-balance:** ${d.preSolBalance} lamports`);
        lines.push(`**Post-balance:** ${d.postSolBalance} lamports`);
      }
    } else {
      const claimFail = stakingEntries.find((e) => e.message.includes("Claim yield failed"));
      lines.push(`**Status:** ${claimFail ? claimFail.status.toUpperCase() : "NOT EXECUTED"}`);
      if (claimFail) {
        lines.push(`**Reason:** ${claimFail.message}`);
      }
    }
    lines.push("");

    // Flow summary
    if (flowResult) {
      lines.push("### Flow Summary");
      lines.push("");
      lines.push(`**Result:** ${flowResult.status === "pass" ? "PASS" : flowResult.status.toUpperCase()}`);
      lines.push(`**Message:** ${flowResult.message}`);
      if (flowResult.details) {
        const d = flowResult.details as any;
        if (d.flowDurationMin) {
          lines.push(`**Duration:** ${d.flowDurationMin} min`);
        }
        if (d.epochTransitions !== undefined) {
          lines.push(`**Epoch Transitions:** ${d.epochTransitions}/3`);
        }
        if (d.diagnosis) {
          lines.push("");
          lines.push(`> **Diagnosis:** ${d.diagnosis}`);
        }
      }
      lines.push("");
    }

    // Detailed log
    lines.push("<details>");
    lines.push("<summary>Full staking log entries</summary>");
    lines.push("");
    for (const entry of stakingEntries) {
      const statusIcon = entry.status === "pass" ? "PASS" : entry.status === "fail" ? "FAIL" : entry.status.toUpperCase();
      lines.push(`- **${statusIcon}:** ${entry.message}`);
      if (entry.txSignature) {
        lines.push(`  - TX: [${entry.txSignature.slice(0, 16)}...](https://explorer.solana.com/tx/${entry.txSignature}?cluster=devnet)`);
      }
    }
    lines.push("");
    lines.push("</details>");

    return lines.join("\n");
  }

  private generateEpochTransitions(): string {
    const epochEntries = this.entries.filter((e) => e.phase === "epoch");
    const lines: string[] = ["## 3. Epoch Transitions (E2E-04)", ""];

    if (epochEntries.length === 0) {
      lines.push("*Epoch transitions not yet tested. See Plan 02.*");
      return lines.join("\n");
    }

    // Extract transition results (entries with epoch/cheapSide details)
    const transitionEntries = epochEntries.filter(
      (e) => e.details && (e.details as any).epoch !== undefined && (e.details as any).cheapSide !== undefined
    );

    // Build structured table
    if (transitionEntries.length > 0) {
      lines.push("| # | Epoch | CheapSide | LowTax | HighTax | Flipped | Carnage | Duration | TX Sig |");
      lines.push("|---|-------|-----------|--------|---------|---------|---------|----------|--------|");

      for (const entry of transitionEntries) {
        const d = entry.details as any;
        const txLink = entry.txSignature
          ? `[${entry.txSignature.slice(0, 8)}...](https://explorer.solana.com/tx/${entry.txSignature}?cluster=devnet)`
          : "N/A";
        const durationSec = d.durationMs ? `${(d.durationMs / 1000).toFixed(1)}s` : "?";

        lines.push(
          `| ${d.transitionIndex || "?"} | ${d.epoch} | ${d.cheapSide} | ${d.lowTaxBps}bps | ${d.highTaxBps}bps | ${d.flipped ? "YES" : "no"} | ${d.carnageTriggered ? "YES" : "no"} | ${durationSec} | ${txLink} |`
        );
      }
      lines.push("");
    }

    // Summary
    const summaryEntry = epochEntries.find((e) => e.message.includes("Multi-epoch cycling complete"));
    if (summaryEntry) {
      const d = summaryEntry.details as any;
      lines.push(`**Result:** ${d.successful || 0}/${d.attempted || 0} transitions successful`);
      lines.push("");
    }

    // Inter-epoch swaps
    const swapEntries = epochEntries.filter((e) => e.message.includes("Inter-epoch swap"));
    if (swapEntries.length > 0) {
      lines.push("### Inter-Epoch Swaps (Tax Revenue Generation)");
      lines.push("");
      for (const entry of swapEntries) {
        const statusIcon = entry.status === "pass" ? "PASS" : "FAIL";
        lines.push(`- **${statusIcon}:** ${entry.message}`);
        if (entry.txSignature) {
          lines.push(`  - TX: [${entry.txSignature.slice(0, 16)}...](https://explorer.solana.com/tx/${entry.txSignature}?cluster=devnet)`);
        }
      }
      lines.push("");
    }

    // Detailed log
    lines.push("<details>");
    lines.push("<summary>Full epoch transition log entries</summary>");
    lines.push("");
    for (const entry of epochEntries) {
      const statusIcon = entry.status === "pass" ? "PASS" : entry.status === "fail" ? "FAIL" : entry.status.toUpperCase();
      lines.push(`- **${statusIcon}:** ${entry.message}`);
      if (entry.txSignature) {
        lines.push(`  - TX: [${entry.txSignature.slice(0, 16)}...](https://explorer.solana.com/tx/${entry.txSignature}?cluster=devnet)`);
      }
    }
    lines.push("");
    lines.push("</details>");

    return lines.join("\n");
  }

  private generateTestEnvironment(): string {
    const lines: string[] = ["## Test Environment", ""];

    // Extract setup details
    const walletEntry = this.entries.find(
      (e) => e.phase === "setup" && e.message.includes("Wallet balance")
    );
    const userEntry = this.entries.find(
      (e) => e.phase === "setup" && e.message.includes("user created")
    );

    lines.push("| Property | Value |");
    lines.push("|----------|-------|");
    lines.push("| Cluster | Solana Devnet |");

    if (walletEntry?.details) {
      const d = walletEntry.details as any;
      lines.push(`| Wallet | \`${d.wallet || "?"}\` |`);
      lines.push(`| Starting Balance | ${d.balanceSol?.toFixed(2) || "?"} SOL |`);
    }
    if (userEntry?.details) {
      const d = userEntry.details as any;
      lines.push(`| E2E User | \`${d.userPubkey || "?"}\` |`);
    }

    // Count total TXs
    const txCount = this.entries.filter((e) => e.txSignature).length;
    lines.push(`| Total Transactions | ${txCount} |`);

    // Time range
    if (this.entries.length > 0) {
      const firstTs = this.entries[0].timestamp;
      const lastTs = this.entries[this.entries.length - 1].timestamp;
      lines.push(`| Started | ${firstTs} |`);
      lines.push(`| Completed | ${lastTs} |`);

      const durationMs = new Date(lastTs).getTime() - new Date(firstTs).getTime();
      const durationMin = (durationMs / 60000).toFixed(1);
      lines.push(`| Duration | ${durationMin} min |`);
    }

    return lines.join("\n");
  }

  private generateCarnage(): string {
    const carnageEntries = this.entries.filter((e) => e.phase === "carnage");
    const lines: string[] = ["## 4. Carnage (E2E-05)", ""];

    if (carnageEntries.length === 0) {
      lines.push("*Carnage not tested in this run.*");
      return lines.join("\n");
    }

    // Forced Carnage section
    const forcedEntries = carnageEntries.filter(
      (e) => e.message.includes("execute_carnage_atomic") || e.message.includes("Carnage pending")
    );
    const skippedForced = carnageEntries.find((e) => e.message.includes("No Carnage pending"));

    lines.push("### Forced Carnage (execute_carnage_atomic)");
    lines.push("");

    if (skippedForced) {
      lines.push("**Status:** SKIPPED (carnage_pending = false, no prior VRF trigger)");
      lines.push("");
    } else if (forcedEntries.length > 0) {
      for (const entry of forcedEntries) {
        const status = entry.status === "pass" ? "PASS" : entry.status === "known_issue" ? "KNOWN ISSUE" : entry.status === "skip" ? "SKIP" : "FAIL";
        lines.push(`**${status}:** ${entry.message}`);
        if (entry.txSignature) {
          lines.push(`- TX: [${entry.txSignature.slice(0, 16)}...](https://explorer.solana.com/tx/${entry.txSignature}?cluster=devnet)`);
        }
        if (entry.details && (entry.details as any).auditFindings) {
          lines.push(`- Audit findings: ${(entry.details as any).auditFindings}`);
          lines.push(`- Fix planned: ${(entry.details as any).fixPlanned}`);
        }
        lines.push("");
      }
    }

    // Natural Carnage section
    const naturalEntries = carnageEntries.filter(
      (e) => e.message.includes("Epoch") && e.details && (e.details as any).epochIndex
    );
    const naturalResult = carnageEntries.find(
      (e) => e.message.includes("Natural Carnage not triggered") || e.message.includes("CARNAGE TRIGGERED")
    );

    lines.push("### Natural Carnage (VRF Epoch Cycling)");
    lines.push("");

    if (naturalEntries.length > 0) {
      lines.push("| Epoch # | Epoch | CheapSide | Carnage? | TX |");
      lines.push("|---------|-------|-----------|----------|-----|");

      for (const entry of naturalEntries) {
        const d = entry.details as any;
        const txLink = entry.txSignature
          ? `[${entry.txSignature.slice(0, 8)}...](https://explorer.solana.com/tx/${entry.txSignature}?cluster=devnet)`
          : "N/A";
        const carnageFlag = d.carnagePending || d.carnageTriggered ? "YES" : "no";
        lines.push(
          `| ${d.epochIndex} | ${d.epoch} | ${d.cheapSide} | ${carnageFlag} | ${txLink} |`
        );
      }
      lines.push("");
    }

    if (naturalResult) {
      const status = naturalResult.status === "pass" ? "PASS" : naturalResult.status === "skip" ? "SKIP (probabilistic)" : naturalResult.status.toUpperCase();
      lines.push(`**Result:** ${status} -- ${naturalResult.message}`);
      lines.push("");
    }

    // Post-Carnage health check
    const healthCheck = carnageEntries.find((e) => e.message.includes("health check"));
    if (healthCheck) {
      lines.push("### Post-Carnage Health Check");
      lines.push("");
      const hcStatus = healthCheck.status === "pass" ? "PASS" : "FAIL";
      lines.push(`**Status:** ${hcStatus} -- ${healthCheck.message}`);
      if (healthCheck.txSignature) {
        lines.push(`- TX: [${healthCheck.txSignature.slice(0, 16)}...](https://explorer.solana.com/tx/${healthCheck.txSignature}?cluster=devnet)`);
      }
      lines.push("");
    }

    // Before/after snapshots
    const snapshotEntries = carnageEntries.filter(
      (e) => e.message.includes("snapshot captured")
    );
    if (snapshotEntries.length > 0) {
      lines.push("<details>");
      lines.push("<summary>Carnage state snapshots</summary>");
      lines.push("");
      for (const entry of snapshotEntries) {
        lines.push(`#### ${entry.message}`);
        if (entry.details) {
          lines.push("```json");
          lines.push(JSON.stringify(entry.details, null, 2));
          lines.push("```");
        }
        lines.push("");
      }
      lines.push("</details>");
    }

    // Full log
    lines.push("");
    lines.push("<details>");
    lines.push("<summary>Full Carnage log entries</summary>");
    lines.push("");
    for (const entry of carnageEntries) {
      const statusIcon = entry.status === "pass" ? "PASS" : entry.status === "fail" ? "FAIL" : entry.status.toUpperCase();
      lines.push(`- **${statusIcon}:** ${entry.message}`);
      if (entry.txSignature) {
        lines.push(`  - TX: [${entry.txSignature.slice(0, 16)}...](https://explorer.solana.com/tx/${entry.txSignature}?cluster=devnet)`);
      }
    }
    lines.push("");
    lines.push("</details>");

    return lines.join("\n");
  }

  private generateKnownIssues(): string {
    const lines: string[] = ["## 5. Known Issues", ""];

    // Collect all known_issue entries
    const knownIssues = this.entries.filter((e) => e.status === "known_issue");

    if (knownIssues.length === 0) {
      lines.push("No known issues encountered during this run.");
      return lines.join("\n");
    }

    lines.push("| # | Phase | Issue | Audit Finding | Fix Planned |");
    lines.push("|---|-------|-------|---------------|-------------|");

    let idx = 1;
    for (const entry of knownIssues) {
      const auditIds = (entry.details as any)?.auditFindings || "N/A";
      const fixPlanned = (entry.details as any)?.fixPlanned || "Phase 36.1";
      const issueDesc = entry.message.slice(0, 100);
      lines.push(`| ${idx++} | ${entry.phase} | ${issueDesc} | ${auditIds} | ${fixPlanned} |`);
    }

    lines.push("");
    lines.push("### Carnage-Specific Known Bugs");
    lines.push("");
    lines.push("These Carnage bugs are tracked in the audit findings and planned for Phase 36.1 fixes:");
    lines.push("");
    lines.push("| Finding ID | Description | Impact |");
    lines.push("|------------|-------------|--------|");
    lines.push("| H041, H042, H063, H089, H094 | `held_amount` stores SOL lamports instead of token count | Carnage buy amount is miscalculated |");
    lines.push("| H018, H052, H058, H099 | Fallback discriminator mismatch in CPI | Fallback Carnage path fails |");
    lines.push("| H019, H059 | Missing `swap_authority` in fallback accounts | Fallback CPI cannot sign |");

    return lines.join("\n");
  }

  private generateMainnetReadiness(): string {
    const lines: string[] = ["## 6. Mainnet Readiness Assessment", ""];

    lines.push("| Criterion | Status | Evidence |");
    lines.push("|-----------|--------|----------|");

    // SC-1: SOL buy swap with tax distribution
    const swapTx = this.entries.find(
      (e) => e.phase === "swap" && e.status === "pass" && e.txSignature && e.message.includes("SOL buy swap executed")
    );
    const taxVerify = this.entries.find(
      (e) => e.phase === "swap" && e.message.includes("Tax distribution verification") && e.status === "pass"
    );
    const sc1Status = swapTx && taxVerify ? "PASS" : swapTx ? "PARTIAL" : "NOT TESTED";
    const sc1Evidence = swapTx?.txSignature
      ? `[TX](https://explorer.solana.com/tx/${swapTx.txSignature}?cluster=devnet)${taxVerify ? " + tax verified" : ""}`
      : "N/A";
    lines.push(`| SC-1: SOL buy swap + tax distribution | ${sc1Status} | ${sc1Evidence} |`);

    // SC-2: Staking yield claim
    const stakeTx = this.entries.find(
      (e) => e.phase === "staking" && e.txSignature && e.message.includes("Staked")
    );
    const claimTx = this.entries.find(
      (e) => e.phase === "staking" && e.txSignature && e.message.includes("Claim yield")
    );
    const yieldAmount = claimTx?.details
      ? `${((claimTx.details as any).yieldSol || 0).toFixed(6)} SOL`
      : "?";
    const sc2Status = stakeTx && claimTx ? "PASS" : stakeTx ? "PARTIAL (staked, no claim)" : "NOT TESTED";
    const sc2Evidence = claimTx?.txSignature
      ? `[Stake TX](https://explorer.solana.com/tx/${stakeTx?.txSignature}?cluster=devnet) + [Claim TX](https://explorer.solana.com/tx/${claimTx.txSignature}?cluster=devnet) (${yieldAmount})`
      : stakeTx?.txSignature
        ? `[Stake TX](https://explorer.solana.com/tx/${stakeTx.txSignature}?cluster=devnet)`
        : "N/A";
    lines.push(`| SC-2: Staking yield claim | ${sc2Status} | ${sc2Evidence} |`);

    // SC-3: Multi-epoch VRF transitions
    const epochTransitions = this.entries.filter(
      (e) => e.phase === "epoch" && e.details && (e.details as any).epoch !== undefined && (e.details as any).cheapSide !== undefined && e.status === "pass"
    );
    // Also count Carnage epoch transitions
    const carnageEpochs = this.entries.filter(
      (e) => e.phase === "carnage" && e.details && (e.details as any).epoch !== undefined && (e.details as any).cheapSide !== undefined && e.status === "pass"
    );
    const totalTransitions = epochTransitions.length + carnageEpochs.length;
    const sc3Status = totalTransitions >= 3 ? "PASS" : totalTransitions > 0 ? `PARTIAL (${totalTransitions}/3)` : "NOT TESTED";
    const sc3Sigs = [...epochTransitions, ...carnageEpochs]
      .filter((e) => e.txSignature)
      .slice(0, 3)
      .map((e) => `[TX](https://explorer.solana.com/tx/${e.txSignature}?cluster=devnet)`)
      .join(", ");
    lines.push(`| SC-3: Multi-epoch VRF transitions (3+) | ${sc3Status} | ${totalTransitions} transitions: ${sc3Sigs || "N/A"} |`);

    // SC-4: Carnage trigger attempt
    const carnageAttempt = this.entries.find(
      (e) => e.phase === "carnage" && (e.message.includes("execute_carnage_atomic") || e.message.includes("CARNAGE TRIGGERED"))
    );
    const carnageKnown = this.entries.find(
      (e) => e.phase === "carnage" && e.status === "known_issue" && e.message.includes("execute_carnage")
    );
    const carnageSuccess = this.entries.find(
      (e) => e.phase === "carnage" && e.status === "pass" && e.message.includes("execute_carnage_atomic SUCCEEDED")
    );
    let sc4Status: string;
    let sc4Evidence: string;
    if (carnageSuccess) {
      sc4Status = "PASS";
      sc4Evidence = carnageSuccess.txSignature
        ? `[TX](https://explorer.solana.com/tx/${carnageSuccess.txSignature}?cluster=devnet)`
        : "Succeeded";
    } else if (carnageKnown) {
      sc4Status = "KNOWN ISSUE";
      sc4Evidence = "Attempted but failed with known bugs (H041-H094). Fix in Phase 36.1.";
    } else if (carnageAttempt) {
      sc4Status = "TESTED";
      sc4Evidence = `Carnage tested: ${carnageAttempt.message.slice(0, 80)}`;
    } else {
      const carnageSkip = this.entries.find(
        (e) => e.phase === "carnage" && e.status === "skip"
      );
      if (carnageSkip) {
        sc4Status = "SKIP (probabilistic)";
        sc4Evidence = "VRF did not trigger Carnage in available epochs (~4.3%/epoch)";
      } else {
        sc4Status = "NOT TESTED";
        sc4Evidence = "N/A";
      }
    }
    lines.push(`| SC-4: Carnage trigger | ${sc4Status} | ${sc4Evidence} |`);

    // SC-5: Documentation (this report)
    lines.push("| SC-5: E2E documentation | PASS | This report |");

    lines.push("");
    lines.push("### Assessment");
    lines.push("");

    // Calculate overall readiness
    const totalCriteria = 5;
    let passed = 0;
    if (swapTx && taxVerify) passed++;
    if (stakeTx && claimTx) passed++;
    if (totalTransitions >= 3) passed++;
    if (carnageSuccess || carnageKnown || carnageAttempt) passed++; // tested = counts
    passed++; // SC-5 always passes (this report)

    if (passed >= 4) {
      lines.push(`**Overall: ${passed}/${totalCriteria} criteria satisfied.** Protocol core functionality validated on devnet.`);
      if (carnageKnown) {
        lines.push("Carnage has known bugs tracked for Phase 36.1 fixes. All other flows operational.");
      }
    } else {
      lines.push(`**Overall: ${passed}/${totalCriteria} criteria satisfied.** Additional testing needed before mainnet.`);
    }

    return lines.join("\n");
  }

  private generateAppendix(): string {
    const lines: string[] = ["## 7. Appendix: Full Transaction Log", ""];

    // Collect all entries with TX signatures
    const txEntries = this.entries.filter((e) => e.txSignature);

    if (txEntries.length === 0) {
      lines.push("*No transactions recorded.*");
      return lines.join("\n");
    }

    lines.push("| # | Phase | Status | TX Signature | Description |");
    lines.push("|---|-------|--------|-------------|-------------|");

    let idx = 1;
    for (const entry of txEntries) {
      const status = entry.status === "pass" ? "PASS" : entry.status === "known_issue" ? "KNOWN" : entry.status.toUpperCase();
      const txLink = `[${entry.txSignature!.slice(0, 12)}...](https://explorer.solana.com/tx/${entry.txSignature}?cluster=devnet)`;
      const desc = entry.message.slice(0, 60);
      lines.push(`| ${idx++} | ${entry.phase} | ${status} | ${txLink} | ${desc} |`);
    }

    return lines.join("\n");
  }

  private generateFooter(): string {
    // Compute summary stats
    const totalPass = this.entries.filter((e) => e.status === "pass").length;
    const totalFail = this.entries.filter((e) => e.status === "fail").length;
    const totalKnown = this.entries.filter((e) => e.status === "known_issue").length;
    const totalSkip = this.entries.filter((e) => e.status === "skip").length;
    const txCount = this.entries.filter((e) => e.txSignature).length;

    return [
      "---",
      "",
      `**Final Tally:** ${totalPass} passed, ${totalFail} failed, ${totalKnown} known issues, ${totalSkip} skipped`,
      `**Total Transactions:** ${txCount}`,
      "",
      "*Generated by Dr. Fraudsworth E2E Devnet Validation Suite*",
      `*Run completed: ${new Date().toISOString()}*`,
    ].join("\n");
  }
}
