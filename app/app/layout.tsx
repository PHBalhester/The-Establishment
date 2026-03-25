import React from "react";
import type { Metadata } from "next";
import Providers from "@/providers/providers";
import { cinzel, ibmPlexMono } from "./fonts";
import "./globals.css";

// Force all pages to render dynamically (no static prerendering at build time).
// Every page depends on client-side wallet state and live RPC data -- static
// prerendering would fail because Solana wallet-adapter libs expect a browser environment.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Dr. Fraudsworth",
  description:
    "Dr. Fraudsworths' Fantastical Finance Factory - the maniacal three token game where you can earn rewards!",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${cinzel.variable} ${ibmPlexMono.variable}`}>
      <body className="antialiased bg-factory-bg text-factory-text">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
