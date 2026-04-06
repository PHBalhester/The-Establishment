import { createConfig, http } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { arcTestnet, arcMainnet } from "./chain-config";

// WalletConnect project ID (get from cloud.walletconnect.com)
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "";

export const wagmiConfig = createConfig({
  chains: [arcTestnet, arcMainnet],
  connectors: [
    injected(),
    ...(projectId ? [walletConnect({ projectId })] : []),
  ],
  transports: {
    [arcTestnet.id]: http(),
    [arcMainnet.id]: http(),
  },
  ssr: true,
});
