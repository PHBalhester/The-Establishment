// Buffer polyfill for Solana libraries (@coral-xyz/anchor, @solana/web3.js)
// Runs BEFORE React hydration per Next.js 16 convention.
// Source: https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation-client
import { Buffer } from "buffer";

// The `buffer` npm package (v6.x) does NOT support BigInt methods.
// @solana/spl-token's createTransferCheckedWithTransferHookInstruction
// uses writeBigUInt64LE internally for serializing transfer amounts.
// Without these shims, hook account resolution fails in the browser.
if (!Buffer.prototype.writeBigUInt64LE) {
  Buffer.prototype.writeBigUInt64LE = function (value: bigint, offset = 0) {
    const big = BigInt(value);
    const mask32 = BigInt(0xffffffff);
    const lo = Number(big & mask32);
    const hi = Number((big >> BigInt(32)) & mask32);
    this.writeUInt32LE(lo, offset);
    this.writeUInt32LE(hi, offset + 4);
    return offset + 8;
  };
}
if (!Buffer.prototype.readBigUInt64LE) {
  Buffer.prototype.readBigUInt64LE = function (offset = 0) {
    const lo = BigInt(this.readUInt32LE(offset));
    const hi = BigInt(this.readUInt32LE(offset + 4));
    return lo + (hi << BigInt(32));
  };
}

globalThis.Buffer = Buffer;

// ── Sentry Error Reporting ──────────────────────────────────────────
// Zero-dependency client: captures unhandled errors and rejections via
// fetch() to Sentry's envelope API. All @sentry/* npm packages conflict
// with Turbopack's SSR runtime, so we use our own minimal reporter.
import { captureException } from "@/lib/sentry";

if (typeof window !== "undefined" && process.env.NEXT_PUBLIC_SENTRY_DSN) {
  window.addEventListener("error", (event) => {
    captureException(event.error ?? event.message);
  });
  window.addEventListener("unhandledrejection", (event) => {
    captureException(event.reason);
  });
}
