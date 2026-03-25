// Instruction handlers for the bonding curve program.
//
// Admin Setup (Phase 78):
//   initialize_bc_admin (deployer-only: create BcAdminConfig PDA)
//   burn_bc_admin (admin-only: permanently revoke admin)
//
// Lifecycle (admin-only, gated by BcAdminConfig):
//   initialize_curve -> fund_curve -> start_curve
//
// Trading:
//   purchase (buy tokens from curve)
//   sell (sell tokens back to curve with 15% tax to escrow)
//
// Graduation (Phase 73):
//   mark_failed (permissionless: Active -> Failed after deadline + grace)
//   prepare_transition (admin-only: both Filled -> Graduated)
//   distribute_tax_escrow (permissionless: escrow -> carnage fund on Graduated)
//
// Refund (Phase 73):
//   consolidate_for_refund (permissionless: merge escrow into vault)
//   claim_refund (user-signed: burn tokens, receive proportional SOL)
//
// Post-Graduation (Phase 74):
//   withdraw_graduated_sol (admin-only: extract SOL from graduated vault)
//   close_token_vault (admin-only: close empty token vault, recover rent)

pub mod burn_bc_admin;
pub mod claim_refund;
pub mod transfer_bc_admin;
pub mod close_token_vault;
pub mod consolidate_for_refund;
pub mod distribute_tax_escrow;
pub mod fund_curve;
pub mod initialize_bc_admin;
pub mod initialize_curve;
pub mod mark_failed;
pub mod prepare_transition;
pub mod purchase;
pub mod sell;
pub mod start_curve;
pub mod withdraw_graduated_sol;

pub use burn_bc_admin::*;
pub use claim_refund::*;
pub use transfer_bc_admin::*;
pub use close_token_vault::*;
pub use consolidate_for_refund::*;
pub use distribute_tax_escrow::*;
pub use fund_curve::*;
pub use initialize_bc_admin::*;
pub use initialize_curve::*;
pub use mark_failed::*;
pub use prepare_transition::*;
pub use purchase::*;
pub use sell::*;
pub use start_curve::*;
pub use withdraw_graduated_sol::*;
