# Dr. Fraudsworth's Finance Factory — Branding Guide

> For community builders, dashboards, and third-party integrations.

---

## 1. Brand Identity

**Project Name:** Dr. Fraudsworth's Finance Factory
**Aesthetic:** Steampunk / Industrial Finance
**Mood:** Bioshock Infinite gentlemen's workshop meets Da Vinci notebook — warm polished brass, amber, rich mahogany.

---

## 2. Color Palette

### 2.1 Core Dark Theme

| Role | Hex | RGB | Usage |
|------|-----|-----|-------|
| Background | `#1c120a` | 28, 18, 10 | Page background |
| Surface | `#2c1e12` | 44, 30, 18 | Cards, panels |
| Surface Elevated | `#3d2b1a` | 61, 43, 26 | Hover states, raised elements |
| Primary (Copper) | `#c89060` | 200, 144, 96 | Metal accent |
| Secondary (Dark Gold) | `#9a7420` | 154, 116, 32 | Secondary accent |
| Accent (Polished Brass) | `#daa520` | 218, 165, 32 | CTAs, highlights, active states |
| Glow (Bright Brass) | `#f0c050` | 240, 192, 80 | Hover glow, decorative accents |

### 2.2 Borders

| Role | Hex | Usage |
|------|-----|-------|
| Border | `#86644a` | Standard UI borders |
| Border Subtle | `#4a3520` | Dividers, grid lines |

### 2.3 Text (Light on Dark)

| Role | Hex | Usage |
|------|-----|-------|
| Text Primary | `#ecdcc4` | Body text |
| Text Secondary | `#bca88a` | Labels, descriptions |
| Text Muted | `#8a7a62` | Disabled, tertiary |

### 2.4 Status Colors

| Role | Hex | Usage |
|------|-----|-------|
| Success | `#5da84a` | Positive states, green candles |
| Error | `#c04030` | Errors, red candles |
| Warning | `#d4982a` | Caution, pending |

### 2.5 Token Faction Colors

| Token | Hex | RGB |
|-------|-----|-----|
| **CRIME** | `#e86050` | 232, 96, 80 |
| **FRAUD** | `#d4a030` | 212, 160, 48 |
| **PROFIT** | `#50b848` | 80, 184, 72 |

These are the canonical faction brand colors. CRIME = danger red, FRAUD = caution gold, PROFIT = success green.

### 2.6 Parchment Frame System (Light Surfaces)

Used for modals, documentation panels, and "blueprint" style content areas.

| Role | Hex | Usage |
|------|-----|-------|
| Parchment | `#f5e6c8` | Light frame background |
| Parchment Dark | `#e8d5a8` | Gradient shadow in frames |
| Ink | `#2a1f0e` | Dark text on parchment |
| Ink Secondary | `#5a4830` | Secondary text on parchment |
| Brass (Frame) | `#c4956a` | Frame borders |
| Brass Highlight | `#f0c050` | Bright accents in frames |
| Brass Shadow | `#5a4510` | Dark brass shadow |

---

## 3. Typography

### 3.1 Heading Font — Cinzel

- **Font:** Cinzel (variable, 400–900 weight)
- **Style:** Roman inscriptional serif
- **Use:** All headings, titles, display text
- **Why:** Evokes engraved brass nameplates and machinery labels
- **Source:** Google Fonts / self-hosted WOFF2

### 3.2 Data Font — IBM Plex Mono

- **Font:** IBM Plex Mono (400, 500, 700)
- **Style:** Monospace with tabular numerals
- **Use:** Prices, balances, percentages, data displays
- **Why:** Industrial IBM heritage matches steampunk instrument readouts
- **Source:** Google Fonts / self-hosted WOFF2

### 3.3 Body — System Sans-Serif

- Default system font stack for UI copy, labels, body text

### 3.4 Type Scale

| Token | Size | Use |
|-------|------|-----|
| Display | 3rem (48px) | Hero titles |
| Heading | 2rem (32px) | Section headings |
| Subheading | 1.25rem (20px) | Card headers |
| Body | 1rem (16px) | Standard text |
| Detail | 0.875rem (14px) | Labels, descriptions |
| Micro | 0.75rem (12px) | Small labels, breadcrumbs |

---

## 4. Gradients

### 4.1 Parchment Background

```css
linear-gradient(135deg, #f5e6c8 0%, #e8d5a8 50%, #f0dbb8 100%)
```

### 4.2 Primary Button (Brass Bevel)

```css
linear-gradient(145deg, #f0c050 0%, #daa520 50%, #c4956a 100%)
```

### 4.3 Secondary Button (Dark Bevel)

```css
linear-gradient(145deg, #3d2b1a 0%, #2c1e12 100%)
```

### 4.4 Tab Active (Sunken)

```css
linear-gradient(180deg, #3d2b1a 0%, #2c1e12 100%)
```

---

## 5. Shadows & Depth

### Hover Glow

```css
0 0 12px rgba(240, 192, 80, 0.3)
```

### Modal Frame (Multi-layer)

```css
0 0 0 6px #3d2b1a,        /* Inner metal ring */
0 0 0 8px #daa520,         /* Brass border ring */
0 0 40px rgba(240, 192, 80, 0.15),  /* Ambient glow */
0 16px 48px rgba(0, 0, 0, 0.5)      /* Drop shadow */
```

### Button Bevel (Primary/Secondary)

```css
/* Default */
inset 0 1px 2px rgba(255, 255, 255, 0.3),
inset 0 -1px 2px rgba(0, 0, 0, 0.2),
0 2px 4px rgba(0, 0, 0, 0.3)

/* Pressed */
inset 0 -1px 2px rgba(255, 255, 255, 0.2),
inset 0 1px 3px rgba(0, 0, 0, 0.4),
0 1px 2px rgba(0, 0, 0, 0.2)
```

### Backdrop

```css
background-color: rgba(0, 0, 0, 0.4);
backdrop-filter: blur(6px);
```

---

## 6. Chart Styling

For candlestick/trading charts (we use `lightweight-charts`):

| Element | Color |
|---------|-------|
| Chart background | `#1c120a` |
| Grid lines | `#4a3520` |
| Axis text | `#bca88a` |
| Scale border | `#86644a` |
| Crosshair | `#86644a` |
| Up candle | `#5da84a` |
| Down candle | `#c04030` |
| Volume up | `rgba(93, 168, 74, 0.35)` |
| Volume down | `rgba(192, 64, 48, 0.35)` |
| OHLC text | `#ecdcc4` |
| OHLC labels | `#daa520` |

---

## 7. Interactive Patterns

### Hover State

```
filter: brightness(1.1)
transform: translateY(-1px)
box-shadow: 0 0 12px rgba(240, 192, 80, 0.3)
transition: 250ms ease
```

### Active/Pressed State

```
filter: brightness(0.95)
transform: translateY(0)
transition: 200ms ease
```

### Disabled State

```
opacity: 0.4
filter: saturate(0.5)
cursor: not-allowed
```

### Timing Tokens

| Action | Duration | Easing |
|--------|----------|--------|
| Hover | 250ms | ease |
| Press | 200ms | ease |
| Toggle | 300ms | ease |

---

## 8. Border Radius

| Element | Radius |
|---------|--------|
| Buttons | 6px |
| Inputs | 6px |
| Cards/Modals (CSS) | 8px |
| Pills/Badges | 8–11px |
| Toggles/Knobs | 50% (circular) |
| Asset frames (9-slice) | 0 (border-image ignores radius) |

---

## 9. Z-Index Layers

| Layer | Z-Index |
|-------|---------|
| Background | 0 |
| Overlays | 10 |
| Hover elements | 20 |
| Tooltips | 30 |
| Modal backdrop | 40 |
| Modal | 50 |
| Spinner | 60 |

---

## 10. Key Animations

| Animation | Duration | Description |
|-----------|----------|-------------|
| `fade-in` | 0.6s ease-out | Opacity + slight translateY entrance |
| `gear-spin` | 3s linear | Continuous 360deg rotation |
| `pulse-glow` | 2s ease-in-out infinite | Brightness oscillation (1.0 to 1.3) |
| `iris-open` | 280ms cubic-bezier(0.22, 1, 0.36, 1) | Modal reveal (expanding circle) |

All animations respect `prefers-reduced-motion: reduce` (disabled entirely).

---

## 11. Logo & Key Assets

| Asset | Path | Format |
|-------|------|--------|
| Logo icon | `/public/logo-icon.png` | PNG |
| Factory background | `/public/scene/background/factory-bg-*.webp` | WebP (1920/2560/3840) |
| Riveted paper frame | `/public/frames/riveted-paper.png` | PNG (9-slice border image) |
| Big Red Button | `/public/buttons/big-red-button-*.png` | PNG (center + border) |
| Gear wheel (splash) | `/public/splash/wheel.png` | PNG |

### Scene Overlays (Modal Backgrounds)

| Overlay | Path |
|---------|------|
| Swap Station | `/public/scene/overlays/swap-station.webp` |
| Rewards Vat | `/public/scene/overlays/rewards-vat.webp` |
| Carnage Cauldron | `/public/scene/overlays/carnage-cauldron.webp` |
| Connect Wallet | `/public/scene/overlays/connect-wallet.webp` |
| Documentation | `/public/scene/overlays/documentation-table.webp` |

---

## 12. Accessibility Notes

All color pairs meet **WCAG 2.2 Level AA** contrast requirements:

- Text on background: 13.68:1 (exceeds 4.5:1)
- Text secondary on background: 7.99:1 (exceeds 4.5:1)
- CRIME on surface: 4.78:1
- FRAUD on surface: 6.82:1
- PROFIT on surface: 6.37:1
- Ink on parchment: ~14:1

---

## 13. Token Addresses (Mainnet)

| Token | Mint Address |
|-------|-------------|
| CRIME | `cRiMEhAxoDhcEuh3Yf7Z2QkXUXUMKbakhcVqmDsqPXc` |
| FRAUD | `FraUdp6YhtVJYPxC2w255yAbpTsPqd8Bfhy9rC56jau5` |
| PROFIT | `pRoFiTj36haRD5sG2Neqib9KoSrtdYMGrM7SEkZetfR` |

Explorer: [Solscan](https://solscan.io)

---

## 14. Quick Reference — CSS Custom Properties

If building with CSS, these are the variable names used throughout the protocol's UI:

```
--color-factory-bg          --color-factory-surface
--color-factory-surface-elevated
--color-factory-border      --color-factory-border-subtle
--color-factory-primary     --color-factory-secondary
--color-factory-accent      --color-factory-glow
--color-factory-text        --color-factory-text-secondary
--color-factory-text-muted
--color-factory-success     --color-factory-error
--color-factory-warning
--color-factory-crime       --color-factory-fraud
--color-factory-profit
--color-frame-parchment     --color-frame-parchment-dark
--color-frame-ink           --color-frame-ink-secondary
--color-frame-brass         --color-frame-brass-highlight
--color-frame-brass-shadow
```

---

*Generated from the Dr. Fraudsworth codebase. For questions, reach out to the team.*
