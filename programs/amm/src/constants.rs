use anchor_lang::prelude::*;

/// Seed for the swap_authority PDA derived by Tax Program.
/// Both Tax Program and AMM must use identical seeds.
pub const SWAP_AUTHORITY_SEED: &[u8] = b"swap_authority";

/// Tax Program ID - the only program authorized to sign swap_authority.
/// This is hardcoded like SPL Token program IDs.
/// Production Tax Program ID (deployed in Phase 18-01).
pub const TAX_PROGRAM_ID: Pubkey = pubkey!("43fZGRtmEsP7ExnJE1dbTbNjaP1ncvVmMPusSeksWGEj");

/// LP fee for SOL pools (CRIME/SOL, FRAUD/SOL) in basis points.
/// 100 bps = 1.0% fee per swap.
/// Source: AMM_Implementation.md Section 6
pub const SOL_POOL_FEE_BPS: u16 = 100;

/// Maximum LP fee in basis points.
/// 500 bps = 5% -- a reasonable upper bound to prevent admin misconfiguration.
/// Source: Phase 37 audit finding -- no upper bound on lp_fee_bps.
pub const MAX_LP_FEE_BPS: u16 = 500;

/// Basis points denominator (10,000 = 100%).
pub const BPS_DENOMINATOR: u128 = 10_000;

/// PDA seed for the global AdminConfig account.
pub const ADMIN_SEED: &[u8] = b"admin";

/// PDA seed prefix for pool state accounts.
/// Full seeds: [POOL_SEED, mint_a.as_ref(), mint_b.as_ref()]
pub const POOL_SEED: &[u8] = b"pool";

/// PDA seed prefix for pool vault token accounts.
/// Full seeds: [VAULT_SEED, pool.as_ref(), VAULT_A_SEED or VAULT_B_SEED]
pub const VAULT_SEED: &[u8] = b"vault";

/// PDA seed suffix for vault A.
pub const VAULT_A_SEED: &[u8] = b"a";

/// PDA seed suffix for vault B.
pub const VAULT_B_SEED: &[u8] = b"b";
