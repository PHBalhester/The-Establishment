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
        // Comprehensive CSP for the Nextra docs site.
        // - frame-ancestors: production HTTPS domains only (no localhost/Railway dev URLs)
        // - unsafe-inline kept for script-src and style-src (Nextra/Pagefind compatibility)
        // - connect-src 'self' allows Pagefind search fetches
        // - object-src 'none' blocks Flash/Java plugin embeds
        // - base-uri 'self' prevents base tag injection
        {
          key: 'Content-Security-Policy',
          value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors https://fraudsworth.fun https://www.fraudsworth.fun https://docs.fraudsworth.fun",
        },
      ],
    }];
  },
}

export default withNextra(nextConfig)
