'use client';

/**
 * ModalCloseButton -- Brass valve close button with rotation animation.
 *
 * Uses ExitButton.png asset (64x64 source, 32x32 rendered = 2x retina).
 * Hover: clockwise valve rotation + brass glow (CSS in globals.css).
 * Active/click: quick snap rotation.
 * Hidden on mobile (CSS breakpoint); mobile uses back arrow instead.
 */

interface ModalCloseButtonProps {
  onClick: () => void;
}

export function ModalCloseButton({ onClick }: ModalCloseButtonProps) {
  return (
    <button
      type="button"
      className="modal-close-btn"
      onClick={onClick}
      aria-label="Close"
    >
      <img
        src="/buttons/exit-button.png"
        alt=""
        width={32}
        height={32}
        draggable={false}
      />
    </button>
  );
}
