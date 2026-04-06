import { GovernmentHeader } from "@/components/layout/GovernmentHeader";
import { HeroSection } from "@/components/home/HeroSection";
import { StatsSection } from "@/components/home/StatsSection";
import { ProtocolSection } from "@/components/home/ProtocolSection";
import { TokensSection } from "@/components/home/TokensSection";
import { GovernmentFooter } from "@/components/home/GovernmentFooter";

export default function Home() {
  return (
    <>
      <GovernmentHeader />
      <main>
        <HeroSection />
        <StatsSection />
        <ProtocolSection />
        <TokensSection />
      </main>
      <GovernmentFooter />
    </>
  );
}
