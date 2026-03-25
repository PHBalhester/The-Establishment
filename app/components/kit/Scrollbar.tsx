/**
 * Scrollbar -- Themed scroll container applying the .kit-scrollbar CSS class.
 *
 * A simple wrapper that applies the kit scrollbar styling (thin brass-toned
 * scrollbar on dark factory surface) plus `overflow-y: auto` to its children
 * container. The `.kit-scrollbar` CSS class is defined in kit.css (Phase 60-02)
 * and uses standard `scrollbar-width`/`scrollbar-color` with webkit fallbacks.
 *
 * Why a component instead of just using the CSS class directly?
 * Consistency and discoverability: downstream phases can import from the kit
 * barrel export and see all available primitives. The component also bundles
 * the overflow-y behavior, preventing the common mistake of adding the
 * scrollbar class without setting overflow.
 *
 * @example
 * ```tsx
 * <Scrollbar className="max-h-64">
 *   <ul>
 *     {items.map(item => <li key={item.id}>{item.name}</li>)}
 *   </ul>
 * </Scrollbar>
 * ```
 */

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface ScrollbarProps {
  /** Content to display inside the scrollable container */
  children: React.ReactNode;
  /** Additional CSS classes (use for max-height constraints) */
  className?: string;
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

export function Scrollbar({ children, className }: ScrollbarProps) {
  const classes = ["kit-scrollbar", className].filter(Boolean).join(" ");

  return (
    <div className={classes} style={{ overflowY: "auto" }}>
      {children}
    </div>
  );
}
