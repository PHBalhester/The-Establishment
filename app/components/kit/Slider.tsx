"use client";

import { useId } from "react";

/**
 * Slider -- Range input with brass knob and steampunk track styling.
 *
 * Wraps a native `<input type="range">` for maximum accessibility: arrow key
 * navigation, screen reader value announcements, and focus management all
 * come free from the browser. Custom styling is applied via CSS `appearance:none`
 * + pseudo-element selectors for the track and thumb (WebKit and Firefox).
 *
 * Why native input[range] instead of a custom div?
 * Custom sliders (div + drag handlers) require manually implementing:
 *   - Keyboard navigation (left/right/home/end arrows)
 *   - ARIA slider role + aria-valuenow/min/max/text
 *   - Touch event normalization
 *   - Snap-to-step calculations
 * A native input gives us all of these for free with zero bundle cost.
 *
 * Track: dark mahogany recessed channel (--color-slider-track)
 * Thumb: brass gradient knob (--color-slider-knob) with bevel shadow
 *
 * @example
 * ```tsx
 * const [slippage, setSlippage] = useState(50);
 * <Slider
 *   value={slippage}
 *   onChange={setSlippage}
 *   min={0}
 *   max={100}
 *   label="Slippage"
 *   suffix="BPS"
 *   showValue
 * />
 * ```
 */

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface SliderProps {
  /** Current numeric value */
  value: number;
  /** Callback when value changes */
  onChange: (value: number) => void;
  /** Minimum value (default: 0) */
  min?: number;
  /** Maximum value (default: 100) */
  max?: number;
  /** Step increment (default: 1) */
  step?: number;
  /** Optional label displayed above the slider */
  label?: string;
  /** Show the current value to the right of the label */
  showValue?: boolean;
  /** Custom value display formatter (default: String(v)) */
  formatValue?: (value: number) => string;
  /** Disables the slider */
  disabled?: boolean;
  /** Additional CSS classes on the wrapper element */
  className?: string;
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

export function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  label,
  showValue = false,
  formatValue = String,
  disabled = false,
  className,
}: SliderProps) {
  const generatedId = useId();
  const sliderId = `slider-${generatedId}`;

  const wrapperClasses = ["kit-slider-wrapper", className]
    .filter(Boolean)
    .join(" ");

  const hasHeader = label || showValue;

  return (
    <div className={wrapperClasses}>
      {hasHeader && (
        <div className="kit-slider-header">
          {label && (
            <label htmlFor={sliderId} className="kit-input-label">
              {label}
            </label>
          )}
          {showValue && (
            <span className="kit-slider-value">{formatValue(value)}</span>
          )}
        </div>
      )}
      <input
        id={sliderId}
        type="range"
        role="slider"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        className="kit-slider kit-focus"
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
