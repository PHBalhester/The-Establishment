/**
 * E2E Incremental Crash-Safe File Logger
 *
 * Writes structured log entries to a JSONL file using appendFileSync
 * for crash safety. If the script crashes mid-execution, all previously
 * logged entries are preserved because each entry is flushed immediately.
 *
 * Why JSONL (JSON Lines) format:
 * - Each line is a self-contained JSON object
 * - Easy to parse even from a partial/truncated file
 * - appendFileSync ensures each entry is atomically written
 * - Compatible with jq, grep, and line-by-line streaming parsers
 *
 * Why no console output:
 * CONTEXT.md requires silent console mode. All output goes to the log
 * file only. The reporter module reads this file to generate the final
 * markdown report.
 */

import * as fs from "fs";

// ---- Interfaces ----

/**
 * Structured log entry for E2E test events.
 *
 * Each entry captures one test step outcome with optional
 * transaction evidence and state snapshots.
 */
export interface LogEntry {
  /** ISO timestamp when this event occurred */
  timestamp: string;
  /** Test phase this entry belongs to */
  phase: "setup" | "swap" | "staking" | "carnage" | "epoch" | "report";
  /** Outcome status */
  status: "pass" | "fail" | "known_issue" | "skip";
  /** Human-readable description of what happened */
  message: string;
  /** Solana transaction signature (if applicable) */
  txSignature?: string;
  /** Arbitrary details: balance snapshots, error info, state diffs */
  details?: Record<string, unknown>;
}

// ---- Logger Class ----

/**
 * Append-only JSONL logger for E2E test runs.
 *
 * Each log() call writes one JSON line and flushes immediately.
 * This means even if the process crashes, all prior entries survive.
 */
export class E2ELogger {
  private logPath: string;

  /**
   * Create a new logger instance.
   *
   * Truncates any existing log file on init to start fresh.
   * This prevents stale entries from a previous run from
   * contaminating the current run's report.
   *
   * @param logPath - Path to the JSONL output file
   */
  constructor(logPath: string) {
    this.logPath = logPath;
    // Truncate/create the file on init
    fs.writeFileSync(this.logPath, "", "utf-8");
  }

  /**
   * Append a log entry to the JSONL file.
   *
   * Uses appendFileSync (synchronous) to guarantee the entry
   * is flushed to disk before returning. This is critical for
   * crash safety -- async writes could be lost in a process crash.
   *
   * @param entry - Structured log entry to write
   */
  log(entry: LogEntry): void {
    const line = JSON.stringify(entry) + "\n";
    fs.appendFileSync(this.logPath, line, "utf-8");
  }

  /**
   * Read all entries from the log file.
   *
   * Parses each line as a JSON object. Skips empty lines
   * (e.g., trailing newline).
   *
   * @returns Array of all logged entries
   */
  getEntries(): LogEntry[] {
    if (!fs.existsSync(this.logPath)) {
      return [];
    }
    const content = fs.readFileSync(this.logPath, "utf-8");
    return content
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as LogEntry);
  }
}
