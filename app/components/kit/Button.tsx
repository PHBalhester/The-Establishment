import { forwardRef } from "react";

// =============================================================================
// Button -- Brass-themed interactive button with variant + size API
//
// Formalizes the existing .brass-button pattern (globals.css) into a typed React
// component. Three variants map to the three button styles used across the app:
//
//   primary:   Brass gradient -- for primary CTAs (Connect Wallet, Stake, Confirm)
//   secondary: Dark bevel -- for secondary actions (Max, Custom, Copy Address)
//   ghost:     Transparent -- for inline/text-like actions (toggle, close, cancel)
//
// The existing .brass-button class in globals.css is NOT modified or replaced.
// Kit Button is a new parallel path. Phases 62-65 will migrate components to
// use kit Button, and .brass-button will be removed after all migrations.
//
// Uses .kit-interactive (kit.css) for shared hover glow, press feedback, and
// disabled appearance. Uses .kit-focus for keyboard focus-visible glow.
// =============================================================================

type ButtonVariant = "primary" | "secondary" | "ghost";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual variant: primary (brass), secondary (dark bevel), ghost (transparent) */
  variant?: ButtonVariant;
  /** Size: sm (compact), md (default), lg (prominent) */
  size?: ButtonSize;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "secondary", size = "md", className, ...props }, ref) => {
    const classes = [
      "kit-button",
      `kit-button-${variant}`,
      `kit-button-${size}`,
      "kit-interactive",
      "kit-focus",
      className,
    ]
      .filter(Boolean)
      .join(" ");

    return <button ref={ref} className={classes} {...props} />;
  },
);

Button.displayName = "Button";

export { Button };
export type { ButtonProps, ButtonVariant, ButtonSize };
