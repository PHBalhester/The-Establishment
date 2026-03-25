'use client';

/**
 * WalletStation -- Wallet connection panel for the Wallet modal station.
 *
 * Shows detected wallet-standard wallets (Phantom, Solflare, Backpack, etc.)
 * and lets the user select one to connect. With wallet-adapter, there's a
 * single connection path -- external wallets only (no embedded wallets).
 *
 * Mobile: Shows deep-link options to open our dApp inside the wallet's
 * in-app browser (same behavior as ConnectModal).
 *
 * Default export required for React.lazy in ModalContent.tsx.
 */

import { useCallback, useMemo } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useModal } from '@/hooks/useModal';
import { Card, Button } from '@/components/kit';
import { isMobile } from '@/lib/isMobile';
import { MOBILE_WALLETS } from '@/lib/mobile-wallets';

export default function WalletStation() {
  const { wallets, select, connecting } = useWallet();
  const { closeModal } = useModal();

  const mobile = useMemo(() => isMobile(), []);

  const handleSelectWallet = useCallback((walletName: string) => {
    select(walletName as any);
    closeModal();
  }, [select, closeModal]);

  // Filter to installed/detected wallets for a cleaner list
  const detectedWallets = wallets.filter(
    (w) => w.readyState === 'Installed' || w.readyState === 'Loadable',
  );

  const detectedNames = new Set(
    detectedWallets.map((w) => w.adapter.name as string),
  );

  const currentUrl =
    typeof window !== 'undefined' ? window.location.href : '';

  return (
    <div className="space-y-4 min-h-full flex flex-col justify-center">
      <p className="text-sm text-factory-text-secondary">
        {mobile ? 'Choose your wallet app' : 'Select a wallet to connect'}
      </p>

      {mobile ? (
        /* ---- MOBILE: detected wallets first, then deep-link options ---- */
        <div className="space-y-2">
          {detectedWallets.map((wallet) => (
            <Button
              key={wallet.adapter.name}
              variant="secondary"
              size="lg"
              onClick={() => handleSelectWallet(wallet.adapter.name)}
              disabled={connecting}
              className="w-full flex items-center gap-3"
            >
              {wallet.adapter.icon && (
                <img
                  src={wallet.adapter.icon}
                  alt={wallet.adapter.name}
                  width={28}
                  height={28}
                  className="rounded-md"
                />
              )}
              <span className="text-sm font-medium text-factory-text">
                {wallet.adapter.name}
              </span>
            </Button>
          ))}

          {MOBILE_WALLETS.filter((mw) => !detectedNames.has(mw.name)).map(
            (mw) => (
              <a
                key={mw.name}
                href={mw.deepLink(currentUrl)}
                rel="noopener noreferrer"
                onClick={() => closeModal()}
                className="kit-button-secondary w-full flex items-center gap-3 rounded-lg p-3 min-h-[48px]"
              >
                <img
                  src={mw.icon}
                  alt={mw.name}
                  width={28}
                  height={28}
                  className="rounded-md"
                />
                <span className="text-sm font-medium flex-1">
                  {mw.name}
                </span>
                <span className="text-[10px] font-mono uppercase tracking-wider opacity-60 px-2 py-0.5 rounded-full border border-current/20">
                  Open App
                </span>
              </a>
            ),
          )}
        </div>
      ) : (
        /* ---- DESKTOP: extension-only behavior ---- */
        <>
          {detectedWallets.length === 0 ? (
            <Card className="text-center">
              <p className="text-sm text-factory-text-muted">
                No wallets detected. Install Phantom, Solflare, or Backpack to continue.
              </p>
            </Card>
          ) : (
            <div className="space-y-2">
              {detectedWallets.map((wallet) => (
                <Button
                  key={wallet.adapter.name}
                  variant="secondary"
                  size="lg"
                  onClick={() => handleSelectWallet(wallet.adapter.name)}
                  disabled={connecting}
                  className="w-full flex items-center gap-3"
                >
                  {wallet.adapter.icon && (
                    <img
                      src={wallet.adapter.icon}
                      alt={wallet.adapter.name}
                      width={28}
                      height={28}
                      className="rounded-md"
                    />
                  )}
                  <span className="text-sm font-medium text-factory-text">
                    {wallet.adapter.name}
                  </span>
                </Button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
