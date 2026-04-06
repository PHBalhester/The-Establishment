"use client";

import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { wagmiConfig } from "@/lib/wagmi-config";
import { ModalProvider } from "@/components/modal/ModalProvider";
import { SettingsProvider } from "@/providers/SettingsProvider";
import { AudioProvider } from "@/providers/AudioProvider";
import { ProtocolStateProvider } from "@/providers/ProtocolStateProvider";
import { ModalRoot } from "@/components/modal/ModalShell";
import { ToastProvider, ToastContainer, useToast } from "@/components/toast/ToastProvider";
import { SplashScreen } from "@/components/onboarding/SplashScreen";
import { QuickMuteButton } from "@/components/audio/QuickMuteButton";
import { useAccount } from "wagmi";
import { useEffect, useRef, useState } from "react";

// Create a client for react-query
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5000,
      refetchOnWindowFocus: false,
    },
  },
});

/** Fires "Wallet connected" toast on fresh wallet connection.
 *  Watches useAccount().isConnected -- when it transitions false->true, fires toast.
 *  useRef tracks previous state to detect the transition. */
function WalletConnectionToast() {
  const { showToast } = useToast();
  const { isConnected } = useAccount();
  const wasConnected = useRef(false);

  useEffect(() => {
    if (isConnected && !wasConnected.current) {
      showToast("success", "Wallet connected");
    }
    wasConnected.current = isConnected;
  }, [isConnected, showToast]);

  return null;
}

export default function Providers({ children }: { children: React.ReactNode }) {
  // Fix hydration issues with wagmi
  const [mounted, setMounted] = useState(false);
  
  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        {/* Provider tree: Wagmi > Query > Settings > Audio > Modal > ProtocolState > Toast
            AudioProvider after SettingsProvider so it can read muted/volume.
            AudioProvider before ModalProvider so modal content can useAudio().

            ModalProvider inside wallet providers so modal content can
            access wallet hooks. ModalRoot renders the
            singleton <dialog> element -- always present in the DOM regardless
            of which page is active.

            ToastProvider wraps children so any component can call useToast().
            ToastContainer is a sibling of ModalRoot -- it renders via portal
            at document.body level so toasts appear above the dialog and
            persist after the modal closes.

            ProtocolStateProvider inside ModalProvider because it uses
            useVisibility() which calls useModal(). Creates a single connection
            per tab -- all useProtocolState() consumers share it.

            QuickMuteButton is a sibling of SplashScreen -- renders the
            floating mute toggle after audio is initialized. */}
        <SettingsProvider>
          <AudioProvider>
            <ModalProvider>
              <ProtocolStateProvider>
                <ToastProvider>
                  {mounted ? children : null}
                  <ModalRoot />
                  <SplashScreen />
                  <QuickMuteButton />
                  <ToastContainer />
                  <WalletConnectionToast />
                </ToastProvider>
              </ProtocolStateProvider>
            </ModalProvider>
          </AudioProvider>
        </SettingsProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
