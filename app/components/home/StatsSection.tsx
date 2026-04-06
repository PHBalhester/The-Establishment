const STATS = [
  { label: "Epoch Duration",        value: "30 min",   sub: "Chainlink VRF randomized"   },
  { label: "Carnage Probability",   value: "4.3%",     sub: "Per epoch trigger rate"      },
  { label: "Staker Yield Share",    value: "71%",      sub: "Of all swap tax collected"   },
  { label: "Conversion Rate",       value: "100 : 1",  sub: "BRIBE or CORUPT to VOTES"   },
  { label: "Carnage Fund Share",    value: "24%",      sub: "Funds buyback-and-burn"      },
  { label: "Max Tax Rate",          value: "14%",      sub: "High-phase epoch tax"        },
];

export function StatsSection() {
  return (
    <section className="bg-government-surface-elevated py-20 px-6 border-y border-government-border">
      {/* Gold accent bar */}
      <div className="max-w-6xl mx-auto flex flex-col items-center gap-12">
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="text-government-accent font-mono text-xs tracking-[0.3em] uppercase">
            Protocol at a Glance
          </p>
          <h2 className="text-2xl md:text-3xl font-serif font-bold text-government-text">
            By the Numbers
          </h2>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-px w-full bg-government-border rounded-lg overflow-hidden">
          {STATS.map((stat) => (
            <div
              key={stat.label}
              className="flex flex-col items-center gap-1 p-6 bg-government-surface text-center"
            >
              <span className="text-3xl md:text-4xl font-mono font-bold text-government-accent">
                {stat.value}
              </span>
              <span className="text-sm font-sans font-medium text-government-text">
                {stat.label}
              </span>
              <span className="text-xs text-government-text-muted">
                {stat.sub}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
