/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/fake_tax_program.json`.
 */
export type FakeTaxProgram = {
  "address": "7i38TDxugSPSV9ciUNTbnEeBps5C5xiQSSY7kNG65YnJ",
  "metadata": {
    "name": "fakeTaxProgram",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Fake Tax Program for negative testing - same interface, different program ID"
  },
  "instructions": [
    {
      "name": "executeSwap",
      "docs": [
        "Attempt to execute a swap through the AMM via CPI.",
        "",
        "This instruction works identically to Mock Tax Program's execute_swap,",
        "but because this program has a different ID, the swap_authority PDA",
        "it derives will be different from what AMM expects.",
        "",
        "Expected behavior: AMM rejects the CPI because seeds::program mismatch."
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
            "The AMM program to CPI into."
          ]
        },
        {
          "name": "swapAuthority",
          "docs": [
            "The swap_authority PDA owned by this program.",
            "Note: This PDA is derived from FakeTax's program ID, NOT MockTax's."
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
