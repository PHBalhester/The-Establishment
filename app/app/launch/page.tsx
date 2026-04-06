'use client';

/**
 * /launch route -- Token Launch Page (Arc Network)
 *
 * Placeholder page for the upcoming token launch on Arc Network.
 * The Establishment protocol tokens: BRIBE, CORUPT, VOTES.
 */

import Link from 'next/link';
import Image from 'next/image';

export default function LaunchPage() {
  return (
    <div className="min-h-screen bg-government-bg">
      {/* Header */}
      <header className="border-b border-government-border bg-government-surface/80 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <Image
              src="/logos/establishment-seal.jpg"
              alt="The Establishment"
              width={40}
              height={40}
              className="rounded-full"
            />
            <span className="font-serif text-government-text font-semibold tracking-wide">
              The Establishment
            </span>
          </Link>
          <Link
            href="/"
            className="text-sm text-government-text-secondary hover:text-government-text transition-colors"
          >
            Back to Home
          </Link>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <h1 className="font-serif text-4xl md:text-5xl text-government-text mb-4">
            Token Launch
          </h1>
          <p className="text-government-text-secondary text-lg max-w-2xl mx-auto">
            The Establishment protocol will launch on Arc Network with three governance tokens.
          </p>
        </div>

        {/* Token Cards */}
        <div className="grid md:grid-cols-3 gap-6 mb-12">
          {/* BRIBE */}
          <div className="bg-government-surface border border-government-border rounded-lg p-6 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-government-bribe/20 flex items-center justify-center">
              <span className="text-2xl font-bold text-government-bribe">B</span>
            </div>
            <h3 className="font-serif text-xl text-government-text mb-2">BRIBE</h3>
            <p className="text-government-text-muted text-sm">
              Governance participation token for protocol voting and proposals.
            </p>
          </div>

          {/* CORUPT */}
          <div className="bg-government-surface border border-government-border rounded-lg p-6 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-government-corupt/20 flex items-center justify-center">
              <span className="text-2xl font-bold text-government-corupt">C</span>
            </div>
            <h3 className="font-serif text-xl text-government-text mb-2">CORUPT</h3>
            <p className="text-government-text-muted text-sm">
              Utility token used for protocol fees and trading activity.
            </p>
          </div>

          {/* VOTES */}
          <div className="bg-government-surface border border-government-border rounded-lg p-6 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-government-votes/20 flex items-center justify-center">
              <span className="text-2xl font-bold text-government-votes">V</span>
            </div>
            <h3 className="font-serif text-xl text-government-text mb-2">VOTES</h3>
            <p className="text-government-text-muted text-sm">
              Staking token for earning real yield from protocol revenue.
            </p>
          </div>
        </div>

        {/* Coming Soon Banner */}
        <div className="bg-government-surface-elevated border border-government-accent/30 rounded-lg p-8 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-government-accent/10 rounded-full mb-4">
            <div className="w-2 h-2 rounded-full bg-government-accent animate-pulse" />
            <span className="text-government-accent text-sm font-medium">Coming Soon</span>
          </div>
          <h2 className="font-serif text-2xl text-government-text mb-3">
            Launch on Arc Network
          </h2>
          <p className="text-government-text-secondary max-w-lg mx-auto mb-6">
            The token launch will begin once smart contracts are deployed and audited 
            on Arc Network. Stay tuned for announcements.
          </p>
          <Link
            href="/"
            className="inline-flex items-center justify-center px-6 py-3 bg-government-accent text-government-bg font-medium rounded-lg hover:brightness-110 transition-all"
          >
            Return to Homepage
          </Link>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-government-border mt-16">
        <div className="max-w-6xl mx-auto px-4 py-6 text-center">
          <p className="text-government-text-muted text-sm">
            The Establishment Protocol on Arc Network
          </p>
        </div>
      </footer>
    </div>
  );
}
