import type { ReactNode } from 'react'
import { Footer, Layout, Navbar } from 'nextra-theme-docs'
import { Head } from 'nextra/components'
import { getPageMap } from 'nextra/page-map'
import 'nextra-theme-docs/style.css'
import './globals.css'

export const metadata = {
  title: {
    default: "Dr. Fraudsworth's Fantastical Finance Factory",
    template: "%s | Dr. Fraudsworth's Fantastical Finance Factory",
  },
  description:
    'A gamified financial experiment on Solana. Three tokens, asymmetric taxes, verifiable randomness, and controlled chaos.',
  icons: {
    icon: '/favicon.ico',
  },
  openGraph: {
    title: "Dr. Fraudsworth's Fantastical Finance Factory",
    description:
      'A gamified financial experiment on Solana. Three tokens, asymmetric taxes, verifiable randomness, and controlled chaos.',
    type: 'website',
  },
}

const navbar = (
  <Navbar
    logo={
      <span style={{ fontFamily: "'Cinzel', serif", fontWeight: 700, fontSize: '1.15rem' }}>
        Dr. Fraudsworth
      </span>
    }
    projectLink="https://github.com/MetalLegBob/drfraudsworth"
  />
)

const footer = (
  <Footer>
    <span style={{ fontFamily: "'Cinzel', serif", opacity: 0.7 }}>
      {new Date().getFullYear()} Dr. Fraudsworth&apos;s Fantastical Finance Factory
    </span>
  </Footer>
)

export default async function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <Head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=EB+Garamond:ital,wght@0,400;0,500;0,600;1,400&display=swap"
          rel="stylesheet"
        />
      </Head>
      <body>
        <Layout
          navbar={navbar}
          footer={footer}
          pageMap={await getPageMap()}
          docsRepositoryBase="https://github.com/MetalLegBob/drfraudsworth/tree/main/docs-site/content"
          sidebar={{ defaultMenuCollapseLevel: 1 }}
          darkMode={false}
          nextThemes={{ defaultTheme: 'light', forcedTheme: 'light' }}
        >
          {children}
        </Layout>
      </body>
    </html>
  )
}
