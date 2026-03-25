import nextra from 'nextra'

const withNextra = nextra({
  // Content lives in the content/ directory
})

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        // Allow framing from the main app (required for DocsStation iframe).
        // X-Frame-Options: SAMEORIGIN does NOT work here because different
        // ports = different origins (localhost:3000 ≠ localhost:3001).
        // CSP frame-ancestors allows specifying multiple origins.
        {
          key: 'Content-Security-Policy',
          value: 'frame-ancestors http://localhost:3000 http://localhost:3001 https://dr-fraudsworth-production.up.railway.app https://fraudsworth.fun https://www.fraudsworth.fun https://docs.fraudsworth.fun',
        },
      ],
    }];
  },
}

export default withNextra(nextConfig)
