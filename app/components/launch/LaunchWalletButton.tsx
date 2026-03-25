'use client';

/**
 * LaunchWalletButton -- Floating wallet connection button for the launch page.
 *
 * Since the launch page has no header or nav, this is the ONLY way to
 * connect a wallet. Renders as a fixed-position button in the bottom-right
 * corner, always visible above all other content.
 *
 * States:
 * - Not ready: loading skeleton
 * - Not connected: "Connect Wallet" button + ConnectModal on click
 * - Connected: abbreviated address (first4...last4) + disconnect option
 *
 * Reuses the existing ConnectModal component and useProtocolWallet hook.
 */

import { useState } from 'react';
import { useProtocolWallet } from '@/hooks/useProtocolWallet';
import { ConnectModal } from '@/components/wallet/ConnectModal';

/** Truncate a base58 address to "XXXX...YYYY" format */
function truncateAddress(address: string): string {
  if (address.length <= 8) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export function LaunchWalletButton() {
  const { publicKey, connected, ready, disconnect } = useProtocolWallet();
  const [modalOpen, setModalOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [copied, setCopied] = useState(false);

  // Not ready -- loading skeleton
  if (!ready) {
    return (
      <div className="fixed top-3 right-3 sm:top-4 sm:right-4 z-50">
        <div className="h-10 w-28 sm:w-32 bg-amber-900/30 rounded-lg animate-pulse border border-amber-800/30" />
      </div>
    );
  }

  // Connected -- show address + disconnect
  if (connected && publicKey) {
    const address = publicKey.toBase58();
    return (
      <div className="fixed top-3 right-3 sm:top-4 sm:right-4 z-50 flex items-center gap-1.5 sm:gap-2">
        <button
          onClick={() => {
            navigator.clipboard.writeText(address);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          title="Click to copy full address"
          className="text-xs font-mono text-amber-200 bg-black/60 backdrop-blur-sm border border-amber-800/50 rounded-lg px-3 py-2.5 min-h-[48px] sm:px-3 hover:border-amber-600/70 transition-colors cursor-pointer"
        >
          {copied ? 'Copied!' : truncateAddress(address)}
        </button>
        <button
          onClick={async () => {
            setDisconnecting(true);
            try {
              await disconnect();
            } finally {
              setDisconnecting(false);
            }
          }}
          disabled={disconnecting}
          className="text-xs text-amber-300/70 hover:text-amber-200 bg-black/60 backdrop-blur-sm border border-amber-800/50 rounded-lg px-3 py-2.5 min-h-[48px] sm:px-3 transition-colors disabled:opacity-50"
        >
          {disconnecting ? '...' : 'Disconnect'}
        </button>
      </div>
    );
  }

  // Not connected -- show connect button + modal
  return (
    <>
      <div className="fixed top-3 right-3 sm:top-4 sm:right-4 z-50">
        <button
          onClick={() => setModalOpen(true)}
          className="text-sm font-medium text-factory-bg bg-amber-500 hover:bg-amber-400 rounded-lg px-3 py-2.5 sm:px-4 transition-colors shadow-lg shadow-amber-900/30 border border-amber-400/30"
        >
          Connect Wallet
        </button>
      </div>
      <ConnectModal isOpen={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}
