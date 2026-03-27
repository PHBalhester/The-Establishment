---
status: resolved
trigger: "chart-header-stale-on-token-switch"
created: 2026-03-25T00:00:00Z
updated: 2026-03-25T00:00:00Z
---

## Current Focus

hypothesis: CONFIRMED - legendData/legendVolume/prevClose state only updated inside crosshairHandler, never on candles prop change
test: Verified by reading CandlestickChart.tsx - data sync effect (line 306) updates series but not legend state
expecting: N/A - confirmed
next_action: Apply fix - update legend state in the candles data sync effect

## Symptoms

expected: Switching between Crime/Fraud charts should update the OHLCV header numbers to reflect the latest candle of the selected token
actual: Header numbers remain unchanged when switching tokens - they only change on candle hover
errors: No errors reported
reproduction: Switch between Crime and Fraud chart tabs and observe the O/H/L/C/V header row
started: Unknown

## Eliminated

## Evidence

- timestamp: 2026-03-25T00:01:00Z
  checked: CandlestickChart.tsx legend state flow
  found: legendData/legendVolume/prevClose are React state (lines 122-131) only set inside crosshairHandler (lines 171-226). The candles data sync effect (lines 306-353) updates chart series but never touches legend state. On token switch, new candles arrive, series updates, but legend keeps showing old values.
  implication: Root cause confirmed - legend state is never synced on data change, only on crosshair interaction.

## Resolution

root_cause: legendData, legendVolume, and prevClose state in CandlestickChart.tsx are only updated by the crosshairHandler (subscribeCrosshairMove). When the candles prop changes (token switch), the data sync effect updates the chart series data but does not update the legend state to reflect the new token's latest candle. The legend stays stale until a hover event fires.
fix: Add legend state updates at the end of the candles data sync effect (useEffect on [candles]) to set legendData, legendVolume, and prevClose from the latest candle in the new data.
verification: Added setLegendData/setLegendVolume/setPrevClose calls at end of candles data sync effect. Now when candles prop changes (token switch), legend immediately reflects the latest candle of the new dataset. Crosshair handler continues to work for hover updates. No type errors introduced.
files_changed: [app/components/chart/CandlestickChart.tsx]
