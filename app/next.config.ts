import type { NextConfig } from "next";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const cspHeader = `
  default-src 'self';
  script-src 'self' 'unsafe-inline';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob:;
  font-src 'self';
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  frame-ancestors 'none';
  connect-src 'self' wss://relay.walletconnect.com wss://relay.walletconnect.org https://explorer-api.walletconnect.com https://rpc.testnet.arc.network wss://rpc.testnet.arc.network;
  worker-src 'self';
  manifest-src 'self';
  upgrade-insecure-requests;
`;

const nextConfig: NextConfig = {
  transpilePackages: ["@the-establishment/shared"],

  images: {
    qualities: [75, 80, 82, 85],
    formats: ["image/webp"],
    deviceSizes: [1920, 2560, 3840],
    unoptimized: true,
  },

  turbopack: {
    root: join(__dirname, ".."),
  },

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: cspHeader.replace(/\s{2,}/g, " ").trim(),
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
