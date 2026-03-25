'use client';

/**
 * SettingsStation -- Three-section settings UI: Wallet > Trading > Audio.
 *
 * Wallet section (if connected):
 *   - Read-only address display (kit Input, monospace, truncated)
 *   - Token balances grid (SOL, CRIME, FRAUD, PROFIT)
 *   - Copy + Disconnect buttons
 *
 * Trading section:
 *   - SlippageConfig with slippage presets, custom input, and priority fee presets
 *   - Props sourced from useSettings() shared context
 *
 * Audio section:
 *   - Kit Toggle for mute/unmute
 *   - Kit Slider for volume 0-100 (disabled when muted)
 *   - Fully wired: Toggle Music and Volume Slider flow through SettingsProvider -> AudioProvider -> AudioManager (Phase 65 UI + Phase 67 wiring)
 *
 * All preferences write to SettingsProvider for cross-component persistence.
 *
 * Default export required for React.lazy in ModalContent.tsx.
 */

import { useCallback } from 'react';
import { Toggle, Slider, Input, Button, Divider } from '@/components/kit';
import { SlippageConfig } from '@/components/swap/SlippageConfig';
import { useSettings } from '@/hooks/useSettings';
import { useProtocolWallet } from '@/hooks/useProtocolWallet';
import { useTokenBalances } from '@/hooks/useTokenBalances';
import { useToast } from '@/components/toast/ToastProvider';
import { useModal } from '@/hooks/useModal';

export default function SettingsStation() {
  const {
    settings,
    setSlippageBps,
    setPriorityFeePreset,
    setMuted,
    setVolume,
  } = useSettings();

  const { publicKey, connected, disconnect } = useProtocolWallet();
  const { sol, crime, fraud, profit, loading: balancesLoading } = useTokenBalances(publicKey);
  const { showToast } = useToast();
  const { state: modalState, closeModal, goBack } = useModal();

  const handleCopyAddress = useCallback(async () => {
    if (!publicKey) return;
    try {
      await navigator.clipboard.writeText(publicKey.toBase58());
      showToast('success', 'Wallet address copied');
    } catch {
      showToast('error', 'Failed to copy address');
    }
  }, [publicKey, showToast]);

  const handleDisconnect = useCallback(async () => {
    try {
      await disconnect();
      closeModal();
      showToast('success', 'Wallet disconnected');
    } catch {
      showToast('error', 'Failed to disconnect');
    }
  }, [disconnect, closeModal, showToast]);

  // Capitalize station name for display (e.g. "swap" -> "Swap")
  const previousLabel = modalState.previousStation
    ? modalState.previousStation.charAt(0).toUpperCase() + modalState.previousStation.slice(1)
    : null;

  return (
    <div className="space-y-5">
      {/* Back navigation -- shown when opened from another station */}
      {previousLabel && (
        <button
          type="button"
          onClick={goBack}
          className="flex items-center gap-1.5 text-sm min-h-[48px] hover:underline transition-colors cursor-pointer"
        >
          <span aria-hidden="true">{'\u2190'}</span>
          Back to {previousLabel}
        </button>
      )}

      {/* ------------------------------------------------------------------ */}
      {/*  Wallet Section -- only visible when connected                      */}
      {/* ------------------------------------------------------------------ */}
      {connected && publicKey && (
        <>
          <section aria-label="Wallet">
            <h3 className="text-sm font-medium mb-3">Wallet</h3>

            {/* Address display */}
            <Input
              value={publicKey.toBase58()}
              readOnly
              label="Wallet Address"
              className="font-mono text-xs !bg-[rgba(42,31,14,0.85)] !text-[#e8dcc8]"
            />

            {/* Action buttons -- between address and balances, same width as balance grid */}
            <div className="grid grid-cols-2 gap-2 mt-3">
              <Button variant="secondary" size="sm" onClick={handleCopyAddress} className="w-full">
                Copy
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDisconnect}
                className="w-full !text-red-700"
              >
                Disconnect
              </Button>
            </div>

            {/* Token balances grid */}
            <div className="grid grid-cols-2 gap-2 mt-2">
              {([
                { label: 'SOL', value: sol, decimals: 4 },
                { label: 'CRIME', value: crime, decimals: 2 },
                { label: 'FRAUD', value: fraud, decimals: 2 },
                { label: 'PROFIT', value: profit, decimals: 2 },
              ] as const).map(({ label, value, decimals }) => (
                <div
                  key={label}
                  className="flex items-center justify-between rounded-md px-3 py-2 text-xs"
                  style={{ background: 'rgba(42, 31, 14, 0.06)' }}
                >
                  <span className="font-medium">{label}</span>
                  <span className="font-mono tabular-nums">
                    {balancesLoading ? '...' : value.toFixed(decimals)}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <Divider variant="riveted" />
        </>
      )}

      {/* ------------------------------------------------------------------ */}
      {/*  Trading Section                                                    */}
      {/* ------------------------------------------------------------------ */}
      <section aria-label="Trading">
        <h3 className="text-sm font-medium mb-1">Trading</h3>

        <SlippageConfig
          slippageBps={settings.slippageBps}
          setSlippageBps={setSlippageBps}
          priorityFeePreset={settings.priorityFeePreset}
          setPriorityFeePreset={setPriorityFeePreset}
        />
      </section>

      <Divider variant="riveted" />

      {/* ------------------------------------------------------------------ */}
      {/*  Audio Section                                                      */}
      {/* ------------------------------------------------------------------ */}
      <section aria-label="Audio">
        <h3 className="text-sm font-medium mb-3">Audio</h3>

        <div className="space-y-4">
          <Toggle
            label="Music"
            checked={!settings.muted}
            onChange={(on) => setMuted(!on)}
          />

          <Slider
            label="Volume"
            value={settings.muted ? 0 : settings.volume}
            onChange={setVolume}
            min={0}
            max={100}
            step={1}
            disabled={settings.muted}
            showValue
            formatValue={(v) => `${v}%`}
          />
        </div>
      </section>
    </div>
  );
}
