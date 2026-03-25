'use client';

/**
 * StakingStation -- Thin wrapper that re-parents StakingForm into the modal context.
 *
 * StakingForm is a self-contained hook consumer: it calls useStaking() internally
 * and manages its own tabs (Stake/Unstake/Claim), form state, and transaction
 * execution. It also renders StakingStats above the tab card with reward rate,
 * pending rewards, staked balance, and protocol totals.
 *
 * Unlike CarnageStation (which calls hooks and passes props), this wrapper simply
 * renders StakingForm directly -- no orchestration needed.
 *
 * Auto-refresh: useStaking hook mounts when the modal opens (React.lazy), unmounts
 * when it closes. Fresh data on every open per the modal lifecycle pattern.
 *
 * Default export required for React.lazy in ModalContent.tsx.
 */

import { StakingForm } from '@/components/staking/StakingForm';

export default function StakingStation() {
  return <StakingForm />;
}
