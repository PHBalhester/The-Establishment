export function ProtocolSection() {
  const mechanics = [
    {
      number: "01",
      title: "Tax on Every Swap",
      body:
        "Every BRIBE/USDC and CORUPT/USDC trade incurs a configurable tax. 71% flows to VOTES stakers as USDC yield, 24% seeds the Carnage Fund, and 5% goes to the treasury.",
    },
    {
      number: "02",
      title: "Epoch Cycle",
      body:
        "Epochs advance every 30 minutes via Chainlink VRF. Tax rates fluctuate between 1–4% (low phase) and 11–14% (high phase), creating natural market pressure cycles.",
    },
    {
      number: "03",
      title: "Carnage Events",
      body:
        "Each epoch has a ~4.3% probability of triggering Carnage. When it fires, the entire Carnage Fund executes a buyback-and-burn of BRIBE and CORUPT, deflating supply.",
    },
    {
      number: "04",
      title: "Convert to VOTES",
      body:
        "Lock 100 BRIBE or CORUPT into the Conversion Vault to receive 1 VOTES. Stake VOTES to earn a proportional share of all USDC collected from swap taxes.",
    },
  ];

  return (
    <section id="protocol" className="bg-government-surface py-24 px-6">
      {/* Section header */}
      <div className="max-w-6xl mx-auto flex flex-col items-center text-center gap-4 mb-16">
        <p className="text-government-accent font-mono text-xs tracking-[0.3em] uppercase">
          How It Works
        </p>
        <h2 className="text-3xl md:text-4xl font-serif font-bold text-government-text text-balance">
          Protocol Mechanics
        </h2>
        <div className="w-16 h-0.5 bg-government-accent" />
        <p className="text-government-text-secondary max-w-xl text-pretty leading-relaxed">
          A self-sustaining economic loop built on Arc Network where every
          market action strengthens the reward flywheel.
        </p>
      </div>

      {/* Mechanics grid */}
      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6">
        {mechanics.map((item) => (
          <div
            key={item.number}
            className="flex gap-5 p-6 rounded-lg border border-government-border bg-government-bg hover:border-government-accent/50 transition-colors group"
          >
            <span className="font-mono text-3xl font-bold text-government-accent/30 group-hover:text-government-accent/60 transition-colors select-none shrink-0 leading-none pt-1">
              {item.number}
            </span>
            <div className="flex flex-col gap-2">
              <h3 className="font-serif font-semibold text-government-text text-lg">
                {item.title}
              </h3>
              <p className="text-government-text-secondary leading-relaxed text-sm">
                {item.body}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
