/**
 * Overnight Run Markdown Report Generator
 *
 * Reads the accumulated EpochRecord[] from the overnight JSONL log
 * and generates a structured markdown report at Docs/Overnight_Report.md.
 *
 * Report sections:
 * 1. Header: Run date, duration, epoch count, cluster
 * 2. Executive Summary: Total epochs, Carnage triggers, error rate, total swaps
 * 3. Tax Rate Distribution Table: Per-epoch CRIME/FRAUD buy/sell rates
 * 4. Carnage Events: Table of any Carnage triggers with VRF bytes
 * 5. Staking Yield: Total yield delta across all epochs
 * 6. Error Summary: Grouped errors with frequency counts
 * 7. Epoch Detail Table: Compact table with key metrics per epoch
 * 8. Footer: Run parameters (target epochs, actual epochs, total duration)
 *
 * TX signatures are formatted as Solana Explorer links for easy
 * click-through verification on devnet.
 */

// ---- Interfaces ----

/**
 * Record of one epoch's worth of overnight runner data.
 * Each record is one JSON line in the JSONL log file.
 */
export interface EpochRecord {
  /** ISO 8601 timestamp when this epoch started */
  timestamp: string;
  /** 0-based index in this run */
  epochIndex: number;
  /** On-chain epoch number from EpochState */
  epochNumber: number;
  /** Which token is cheap this epoch: "CRIME" or "FRAUD" */
  cheapSide: string;
  /** CRIME buy tax in basis points */
  crimeBuyTaxBps: number;
  /** CRIME sell tax in basis points */
  crimeSellTaxBps: number;
  /** FRAUD buy tax in basis points */
  fraudBuyTaxBps: number;
  /** FRAUD sell tax in basis points */
  fraudSellTaxBps: number;
  /** First 8 VRF bytes (for analysis/debugging) */
  vrfBytes: number[];
  /** Whether VRF triggered Carnage this epoch */
  carnageTriggered: boolean;
  /** Whether Carnage was successfully executed */
  carnageExecuted: boolean;
  /** Whether the inter-epoch swap succeeded */
  swapPerformed: boolean;
  /** Which pool the swap targeted */
  swapPool: string;
  /** TX signature for the swap (null on failure) */
  swapSig: string | null;
  /** Tax distribution from the swap (null if no swap) */
  taxDistribution: {
    staking: number;
    carnage: number;
    treasury: number;
  } | null;
  /** Delta in staking yield since last epoch (lamports) */
  stakingYieldDelta: number;
  /** Errors encountered during this epoch */
  errors: string[];
  /** All TX signatures for this epoch */
  txSignatures: string[];
  /** Time spent on VRF commit-reveal cycle (ms) */
  vrfDurationMs: number;
  /** Total time for this entire epoch (ms) */
  totalDurationMs: number;
  /** Wallet SOL balance after this epoch (lamports) */
  walletBalance: number;
  /** Carnage SOL vault balance after this epoch (lamports) */
  carnageVaultBalance: number;
}

// ---- Reporter Class ----

/**
 * Generates a structured Markdown report from an array of EpochRecords.
 *
 * The report is written to Docs/Overnight_Report.md and provides
 * a morning summary of the overnight E2E run.
 */
export class OvernightReporter {
  private records: EpochRecord[];
  private startTime: string;
  private endTime: string;
  private targetEpochs: number;
  private totalDurationMs: number;

  constructor(
    records: EpochRecord[],
    startTime: string,
    endTime: string,
    targetEpochs: number,
    totalDurationMs: number
  ) {
    this.records = records;
    this.startTime = startTime;
    this.endTime = endTime;
    this.targetEpochs = targetEpochs;
    this.totalDurationMs = totalDurationMs;
  }

  /**
   * Generate the complete Markdown report.
   *
   * @returns Markdown string ready to write to file
   */
  generate(): string {
    const sections: string[] = [];

    sections.push(this.generateHeader());
    sections.push(this.generateExecutiveSummary());
    sections.push(this.generateTaxRateDistribution());
    sections.push(this.generateCarnageEvents());
    sections.push(this.generateStakingYield());
    sections.push(this.generateErrorSummary());
    sections.push(this.generateEpochDetailTable());
    sections.push(this.generateFooter());

    return sections.join("\n\n");
  }

  // ---- Section Generators ----

  private generateHeader(): string {
    const durationHours = (this.totalDurationMs / 3_600_000).toFixed(1);
    return [
      "# Overnight E2E Run Report",
      "",
      `**Run Date:** ${this.startTime.split("T")[0]}`,
      `**Started:** ${this.startTime}`,
      `**Completed:** ${this.endTime}`,
      `**Duration:** ${durationHours} hours`,
      `**Epochs Completed:** ${this.records.length} / ${this.targetEpochs}`,
      `**Cluster:** Solana Devnet`,
    ].join("\n");
  }

  private generateExecutiveSummary(): string {
    const totalEpochs = this.records.length;
    const carnageTriggers = this.records.filter((r) => r.carnageTriggered).length;
    const carnageExecutions = this.records.filter((r) => r.carnageExecuted).length;
    const swapsPerformed = this.records.filter((r) => r.swapPerformed).length;
    const epochsWithErrors = this.records.filter((r) => r.errors.length > 0).length;
    const totalErrors = this.records.reduce((sum, r) => sum + r.errors.length, 0);
    const errorRate = totalEpochs > 0 ? ((epochsWithErrors / totalEpochs) * 100).toFixed(1) : "0";

    const totalTxSigs = this.records.reduce((sum, r) => sum + r.txSignatures.length, 0);
    const avgDurationSec = totalEpochs > 0
      ? (this.records.reduce((sum, r) => sum + r.totalDurationMs, 0) / totalEpochs / 1000).toFixed(1)
      : "0";

    const crimeEpochs = this.records.filter((r) => r.cheapSide === "CRIME").length;
    const fraudEpochs = this.records.filter((r) => r.cheapSide === "FRAUD").length;

    const lastWallet = this.records.length > 0
      ? (this.records[this.records.length - 1].walletBalance / 1e9).toFixed(2)
      : "?";

    return [
      "## Executive Summary",
      "",
      "| Metric | Value |",
      "|--------|-------|",
      `| Epochs completed | ${totalEpochs} / ${this.targetEpochs} |`,
      `| Carnage triggers | ${carnageTriggers} (${carnageExecutions} executed) |`,
      `| Swaps performed | ${swapsPerformed} |`,
      `| Total transactions | ${totalTxSigs} |`,
      `| Epochs with errors | ${epochsWithErrors} (${errorRate}%) |`,
      `| Total errors | ${totalErrors} |`,
      `| Avg epoch duration | ${avgDurationSec}s |`,
      `| CheapSide distribution | CRIME: ${crimeEpochs}, FRAUD: ${fraudEpochs} |`,
      `| Final wallet balance | ${lastWallet} SOL |`,
    ].join("\n");
  }

  private generateTaxRateDistribution(): string {
    const lines: string[] = [
      "## Tax Rate Distribution",
      "",
      "| Epoch | CheapSide | CRIME Buy | CRIME Sell | FRAUD Buy | FRAUD Sell |",
      "|-------|-----------|-----------|------------|-----------|------------|",
    ];

    for (const r of this.records) {
      lines.push(
        `| ${r.epochNumber} | ${r.cheapSide} | ${r.crimeBuyTaxBps}bps | ${r.crimeSellTaxBps}bps | ${r.fraudBuyTaxBps}bps | ${r.fraudSellTaxBps}bps |`
      );
    }

    // Summary: count unique rate combinations
    const uniqueCombos = new Set(
      this.records.map(
        (r) =>
          `${r.crimeBuyTaxBps}/${r.crimeSellTaxBps}/${r.fraudBuyTaxBps}/${r.fraudSellTaxBps}`
      )
    );
    lines.push("");
    lines.push(`**Unique rate combinations:** ${uniqueCombos.size}`);

    return lines.join("\n");
  }

  private generateCarnageEvents(): string {
    const carnageRecords = this.records.filter((r) => r.carnageTriggered);
    const lines: string[] = ["## Carnage Events", ""];

    if (carnageRecords.length === 0) {
      lines.push(
        `No Carnage triggers in ${this.records.length} epochs. ` +
        `Expected probability: ~4.3% per epoch (VRF bytes 5-7 < threshold).`
      );
      if (this.records.length > 0) {
        const expectedTriggers = (this.records.length * 0.043).toFixed(1);
        const noTriggerProb = (Math.pow(1 - 0.043, this.records.length) * 100).toFixed(1);
        lines.push(
          `Expected ~${expectedTriggers} triggers in ${this.records.length} epochs. ` +
          `Probability of zero triggers: ${noTriggerProb}%.`
        );
      }
      return lines.join("\n");
    }

    lines.push(
      "| Epoch | Index | VRF Bytes | Executed | TX |"
    );
    lines.push(
      "|-------|-------|-----------|----------|-----|"
    );

    for (const r of carnageRecords) {
      const vrfStr = r.vrfBytes.slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join(" ");
      const executedStr = r.carnageExecuted ? "YES" : "NO";
      const txLink = r.txSignatures.length > 0
        ? `[${r.txSignatures[0].slice(0, 8)}...](https://explorer.solana.com/tx/${r.txSignatures[0]}?cluster=devnet)`
        : "N/A";
      lines.push(
        `| ${r.epochNumber} | ${r.epochIndex} | ${vrfStr} | ${executedStr} | ${txLink} |`
      );
    }

    return lines.join("\n");
  }

  private generateStakingYield(): string {
    const totalYieldDelta = this.records.reduce(
      (sum, r) => sum + r.stakingYieldDelta,
      0
    );
    const yieldSol = (totalYieldDelta / 1e9).toFixed(9);

    const epochsWithYield = this.records.filter(
      (r) => r.stakingYieldDelta > 0
    ).length;

    const lines: string[] = [
      "## Staking Yield",
      "",
      "| Metric | Value |",
      "|--------|-------|",
      `| Total yield delta | ${yieldSol} SOL (${totalYieldDelta} lamports) |`,
      `| Epochs with yield growth | ${epochsWithYield} / ${this.records.length} |`,
    ];

    return lines.join("\n");
  }

  private generateErrorSummary(): string {
    const lines: string[] = ["## Error Summary", ""];

    // Collect all errors and group by pattern
    const allErrors = this.records.flatMap((r) =>
      r.errors.map((e) => ({ error: e, epoch: r.epochNumber }))
    );

    if (allErrors.length === 0) {
      lines.push("No errors during the overnight run.");
      return lines.join("\n");
    }

    // Group errors by first 80 chars (deduplicate similar errors)
    const errorGroups = new Map<string, { count: number; epochs: number[] }>();
    for (const { error, epoch } of allErrors) {
      const key = error.slice(0, 80);
      const existing = errorGroups.get(key) || { count: 0, epochs: [] };
      existing.count++;
      existing.epochs.push(epoch);
      errorGroups.set(key, existing);
    }

    lines.push("| Error Pattern | Count | Epochs |");
    lines.push("|---------------|-------|--------|");

    for (const [pattern, data] of errorGroups) {
      const epochList =
        data.epochs.length <= 5
          ? data.epochs.join(", ")
          : `${data.epochs.slice(0, 5).join(", ")}... (+${data.epochs.length - 5} more)`;
      lines.push(`| ${pattern} | ${data.count} | ${epochList} |`);
    }

    return lines.join("\n");
  }

  private generateEpochDetailTable(): string {
    const lines: string[] = [
      "## Epoch Details",
      "",
      "<details>",
      "<summary>Full epoch-by-epoch breakdown</summary>",
      "",
      "| # | Epoch | CheapSide | Tax (low/high) | Swap | Carnage | VRF(ms) | Total(s) | Wallet(SOL) |",
      "|---|-------|-----------|----------------|------|---------|---------|----------|-------------|",
    ];

    for (const r of this.records) {
      const lowTax = Math.min(r.crimeBuyTaxBps, r.fraudBuyTaxBps);
      const highTax = Math.max(r.crimeBuyTaxBps, r.fraudBuyTaxBps);
      const swapIcon = r.swapPerformed ? "OK" : "FAIL";
      const carnageIcon = r.carnageTriggered
        ? r.carnageExecuted
          ? "EXEC"
          : "TRIG"
        : "-";
      const totalSec = (r.totalDurationMs / 1000).toFixed(1);
      const walletSol = (r.walletBalance / 1e9).toFixed(2);

      lines.push(
        `| ${r.epochIndex} | ${r.epochNumber} | ${r.cheapSide} | ${lowTax}/${highTax} | ${swapIcon} | ${carnageIcon} | ${r.vrfDurationMs} | ${totalSec} | ${walletSol} |`
      );
    }

    lines.push("");
    lines.push("</details>");

    return lines.join("\n");
  }

  private generateFooter(): string {
    const durationHours = (this.totalDurationMs / 3_600_000).toFixed(1);
    const durationMin = (this.totalDurationMs / 60_000).toFixed(1);

    const lastCarnageVault =
      this.records.length > 0
        ? (
            this.records[this.records.length - 1].carnageVaultBalance / 1e9
          ).toFixed(4)
        : "?";

    return [
      "---",
      "",
      "## Run Parameters",
      "",
      "| Parameter | Value |",
      "|-----------|-------|",
      `| Target epochs | ${this.targetEpochs} |`,
      `| Actual epochs | ${this.records.length} |`,
      `| Total duration | ${durationMin} min (${durationHours} hours) |`,
      `| Carnage vault (final) | ${lastCarnageVault} SOL |`,
      "",
      "*Generated by Dr. Fraudsworth Overnight E2E Runner*",
      `*Run completed: ${this.endTime}*`,
    ].join("\n");
  }
}
