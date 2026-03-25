import type { NextConfig } from "next";
import path from "path";

// Content Security Policy -- restrict all resource loading to explicit whitelist.
// Each directive limits where specific resource types can be loaded from.
// 'self' = same origin only. 'unsafe-inline' needed for Next.js style injection.

// Cluster detection: build-time env var determines which Helius URLs to allow.
// Defaults to 'devnet' so existing behavior is preserved when env var is unset.
const cluster = process.env.NEXT_PUBLIC_CLUSTER || "devnet";
const isMainnet = cluster === "mainnet";

// Helius RPC -- only allow the cluster-appropriate domain (HTTPS + WSS).
// Mainnet uses mainnet.helius-rpc.com; devnet uses devnet.helius-rpc.com.
const heliusRpcDomain = isMainnet
  ? "mainnet.helius-rpc.com"
  : "devnet.helius-rpc.com";

// Helius REST API -- devnet uses api.helius.xyz and api-devnet.helius-rpc.com
// (legacy client-side calls). Mainnet uses api-mainnet.helius-rpc.com.
const heliusApiSources = isMainnet
  ? "https://api-mainnet.helius-rpc.com"
  : "https://api.helius.xyz https://api-devnet.helius-rpc.com";

// Docs iframe sources -- mainnet embeds from production domain,
// devnet uses localhost (local dev) and Railway docs service.
const docsFrameSources = isMainnet
  ? "https://docs.fraudsworth.fun https://fraudsworth.fun"
  : "http://localhost:3001 https://docs-drfraudsworth.up.railway.app https://docs.fraudsworth.fun";

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
  child-src 'self' ${docsFrameSources} https://verify.walletconnect.com https://verify.walletconnect.org;
  frame-src 'self' ${docsFrameSources} https://verify.walletconnect.com https://verify.walletconnect.org;
  connect-src 'self' wss://relay.walletconnect.com wss://relay.walletconnect.org wss://www.walletlink.org https://explorer-api.walletconnect.com https://${heliusRpcDomain} wss://${heliusRpcDomain} ${heliusApiSources} https://*.ingest.sentry.io https://*.ingest.us.sentry.io;
  worker-src 'self';
  manifest-src 'self';
  upgrade-insecure-requests;
`;

const nextConfig: NextConfig = {
  // Transpile the shared workspace package (raw .ts files)
  transpilePackages: ["@dr-fraudsworth/shared"],

  // Image optimization config for the factory scene.
  // qualities: Whitelist of allowed quality values (required in Next.js 16).
  //   75 = thumbnails, 80 = background, 82 = overlays, 85 = high-detail.
  // formats: Serve WebP (our pre-optimized format).
  // deviceSizes: Match our scene breakpoints (1920/2560/3840) so srcset
  //   picks the right variant for the viewport width.
  images: {
    qualities: [75, 80, 82, 85],
    formats: ["image/webp"],
    deviceSizes: [1920, 2560, 3840],
    // Serve pre-optimized WebPs directly from public/ -- skip Next.js
    // image optimization endpoint (/_next/image) which has persistent
    // cache issues on Railway/Nixpacks deploys.
    unoptimized: true,
  },

  turbopack: {
    // Set monorepo root explicitly to avoid "multiple lockfiles" warning.
    // Turbopack needs to know the workspace root for correct module resolution.
    root: path.join(__dirname, ".."),

    resolveAlias: {
      // Stub Node.js modules that Anchor/web3.js transitively import.
      // These are not used in the browser but cause "Module not found" build failures.
      fs: { browser: "./lib/empty.ts" },
      net: { browser: "./lib/empty.ts" },
      tls: { browser: "./lib/empty.ts" },
    },
  },

  // Security headers applied to all routes.
  // CSP prevents XSS/injection, X-Frame-Options prevents clickjacking,
  // nosniff prevents MIME-type confusion attacks.
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
            // H026: HSTS -- force HTTPS for 2 years, include subdomains, and
            // opt into the browser preload list. This prevents SSL-stripping
            // attacks where an attacker downgrades HTTPS to HTTP.
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

// @sentry/nextjs REMOVED -- incompatible with Turbopack (monkey-patches webpack internals).
// Sentry integration uses @sentry/browser (client) + @sentry/node (server) instead.
export default nextConfig;
