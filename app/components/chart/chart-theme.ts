/**
 * Chart Theme Constants -- Centralized color values for lightweight-charts
 *
 * Canvas-based rendering (lightweight-charts) cannot read CSS custom properties
 * at runtime, so hex values must be hardcoded. This module centralizes all chart
 * colors in one place to prevent drift between the chart and the rest of the UI.
 *
 * Each value has a comment mapping to its CSS token name from globals.css @theme.
 *
 * IMPORTANT: This file has NO lightweight-charts imports and NO 'use client'
 * directive. It is pure data, safe for import from any context (server or client).
 */

// =============================================================================
// Layout & Structure
// =============================================================================

/** Chart layout colors matching --color-factory-* tokens */
export const FACTORY_CHART_THEME = {
  // Layout
  background: '#1c120a',        // --color-factory-bg
  textColor: '#bca88a',         // --color-factory-text-secondary
  fontSize: 11,

  // Grid
  gridVertColor: '#4a3520',     // --color-factory-border-subtle
  gridHorzColor: '#4a3520',     // --color-factory-border-subtle

  // Scale borders
  scaleBorderColor: '#86644a',  // --color-factory-border

  // Crosshair
  crosshairColor: '#86644a',   // --color-factory-border
  crosshairLabelBg: '#2c1e12', // --color-factory-surface
} as const;

// =============================================================================
// Candle Colors
// =============================================================================

/** Candlestick up/down colors matching factory-success/error tokens */
export const FACTORY_CANDLE_COLORS = {
  upColor: '#5da84a',           // --color-factory-success
  downColor: '#c04030',         // --color-factory-error
  borderUpColor: '#5da84a',     // --color-factory-success
  borderDownColor: '#c04030',   // --color-factory-error
  wickUpColor: '#5da84a',       // --color-factory-success
  wickDownColor: '#c04030',     // --color-factory-error
} as const;

// =============================================================================
// Volume Colors
// =============================================================================

/** Volume histogram colors (semi-transparent to not obscure candle wicks) */
export const FACTORY_VOLUME_COLORS = {
  up: 'rgba(93, 168, 74, 0.35)',   // --color-factory-success @ 35% opacity
  down: 'rgba(192, 64, 48, 0.35)', // --color-factory-error @ 35% opacity
} as const;

// =============================================================================
// Legend Colors
// =============================================================================

/** OHLC legend overlay colors for the brass-gauge readout */
export const FACTORY_LEGEND_COLORS = {
  text: '#ecdcc4',                       // --color-factory-text
  label: '#daa520',                      // --color-factory-accent
  bg: 'rgba(28, 18, 10, 0.85)',          // --color-factory-bg with opacity
} as const;
