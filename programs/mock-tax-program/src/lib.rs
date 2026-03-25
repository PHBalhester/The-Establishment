//! Mock Tax Program for testing AMM CPI access control.
//!
//! This program demonstrates how the real Tax Program will call the AMM:
//! 1. Derive the swap_authority PDA using seeds ["swap_authority"]
//! 2. Call AMM swap instruction via CPI with invoke_signed
//! 3. The PDA signature proves the call came from Tax Program
//!
//! The execute_swap instruction is a minimal pass-through that:
//! - Derives swap_authority PDA and signs with it
//! - Forwards all accounts to AMM swap instruction via CPI
//!
//! This mock does NOT implement tax calculation -- it just proves the CPI pattern works.

use anchor_lang::prelude::*;
use solana_program::instruction::Instruction;
use solana_program::program::invoke_signed;

// NOTE: This mock is deployed at the real TAX_PROGRAM_ID address in LiteSVM tests
// so the AMM's seeds::program = TAX_PROGRAM_ID constraint is satisfied.
// The mock_tax_program keypair (9irn...) is kept for Anchor build but tests
// deploy this .so at the Tax Program address.
declare_id!("43fZGRtmEsP7ExnJE1dbTbNjaP1ncvVmMPusSeksWGEj");

/// Seed for the swap_authority PDA. Must match AMM's SWAP_AUTHORITY_SEED.
pub const SWAP_AUTHORITY_SEED: &[u8] = b"swap_authority";

#[program]
pub mod mock_tax_program {
    use super::*;

    /// Execute a swap through the AMM via CPI.
    ///
    /// This instruction:
    /// 1. Derives the swap_authority PDA from this program
    /// 2. Builds the AMM swap instruction with swap_authority as first account
    /// 3. Calls invoke_signed to sign with the PDA
    ///
    /// The caller must provide:
    /// - amm_program: The AMM program to CPI into
    /// - swap_authority: The PDA account (verified by this program)
    /// - All other accounts needed for AMM swap (passed through remaining_accounts)
    /// - instruction_data: The raw AMM swap instruction data (discriminator + args)
    ///
    /// The real Tax Program will calculate taxes and adjust amounts before calling this.
    /// This mock just passes through to prove the CPI mechanism works.
    pub fn execute_swap<'info>(
        ctx: Context<'_, '_, 'info, 'info, ExecuteSwap<'info>>,
        instruction_data: Vec<u8>,
    ) -> Result<()> {
        // 1. Derive swap_authority PDA and get bump
        let (expected_swap_authority, bump) =
            Pubkey::find_program_address(&[SWAP_AUTHORITY_SEED], ctx.program_id);

        // 2. Verify the provided swap_authority matches our PDA
        require_keys_eq!(
            ctx.accounts.swap_authority.key(),
            expected_swap_authority,
            MockTaxError::InvalidSwapAuthority
        );

        // 3. Build account metas for AMM CPI
        //    First account is swap_authority (signer), rest come from remaining_accounts
        let mut account_metas = vec![AccountMeta::new_readonly(
            ctx.accounts.swap_authority.key(),
            true, // is_signer = true (we sign via invoke_signed)
        )];

        // Add all remaining accounts with their original mutability/signer flags
        for account in ctx.remaining_accounts.iter() {
            if account.is_writable {
                account_metas.push(AccountMeta::new(account.key(), account.is_signer));
            } else {
                account_metas.push(AccountMeta::new_readonly(account.key(), account.is_signer));
            }
        }

        // 4. Build the instruction
        let ix = Instruction {
            program_id: ctx.accounts.amm_program.key(),
            accounts: account_metas,
            data: instruction_data,
        };

        // 5. Build account infos for CPI
        //    Must include swap_authority first, then all remaining accounts
        let mut account_infos = vec![ctx.accounts.swap_authority.to_account_info()];
        account_infos.extend(ctx.remaining_accounts.iter().cloned());
        account_infos.push(ctx.accounts.amm_program.to_account_info());

        // 6. Build signer seeds for invoke_signed
        let signer_seeds: &[&[&[u8]]] = &[&[SWAP_AUTHORITY_SEED, &[bump]]];

        // 7. Execute CPI with PDA signature
        invoke_signed(&ix, &account_infos, signer_seeds)?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct ExecuteSwap<'info> {
    /// The AMM program to CPI into.
    /// CHECK: We don't validate this because tests may use different AMM addresses.
    /// In production, this should be constrained to the actual AMM program ID.
    pub amm_program: UncheckedAccount<'info>,

    /// The swap_authority PDA owned by this program.
    /// This account will be signed via invoke_signed.
    /// CHECK: We validate this matches our PDA in the handler.
    pub swap_authority: UncheckedAccount<'info>,
}

#[error_code]
pub enum MockTaxError {
    #[msg("Invalid swap_authority PDA")]
    InvalidSwapAuthority,
}
