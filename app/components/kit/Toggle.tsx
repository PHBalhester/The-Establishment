"use client";

/**
 * Toggle -- Brass knob switch with mechanical slide animation.
 *
 * Renders a `<button>` with `role="switch"` and `aria-pressed` for full
 * screen reader and keyboard support. The visual is a horizontal track
 * (40px x 22px) with a circular brass knob (18px) that slides left/right
 * using CSS `translateX`, giving a weighted mechanical feel via the
 * `--duration-kit-toggle` (300ms) timing token.
 *
 * Why button instead of input[checkbox]?
 * A checkbox needs CSS hacks (appearance:none + :checked pseudo-class) and
 * a hidden input for form submission. Since our toggles are controlled React
 * state (no HTML form submission), a button with ARIA switch role gives us
 * the same accessibility guarantees with simpler, more predictable markup.
 *
 * Track colors:
 *   off = var(--color-toggle-off-track) -- dark mahogany (#3d2b1a)
 *   on  = var(--color-toggle-on-track)  -- factory success green (#5da84a)
 *
 * Knob: Brass gradient matching the close-button pattern, with bevel shadow
 * for the raised metal feel.
 *
 * @example
 * ```tsx
 * const [enabled, setEnabled] = useState(false);
 * <Toggle checked={enabled} onChange={setEnabled} label="Auto-compound" />
 * ```
 */

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface ToggleProps {
  /** Current on/off state */
  checked: boolean;
  /** Callback when state changes */
  onChange: (checked: boolean) => void;
  /** Optional label text displayed next to the toggle */
  label?: string;
  /** Disables the toggle (dims, not-allowed cursor via .kit-interactive) */
  disabled?: boolean;
  /** Additional CSS classes on the wrapper element */
  className?: string;
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

export function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
  className,
}: ToggleProps) {
  const wrapperClasses = ["kit-toggle-wrapper", className]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={wrapperClasses}>
      <button
        type="button"
        role="switch"
        aria-pressed={checked}
        aria-label={label}
        disabled={disabled}
        className="kit-toggle kit-interactive kit-focus"
        onClick={() => {
          if (!disabled) onChange(!checked);
        }}
      >
        <span className="kit-toggle-knob" />
      </button>
      {label && (
        <span className="kit-toggle-label">{label}</span>
      )}
    </div>
  );
}
