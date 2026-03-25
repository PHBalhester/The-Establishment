/**
 * Font definitions for Dr. Fraudsworth's Finance Factory.
 *
 * Uses next/font/local with self-hosted .woff2 files to avoid network
 * dependencies during Docker/Nixpacks builds (Railway can't reach
 * fonts.gstatic.com during build). Zero external requests, zero layout shift.
 *
 * Each font exports a CSS variable that gets applied to <html> in layout.tsx,
 * then bridged to Tailwind utilities via @theme inline in globals.css.
 *
 * Cinzel  -> --font-cinzel  -> font-heading utility
 * IBM Plex Mono -> --font-ibm-plex-mono -> font-mono utility
 */

import localFont from "next/font/local";

/**
 * Cinzel: Roman inscriptional display serif.
 *
 * Why Cinzel: Its inscriptional letterforms evoke engraved brass nameplates
 * and machinery labels -- perfect for the steampunk factory aesthetic. Designed
 * for all-caps display contexts (headings, titles, modal headers).
 *
 * Variable font (400-900) means a single font file covers all weights,
 * keeping the download small while providing full weight flexibility.
 *
 * Usage: className="font-heading text-heading font-bold"
 */
export const cinzel = localFont({
  src: "./fonts/cinzel-variable.woff2",
  display: "swap",
  variable: "--font-cinzel",
  weight: "400 900",
});

/**
 * IBM Plex Mono: Industrial monospace with tabular numerals.
 *
 * Why IBM Plex Mono: Its IBM industrial heritage aligns with the steampunk
 * instrument-readout aesthetic. Built-in tabular numerals ensure perfect column
 * alignment for prices, balances, and percentages. Multiple weights allow
 * visual hierarchy within data displays (bold totals vs regular values).
 *
 * NOT a variable font -- we specify exact weights to minimize download size:
 * - 400: regular data values
 * - 500: medium emphasis (labels, headers within data)
 * - 700: bold totals, highlighted values
 *
 * Usage: className="font-mono tabular-nums"
 */
export const ibmPlexMono = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-mono-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-mono-700.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  variable: "--font-ibm-plex-mono",
});
