'use client';

/**
 * useModal -- Hook for opening and closing factory station modals.
 *
 * Thin wrapper around ModalContext that provides a clean API for any
 * component in the tree to open a station modal (with iris animation
 * origin) or close the current modal.
 *
 * Throws if used outside a ModalProvider -- this is intentional developer
 * safety to catch missing providers early during development.
 *
 * Usage:
 *   const { state, openModal, closeModal } = useModal();
 *   openModal('swap', { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
 */

import { useContext } from 'react';
import { ModalContext } from '@/components/modal/ModalProvider';
import type { ModalContextValue } from '@/components/modal/ModalProvider';

export function useModal(): ModalContextValue {
  const context = useContext(ModalContext);
  if (!context) {
    throw new Error(
      'useModal must be used within a ModalProvider. ' +
      'Wrap your component tree with <ModalProvider> in providers.tsx.',
    );
  }
  return context;
}
