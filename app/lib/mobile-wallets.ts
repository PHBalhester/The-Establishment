/**
 * Shared mobile wallet deep-link definitions.
 *
 * Used by ConnectModal (launch page) and WalletStation (main app).
 * Each entry builds a deep-link URL that opens our dApp inside the
 * wallet's in-app browser, where wallet-standard auto-detect works.
 *
 * Icons are local static files in /public/wallets/ to avoid CSP
 * issues with external CDNs.
 */

export const MOBILE_WALLETS = [
  {
    name: "Phantom",
    // Official icon from Phantom Integration Assets (docs.phantom.com/resources/assets)
    icon: "/wallets/phantom.png",
    deepLink: (url: string) =>
      `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(new URL(url).origin)}`,
  },
  {
    name: "Solflare",
    icon: "/wallets/solflare.ico",
    deepLink: (url: string) =>
      `https://solflare.com/ul/v1/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(new URL(url).origin)}`,
  },
  {
    name: "Backpack",
    icon: "/wallets/backpack.ico",
    deepLink: (url: string) =>
      `https://backpack.app/ul/browse/${encodeURIComponent(url)}`,
  },
];
