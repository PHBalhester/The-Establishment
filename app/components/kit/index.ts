// =============================================================================
// Dr. Fraudsworth's Steampunk Component Kit -- Barrel Export
// Phase 60: Design Tokens + Component Kit
//
// Usage: import { Frame, Button, Input, ... } from '@/components/kit'
//
// 8 primitives + 1 utility:
//   Frame      -- Dual-mode container (CSS rounded or asset-based 9-slice)
//   Button     -- Brass-themed interactive button (primary/secondary/ghost)
//   Input      -- Themed input with recessed gauge styling
//   Tabs       -- Compound tabbed interface (Tabs > TabList + Tab + TabPanel)
//   Toggle     -- On/off switch with brass knob slide animation
//   Slider     -- Range input with brass knob and track
//   Card       -- Framed content container with optional header
//   Divider    -- Decorative horizontal rule (simple/ornate/riveted)
//   Scrollbar  -- Themed scroll container applying .kit-scrollbar CSS
// =============================================================================

// -- Components ---------------------------------------------------------------

export { Frame } from './Frame';
export { Button } from './Button';
export { Input } from './Input';
export { Tabs, TabList, Tab, TabPanel } from './Tabs';
export { Toggle } from './Toggle';
export { Slider } from './Slider';
export { Card } from './Card';
export { Divider } from './Divider';
export { Scrollbar } from './Scrollbar';

// -- Types --------------------------------------------------------------------

export type { FrameProps } from './Frame';
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button';
export type { InputProps } from './Input';
export type { TabsProps, TabListProps, TabProps, TabPanelProps } from './Tabs';
export type { ToggleProps } from './Toggle';
export type { SliderProps } from './Slider';
export type { CardProps } from './Card';
export type { DividerProps } from './Divider';
export type { ScrollbarProps } from './Scrollbar';
