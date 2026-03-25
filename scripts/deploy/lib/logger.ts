/**
 * Step-by-Step Operator Logging with Transaction Signature File
 *
 * Provides human-readable terminal output during deployment while writing
 * transaction signatures to a separate log file for post-deployment debugging.
 *
 * Why separate log file for tx signatures?
 * - Terminal output stays clean and readable (step progress only)
 * - Signatures are saved for Solana Explorer lookup if something goes wrong
 * - Log file serves as audit trail of what was deployed and when
 *
 * Terminal output format:
 *   === Protocol Initialization ===
 *   [1/32] Creating WhitelistAuthority... done
 *   [2/32] Creating CRIME mint... done
 *   [3/32] Creating FRAUD mint... SKIPPED (already exists)
 *
 * Log file format:
 *   2026-02-11T00:00:00.000Z | Deploy started
 *   [1/32] Creating WhitelistAuthority: 5xYz...abc123
 *   [2/32] Creating CRIME mint: 9kLm...def456
 */

import * as fs from "fs";
import * as path from "path";

// ANSI color codes for terminal output
// Why ANSI? It's universally supported in modern terminals and makes
// deployment progress scannable at a glance (green = done, yellow = skip, red = error).
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

/**
 * Logger interface returned by createLogger.
 * All methods print to terminal; step() also writes to log file when a tx signature is provided.
 */
export interface Logger {
  /** Log a numbered step with status. Optionally records tx signature to file. */
  step(current: number, total: number, name: string, status: "done" | "SKIPPED", sig?: string): void;
  /** Print an informational line (e.g., cluster URL, wallet address). */
  info(message: string): void;
  /** Print an error message in red. */
  error(message: string): void;
  /** Print a section header (e.g., === Protocol Initialization ===). */
  section(title: string): void;
  /** Get the path to the tx signature log file. */
  getLogPath(): string;
}

/**
 * Create a logger instance.
 *
 * Why a factory function?
 * - Encapsulates the log file handle and path
 * - Each deployment run gets a unique timestamped log file
 * - Callers don't need to manage file I/O
 *
 * @param logFilePath - Override log file location (default: deploy-log-{timestamp}.txt in scripts/deploy/)
 * @returns Logger with step, info, error, section, and getLogPath methods
 */
export function createLogger(logFilePath?: string): Logger {
  // Generate timestamped log file name
  // Format: deploy-log-20260211T001234Z.txt
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");

  const logDir = path.resolve(__dirname, "..");
  const logPath = logFilePath || path.join(logDir, `deploy-log-${timestamp}.txt`);

  // Create/truncate the log file with a header line
  // Why truncate? Each deployment run should have a clean log file.
  // If re-running, the old log is replaced (timestamps make them unique anyway).
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, `${new Date().toISOString()} | Deploy log started\n`);

  return {
    step(current: number, total: number, name: string, status: "done" | "SKIPPED", sig?: string): void {
      const prefix = `[${current}/${total}]`;

      // Terminal: colored status
      const statusColor = status === "done" ? GREEN : YELLOW;
      console.log(`${prefix} ${name}... ${statusColor}${status}${RESET}`);

      // Log file: append tx signature if provided
      // Only "done" steps with signatures are interesting for the log file.
      // SKIPPED steps don't have signatures (no transaction was sent).
      if (sig) {
        fs.appendFileSync(logPath, `${prefix} ${name}: ${sig}\n`);
      }
    },

    info(message: string): void {
      console.log(message);
    },

    error(message: string): void {
      console.log(`${RED}ERROR: ${message}${RESET}`);
      fs.appendFileSync(logPath, `ERROR: ${message}\n`);
    },

    section(title: string): void {
      console.log(`\n${BOLD}=== ${title} ===${RESET}`);
      fs.appendFileSync(logPath, `\n=== ${title} ===\n`);
    },

    getLogPath(): string {
      return logPath;
    },
  };
}
