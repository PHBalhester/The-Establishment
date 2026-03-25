import { forwardRef } from 'react';
import { Frame } from './Frame';

/**
 * Card -- Framed content container with optional header.
 *
 * Card is a semantic wrapper around {@link Frame} that adds a structured layout:
 * an optional serif heading separated by a brass rule, and a body region for
 * arbitrary content. It encapsulates the "titled panel" pattern used throughout
 * the v1.1 modal system (portfolio summaries, staking details, swap routes).
 *
 * The `frame` prop passes through to Frame's `mode` prop, so Card inherits
 * the same dual-mode rendering (CSS rounded or asset-based 9-slice).
 *
 * Cards use medium padding by default -- enough breathing room for content
 * readability on parchment surfaces without wasting space in modal layouts.
 *
 * @example
 * ```tsx
 * // Simple card with header
 * <Card header="Portfolio Summary">
 *   <p>Total staked: 1,234 CRIME</p>
 * </Card>
 *
 * // Asset-framed card (riveted border)
 * <Card frame="asset" header="Epoch Rewards">
 *   <p>Current yield: 4.2%</p>
 * </Card>
 *
 * // Headerless card (just a framed content region)
 * <Card>
 *   <p>Some content in a parchment frame</p>
 * </Card>
 * ```
 */

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Frame rendering mode passed to the inner Frame component.
   * - `'css'`   -- border-radius + box-shadow (rounded)
   * - `'asset'` -- border-image 9-slice with riveted-paper.png
   *
   * @default 'css'
   */
  frame?: 'css' | 'asset';

  /**
   * Optional card header text. When provided, renders a serif heading above
   * the body content with a brass rule separator.
   */
  header?: string;
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { frame = 'css', header, className, children, ...rest },
  ref,
) {
  return (
    <Frame ref={ref} mode={frame} padding="md" className={className} {...rest}>
      {header && (
        <div className="kit-card-header">
          {header}
        </div>
      )}
      <div className="kit-card-body">
        {children}
      </div>
    </Frame>
  );
});
