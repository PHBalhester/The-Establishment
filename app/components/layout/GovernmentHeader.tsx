'use client';

import Image from 'next/image';
import { WalletButton } from '@/components/wallet/WalletButton';

export function GovernmentHeader() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-government-bg border-b border-government-border shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex items-center justify-between">
          {/* Logo and Title */}
          <div className="flex items-center gap-3">
            <div className="relative w-10 h-10 rounded-full overflow-hidden">
              <Image
                src="/logos/establishment-seal.jpg"
                alt="The Establishment seal"
                fill
                className="object-cover"
              />
            </div>
            <div>
              <h1 className="text-xl font-bold text-government-text font-serif">
                The Establishment
              </h1>
              <p className="text-xs text-government-text-muted font-mono">
                Official Arc Protocol
              </p>
            </div>
          </div>

          {/* Navigation and Wallet */}
          <nav className="flex items-center gap-6">
            <a
              href="#documentation"
              className="text-sm text-government-text-secondary hover:text-government-accent transition-colors"
            >
              Documentation
            </a>
            <a
              href="#tokens"
              className="text-sm text-government-text-secondary hover:text-government-accent transition-colors"
            >
              Tokens
            </a>
            <a
              href="#governance"
              className="text-sm text-government-text-secondary hover:text-government-accent transition-colors"
            >
              Governance
            </a>
            <WalletButton />
          </nav>
        </div>
      </div>
    </header>
  );
}
