"use client";

import { useAccount, useConnect, useDisconnect, useBalance } from "wagmi";
import { useCallback } from "react";
import { CONTRACTS } from "@/lib/contract-addresses";
import { arcTestnet } from "@/lib/chain-config";

/**
 * Custom wallet hook that wraps wagmi hooks
 * Provides a similar API to the old Solana wallet adapter
 */
export function useWallet() {
  const { address, isConnected, isConnecting, chain } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();

  // USDC balance (native gas token on Arc)
  const { data: usdcBalance } = useBalance({
    address,
    chainId: arcTestnet.id,
  });

  const connectWallet = useCallback(() => {
    // Try to connect with the first available connector (usually injected/MetaMask)
    const connector = connectors[0];
    if (connector) {
      connect({ connector });
    }
  }, [connect, connectors]);

  return {
    // Address
    address,
    publicKey: address, // Alias for compatibility
    
    // Connection state
    connected: isConnected,
    connecting: isConnecting,
    
    // Chain info
    chain,
    isCorrectChain: chain?.id === arcTestnet.id,
    
    // Balances
    usdcBalance: usdcBalance?.value ?? 0n,
    usdcBalanceFormatted: usdcBalance?.formatted ?? "0",
    
    // Actions
    connect: connectWallet,
    disconnect,
    
    // Available connectors
    connectors,
  };
}

export type WalletState = ReturnType<typeof useWallet>;
