'use client';

/**
 * BuyForm -- SOL input -> token output preview -> execute buy
 *
 * Flow:
 * 1. User enters SOL amount
 * 2. Debounced quote calculates tokens out via curve-math
 * 3. PreviewBreakdown displays all trade metrics
 * 4. Submit builds purchase TX, signs via wallet, sends via our RPC
 * 5. Confirms via pollTransactionConfirmation, shows feedback
 *
 * Pre-validation:
 * - Minimum 0.05 SOL (MIN_PURCHASE_SOL)
 * - SOL balance check
 * - Per-wallet cap check (20M tokens)
 *
 * Uses sign-then-send pattern per MEMORY.md (Phantom devnet RPC workaround).
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Transaction, PublicKey } from '@solana/web3.js';
import { useProtocolWallet } from '@/hooks/useProtocolWallet';
import { useTokenBalances } from '@/hooks/useTokenBalances';
import { useSettings } from '@/hooks/useSettings';
import { getConnection } from '@/lib/connection';
import { getBondingCurveProgram } from '@/lib/anchor';
import { buildPurchaseInstruction } from '@/lib/curve/curve-tx-builder';
import { calculateTokensOut, getCurrentPrice } from '@/lib/curve/curve-math';
import { parseCurveError } from '@/lib/curve/error-map';
import { pollTransactionConfirmation } from '@/lib/confirm-transaction';
import {
  MIN_PURCHASE_SOL,
  MAX_TOKENS_PER_WALLET,
  TOKEN_DECIMAL_FACTOR,
} from '@/lib/curve/curve-constants';
import { PreviewBreakdown } from './PreviewBreakdown';
import type { CurveStateData } from '@/hooks/useCurveState';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BuyFormProps {
  curve: CurveStateData;
  tokenSymbol: 'CRIME' | 'FRAUD';
  tokenMint: PublicKey;
  solPrice: number | null;
  /** Called after a successful buy TX confirms (triggers curve state refresh) */
  onTxConfirmed?: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEBOUNCE_MS = 300;
const LAMPORTS_PER_SOL = 1_000_000_000;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BuyForm({ curve, tokenSymbol, tokenMint, solPrice, onTxConfirmed }: BuyFormProps) {
  const { publicKey, connected, sendTransaction } = useProtocolWallet();
  const { settings } = useSettings();
  const { crime: crimeBalance, fraud: fraudBalance, sol: solBalance, refresh: refreshBalances } =
    useTokenBalances(publicKey);

  // State
  const [solInput, setSolInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [txStatus, setTxStatus] = useState<string | null>(null);

  // Computed quote
  const [tokensOut, setTokensOut] = useState<bigint | null>(null);
  const [currentPriceBigint, setCurrentPriceBigint] = useState<bigint>(0n);
  const [newPriceBigint, setNewPriceBigint] = useState<bigint>(0n);
  const [solLamports, setSolLamports] = useState<bigint>(0n);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Debounce ref
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // User's current token holdings in base units
  const currentHoldings = tokenSymbol === 'CRIME'
    ? BigInt(Math.floor(crimeBalance * Number(TOKEN_DECIMAL_FACTOR)))
    : BigInt(Math.floor(fraudBalance * Number(TOKEN_DECIMAL_FACTOR)));

  // ---------------------------------------------------------------------------
  // Quote calculation (debounced)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    // Reset on empty input
    if (!solInput || solInput.trim() === '') {
      setTokensOut(null);
      setSolLamports(0n);
      setValidationError(null);
      return;
    }

    debounceRef.current = setTimeout(() => {
      const parsed = parseFloat(solInput);
      if (isNaN(parsed) || parsed <= 0) {
        setTokensOut(null);
        setSolLamports(0n);
        setValidationError('Enter a valid SOL amount');
        return;
      }

      const lamports = BigInt(Math.floor(parsed * LAMPORTS_PER_SOL));
      setSolLamports(lamports);

      // Minimum check
      if (lamports < MIN_PURCHASE_SOL) {
        setValidationError('Minimum 0.05 SOL');
        setTokensOut(null);
        return;
      }

      // SOL balance check
      if (connected && parsed > solBalance) {
        setValidationError('Insufficient SOL balance');
      } else {
        setValidationError(null);
      }

      // Calculate quote
      const tokens = calculateTokensOut(lamports, curve.tokensSold);
      setTokensOut(tokens);

      // Prices
      const curPrice = getCurrentPrice(curve.tokensSold);
      setCurrentPriceBigint(curPrice);
      const postPrice = getCurrentPrice(curve.tokensSold + tokens);
      setNewPriceBigint(postPrice);

      // Cap check
      if (currentHoldings + tokens > MAX_TOKENS_PER_WALLET) {
        setValidationError(
          `Would exceed 20M token cap (you have ${(Number(currentHoldings) / Number(TOKEN_DECIMAL_FACTOR)).toLocaleString('en-US', { maximumFractionDigits: 0 })})`
        );
      }
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [solInput, curve.tokensSold, connected, solBalance, currentHoldings]);

  // ---------------------------------------------------------------------------
  // Submit handler
  // ---------------------------------------------------------------------------

  const handleSubmit = useCallback(async () => {
    if (!publicKey || !connected || !tokensOut || tokensOut === 0n || solLamports === 0n) return;
    if (validationError) return;

    setSubmitting(true);
    setTxStatus('Building transaction...');

    try {
      const connection = getConnection();
      const program = getBondingCurveProgram(connection);

      // Slippage protection: floor division for minimum tokens out
      const slippageBps = BigInt(settings.slippageBps);
      const minimumTokensOut = tokensOut * (10000n - slippageBps) / 10000n;

      setTxStatus('Building instruction...');
      const instruction = await buildPurchaseInstruction(
        program,
        publicKey,
        tokenMint,
        solLamports,
        minimumTokensOut,
      );

      // Build transaction
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      const tx = new Transaction();
      tx.add(instruction);
      tx.feePayer = publicKey;
      tx.recentBlockhash = blockhash;

      setTxStatus('Waiting for wallet...');
      const signature = await sendTransaction(tx, connection, {
        skipPreflight: true,
      });

      setTxStatus('Confirming...');
      const result = await pollTransactionConfirmation(
        connection,
        signature,
        lastValidBlockHeight,
      );

      if (result.err) {
        setTxStatus(`Transaction failed: ${parseCurveError(result.err)}`);
      } else {
        setTxStatus(`Bought ${tokenSymbol} successfully!`);
        setSolInput('');
        setTokensOut(null);
        // Refresh balances and curve state after successful buy
        refreshBalances();
        onTxConfirmed?.();
        // Clear success message after 3s
        setTimeout(() => setTxStatus(null), 3000);
      }
    } catch (err) {
      const message = parseCurveError(err);
      setTxStatus(message);
      // Clear error after 5s
      setTimeout(() => setTxStatus(null), 5000);
    } finally {
      setSubmitting(false);
    }
  }, [
    publicKey,
    connected,
    tokensOut,
    solLamports,
    validationError,
    settings.slippageBps,
    tokenMint,
    tokenSymbol,
    sendTransaction,
    refreshBalances,
    onTxConfirmed,
  ]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const canSubmit =
    connected &&
    solInput.trim() !== '' &&
    !validationError &&
    tokensOut !== null &&
    tokensOut > 0n &&
    !submitting;

  return (
    <div className="space-y-3 pt-1">
      {/* SOL Input */}
      <div>
        <label className="block text-xs text-[#8a7a62] uppercase tracking-wider mb-1">
          SOL Amount
        </label>
        <div className="relative">
          <input
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={solInput}
            onChange={(e) => {
              // Allow digits, one decimal point
              const v = e.target.value;
              if (v === '' || /^\d*\.?\d*$/.test(v)) {
                setSolInput(v);
              }
            }}
            disabled={submitting}
            className={`
              w-full pl-3 pr-12 py-3 rounded
              bg-[#c4b08a]/50 border border-[#8a7a62]/50
              text-[#2c1e12] text-sm font-mono
              placeholder:text-[#8a7a62]/60
              focus:outline-none focus:border-[#8a6914]/60 focus:ring-1 focus:ring-[#8a6914]/30
              disabled:opacity-50
              transition-colors
            `}
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8a7a62] text-xs font-mono">
            SOL
          </span>
        </div>

        {/* SOL balance hint */}
        {connected && (
          <p className="text-xs text-[#8a7a62] mt-0.5 text-right font-mono">
            Balance: {solBalance.toFixed(4)} SOL
          </p>
        )}

        {/* Validation error */}
        {validationError && (
          <p className="text-xs text-red-400 mt-0.5 font-mono">
            {validationError}
          </p>
        )}
      </div>

      {/* Preview Breakdown */}
      {tokensOut !== null && tokensOut > 0n && (
        <PreviewBreakdown
          mode="buy"
          inputAmount={solLamports}
          outputAmount={tokensOut}
          currentPrice={currentPriceBigint}
          newPrice={newPriceBigint}
          currentHoldings={currentHoldings}
          maxTokens={MAX_TOKENS_PER_WALLET}
          solPrice={solPrice}
        />
      )}

      {/* Submit Button */}
      <button
        onClick={handleSubmit}
        disabled={!canSubmit}
        className={`
          w-full py-3 min-h-[48px] rounded text-sm font-semibold uppercase tracking-wider
          transition-all duration-150
          ${canSubmit
            ? 'bg-[#2d6b30]/80 hover:bg-[#2d6b30] text-white border border-[#2d6b30]/60 cursor-pointer'
            : 'bg-[#c4b08a]/50 text-[#8a7a62] border border-[#8a7a62]/30 cursor-not-allowed'
          }
        `}
      >
        {submitting
          ? 'Processing...'
          : !connected
            ? 'Connect Wallet'
            : `Buy ${tokenSymbol}`
        }
      </button>

      {/* TX Status */}
      {txStatus && (
        <p
          className={`text-xs text-center font-mono ${
            txStatus.includes('successfully')
              ? 'text-green-400'
              : txStatus.includes('failed') || txStatus.includes('error') || txStatus.includes('Insufficient') || txStatus.includes('cancelled')
                ? 'text-red-400'
                : 'text-[#6b5a42]'
          }`}
        >
          {txStatus}
        </p>
      )}
    </div>
  );
}
