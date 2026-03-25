/**
 * scene-data.ts -- Centralized station metadata for the factory scene.
 *
 * Maps overlay image keys (kebab-case from SCENE_DATA in image-data.ts) to
 * ModalProvider StationId values and display labels.
 *
 * The STATIONS array is ordered by **tab priority** -- DOM render order
 * determines keyboard navigation sequence. No positive tabIndex values needed.
 *
 * When new stations are added or overlay assets change, only this file needs
 * updating -- component logic stays untouched.
 */

import type { StationId } from '@/components/modal/ModalProvider';

/** Metadata for a single factory station in the scene. */
export interface StationMeta {
  /** Key into SCENE_DATA.overlays (e.g., 'carnage-cauldron') */
  overlayId: string;
  /** StationId for useModal().openModal() */
  stationId: StationId;
  /** Tooltip label text */
  label: string;
}

/**
 * All 6 factory stations in tab-priority order.
 *
 * Tab order rationale:
 * 1. Connect Wallet -- primary action, first thing a new user needs
 * 2. Swap Machine -- core trading function
 * 3. Carnage Cauldron -- the signature game mechanic
 * 4. Rewards Vat -- staking/yield station
 * 5. Documentation Table -- reference material
 * 6. Settings -- least-used, last in tab order
 */
export const STATIONS: StationMeta[] = [
  {
    overlayId: 'connect-wallet',
    stationId: 'wallet',
    label: 'Connect',
  },
  {
    overlayId: 'swap-station',
    stationId: 'swap',
    label: 'Swap',
  },
  {
    overlayId: 'carnage-cauldron',
    stationId: 'carnage',
    label: 'Carnage',
  },
  {
    overlayId: 'rewards-vat',
    stationId: 'staking',
    label: 'Rewards',
  },
  {
    overlayId: 'documentation-table',
    stationId: 'docs',
    label: 'Whitepaper',
  },
  {
    overlayId: 'settings',
    stationId: 'settings',
    label: 'Settings',
  },
];
