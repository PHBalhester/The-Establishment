const TOKENS = [
  {
    symbol: "BRIBE",
    name: "Bribe Token",
    description:
      "The primary governance currency of corruption. Swap BRIBE for USDC through the taxed AMM pool, or convert 100 BRIBE into 1 VOTES via the Conversion Vault.",
    role: "Swap & Convert",
    color: "text-government-bribe",
    border: "border-government-bribe/40",
    bg: "bg-government-bribe/5",
    glow: "shadow-government-bribe/20",
    stats: [
      { label: "Pool", value: "BRIBE / USDC" },
      { label: "Conversion", value: "100 → 1 VOTES" },
      { label: "Tax Range", value: "1% – 14%" },
    ],
  },
  {
    symbol: "CORUPT",
    name: "Corruption Token",
    description:
      "The secondary instrument of institutional capture. Operates identically to BRIBE — taxed swaps feed the reward loop and 100 CORUPT converts to 1 VOTES.",
    role: "Swap & Convert",
    color: "text-government-corupt",
    border: "border-government-corupt/40",
    bg: "bg-government-corupt/5",
    glow: "shadow-government-corupt/20",
    stats: [
      { label: "Pool", value: "CORUPT / USDC" },
      { label: "Conversion", value: "100 → 1 VOTES" },
      { label: "Tax Range", value: "1% – 14%" },
    ],
  },
  {
    symbol: "VOTES",
    name: "Votes Token",
    description:
      "Power. Stake VOTES to earn a proportional share of all USDC collected from BRIBE and CORUPT swap taxes. The more VOTES staked, the more USDC you claim.",
    role: "Stake & Earn",
    color: "text-government-votes",
    border: "border-government-votes/40",
    bg: "bg-government-votes/5",
    glow: "shadow-government-votes/20",
    stats: [
      { label: "Yield Asset", value: "USDC" },
      { label: "Staking Share", value: "71% of taxes" },
      { label: "Cooldown", value: "12 hours" },
    ],
  },
];

export function TokensSection() {
  return (
    <section id="tokens" className="bg-government-bg py-24 px-6">
      {/* Section header */}
      <div className="max-w-6xl mx-auto flex flex-col items-center text-center gap-4 mb-16">
        <p className="text-government-accent font-mono text-xs tracking-[0.3em] uppercase">
          The Three Pillars
        </p>
        <h2 className="text-3xl md:text-4xl font-serif font-bold text-government-text text-balance">
          Official Token Registry
        </h2>
        <div className="w-16 h-0.5 bg-government-accent" />
      </div>

      {/* Tokens grid */}
      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
        {TOKENS.map((token) => (
          <article
            key={token.symbol}
            className={`flex flex-col gap-5 p-6 rounded-lg border ${token.border} ${token.bg} shadow-lg ${token.glow}`}
          >
            {/* Header */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className={`font-mono text-2xl font-bold ${token.color}`}>
                  {token.symbol}
                </span>
                <span className={`text-xs font-mono px-2 py-0.5 rounded border ${token.border} ${token.color}`}>
                  {token.role}
                </span>
              </div>
              <span className="text-government-text-muted text-xs font-sans">
                {token.name}
              </span>
            </div>

            {/* Divider */}
            <div className={`h-px ${token.bg} border-t ${token.border}`} />

            {/* Description */}
            <p className="text-government-text-secondary text-sm leading-relaxed flex-1">
              {token.description}
            </p>

            {/* Stats */}
            <dl className="flex flex-col gap-2">
              {token.stats.map((stat) => (
                <div key={stat.label} className="flex justify-between items-center">
                  <dt className="text-xs text-government-text-muted font-mono uppercase tracking-wider">
                    {stat.label}
                  </dt>
                  <dd className={`text-xs font-mono font-semibold ${token.color}`}>
                    {stat.value}
                  </dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}
