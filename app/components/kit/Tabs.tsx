"use client";

import { createContext, useContext } from "react";

// =============================================================================
// Tabs -- Lever-style compound tabbed interface
//
// Formalizes the existing .lever-tab pattern (globals.css) into typed React
// components. Compound component pattern (Tabs > TabList + Tab + TabPanel)
// gives consumers maximum layout flexibility while keeping state management
// internal via React Context.
//
// The active tab is controlled by the parent (value + onChange props) so this
// component works seamlessly with React state, URL params, or form state.
//
// Existing .lever-tab class in globals.css is NOT modified or replaced.
// Kit Tabs is the new formal path. Phases 62-65 will migrate components.
//
// Accessibility:
//   - TabList: role="tablist"
//   - Tab: role="tab", aria-selected, data-state="active"/"inactive"
//   - TabPanel: role="tabpanel"
// =============================================================================

// -- Context ------------------------------------------------------------------

interface TabsContextValue {
  /** Currently active tab value */
  value: string;
  /** Callback to change the active tab */
  onChange: (value: string) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) {
    throw new Error(
      "Tabs compound components (TabList, Tab, TabPanel) must be used within a <Tabs> provider.",
    );
  }
  return ctx;
}

// -- Tabs (root provider) -----------------------------------------------------

interface TabsProps {
  /** Currently active tab value (controlled) */
  value: string;
  /** Callback when active tab changes */
  onChange: (value: string) => void;
  children: React.ReactNode;
  className?: string;
}

function Tabs({ value, onChange, children, className }: TabsProps) {
  return (
    <TabsContext.Provider value={{ value, onChange }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

// -- TabList ------------------------------------------------------------------

interface TabListProps {
  children: React.ReactNode;
  className?: string;
}

function TabList({ children, className }: TabListProps) {
  const classes = ["kit-tab-list", className].filter(Boolean).join(" ");
  return (
    <div role="tablist" className={classes}>
      {children}
    </div>
  );
}

// -- Tab ----------------------------------------------------------------------

interface TabProps {
  /** Unique value identifying this tab (matched against Tabs.value) */
  value: string;
  children: React.ReactNode;
  disabled?: boolean;
  className?: string;
}

function Tab({ value, children, disabled = false, className }: TabProps) {
  const ctx = useTabsContext();
  const isActive = ctx.value === value;

  const classes = [
    "kit-tab",
    "kit-interactive",
    "kit-focus",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      role="tab"
      type="button"
      aria-selected={isActive}
      data-state={isActive ? "active" : "inactive"}
      disabled={disabled}
      className={classes}
      onClick={() => {
        if (!disabled) ctx.onChange(value);
      }}
    >
      {children}
    </button>
  );
}

// -- TabPanel -----------------------------------------------------------------

interface TabPanelProps {
  /** Show this panel when Tabs value matches */
  value: string;
  children: React.ReactNode;
  className?: string;
}

function TabPanel({ value, children, className }: TabPanelProps) {
  const ctx = useTabsContext();
  if (ctx.value !== value) return null;
  return (
    <div role="tabpanel" className={className}>
      {children}
    </div>
  );
}

// -- Exports ------------------------------------------------------------------

export { Tabs, TabList, Tab, TabPanel };
export type { TabsProps, TabListProps, TabProps, TabPanelProps };
