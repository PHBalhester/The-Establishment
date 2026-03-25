# Phase 40: Wallet Connection - Research

**Researched:** 2026-02-15
**Domain:** Solana wallet integration (external + embedded) with Next.js App Router
**Confidence:** HIGH (core patterns verified against official Privy examples repo and Solana docs)

## Summary

Phase 40 connects users to the Dr. Fraudsworth protocol via either standard browser wallets (Phantom, Solflare, Backpack) or Privy embedded wallets (phone, email, Google login), then shows their CRIME, FRAUD, PROFIT, and SOL balances.

The **key architectural finding** is that Privy v3 handles BOTH external wallet connection AND embedded wallets through a single provider. There is **no need for `@solana/wallet-adapter`** when using Privy's `toSolanaWalletConnectors()`. Privy uses the Solana Wallet Standard under the hood to detect browser extension wallets (Phantom, Solflare, Backpack) and provides them alongside embedded wallets through the same `useWallets()` hook from `@privy-io/react-auth/solana`. This dramatically simplifies the architecture: one provider (`PrivyProvider`), one wallet hook (`useWallets` from the Solana sub-path), and one set of signing hooks.

For the `useProtocolWallet()` abstraction layer, we build a thin wrapper over Privy's hooks that provides a stable `{ publicKey, signTransaction, signAllTransactions }` interface. The signTransaction method uses Privy's `useSignTransaction` hook, and signAllTransactions is implemented by iterating signTransaction over an array (Privy does not expose a native signAllTransactions, but the wallet standard supports `solana:signTransaction` with multiple transactions).

Token balances for CRIME, FRAUD, and PROFIT (all Token-2022 mints) are fetched via `connection.getParsedTokenAccountsByOwner()` with `TOKEN_2022_PROGRAM_ID` as the programId filter. SOL balance uses `connection.getBalance()`.

**Primary recommendation:** Use Privy as the sole wallet provider (no @solana/wallet-adapter). Build `useProtocolWallet()` as a thin wrapper over Privy's `useWallets` + `useSignTransaction` + `useSignAndSendTransaction` hooks from `@privy-io/react-auth/solana`.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@privy-io/react-auth` | ^3.9.0+ (latest 3.13.1) | Auth + wallet provider (embedded + external) | Official Privy SDK; handles social login, embedded wallets, AND external wallet detection via Wallet Standard |
| `@solana/web3.js` | ^1.98.4 (already installed) | RPC calls, Transaction construction, PublicKey | Already in project; Privy's web3.js integration page shows compatibility |
| `@solana/spl-token` | ^0.4.x | Token-2022 `TOKEN_2022_PROGRAM_ID` constant, account layout | Standard SPL library; provides the program ID constant needed for Token-2022 balance queries |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@coral-xyz/anchor` | ^0.32.1 (already installed) | Anchor program interaction | Already in project; used for program factories in later phases |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Privy-only external wallets | `@solana/wallet-adapter-react` + `@solana/wallet-adapter-react-ui` | wallet-adapter is the traditional standard, BUT it would require two separate wallet systems (wallet-adapter for external, Privy for embedded) and a complex unification layer. Privy handles both through one provider, which is simpler. |
| `@solana/kit` (v2) for RPC | `@solana/web3.js` (v1) | Privy's official example uses `@solana/kit`, but our project is deeply committed to `@solana/web3.js` v1 (Anchor, all existing code). Privy explicitly supports web3.js v1 integration. No reason to migrate. |
| Custom modal UI | Privy's built-in login modal | Privy's modal handles wallet selection + social login. Custom modal gives more control over UX. Decision: use custom connection modal with two clear paths, calling Privy's `connectWallet()` for external and `login()` for social. |

### NOT Needed (Do Not Install)
| Package | Why NOT |
|---------|---------|
| `@solana/wallet-adapter-react` | Privy's `toSolanaWalletConnectors()` replaces this entirely |
| `@solana/wallet-adapter-react-ui` | Building custom modal per CONTEXT.md UX requirements |
| `@solana/wallet-adapter-wallets` | Not needed; Privy uses Wallet Standard for detection |
| `@solana/wallet-adapter-base` | Not needed; only needed if using wallet-adapter |

**Installation:**
```bash
npm install @privy-io/react-auth @solana/spl-token
```

Note: `@solana/web3.js`, `@coral-xyz/anchor`, `buffer`, `next`, `react`, `react-dom` are already installed.

## Architecture Patterns

### Recommended Project Structure
```
app/
├── providers/
│   └── providers.tsx           # "use client" - PrivyProvider wrapper
├── hooks/
│   ├── useProtocolWallet.ts    # Unified wallet abstraction
│   └── useTokenBalances.ts     # CRIME/FRAUD/PROFIT/SOL balances
├── components/
│   └── wallet/
│       ├── ConnectModal.tsx     # Two-path connection modal
│       ├── WalletButton.tsx     # Header connect/disconnect button
│       └── BalanceDisplay.tsx   # Token balance cards
├── lib/
│   ├── anchor.ts               # (existing) read-only program factories
│   └── connection.ts           # (existing) RPC connection factory
└── app/
    └── layout.tsx              # Wraps children in <Providers>
```

### Pattern 1: PrivyProvider as Root Provider
**What:** Wrap entire app in a single `"use client"` Providers component that contains `PrivyProvider` with Solana configuration.
**When to use:** Always -- this is the root provider pattern.
**Example:**
```typescript
// app/providers/providers.tsx
"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
      config={{
        appearance: {
          walletChainType: "solana-only",
          walletList: ["phantom", "solflare", "backpack", "detected_solana_wallets"],
        },
        embeddedWallets: {
          solana: { createOnLogin: "users-without-wallets" },
        },
        externalWallets: {
          solana: { connectors: toSolanaWalletConnectors() },
        },
        loginMethods: ["email", "sms", "google"],
      }}
    >
      {children}
    </PrivyProvider>
  );
}
```
Source: Verified against https://github.com/privy-io/examples/tree/main/examples/privy-next-solana

### Pattern 2: Unified useProtocolWallet() Hook
**What:** A custom hook that wraps Privy's Solana hooks to provide a stable interface for all protocol operations.
**When to use:** Every component that needs wallet signing.
**Example:**
```typescript
// app/hooks/useProtocolWallet.ts
"use client";

import { useCallback, useMemo } from "react";
import { usePrivy } from "@privy-io/react-auth";
import {
  useWallets,
  useSignTransaction,
  useSignAndSendTransaction,
} from "@privy-io/react-auth/solana";
import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";

export interface ProtocolWallet {
  publicKey: PublicKey | null;
  connected: boolean;
  signTransaction: (tx: Transaction | VersionedTransaction) => Promise<Transaction | VersionedTransaction>;
  signAllTransactions: (txs: (Transaction | VersionedTransaction)[]) => Promise<(Transaction | VersionedTransaction)[]>;
  disconnect: () => void;
}

export function useProtocolWallet(): ProtocolWallet {
  const { authenticated, logout } = usePrivy();
  const { wallets, ready } = useWallets();
  const { signTransaction: privySignTx } = useSignTransaction();
  const { signAndSendTransaction } = useSignAndSendTransaction();

  // First Solana wallet is the active one (embedded or external)
  const activeWallet = wallets[0] ?? null;

  const publicKey = useMemo(
    () => (activeWallet ? new PublicKey(activeWallet.address) : null),
    [activeWallet]
  );

  const signTransaction = useCallback(
    async (tx: Transaction | VersionedTransaction) => {
      if (!activeWallet) throw new Error("No wallet connected");
      // Serialize the transaction for Privy
      const serialized = tx.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      });
      const { signedTransaction } = await privySignTx({
        transaction: new Uint8Array(serialized),
        wallet: activeWallet,
      });
      // Deserialize back -- Privy returns Uint8Array
      // Caller can use Transaction.from() or VersionedTransaction.deserialize()
      return signedTransaction;
    },
    [activeWallet, privySignTx]
  );

  const signAllTransactions = useCallback(
    async (txs: (Transaction | VersionedTransaction)[]) => {
      // Privy does not have a native signAllTransactions
      // Iterate over signTransaction for each
      return Promise.all(txs.map((tx) => signTransaction(tx)));
    },
    [signTransaction]
  );

  return {
    publicKey,
    connected: authenticated && !!activeWallet,
    signTransaction,
    signAllTransactions,
    disconnect: logout,
  };
}
```

**IMPORTANT NOTE:** The exact serialization/deserialization pattern above is illustrative. The actual implementation needs to handle:
1. Legacy `Transaction` vs `VersionedTransaction` differently (they have different serialize methods)
2. Privy's `signTransaction` returns `{ signedTransaction: Uint8Array }` -- this needs to be deserialized back to the appropriate Transaction type
3. The `useSignTransaction` hook from `@privy-io/react-auth/solana` accepts `SupportedSolanaTransaction` which may handle both types

### Pattern 3: Token-2022 Balance Fetching
**What:** Hook that fetches CRIME, FRAUD, PROFIT, and SOL balances using the RPC connection.
**When to use:** Anywhere user balances are displayed.
**Example:**
```typescript
// app/hooks/useTokenBalances.ts
"use client";

import { useEffect, useState, useCallback } from "react";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { getConnection } from "@/lib/connection";
import { MINTS, TOKEN_DECIMALS } from "@dr-fraudsworth/shared";

interface TokenBalances {
  sol: number;
  crime: number;
  fraud: number;
  profit: number;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useTokenBalances(publicKey: PublicKey | null): TokenBalances {
  const [balances, setBalances] = useState({ sol: 0, crime: 0, fraud: 0, profit: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!publicKey) return;
    setLoading(true);
    setError(null);

    try {
      const connection = getConnection();

      // Fetch SOL balance and Token-2022 accounts in parallel
      const [solBalance, tokenAccounts] = await Promise.all([
        connection.getBalance(publicKey),
        connection.getParsedTokenAccountsByOwner(publicKey, {
          programId: TOKEN_2022_PROGRAM_ID,
        }),
      ]);

      // Map mint addresses to balances
      const mintToBalance: Record<string, number> = {};
      for (const { account } of tokenAccounts.value) {
        const parsed = account.data.parsed;
        if (parsed?.info?.mint) {
          mintToBalance[parsed.info.mint] = parsed.info.tokenAmount.uiAmount ?? 0;
        }
      }

      setBalances({
        sol: solBalance / LAMPORTS_PER_SOL,
        crime: mintToBalance[MINTS.CRIME.toBase58()] ?? 0,
        fraud: mintToBalance[MINTS.FRAUD.toBase58()] ?? 0,
        profit: mintToBalance[MINTS.PROFIT.toBase58()] ?? 0,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [publicKey]);

  useEffect(() => { refresh(); }, [refresh]);

  return { ...balances, loading, error, refresh };
}
```

### Pattern 4: Two-Path Connection Modal
**What:** Custom modal with two clear paths: "External Wallet" and "Sign In".
**When to use:** When user clicks "Connect Wallet" button.
**Key insight:** For external wallets, call `connectWallet({ walletChainType: 'solana' })` from `useConnectWallet`. For social login, call `login()` from `useLogin`. These are separate Privy methods.
```typescript
import { useLogin } from "@privy-io/react-auth";
import { useConnectWallet } from "@privy-io/react-auth";

// External wallet path:
const { connectWallet } = useConnectWallet();
connectWallet({ walletChainType: "solana" });

// Social login path (triggers Privy's built-in modal for email/phone/Google):
const { login } = useLogin();
login();
```

### Anti-Patterns to Avoid
- **Using both `@solana/wallet-adapter` AND Privy:** This creates two competing wallet systems, duplicate providers, and a complex unification nightmare. Privy alone handles both paths.
- **Wrapping PrivyProvider in server components:** PrivyProvider is a client-side context. Always use a `"use client"` wrapper component.
- **Calling `login()` for external wallet users:** External wallet users should use `connectWallet()`, not `login()`. They do NOT need a Privy account per the CONTEXT.md decision.
- **Using `createOnLogin: 'all-users'`:** This creates embedded wallets even for external wallet users. Use `'users-without-wallets'` to only create embedded wallets for social login users.
- **Fetching Token-2022 balances with `TOKEN_PROGRAM_ID`:** CRIME, FRAUD, and PROFIT are Token-2022 tokens. Must use `TOKEN_2022_PROGRAM_ID` (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`) or balances will return empty.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| External wallet detection | Custom window.solana detection | `toSolanaWalletConnectors()` from Privy | Wallet Standard detection handles Phantom, Solflare, Backpack, and any future compliant wallets automatically |
| Social login auth flow | Custom OAuth/SMS/email verification | Privy's `login()` method | OAuth flows, phone verification, email OTP are extremely complex; Privy handles all edge cases |
| Embedded wallet key management | Custom MPC/key storage | Privy embedded wallets | Key management is the hardest security problem in crypto; Privy has it solved with MPC |
| Connection state management | Custom React context for wallet state | Privy's `usePrivy()` + `useWallets()` hooks | Privy manages connection lifecycle, reconnection, and state persistence |
| Token account parsing | Manual buffer decoding of token accounts | `getParsedTokenAccountsByOwner()` with `jsonParsed` encoding | RPC does the parsing; returns clean JSON with mint, amount, decimals |

**Key insight:** Privy is a comprehensive wallet infrastructure provider, not just an auth SDK. Using it for BOTH external and embedded wallets eliminates the biggest integration complexity (unifying two wallet systems).

## Common Pitfalls

### Pitfall 1: Turbopack + Privy Compatibility
**What goes wrong:** Privy v3 includes `@walletconnect/ethereum-provider` internally. Turbopack may have module resolution issues with WalletConnect's iteration over `supportedChains`, causing "s is not iterable" errors.
**Why it happens:** Turbopack initializes modules differently than webpack, and deeply nested dependencies like WalletConnect can break.
**How to avoid:**
- The project already uses turbopack (Next.js 16.1.6). Test early.
- If turbopack fails, the Privy Solana example uses `next dev --turbopack` successfully (verified in their `package.json`). The issue is specifically with `@privy-io/wagmi` (EVM), not the base `@privy-io/react-auth`. Since we're Solana-only (`walletChainType: "solana-only"`), WalletConnect may not be loaded.
- Fallback: Add turbopack resolveAlias stubs if needed, similar to existing fs/net/tls stubs.
**Warning signs:** Build errors referencing "s is not iterable" or module resolution failures in WalletConnect.

### Pitfall 2: Privy `ready` State
**What goes wrong:** Components render before Privy has initialized, causing hydration mismatches or showing wrong wallet state.
**Why it happens:** Privy does async initialization (checking sessions, refreshing tokens). `usePrivy()` returns `{ ready: false }` until done.
**How to avoid:** Always check `ready` from `usePrivy()` before rendering wallet-dependent UI. Also check `ready` from `useWallets()` before accessing wallets array. Show loading skeleton/spinner until both are ready.
**Warning signs:** Flickering UI on page load, wallet state being null then immediately changing.

### Pitfall 3: Token-2022 vs SPL Token Program ID
**What goes wrong:** Balance queries return empty results even though the user holds tokens.
**Why it happens:** CRIME, FRAUD, and PROFIT are Token-2022 tokens (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`), not classic SPL tokens (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`). If you query with the wrong program ID, you get zero results.
**How to avoid:** Always use `TOKEN_2022_PROGRAM_ID` from `@solana/spl-token` for balance queries of our tokens.
**Warning signs:** SOL balance shows correctly but all token balances show 0.

### Pitfall 4: Next.js SSR + Privy Provider
**What goes wrong:** Privy crashes or produces hydration errors because it tries to run on the server.
**Why it happens:** PrivyProvider is a client-side React context with iframes and dialogs. It cannot render on the server.
**How to avoid:** Create a dedicated `"use client"` Providers component. Import it into `layout.tsx` (which can be a server component). The layout.tsx itself does NOT need `"use client"`.
**Warning signs:** "window is not defined", "document is not defined", hydration mismatch errors.

### Pitfall 5: signTransaction Serialization Mismatch
**What goes wrong:** Transaction signing fails or returns unusable data.
**Why it happens:** Privy's `signTransaction` accepts `Uint8Array` (or `SupportedSolanaTransaction`) and returns `{ signedTransaction: Uint8Array }`. If you pass a web3.js `Transaction` object directly, or forget to deserialize the response, operations fail.
**How to avoid:** The `useProtocolWallet()` hook must handle serialization to/from Uint8Array transparently. For legacy `Transaction`, use `tx.serialize({ requireAllSignatures: false, verifySignatures: false })` before passing to Privy, and `Transaction.from(signedBytes)` after.
**Warning signs:** "Cannot read property" errors, or transactions that appear signed but fail on-chain.

### Pitfall 6: External Wallet Users Creating Unwanted Privy Accounts
**What goes wrong:** External wallet users go through `login()` instead of `connectWallet()`, creating a Privy account they don't need.
**Why it happens:** Confusing the two connection paths in the UI.
**How to avoid:** The connection modal must clearly separate: "Connect Wallet" (calls `connectWallet()`) vs "Sign In" (calls `login()` with email/phone/Google). Per CONTEXT.md: "External wallet users do NOT need a Privy account."
**Warning signs:** Privy dashboard shows accounts for users who only connected external wallets.

### Pitfall 7: Privy `config.solana.rpcs` Requirement
**What goes wrong:** Privy's embedded wallet UI for signing transactions fails or shows errors.
**Why it happens:** Privy needs RPC endpoints configured via `config.solana.rpcs` to show transaction details in the signing modal. Without this, embedded wallet UIs cannot simulate or display transaction info.
**How to avoid:** Configure `solana.rpcs` in the PrivyProvider with the devnet RPC endpoint. Use the existing Helius devnet URL from `DEVNET_RPC_URL` in the shared package. NOTE: This uses `createSolanaRpc()` from `@solana/kit` -- Privy requires this for its internal UI. This is the only place `@solana/kit` is needed; the rest of the app stays on `@solana/web3.js`.
**Warning signs:** Privy signing modal shows blank or errors for embedded wallet transactions.

## Code Examples

### Complete PrivyProvider for Dr. Fraudsworth
```typescript
// app/providers/providers.tsx
// Source: Pattern derived from official privy-io/examples/privy-next-solana/src/providers/providers.tsx
"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";
import { DEVNET_RPC_URL } from "@dr-fraudsworth/shared";

// NOTE: Privy's solana.rpcs config requires @solana/kit's createSolanaRpc.
// This is the ONLY place we use @solana/kit -- rest of app uses @solana/web3.js v1.
// If this causes bundle issues, the rpcs config can be omitted
// (only needed for Privy's built-in embedded wallet signing UIs).

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
      config={{
        appearance: {
          walletChainType: "solana-only",
          walletList: ["phantom", "solflare", "backpack", "detected_solana_wallets"],
        },
        embeddedWallets: {
          solana: { createOnLogin: "users-without-wallets" },
        },
        externalWallets: {
          solana: { connectors: toSolanaWalletConnectors() },
        },
        loginMethods: ["email", "sms", "google"],
        // solana.rpcs: optional -- only needed if using Privy's built-in signing UIs
        // If we build our own signing confirmation UI, we can skip this
        // and avoid the @solana/kit dependency entirely.
      }}
    >
      {children}
    </PrivyProvider>
  );
}
```

### Fetching Token-2022 Balances (CRIME, FRAUD, PROFIT)
```typescript
// Source: Solana RPC docs (solana.com/docs/rpc/http/gettokenaccountsbyowner.md)
import { PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { getConnection } from "@/lib/connection";
import { MINTS } from "@dr-fraudsworth/shared";

async function fetchBalances(owner: PublicKey) {
  const connection = getConnection();

  // One RPC call returns ALL Token-2022 accounts for this owner
  const response = await connection.getParsedTokenAccountsByOwner(owner, {
    programId: TOKEN_2022_PROGRAM_ID,
  });

  const balances: Record<string, number> = {};
  for (const { account } of response.value) {
    const info = account.data.parsed?.info;
    if (info?.mint && info?.tokenAmount) {
      balances[info.mint] = info.tokenAmount.uiAmount ?? 0;
    }
  }

  return {
    crime: balances[MINTS.CRIME.toBase58()] ?? 0,
    fraud: balances[MINTS.FRAUD.toBase58()] ?? 0,
    profit: balances[MINTS.PROFIT.toBase58()] ?? 0,
  };
}
```

### Using Privy Hooks for Wallet Actions
```typescript
// Source: Privy docs - wallets/using-wallets/solana/sign-a-transaction
import { useWallets, useSignTransaction, useSignAndSendTransaction } from "@privy-io/react-auth/solana";
import { usePrivy, useLogin, useConnectWallet } from "@privy-io/react-auth";

// In component:
const { ready, authenticated, logout } = usePrivy();
const { wallets, ready: walletsReady } = useWallets();
const { signTransaction } = useSignTransaction();
const { signAndSendTransaction } = useSignAndSendTransaction();
const { login } = useLogin();
const { connectWallet } = useConnectWallet();

// External wallet connection:
connectWallet({ walletChainType: "solana" });

// Social login (creates embedded wallet):
login();

// Sign a transaction with first available wallet:
const wallet = wallets[0];
const { signedTransaction } = await signTransaction({
  transaction: serializedTxBytes, // Uint8Array
  wallet: wallet,
});
```

### Layout Integration
```typescript
// app/app/layout.tsx (server component -- no "use client" needed)
import type { Metadata } from "next";
import Providers from "@/providers/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dr. Fraudsworth",
  description: "Dr. Fraudsworth's Finance Factory",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `@solana/wallet-adapter` for external wallets + separate Privy for embedded | Privy handles both via `toSolanaWalletConnectors()` + Wallet Standard | Privy v2+ (2024) | Eliminates dual-provider complexity |
| `useSendSolanaTransaction` from `@privy-io/react-auth` | `useSendTransaction` from `@privy-io/react-auth/solana` | Privy v2.0.0 (Dec 2024) | Solana hooks moved to dedicated sub-path |
| Manual Phantom/Solflare adapter classes | Wallet Standard auto-detection | wallet-adapter 0.15.36+ | No manual adapter registration needed |
| `getTokenAccountsByOwner` + manual buffer decode | `getParsedTokenAccountsByOwner` with `jsonParsed` | Always available | Returns clean JSON with uiAmount |
| `createOnLogin: 'all-users'` | `createOnLogin: 'users-without-wallets'` | Best practice | Only creates embedded wallets for social login users |
| Privy `config.solanaClusters` | Privy `config.solana.rpcs` with `@solana/kit` | Privy v3 | RPC config uses @solana/kit types |

**Deprecated/outdated:**
- `@privy-io/react-auth` v1: Completely superseded by v2/v3 with breaking changes
- `sendSolanaTransaction` from `usePrivy()`: Removed in v2; use `@privy-io/react-auth/solana` exports
- `getTokenAccountsByOwner` without `jsonParsed`: Still works but requires manual buffer parsing; use `getParsedTokenAccountsByOwner` instead

## Open Questions

1. **`@solana/kit` as Privy RPC dependency**
   - What we know: Privy's `config.solana.rpcs` requires `createSolanaRpc()` from `@solana/kit`. This is used internally by Privy's embedded wallet signing UIs.
   - What's unclear: Whether we can avoid this dependency entirely by not configuring `solana.rpcs` and building our own transaction confirmation UI (which would use our existing `@solana/web3.js` connection). Or whether `@solana/kit` can coexist without bundling conflicts alongside `@solana/web3.js` v1.
   - Recommendation: Try without `solana.rpcs` first. If Privy's signing UIs need it, install `@solana/kit` as a minimal dependency used ONLY in the providers config. Test for bundle conflicts with turbopack.

2. **Privy `connectWallet()` vs `login()` for external wallet users**
   - What we know: CONTEXT.md says "External wallet users do NOT need a Privy account." Privy's `connectWallet()` connects an external wallet. `login()` creates a Privy session.
   - What's unclear: Whether `connectWallet()` alone (without `login()`) gives us access to `signTransaction` and `signAndSendTransaction` hooks. The Privy docs show `useWallets()` returns wallets after either path, but the signing hooks may require an authenticated session.
   - Recommendation: Test this as part of the INFR-02 smoke test. If `connectWallet()` alone doesn't enable signing, external wallet users may need to `login()` with their wallet (which creates a minimal Privy account). This is acceptable -- the UX still shows "Connect Wallet" not "Create Account."

3. **signAllTransactions support**
   - What we know: Privy exposes `useSignTransaction` (singular). The Solana Wallet Standard defines `solana:signTransaction` which can accept multiple transactions. Privy's `useStandardSignTransaction` hook (from `@privy-io/react-auth/solana`) may support batch signing.
   - What's unclear: Whether Privy's hooks support batch signTransaction natively or if we need to iterate.
   - Recommendation: Implement as iteration initially (sign each tx sequentially). If performance is an issue, investigate `useStandardSignTransaction` for batch support.

4. **Privy App ID**
   - What we know: Need a `NEXT_PUBLIC_PRIVY_APP_ID` env var from the Privy dashboard.
   - What's unclear: Whether an existing Privy app exists for this project or needs to be created.
   - Recommendation: Create Privy app in dashboard during implementation. Configure login methods (email, SMS, Google) and Solana support there.

## Sources

### Primary (HIGH confidence)
- `privy-io/examples` GitHub repo (cloned and inspected) - `examples/privy-next-solana/` - Full Next.js + Privy + Solana example with turbopack
- `https://docs.privy.io/recipes/solana/getting-started-with-privy-and-solana` - Official Privy Solana setup guide
- `https://docs.privy.io/basics/react/setup` - PrivyProvider configuration for Solana
- `https://docs.privy.io/wallets/connectors/solana/web3-integrations` - Privy + @solana/web3.js integration
- `https://docs.privy.io/wallets/connectors/setup/configuring-external-connector-wallets` - External wallet configuration (walletList, toSolanaWalletConnectors)
- `https://docs.privy.io/basics/react/advanced/configuring-solana-networks` - Solana network/RPC config
- `https://docs.privy.io/basics/react/advanced/automatic-wallet-creation` - createOnLogin options
- `https://solana.com/docs/rpc/http/gettokenaccountsbyowner` - RPC API for Token-2022 balance queries
- `https://www.npmjs.com/package/@privy-io/react-auth` - v3.13.1 latest, dependencies verified
- `https://www.npmjs.com/package/@solana/wallet-adapter-react` - v0.15.39 latest (documented for reference, NOT recommended for use)
- `https://docs.privy.io/basics/troubleshooting/react-frameworks` - Next.js App Router integration pattern

### Secondary (MEDIUM confidence)
- `https://docs.privy.io/recipes/solana/standard-wallets` - Solana standard wallet features (signTransaction, signAndSendTransaction confirmed)
- `https://docs.privy.io/wallets/using-wallets/solana/sign-a-transaction` - Sign transaction with React SDK
- `https://docs.privy.io/wallets/using-wallets/solana/send-a-transaction` - Send transaction with React SDK
- `https://docs.privy.io/basics/react/advanced/migrating-to-2.0` - v2 migration guide (Solana exports moved to sub-path)
- `https://github.com/vercel/next.js/issues/81724` - Turbopack + Privy/wagmi issue (NOT affecting Solana-only config)

### Tertiary (LOW confidence)
- signAllTransactions batch support via useStandardSignTransaction - not verified in docs, needs testing
- `connectWallet()` without `login()` enabling signing hooks - needs smoke test validation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Verified against official Privy examples repo (cloned and inspected code), NPM registry, Solana RPC docs
- Architecture: HIGH - Provider pattern from official example; useProtocolWallet abstraction follows standard React patterns; Token-2022 balance fetch uses well-documented RPC method
- Pitfalls: HIGH - Turbopack issue documented in GitHub issues; Token-2022 program ID distinction is well-known; SSR/client boundary is standard Next.js knowledge; Privy ready state documented in official troubleshooting

**Research date:** 2026-02-15
**Valid until:** 2026-03-15 (30 days -- Privy may release minor updates but core patterns are stable)
