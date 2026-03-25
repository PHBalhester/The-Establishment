/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/mock_tax_program.json`.
 */
export type MockTaxProgram = {
  "address": "43fZGRtmEsP7ExnJE1dbTbNjaP1ncvVmMPusSeksWGEj",
  "metadata": {
    "name": "mockTaxProgram",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Mock Tax Program for testing AMM CPI access control"
  },
  "instructions": [
    {
      "name": "executeSwap",
      "docs": [
        "Execute a swap through the AMM via CPI.",
        "",
        "This instruction:",
        "1. Derives the swap_authority PDA from this program",
        "2. Builds the AMM swap instruction with swap_authority as first account",
        "3. Calls invoke_signed to sign with the PDA",
        "",
        "The caller must provide:",
        "- amm_program: The AMM program to CPI into",
        "- swap_authority: The PDA account (verified by this program)",
        "- All other accounts needed for AMM swap (passed through remaining_accounts)",
        "- instruction_data: The raw AMM swap instruction data (discriminator + args)",
        "",
        "The real Tax Program will calculate taxes and adjust amounts before calling this.",
        "This mock just passes through to prove the CPI mechanism works."
      ],
      "discriminator": [
        56,
        182,
        124,
        215,
        155,
        140,
        157,
        102
      ],
      "accounts": [
        {
          "name": "ammProgram",
          "docs": [
            "The AMM program to CPI into.",
            "In production, this should be constrained to the actual AMM program ID."
          ]
        },
        {
          "name": "swapAuthority",
          "docs": [
            "The swap_authority PDA owned by this program.",
            "This account will be signed via invoke_signed."
          ]
        }
      ],
      "args": [
        {
          "name": "instructionData",
          "type": "bytes"
        }
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidSwapAuthority",
      "msg": "Invalid swap_authority PDA"
    }
  ]
};
