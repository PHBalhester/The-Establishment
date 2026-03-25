'use client';

/**
 * SellForm -- Token input -> SOL output preview -> execute sell
 *
 * Flow:
 * 1. User enters token amount to sell
 * 2. Debounced quote calculates gross SOL, tax, net SOL via curve-math
 * 3. PreviewBreakdown displays all trade metrics including 15% tax
 * 4. Submit builds sell TX, signs via wallet, sends via our RPC
 * 5. Confirms via pollTransactionConfirmation, shows feedback
 *
 * Sell math:
 * - Gross SOL = calculateSolForTokens(currentSold - tokens, tokens)
 *   The position BEFORE selling is (currentSold - tokens), and we integrate
 *   from there over `tokens` base units.
 * - Tax = calculateSellTax(grossSol) -- ceil-rounded 15%
 * - Net SOL = grossSol - tax
 * - minimumSolOut = net SOL with slippage applied (on-chain checks net amount)
 *
 * Uses sign-then-send pattern per MEMORY.md.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Transaction, PublicKey } from '@solana/web3.js';
import { useProtocolWallet } from '@/hooks/useProtocolWallet';
import { useTokenBalances } from '@/hooks/useTokenBalances';
import { useSettings } from '@/hooks/useSettings';
import { getConnection } from '@/lib/connection';
import { getBondingCurveProgram } from '@/lib/anchor';
import { buildSellInstruction } from '@/lib/curve/curve-tx-builder';
import {
  calculateSolForTokens,
  calculateSellTax,
  getCurrentPrice,
} from '@/lib/curve/curve-math';
import { parseCurveError } from '@/lib/curve/error-map';
import { pollTransactionConfirmation } from '@/lib/confirm-transaction';
import {
  MAX_TOKENS_PER_WALLET,
  TOKEN_DECIMAL_FACTOR,
} from '@/lib/curve/curve-constants';
import { PreviewBreakdown } from './PreviewBreakdown';
import type { CurveStateData } from '@/hooks/useCurveState';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SellFormProps {
  curve: CurveStateData;
  tokenSymbol: 'CRIME' | 'FRAUD';
  tokenMint: PublicKey;
  solPrice: number | null;
  /** Called after a successful sell TX confirms (triggers curve state refresh) */
  onTxConfirmed?: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEBOUNCE_MS = 300;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SellForm({ curve, tokenSymbol, tokenMint, solPrice, onTxConfirmed }: SellFormProps) {
  const { publicKey, connected, sendTransaction } = useProtocolWallet();
  const { settings } = useSettings();
  const { crime: crimeBalance, fraud: fraudBalance, refresh: refreshBalances } =
    useTokenBalances(publicKey);

  // State
  const [tokenInput, setTokenInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [txStatus, setTxStatus] = useState<string | null>(null);

  // Computed quote
  const [grossSol, setGrossSol] = useState<bigint | null>(null);
  const [taxAmount, setTaxAmount] = useState<bigint>(0n);
  const [netSol, setNetSol] = useState<bigint>(0n);
  const [tokenBaseUnits, setTokenBaseUnits] = useState<bigint>(0n);
  const [currentPriceBigint, setCurrentPriceBigint] = useState<bigint>(0n);
  const [newPriceBigint, setNewPriceBigint] = useState<bigint>(0n);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Debounce ref
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // User's current token balance (human-readable number from useTokenBalances)
  const userBalance = tokenSymbol === 'CRIME' ? crimeBalance : fraudBalance;

  // Current holdings in base units
  const currentHoldings = BigInt(Math.floor(userBalance * Number(TOKEN_DECIMAL_FACTOR)));

  // ---------------------------------------------------------------------------
  // Quote calculation (debounced)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!tokenInput || tokenInput.trim() === '') {
      setGrossSol(null);
      setTaxAmount(0n);
      setNetSol(0n);
      setTokenBaseUnits(0n);
      setValidationError(null);
      return;
    }

    debounceRef.current = setTimeout(() => {
      const parsed = parseFloat(tokenInput);
      if (isNaN(parsed) || parsed <= 0) {
        setGrossSol(null);
        setValidationError('Enter a valid token amount');
        return;
      }

      const baseUnits = BigInt(Math.floor(parsed * Number(TOKEN_DECIMAL_FACTOR)));
      setTokenBaseUnits(baseUnits);

      // Balance check
      if (connected && parsed > userBalance) {
        setValidationError(`Insufficient ${tokenSymbol} balance`);
      } else {
        setValidationError(null);
      }

      // Sell position: the curve position BEFORE selling is (currentSold - tokens).
      // calculateSolForTokens(startPosition, tokens) integrates the area under
      // the curve from startPosition to startPosition + tokens.
      if (baseUnits > curve.tokensSold) {
        setValidationError('Cannot sell more tokens than the curve has sold');
        setGrossSol(null);
        return;
      }

      const startPosition = curve.tokensSold - baseUnits;
      const gross = calculateSolForTokens(startPosition, baseUnits);
      setGrossSol(gross);

      const tax = calculateSellTax(gross);
      setTaxAmount(tax);
      setNetSol(gross - tax);

      // Prices
      const curPrice = getCurrentPrice(curve.tokensSold);
      setCurrentPriceBigint(curPrice);
      // After selling, tokensSold decreases
      const postPrice = getCurrentPrice(curve.tokensSold - baseUnits);
      setNewPriceBigint(postPrice);
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [tokenInput, curve.tokensSold, connected, userBalance, tokenSymbol]);

  // ---------------------------------------------------------------------------
  // Submit handler
  // ---------------------------------------------------------------------------

  const handleSubmit = useCallback(async () => {
    if (!publicKey || !connected || !grossSol || grossSol === 0n || tokenBaseUnits === 0n) return;
    if (validationError) return;

    setSubmitting(true);
    setTxStatus('Building transaction...');

    try {
      const connection = getConnection();
      const program = getBondingCurveProgram(connection);

      // Slippage on the NET amount (after tax).
      // On-chain sell checks: sol_after_tax >= minimum_sol_out
      const slippageBps = BigInt(settings.slippageBps);
      const minimumSolOut = netSol * (10000n - slippageBps) / 10000n;

      setTxStatus('Building instruction...');
      const instruction = await buildSellInstruction(
        program,
        publicKey,
        tokenMint,
        tokenBaseUnits,
        minimumSolOut,
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
        setTxStatus(`Sold ${tokenSymbol} successfully!`);
        setTokenInput('');
        setGrossSol(null);
        setTaxAmount(0n);
        setNetSol(0n);
        // Refresh balances and curve state after successful sell
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
    grossSol,
    tokenBaseUnits,
    validationError,
    netSol,
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
    tokenInput.trim() !== '' &&
    !validationError &&
    grossSol !== null &&
    grossSol > 0n &&
    !submitting;

  return (
    <div className="space-y-3 pt-1">
      {/* Token Input */}
      <div>
        <label className="block text-xs text-[#8a7a62] uppercase tracking-wider mb-1">
          {tokenSymbol} Amount
        </label>
        <div className="relative">
          <input
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={tokenInput}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '' || /^\d*\.?\d*$/.test(v)) {
                setTokenInput(v);
              }
            }}
            disabled={submitting}
            className={`
              w-full pl-3 pr-16 py-3 rounded
              bg-[#c4b08a]/50 border border-[#8a7a62]/50
              text-[#2c1e12] text-sm font-mono
              placeholder:text-[#8a7a62]/60
              focus:outline-none focus:border-[#8a6914]/60 focus:ring-1 focus:ring-[#8a6914]/30
              disabled:opacity-50
              transition-colors
            `}
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8a7a62] text-xs font-mono">
            {tokenSymbol}
          </span>
        </div>

        {/* Token balance hint + Max button */}
        {connected && (
          <div className="flex items-center justify-end gap-2 mt-0.5">
            <p className="text-xs text-[#8a7a62] font-mono">
              Balance: {userBalance.toLocaleString('en-US', { maximumFractionDigits: 2 })}
            </p>
            {userBalance > 0 && (
              <button
                type="button"
                onClick={() => setTokenInput(userBalance.toString())}
                className="text-xs text-[#8a6914] hover:text-[#6b5210] font-mono uppercase"
              >
                Max
              </button>
            )}
          </div>
        )}

        {/* Validation error */}
        {validationError && (
          <p className="text-xs text-red-400 mt-0.5 font-mono">
            {validationError}
          </p>
        )}
      </div>

      {/* Preview Breakdown */}
      {grossSol !== null && grossSol > 0n && (
        <PreviewBreakdown
          mode="sell"
          inputAmount={tokenBaseUnits}
          outputAmount={netSol}
          currentPrice={currentPriceBigint}
          newPrice={newPriceBigint}
          taxAmount={taxAmount}
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
            ? 'bg-[#8b2020]/80 hover:bg-[#8b2020] text-white border border-[#8b2020]/60 cursor-pointer'
            : 'bg-[#c4b08a]/50 text-[#8a7a62] border border-[#8a7a62]/30 cursor-not-allowed'
          }
        `}
      >
        {submitting
          ? 'Processing...'
          : !connected
            ? 'Connect Wallet'
            : `Sell ${tokenSymbol}`
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
