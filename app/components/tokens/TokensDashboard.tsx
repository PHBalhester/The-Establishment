'use client';

import { TokenDisplay } from './TokenDisplay';

export function TokensDashboard() {
  return (
    <section className="py-16 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-government-bg to-government-surface">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-12 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-government-text font-serif mb-4">
            The Establishment Tokens
          </h2>
          <p className="text-lg text-government-text-secondary max-w-2xl mx-auto">
            Three powerful tokens drive the official Arc protocol: BRIBE influences policy, CORUPT accelerates corruption events, and VOTES grants governance rights.
          </p>
        </div>

        {/* Token Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          <TokenDisplay
            name="Influence Currency"
            symbol="BRIBE"
            value="≈ $8,450"
            color="bribe"
          />
          <TokenDisplay
            name="Event Accelerant"
            symbol="CORUPT"
            value="≈ $3,220"
            color="corupt"
          />
          <TokenDisplay
            name="Governance Rights"
            symbol="VOTES"
            value="≈ $12,890"
            color="votes"
          />
        </div>

        {/* Protocol Stats */}
        <div className="bg-government-surface-elevated border border-government-border rounded-lg p-8 backdrop-blur-sm">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="text-center">
              <p className="text-government-text-muted text-sm font-mono uppercase">Total Locked Value</p>
              <p className="text-2xl font-bold text-government-accent mt-2 font-serif">$2.4M</p>
            </div>
            <div className="text-center">
              <p className="text-government-text-muted text-sm font-mono uppercase">Active Voters</p>
              <p className="text-2xl font-bold text-government-accent mt-2 font-serif">18,340</p>
            </div>
            <div className="text-center">
              <p className="text-government-text-muted text-sm font-mono uppercase">Corruption Events</p>
              <p className="text-2xl font-bold text-government-accent mt-2 font-serif">247</p>
            </div>
            <div className="text-center">
              <p className="text-government-text-muted text-sm font-mono uppercase">Epochs Completed</p>
              <p className="text-2xl font-bold text-government-accent mt-2 font-serif">512</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
