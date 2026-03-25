/**
 * Divider -- Decorative horizontal rule with steampunk styling.
 *
 * Three CSS-only variants for visual hierarchy within framed content:
 *
 * 1. **simple** -- Thin horizontal line in brass color with a subtle gradient
 *    fade at both ends. For lightweight section separation.
 *
 * 2. **ornate** -- Thicker rule with decorative scrollwork dots at center and
 *    endpoints using ::before and ::after pseudo-elements. For prominent section
 *    breaks in formal contexts (modal headers, card separators).
 *
 * 3. **riveted** -- Rule with small circular pseudo-element dots at regular
 *    intervals simulating brass rivets. Matches the riveted-paper frame
 *    aesthetic for visual consistency.
 *
 * All variants are purely decorative: `role="separator"` for semantic meaning,
 * `aria-hidden="true"` so screen readers skip the visual embellishment.
 *
 * @example
 * ```tsx
 * <Divider />                    // simple (default)
 * <Divider variant="ornate" />   // scrollwork dots
 * <Divider variant="riveted" />  // rivet dots
 * ```
 */

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface DividerProps {
  /**
   * Visual variant:
   * - `'simple'`  -- thin gradient line
   * - `'ornate'`  -- thick line with scrollwork dots
   * - `'riveted'` -- line with rivet dots
   *
   * @default 'simple'
   */
  variant?: 'simple' | 'ornate' | 'riveted';

  /** Additional CSS classes. */
  className?: string;
}

/* -------------------------------------------------------------------------- */
/*  Variant CSS class map                                                      */
/* -------------------------------------------------------------------------- */

const VARIANT_CLASS: Record<NonNullable<DividerProps['variant']>, string> = {
  simple: 'kit-divider-simple',
  ornate: 'kit-divider-ornate',
  riveted: 'kit-divider-riveted',
};

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

export function Divider({ variant = 'simple', className }: DividerProps) {
  const classes = ['kit-divider', VARIANT_CLASS[variant], className]
    .filter(Boolean)
    .join(' ');

  return (
    <hr
      className={classes}
      role="separator"
      aria-hidden="true"
    />
  );
}
