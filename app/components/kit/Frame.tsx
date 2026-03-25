import { forwardRef } from 'react';

/**
 * Frame -- Dual-mode container component for the steampunk component kit.
 *
 * Two rendering modes:
 *
 * 1. **CSS mode** (default): Uses border-radius, box-shadow, and parchment gradient
 *    background. Suitable for rounded elements like buttons, pills, tooltips, and
 *    cards. Mimics the established .modal-chrome pattern from Phase 54.
 *
 * 2. **Asset mode**: Uses CSS border-image with the riveted-paper.png 9-slice asset
 *    for rectangular steampunk frames. border-image ignores border-radius per CSS
 *    spec, so border-radius is explicitly 0 in this mode.
 *
 * Frames are passive containers -- they have NO active/pressed/hover states.
 * Interactive behavior belongs on child elements (buttons, tabs, links).
 *
 * The `.kit-frame` base class automatically applies dark ink text color
 * (var(--color-frame-ink)) for readability on parchment backgrounds, preventing
 * the light-on-light issue documented in RESEARCH.md Pitfall 6.
 *
 * @example
 * ```tsx
 * // CSS-only rounded frame (works without any image assets)
 * <Frame mode="css" padding="md">
 *   <p>Content on parchment background</p>
 * </Frame>
 *
 * // Asset-based rectangular steampunk frame
 * <Frame mode="asset" padding="lg">
 *   <p>Content inside riveted border</p>
 * </Frame>
 * ```
 */

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface FrameProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Rendering mode:
   * - `'css'`   -- border-radius + box-shadow (rounded elements)
   * - `'asset'` -- border-image 9-slice with riveted-paper.png (rectangular)
   *
   * @default 'css'
   */
  mode?: 'css' | 'asset';

  /**
   * Internal padding variant. Maps to CSS utility classes:
   * - `'none'` -- 0
   * - `'sm'`   -- 0.75rem
   * - `'md'`   -- 1.25rem
   * - `'lg'`   -- 2rem
   *
   * @default 'none'
   */
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

/* -------------------------------------------------------------------------- */
/*  Padding CSS class map                                                      */
/* -------------------------------------------------------------------------- */

const PAD_CLASS: Record<NonNullable<FrameProps['padding']>, string> = {
  none: '',
  sm: 'kit-frame-pad-sm',
  md: 'kit-frame-pad-md',
  lg: 'kit-frame-pad-lg',
};

/* -------------------------------------------------------------------------- */
/*  Mode CSS class map                                                         */
/* -------------------------------------------------------------------------- */

const MODE_CLASS: Record<NonNullable<FrameProps['mode']>, string> = {
  css: 'kit-frame-css',
  asset: 'kit-frame-asset',
};

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

export const Frame = forwardRef<HTMLDivElement, FrameProps>(function Frame(
  { mode = 'css', padding = 'none', className, children, ...rest },
  ref,
) {
  const classes = [
    'kit-frame',
    MODE_CLASS[mode],
    PAD_CLASS[padding],
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div ref={ref} className={classes} {...rest}>
      {children}
    </div>
  );
});
