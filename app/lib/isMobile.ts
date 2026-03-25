/**
 * isMobile -- Detect mobile browsers via user-agent string.
 *
 * Used to conditionally render deep-link wallet options in ConnectModal.
 * SSR-safe: returns false when window is undefined (server-side rendering).
 *
 * Checks for common mobile user-agent tokens:
 * - Android, iPhone, iPad, iPod (iOS/Android devices)
 * - "Mobile" suffix (catches mobile Chrome, Firefox, Edge on any device)
 * - webOS, BlackBerry, Opera Mini, Windows Phone (legacy/niche devices)
 */
export function isMobile(): boolean {
  if (typeof window === "undefined") return false;
  return /Android|iPhone|iPad|iPod|webOS|BlackBerry|Opera Mini|Windows Phone|Mobile/i.test(
    navigator.userAgent,
  );
}
