import Image from "next/image";

export function GovernmentFooter() {
  return (
    <footer className="bg-government-bg border-t border-government-border py-12 px-6">
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="relative w-8 h-8 rounded-full overflow-hidden border border-government-accent/50">
            <Image
              src="/logos/establishment-seal.jpg"
              alt="The Establishment"
              fill
              className="object-cover"
            />
          </div>
          <div>
            <span className="text-sm font-serif font-bold text-government-text">
              The Establishment
            </span>
            <p className="text-xs text-government-text-muted font-mono">
              Arc Network DeFi Protocol
            </p>
          </div>
        </div>

        {/* Links */}
        <nav className="flex items-center gap-6" aria-label="Footer navigation">
          {[
            { label: "Documentation", href: "#" },
            { label: "GitHub",        href: "#" },
            { label: "Arc Network",   href: "https://arc.network" },
          ].map((link) => (
            <a
              key={link.label}
              href={link.href}
              target={link.href.startsWith("http") ? "_blank" : undefined}
              rel={link.href.startsWith("http") ? "noopener noreferrer" : undefined}
              className="text-xs text-government-text-muted hover:text-government-accent transition-colors font-mono"
            >
              {link.label}
            </a>
          ))}
        </nav>

        {/* Disclaimer */}
        <p className="text-xs text-government-text-muted text-center md:text-right max-w-xs leading-relaxed">
          Not affiliated with any government institution.
          DeFi protocols involve financial risk.
        </p>
      </div>

      {/* Bottom gold bar */}
      <div className="mt-10 pt-6 border-t border-government-border/50 flex justify-center">
        <span className="text-xs text-government-text-muted font-mono">
          &copy; {new Date().getFullYear()} The Establishment. Deployed on Arc Network.
        </span>
      </div>
    </footer>
  );
}
