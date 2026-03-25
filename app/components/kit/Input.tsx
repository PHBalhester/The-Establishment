import { forwardRef, useId } from "react";

// =============================================================================
// Input -- Themed input with recessed gauge styling
//
// Formalizes the existing .brass-input pattern (globals.css) into a typed React
// component. Two variants:
//
//   default: Recessed gauge look -- bordered, inset shadow, brass glow on focus.
//            Used for amount inputs (swap, stake), custom slippage, etc.
//   flush:   Minimal inline variant -- no border, transparent background, subtle
//            bottom border only. For inline editing or compact forms.
//
// Supports optional label (above), suffix (inside right), and error (below).
// The existing .brass-input class in globals.css is NOT modified or replaced.
//
// Uses forwardRef so parent components can focus the input programmatically
// (e.g., auto-focus on modal open, or focus after validation error).
// =============================================================================

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Visual variant: default (recessed gauge) or flush (minimal inline) */
  variant?: "default" | "flush";
  /** Optional label displayed above input */
  label?: string;
  /** Optional error message displayed below input */
  error?: string;
  /** Optional unit suffix (e.g., "SOL", "BPS") displayed inside input right side */
  suffix?: string;
  /** Additional class names for the outer wrapper div */
  wrapperClassName?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      variant = "default",
      label,
      error,
      suffix,
      wrapperClassName,
      className,
      id: externalId,
      ...props
    },
    ref,
  ) => {
    // Generate stable ID for label-input association if none provided
    const generatedId = useId();
    const inputId = externalId ?? generatedId;

    const inputClasses = [
      "kit-input",
      variant === "flush" ? "kit-input-flush" : "",
      "kit-focus",
      className,
    ]
      .filter(Boolean)
      .join(" ");

    const wrapperClasses = ["kit-input-wrapper", wrapperClassName]
      .filter(Boolean)
      .join(" ");

    return (
      <div className={wrapperClasses}>
        {label && (
          <label htmlFor={inputId} className="kit-input-label">
            {label}
          </label>
        )}
        <div className="kit-input-field">
          <input
            ref={ref}
            id={inputId}
            className={inputClasses}
            aria-invalid={error ? "true" : undefined}
            aria-describedby={error ? `${inputId}-error` : undefined}
            {...props}
          />
          {suffix && <span className="kit-input-suffix">{suffix}</span>}
        </div>
        {error && (
          <p id={`${inputId}-error`} className="kit-input-error" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  },
);

Input.displayName = "Input";

export { Input };
export type { InputProps };
