import Image from "next/image";
import { WalletButton } from "@/components/wallet/WalletButton";

export function HeroSection() {
  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden bg-government-bg">
      {/* Background image */}
      <div className="absolute inset-0 z-0">
        <Image
          src="/backgrounds/government-scene.jpg"
          alt="The Establishment official headquarters"
          fill
          className="object-cover opacity-20"
          priority
        />
        {/* Navy overlay gradient */}
        <div className="absolute inset-0 bg-gradient-to-b from-government-bg/80 via-government-bg/60 to-government-bg" />
      </div>

      {/* Gold top bar — Casa Branca style */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-government-accent z-10" />

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center text-center px-6 max-w-4xl mx-auto gap-8">
        {/* Seal */}
        <div className="relative w-28 h-28 rounded-full overflow-hidden border-4 border-government-accent shadow-lg shadow-government-accent/30">
          <Image
            src="/logos/establishment-seal.jpg"
            alt="The Establishment official seal"
            fill
            className="object-cover"
          />
        </div>

        {/* Eyebrow */}
        <p className="text-government-accent font-mono text-sm tracking-[0.3em] uppercase">
          Official Arc Network Protocol
        </p>

        {/* Title */}
        <h1 className="text-5xl md:text-7xl font-serif font-bold text-government-text text-balance leading-tight">
          The Establishment
        </h1>

        {/* Divider */}
        <div className="flex items-center gap-4 w-full max-w-xs">
          <div className="flex-1 h-px bg-government-accent/40" />
          <div className="w-2 h-2 rotate-45 bg-government-accent" />
          <div className="flex-1 h-px bg-government-accent/40" />
        </div>

        {/* Subtitle */}
        <p className="text-lg md:text-xl text-government-text-secondary font-sans leading-relaxed max-w-2xl text-pretty">
          A tax-driven DeFi protocol on Arc Network. Every swap fuels epochs,
          carnage events, and real USDC yield for{" "}
          <span className="text-government-votes font-semibold">VOTES</span> stakers.
        </p>

        {/* Token trio */}
        <div className="flex items-center gap-6 flex-wrap justify-center">
          {[
            { symbol: "BRIBE",  label: "Bribe",      color: "text-government-bribe",  bg: "bg-government-bribe/10",  border: "border-government-bribe/30"  },
            { symbol: "CORUPT", label: "Corruption",  color: "text-government-corupt", bg: "bg-government-corupt/10", border: "border-government-corupt/30" },
            { symbol: "VOTES",  label: "Votes",      color: "text-government-votes",  bg: "bg-government-votes/10",  border: "border-government-votes/30"  },
          ].map((token) => (
            <div
              key={token.symbol}
              className={`flex flex-col items-center gap-1 px-5 py-3 rounded-lg border ${token.bg} ${token.border}`}
            >
              <span className={`text-xl font-mono font-bold ${token.color}`}>{token.symbol}</span>
              <span className="text-xs text-government-text-muted font-sans uppercase tracking-widest">{token.label}</span>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="flex items-center gap-4 flex-wrap justify-center pt-2">
          <WalletButton />
          <a
            href="#protocol"
            className="text-sm font-medium text-government-text-secondary border border-government-border hover:border-government-accent hover:text-government-accent rounded-lg px-6 py-2.5 transition-colors"
          >
            Learn the Protocol
          </a>
        </div>
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-2 text-government-text-muted">
        <span className="text-xs font-mono tracking-widest uppercase">Scroll</span>
        <div className="w-px h-8 bg-government-accent/40 animate-pulse" />
      </div>
    </section>
  );
}
