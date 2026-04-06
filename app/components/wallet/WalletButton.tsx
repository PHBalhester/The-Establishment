"use client";

/**
 * WalletButton -- Header button showing wallet connection state
 *
 * Three states:
 * 1. Not ready (Wallet connecting): Shows loading skeleton
 * 2. Not connected: Shows "Connect Wallet" button that opens ConnectModal
 * 3. Connected: Shows truncated address (e.g. "0x8kPz...MH4") + disconnect button
 *
 * Updated for Arc Network (EVM) using wagmi.
 */

import { useState } from "react";
import { useAccount, useDisconnect, useConnect } from "wagmi";
import { ConnectModal } from "./ConnectModal";

/** Truncate an EVM address to "0xXXXX...YYYY" format */
function truncateAddress(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function WalletButton() {
  const { address, isConnected, isConnecting } = useAccount();
  const { disconnect, isPending: isDisconnecting } = useDisconnect();
  const { connectors } = useConnect();
  const [modalOpen, setModalOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // Wallet connecting -- show loading state
  if (isConnecting) {
    return (
      <div className="h-10 w-32 bg-factory-surface-elevated rounded-lg animate-pulse" />
    );
  }

  // Connected -- show address (click to copy) + disconnect
  if (isConnected && address) {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={() => {
            navigator.clipboard.writeText(address);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          title="Click to copy full address"
          className="text-sm font-mono text-factory-text-secondary bg-factory-surface-elevated border border-factory-border rounded-lg px-3 py-2 hover:border-factory-accent transition-colors cursor-pointer"
        >
          {copied ? "Copied!" : truncateAddress(address)}
        </button>
        <button
          onClick={() => disconnect()}
          disabled={isDisconnecting}
          className="text-sm text-factory-text-secondary hover:text-factory-text bg-factory-surface-elevated border border-factory-border rounded-lg px-3 py-2 transition-colors disabled:opacity-50"
        >
          {isDisconnecting ? "..." : "Disconnect"}
        </button>
      </div>
    );
  }

  // Not connected -- show connect button + modal
  return (
    <>
      <button
        onClick={() => setModalOpen(true)}
        className="text-sm font-medium text-factory-bg bg-factory-accent hover:brightness-110 rounded-lg px-4 py-2 transition-all brass-button"
      >
        Connect Wallet
      </button>
      <ConnectModal 
        isOpen={modalOpen} 
        onClose={() => setModalOpen(false)} 
        connectors={connectors}
      />
    </>
  );
}
