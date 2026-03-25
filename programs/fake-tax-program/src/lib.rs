//! Fake Tax Program for negative testing of AMM access control.
//!
//! This program has the SAME interface as Mock Tax Program but a DIFFERENT program ID.
//! When it tries to CPI into the AMM, the swap_authority PDA derived from this program
//! will NOT match the PDA expected by the AMM (which expects TAX_PROGRAM_ID = Mock Tax).
//!
//! This is used to test that the AMM correctly rejects swaps from unauthorized programs.

use anchor_lang::prelude::*;
use solana_program::instruction::Instruction;
use solana_program::program::invoke_signed;

// DIFFERENT program ID than Mock Tax Program
// AMM's TAX_PROGRAM_ID = 9irnHg1ddyLeeDTcuXYMa8Zby7uafL5PpkZ7LPfzzNw9 (Mock Tax)
// This program = 7i38TDxugSPSV9ciUNTbnEeBps5C5xiQSSY7kNG65YnJ (Fake Tax)
declare_id!("7i38TDxugSPSV9ciUNTbnEeBps5C5xiQSSY7kNG65YnJ");

/// Seed for the swap_authority PDA. Same as Mock Tax and AMM.
pub const SWAP_AUTHORITY_SEED: &[u8] = b"swap_authority";

#[program]
pub mod fake_tax_program {
    use super::*;

    /// Attempt to execute a swap through the AMM via CPI.
    ///
    /// This instruction works identically to Mock Tax Program's execute_swap,
    /// but because this program has a different ID, the swap_authority PDA
    /// it derives will be different from what AMM expects.
    ///
    /// Expected behavior: AMM rejects the CPI because seeds::program mismatch.
    pub fn execute_swap<'info>(
        ctx: Context<'_, '_, 'info, 'info, ExecuteSwap<'info>>,
        instruction_data: Vec<u8>,
    ) -> Result<()> {
        // 1. Derive swap_authority PDA from THIS program (different from Mock Tax)
        let (expected_swap_authority, bump) =
            Pubkey::find_program_address(&[SWAP_AUTHORITY_SEED], ctx.program_id);

        // 2. Verify the provided swap_authority matches our PDA
        require_keys_eq!(
            ctx.accounts.swap_authority.key(),
            expected_swap_authority,
            FakeTaxError::InvalidSwapAuthority
        );

        // 3. Build account metas for AMM CPI
        let mut account_metas = vec![AccountMeta::new_readonly(
            ctx.accounts.swap_authority.key(),
            true, // is_signer = true
        )];

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
        let mut account_infos = vec![ctx.accounts.swap_authority.to_account_info()];
        account_infos.extend(ctx.remaining_accounts.iter().cloned());
        account_infos.push(ctx.accounts.amm_program.to_account_info());

        // 6. Build signer seeds for invoke_signed
        let signer_seeds: &[&[&[u8]]] = &[&[SWAP_AUTHORITY_SEED, &[bump]]];

        // 7. Execute CPI with PDA signature
        //    This WILL succeed as a CPI call, but AMM will reject because
        //    the swap_authority PDA doesn't match TAX_PROGRAM_ID derivation.
        invoke_signed(&ix, &account_infos, signer_seeds)?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct ExecuteSwap<'info> {
    /// The AMM program to CPI into.
    /// CHECK: We don't validate this because tests may use different AMM addresses.
    pub amm_program: UncheckedAccount<'info>,

    /// The swap_authority PDA owned by this program.
    /// Note: This PDA is derived from FakeTax's program ID, NOT MockTax's.
    /// CHECK: We validate this matches our PDA in the handler.
    pub swap_authority: UncheckedAccount<'info>,
}

#[error_code]
pub enum FakeTaxError {
    #[msg("Invalid swap_authority PDA")]
    InvalidSwapAuthority,
}
