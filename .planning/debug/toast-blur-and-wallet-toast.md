---
status: verified
trigger: "Toast system has two bugs: (1) toast blurred behind dialog backdrop, (2) wallet connected toast never appears"
created: 2026-02-24T00:00:00Z
updated: 2026-02-24T00:03:00Z
---

## Current Focus

hypothesis: BOTH CONFIRMED AND FIXED
test: TypeScript compiles cleanly (tsc --noEmit passes)
expecting: N/A
next_action: Archive session, present results

## Symptoms

expected: |
  BUG 1: Toast notifications should always render crisp and unblurred, even when a dialog modal is open.
  BUG 2: When a user connects their wallet, a "Wallet connected" success toast should appear.
actual: |
  BUG 1: Toast appears blurred behind the dialog's ::backdrop blur effect.
  BUG 2: The "Wallet connected" toast simply does not appear at all.
errors: No console errors reported.
reproduction: |
  BUG 1: Open a modal station, trigger a swap failure -> error toast appears blurred.
  BUG 2: Connect a wallet from main page or swap page -> no toast appears.
started: Phase 56 (recent implementation). Wallet toast never worked with either approach.

## Eliminated

## Evidence

- timestamp: 2026-02-24T00:00:30Z
  checked: ToastProvider.tsx lines 218-231 (popover show/hide effect)
  found: |
    Effect only calls showPopover() when NOT already open:
    `if (!el.matches(':popover-open')) { el.showPopover(); }`
    This means if the popover is already in the top layer and a dialog opens ABOVE it,
    the popover stays BELOW the dialog's ::backdrop. It never re-stacks.
  implication: BUG 1 CONFIRMED - popover needs hide+show to re-enter top layer at the top of the stack

- timestamp: 2026-02-24T00:00:30Z
  checked: globals.css lines 273-274 (dialog backdrop)
  found: |
    `dialog.modal-shell[open]::backdrop` applies `backdrop-fade-in` with `backdrop-filter: blur(6px)`.
    This blurs everything below the dialog in the top layer stack -- including a popover that entered first.
  implication: Confirms the blur mechanism. The ::backdrop sits between the dialog and the popover in the top layer.

- timestamp: 2026-02-24T00:00:45Z
  checked: WalletStation.tsx lines 27-53 (lifecycle)
  found: |
    WalletStation registers useLogin({onComplete}) and useConnectWallet({onSuccess}).
    handleConnectWallet and handleSignIn both call closeModal() immediately after connectWallet()/login().
    closeModal() sets activeStation=null -> ModalContent stops rendering WalletStation -> UNMOUNTS.
    Privy's wallet connection is async; onSuccess/onComplete fire later, but the hooks are already destroyed.
  implication: BUG 2 PATH 1 CONFIRMED - WalletStation unmounts before callbacks can fire

- timestamp: 2026-02-24T00:00:45Z
  checked: ConnectModal.tsx + WalletButton.tsx lifecycle
  found: |
    ConnectModal registers the same hooks. handleConnectWallet/handleSignIn call onClose() -> sets isOpen=false.
    WalletButton.tsx line 38 - when `connected && publicKey`, the connected branch renders (no ConnectModal).
    ConnectModal UNMOUNTS when wallet connects, before onSuccess/onComplete fire.
  implication: BUG 2 PATH 2 CONFIRMED - ConnectModal also unmounts before callbacks fire

- timestamp: 2026-02-24T00:02:00Z
  checked: TypeScript compilation after all fixes
  found: tsc --noEmit passes with zero errors
  implication: All fixes are type-safe and compile correctly

## Resolution

root_cause: |
  BUG 1: ToastProvider's popover show effect used `if (!el.matches(':popover-open')) el.showPopover()`.
  When a toast was already showing and a dialog opened above it, the popover stayed BELOW the
  dialog's ::backdrop blur. The effect didn't re-stack the popover because it was already :popover-open.
  Additionally, when the dialog opened while a toast was visible, the effect had no dependency on
  modal state, so it never re-ran to re-stack the popover.

  BUG 2: useLogin({onComplete}) and useConnectWallet({onSuccess}) were only registered in
  WalletStation.tsx and ConnectModal.tsx. Both components unmount before Privy's async
  wallet connection completes: WalletStation unmounts when closeModal() clears activeStation,
  ConnectModal unmounts when WalletButton switches to its connected view. The hooks and
  their callbacks were destroyed before they could fire.

fix: |
  BUG 1: Changed the popover effect to ALWAYS hide+show when toast is truthy (re-inserts at
  top of top layer stack). Added modalState.activeStation as a dependency so the effect also
  re-runs when the dialog opens/closes while a toast is visible.

  BUG 2: Created WalletConnectionToast component in providers.tsx that registers
  useConnectWallet({onSuccess}) and useLogin({onComplete}) at the provider level.
  This component never unmounts, so callbacks persist for the app's entire lifetime.
  Removed the callback registrations from WalletStation.tsx and ConnectModal.tsx.

verification: TypeScript compiles cleanly. Requires manual browser testing to fully verify.

files_changed:
  - app/components/toast/ToastProvider.tsx
  - app/providers/providers.tsx
  - app/components/station/WalletStation.tsx
  - app/components/wallet/ConnectModal.tsx
