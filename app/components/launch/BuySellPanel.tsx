'use client';

/**
 * BuySellPanel -- Combined curve info + trading panel
 *
 * Structure:
 * - Top tabs: CRIME / FRAUD curve selection
 * - Sub-tabs: Info / Buy / Sell
 *   - Info: curve stats (raised, market cap, price, tax escrow)
 *   - Buy: SOL -> token purchase form
 *   - Sell: token -> SOL sell form (with 15% tax)
 *
 * Uses Tailwind v4 @theme utility classes: bg-factory-*, text-factory-*, etc.
 */

import { useState } from 'react';
import type { CurveStateData } from '@/hooks/useCurveState';
import { BuyForm } from './BuyForm';
import { SellForm } from './SellForm';
import { getCurrentPrice } from '@/lib/curve/curve-math';
import { TARGET_SOL } from '@/lib/curve/curve-constants';
import { MINTS } from '@/lib/protocol-config';
import { PublicKey } from '@solana/web3.js';
import { useProtocolWallet } from '@/hooks/useProtocolWallet';
import { ConnectModal } from '@/components/wallet/ConnectModal';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CurveTab = 'CRIME' | 'FRAUD';
type SubTab = 'info' | 'buy' | 'sell';

interface BuySellPanelProps {
  crime: CurveStateData | null;
  fraud: CurveStateData | null;
  solPrice: number | null;
  className?: string;
  /** Called after a buy/sell TX confirms to refresh curve state */
  onTxConfirmed?: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MINT_MAP: Record<CurveTab, PublicKey> = {
  CRIME: MINTS.CRIME,
  FRAUD: MINTS.FRAUD,
};

function formatSol(lamports: bigint, decimals = 2): string {
  return (Number(lamports) / 1e9).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatUsd(value: number): string {
  if (value < 0.01) return '$0.00';
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// ---------------------------------------------------------------------------
// Info Panel (stats for selected curve)
// ---------------------------------------------------------------------------

function InfoPanel({ data, solPrice }: { data: CurveStateData | null; solPrice: number | null }) {
  if (!data) {
    return (
      <div className="py-6 text-center">
        <p className="text-[#6b5a42] text-sm font-mono">Loading...</p>
      </div>
    );
  }

  // Net SOL in vault = gross raised minus SOL returned via sells
  const netSol = data.solRaised - data.solReturned;
  const netSolNum = Number(netSol) / 1e9;
  const marketCap = netSolNum * (solPrice ?? 0);
  const spotPriceLamports = getCurrentPrice(data.tokensSold);
  const spotPriceSol = Number(spotPriceLamports) / 1e9;
  const spotPriceUsd = spotPriceSol * (solPrice ?? 0);
  const pctFilled = Number((netSol * 100n) / TARGET_SOL);

  return (
    <div className="space-y-3 py-2">
      {/* Progress bar */}
      <div>
        <div className="flex justify-between text-xs font-mono mb-1">
          <span className="text-[#6b5a42]">Progress</span>
          <span className="text-[#4a3520]">{pctFilled.toFixed(1)}%</span>
        </div>
        <div className="h-2 rounded-full bg-[#c4b08a] border border-[#8a7a62]/40">
          <div
            className="h-full rounded-full bg-gradient-to-r from-factory-secondary to-factory-accent"
            style={{ width: `${Math.min(100, pctFilled)}%`, transition: 'width 0.6s ease' }}
          />
        </div>
      </div>

      {/* Stats grid */}
      <div className="space-y-1.5">
        <StatRow label="SOL Raised" value={`${formatSol(netSol)} / ${formatSol(TARGET_SOL)}`} />
        <StatRow label="Market Cap" value={formatUsd(marketCap)} />
        <StatRow label="Spot Price" value={`${spotPriceSol.toFixed(7)} SOL`} sub={solPrice ? formatUsd(spotPriceUsd) : undefined} />
        <StatRow label="Tax Escrow" value={`${formatSol(data.taxCollected)} SOL`} />
        <StatRow label="Participants" value={data.participantCount.toLocaleString()} />
        <StatRow label="Status" value={data.status.toUpperCase()} />
      </div>
    </div>
  );
}

function StatRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex justify-between items-baseline gap-2">
      <span className="text-xs text-[#6b5a42] uppercase tracking-wider font-mono shrink-0">
        {label}
      </span>
      <div className="text-right">
        <span className="text-sm text-[#2c1e12] font-mono tabular-nums">
          {value}
        </span>
        {sub && (
          <span className="text-xs text-[#6b5a42] ml-1 font-mono">
            {sub}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BuySellPanel({ crime, fraud, solPrice, className, onTxConfirmed }: BuySellPanelProps) {
  const [activeTab, setActiveTab] = useState<CurveTab>('CRIME');
  const [subTab, setSubTab] = useState<SubTab>('info');
  const [connectModalOpen, setConnectModalOpen] = useState(false);

  const { connected } = useProtocolWallet();
  const selectedCurve = activeTab === 'CRIME' ? crime : fraud;
  const tokenMint = MINT_MAP[activeTab];
  const isActive = selectedCurve?.status === 'active';

  // Show connect prompt on Buy/Sell tabs when wallet not connected
  const showConnectPrompt = !connected && (subTab === 'buy' || subTab === 'sell');

  return (
    <div
      className={`
        w-full
        bg-[#e8d5b0]/95 backdrop-blur-sm
        border border-[#8a7a62]
        rounded-lg overflow-hidden
        shadow-[0_4px_24px_rgba(0,0,0,0.6)]
        flex flex-col
        ${className ?? ''}
      `}
    >
      {/* ---- Curve Tabs (CRIME / FRAUD) ---- */}
      <div className="flex border-b border-[#8a7a62]/40">
        {(['CRIME', 'FRAUD'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => { setActiveTab(tab); setSubTab('info'); }}
            className={`
              flex-1 py-2.5 min-h-[48px] text-sm font-heading tracking-wider transition-colors
              ${activeTab === tab
                ? 'text-[#4a3520] border-b-2 border-[#8a6914] bg-[#d4c09a]/50'
                : 'text-[#6b5a42] hover:text-[#4a3520]'
              }
            `}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* ---- Sub-tabs (Info / Buy / Sell) ---- */}
      <div className="flex px-2 pt-2 gap-1">
        {(['info', 'buy', 'sell'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setSubTab(tab)}
            className={`
              flex-1 py-2.5 min-h-[48px] text-xs font-mono uppercase tracking-widest rounded transition-all
              ${subTab === tab
                ? tab === 'buy'
                  ? 'bg-[#2d6b30]/20 text-[#2d6b30] border border-[#2d6b30]/40'
                  : tab === 'sell'
                    ? 'bg-[#8b2020]/20 text-[#8b2020] border border-[#8b2020]/40'
                    : 'bg-[#8a6914]/15 text-[#6b5210] border border-[#8a6914]/30'
                : 'bg-transparent text-[#6b5a42] hover:text-[#4a3520] border border-transparent'
              }
            `}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* ---- Content Area ---- */}
      <div className="px-3 pb-3 relative flex-1 min-h-0 overflow-y-auto">
        {subTab !== 'info' && !isActive && selectedCurve && !showConnectPrompt && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#e8d5b0]/80 rounded-b-lg">
            <p className="text-[#4a3520] text-sm font-mono text-center px-4">
              This curve is {selectedCurve.status}
            </p>
          </div>
        )}

        {/* Connect prompt -- shown on Buy/Sell tabs when wallet not connected */}
        {showConnectPrompt && (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <p className="text-sm text-[#6b5a42] font-mono text-center">
              Wallet required to trade
            </p>
            <button
              onClick={() => setConnectModalOpen(true)}
              className="text-sm font-medium text-[#e8d5b0] bg-[#8a6914] hover:bg-[#a07a1a] rounded-lg px-5 py-2.5 min-h-[48px] transition-colors shadow-md"
            >
              Connect Wallet to Trade
            </button>
          </div>
        )}

        {subTab === 'info' && (
          <InfoPanel data={selectedCurve} solPrice={solPrice} />
        )}

        {subTab === 'buy' && selectedCurve && isActive && connected && (
          <BuyForm
            curve={selectedCurve}
            tokenSymbol={activeTab}
            tokenMint={tokenMint}
            solPrice={solPrice}
            onTxConfirmed={onTxConfirmed}
          />
        )}

        {subTab === 'sell' && selectedCurve && isActive && connected && (
          <SellForm
            curve={selectedCurve}
            tokenSymbol={activeTab}
            tokenMint={tokenMint}
            solPrice={solPrice}
            onTxConfirmed={onTxConfirmed}
          />
        )}

        {subTab !== 'info' && (!selectedCurve || !isActive) && !showConnectPrompt && (
          <div className="h-48" />
        )}
      </div>

      {/* ConnectModal for inline connect prompt */}
      <ConnectModal
        isOpen={connectModalOpen}
        onClose={() => setConnectModalOpen(false)}
      />
    </div>
  );
}
