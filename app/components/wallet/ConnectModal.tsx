"use client";

/**
 * ConnectModal -- Wallet connection modal for Arc Network (EVM)
 *
 * Shows available wagmi connectors (MetaMask, WalletConnect, etc.)
 * Used by WalletButton as the connection entry point.
 */

import { useEffect, useCallback } from "react";
import { useConnect, type Connector } from "wagmi";

interface ConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectors?: readonly Connector[];
}

// Connector icons (fallback SVGs for common wallets)
const CONNECTOR_ICONS: Record<string, string> = {
  MetaMask: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 318.6 318.6'%3E%3Cpath fill='%23e2761b' d='M274.1 35.5l-99.5 73.9 18.4-43.6z'/%3E%3Cpath fill='%23e4761b' d='M44.4 35.5l98.7 74.6-17.5-44.3zm193.9 171.3l-26.5 40.6 56.7 15.6 16.3-55.3zm-204.4.9l16.2 55.3 56.7-15.6-26.5-40.6z'/%3E%3Cpath fill='%23d7c1b3' d='M103.6 138.2l-15.8 23.9 56.3 2.5-2-60.5zm111.3 0l-39-34.8-1.3 61.2 56.2-2.5zM106.8 247.4l33.8-16.5-29.2-22.8zm71.1-16.5l33.9 16.5-4.7-39.3z'/%3E%3Cpath fill='%23ea8d3a' d='M211.8 247.4l-33.9-16.5 2.7 22.1-.3 9.3zm-105 0l31.5 14.9-.2-9.3 2.5-22.1z'/%3E%3Cpath fill='%23f89d35' d='M138.8 193.5l-28.2-8.3 19.9-9.1zm40.9 0l8.3-17.4 20 9.1z'/%3E%3Cpath fill='%23eb8f35' d='M106.8 247.4l4.8-40.6-31.3.9zM207 206.8l4.8 40.6 26.5-39.7zm23.8-44.7l-56.2 2.5 5.2 28.9 8.3-17.4 20 9.1zm-120.2 23.1l20-9.1 8.2 17.4 5.3-28.9-56.3-2.5z'/%3E%3Cpath fill='%23e8821e' d='M87.8 162.1l23.6 46-.8-22.9zm120.3 23.1l-1 22.9 23.7-46zm-64-20.6l-5.3 28.9 6.6 34.1 1.5-44.9zm30.5 0l-2.7 18 1.2 45 6.7-34.1z'/%3E%3Cpath fill='%23dfcec3' d='M179.8 193.5l-6.7 34.1 4.8 3.3 29.2-22.8 1-22.9zm-69.2-8.3l.8 22.9 29.2 22.8 4.8-3.3-6.6-34.1z'/%3E%3Cpath fill='%23393939' d='M180.3 262.3l.3-9.3-2.5-2.2h-37.7l-2.3 2.2.2 9.3-31.5-14.9 11 9 22.3 15.5h38.3l22.4-15.5 11-9z'/%3E%3Cpath fill='%23141619' d='M177.9 230.9l-4.8-3.3h-27.7l-4.8 3.3-2.5 22.1 2.3-2.2h37.7l2.5 2.2z'/%3E%3Cpath fill='%23763d16' d='M278.3 114.2l8.5-40.8-12.7-37.9-96.2 71.4 37 31.3 52.3 15.3 11.6-13.5-5-3.6 8-7.3-6.2-4.8 8-6.1zM31.8 73.4l8.5 40.8-5.4 4 8 6.1-6.1 4.8 8 7.3-5 3.6 11.5 13.5 52.3-15.3 37-31.3-96.2-71.4z'/%3E%3Cpath fill='%23f89d35' d='M267.2 153.5l-52.3-15.3 15.9 23.9-23.7 46 31.2-.4h46.5zm-163.6-15.3l-52.3 15.3-17.4 54.2h46.4l31.1.4-23.6-46zm71 26.4l3.3-57.7 15.2-41.1h-67.5l15 41.1 3.5 57.7 1.2 18.2.1 44.8h27.7l.2-44.8z'/%3E%3C/svg%3E",
  WalletConnect: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400'%3E%3Ccircle cx='200' cy='200' r='200' fill='%233396ff'/%3E%3Cpath fill='%23fff' d='M122.5 155.5c42.8-41.9 112.2-41.9 155 0l5.2 5c2.1 2.1 2.1 5.5 0 7.6l-17.6 17.3c-1.1 1-2.8 1-3.9 0l-7.1-6.9c-29.9-29.2-78.3-29.2-108.2 0l-7.6 7.4c-1.1 1-2.8 1-3.9 0l-17.6-17.3c-2.1-2.1-2.1-5.5 0-7.6l5.7-5.5zm191.5 35.6l15.7 15.4c2.1 2.1 2.1 5.5 0 7.6l-70.7 69.2c-2.1 2.1-5.6 2.1-7.8 0l-50.2-49.1c-.5-.5-1.4-.5-1.9 0l-50.2 49.1c-2.1 2.1-5.6 2.1-7.8 0L70.4 214c-2.1-2.1-2.1-5.5 0-7.6l15.7-15.4c2.1-2.1 5.6-2.1 7.8 0l50.2 49.1c.5.5 1.4.5 1.9 0l50.2-49.1c2.1-2.1 5.6-2.1 7.8 0l50.2 49.1c.5.5 1.4.5 1.9 0l50.2-49.1c2.2-2 5.6-2 7.8.1z'/%3E%3C/svg%3E",
  "Injected": "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Crect x='3' y='3' width='18' height='18' rx='2'/%3E%3Cpath d='M12 8v8m-4-4h8'/%3E%3C/svg%3E",
};

function getConnectorIcon(connector: Connector): string {
  // Use connector's built-in icon if available
  if (connector.icon) return connector.icon;
  // Fall back to our predefined icons
  return CONNECTOR_ICONS[connector.name] || CONNECTOR_ICONS["Injected"];
}

export function ConnectModal({ isOpen, onClose, connectors: propConnectors }: ConnectModalProps) {
  const { connect, connectors: hookConnectors, isPending } = useConnect();
  
  const connectors = propConnectors || hookConnectors;

  // Close modal on Escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  const handleConnect = (connector: Connector) => {
    connect({ connector });
    onClose();
  };

  return (
    // Fixed overlay with semi-transparent backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Modal card -- stop click propagation so clicking inside doesn't close */}
      <div
        className="relative w-full max-w-md mx-4 bg-factory-surface border border-factory-border rounded-xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 pb-2">
          <h2 className="text-lg font-semibold text-factory-text">
            Connect to The Establishment
          </h2>
          <button
            onClick={onClose}
            className="text-factory-text-muted hover:text-factory-text transition-colors"
            aria-label="Close modal"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <p className="px-6 text-sm text-factory-text-secondary mb-4">
          Select a wallet to connect to Arc Network
        </p>

        <div className="px-6 pb-6 space-y-2">
          {connectors.length === 0 ? (
            <div className="rounded-lg border border-factory-border p-4 text-center">
              <p className="text-sm text-factory-text-muted">
                No wallets detected. Install MetaMask or another EVM wallet to continue.
              </p>
            </div>
          ) : (
            connectors.map((connector) => (
              <button
                key={connector.uid}
                onClick={() => handleConnect(connector)}
                disabled={isPending}
                className="w-full flex items-center gap-3 rounded-lg border border-factory-border p-3 hover:brightness-110 transition-[filter] bg-factory-surface-elevated disabled:opacity-50"
              >
                <img
                  src={getConnectorIcon(connector)}
                  alt={connector.name}
                  width={28}
                  height={28}
                  className="rounded-md"
                />
                <span className="text-sm font-medium text-factory-text">
                  {connector.name}
                </span>
              </button>
            ))
          )}
        </div>
        
        {/* Arc Network info */}
        <div className="px-6 pb-6">
          <div className="text-xs text-factory-text-muted text-center border-t border-factory-border pt-4">
            Connecting to Arc Network (EVM)
          </div>
        </div>
      </div>
    </div>
  );
}
