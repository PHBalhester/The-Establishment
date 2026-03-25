/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/tax_program.json`.
 */
export type TaxProgram = {
  "address": "43fZGRtmEsP7ExnJE1dbTbNjaP1ncvVmMPusSeksWGEj",
  "metadata": {
    "name": "taxProgram",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Dr Fraudsworth Tax Program - Asymmetric taxation and atomic distribution"
  },
  "instructions": [
    {
      "name": "initializeWsolIntermediary",
      "docs": [
        "Initialize the WSOL intermediary account (one-time admin setup).",
        "Must be called before the first sell swap.",
        "Creates a WSOL token account at the intermediary PDA, owned by swap_authority."
      ],
      "discriminator": [
        240,
        113,
        117,
        75,
        43,
        61,
        230,
        214
      ],
      "accounts": [
        {
          "name": "admin",
          "docs": [
            "Admin (payer). Only needs to be called once during protocol setup."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "wsolIntermediary",
          "docs": [
            "WSOL intermediary PDA -- must not exist yet."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  119,
                  115,
                  111,
                  108,
                  95,
                  105,
                  110,
                  116,
                  101,
                  114,
                  109,
                  101,
                  100,
                  105,
                  97,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "swapAuthority",
          "docs": [
            "swap_authority PDA -- will be set as the owner of the WSOL token account."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  119,
                  97,
                  112,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "mint",
          "docs": [
            "WSOL mint (NATIVE_MINT)."
          ]
        },
        {
          "name": "tokenProgram",
          "docs": [
            "SPL Token program."
          ]
        },
        {
          "name": "program",
          "docs": [
            "The Tax Program — used to look up its ProgramData address."
          ],
          "address": "43fZGRtmEsP7ExnJE1dbTbNjaP1ncvVmMPusSeksWGEj"
        },
        {
          "name": "programData",
          "docs": [
            "ProgramData account — upgrade_authority must match admin."
          ]
        },
        {
          "name": "systemProgram",
          "docs": [
            "System program for account creation."
          ],
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "swapExempt",
      "docs": [
        "Execute tax-exempt swap for Carnage Fund (bidirectional).",
        "",
        "Called by Epoch Program during Carnage rebalancing.",
        "No tax applied - only AMM LP fee (1%) applies.",
        "",
        "# Arguments",
        "* `amount_in` - Amount to swap (SOL for buy, token for sell)",
        "* `direction` - 0 = buy (SOL->Token), 1 = sell (Token->SOL)",
        "* `is_crime` - true = CRIME pool, false = FRAUD pool"
      ],
      "discriminator": [
        244,
        95,
        90,
        36,
        153,
        160,
        55,
        12
      ],
      "accounts": [
        {
          "name": "carnageAuthority",
          "docs": [
            "Carnage authority PDA from Epoch Program.",
            "",
            "CRITICAL SECURITY: seeds::program ensures this PDA is derived from Epoch Program.",
            "Only Epoch Program can produce a valid signer with these seeds.",
            "",
            "CROSS-PROGRAM DEPENDENCY:",
            "- Tax Program's CARNAGE_SIGNER_SEED must match Epoch Program's derivation",
            "- Tax Program's epoch_program_id() must match Epoch Program's declare_id!",
            "- If either mismatch, swap_exempt will reject all Carnage calls",
            ""
          ],
          "signer": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  114,
                  110,
                  97,
                  103,
                  101,
                  95,
                  115,
                  105,
                  103,
                  110,
                  101,
                  114
                ]
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                48,
                215,
                35,
                39,
                92,
                255,
                252,
                177,
                255,
                59,
                215,
                14,
                138,
                15,
                252,
                42,
                224,
                251,
                124,
                63,
                231,
                83,
                226,
                150,
                188,
                103,
                242,
                205,
                48,
                27,
                224,
                209
              ]
            }
          }
        },
        {
          "name": "swapAuthority",
          "docs": [
            "Tax Program's swap_authority PDA - signs AMM CPI.",
            "Same derivation as swap_sol_buy/swap_sol_sell.",
            ""
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  119,
                  97,
                  112,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "docs": [
            "AMM pool state - mutable for reserve updates"
          ],
          "writable": true
        },
        {
          "name": "poolVaultA",
          "docs": [
            "Pool's WSOL vault (Token A)"
          ],
          "writable": true
        },
        {
          "name": "poolVaultB",
          "docs": [
            "Pool's CRIME/FRAUD vault (Token B)"
          ],
          "writable": true
        },
        {
          "name": "mintA",
          "docs": [
            "WSOL mint"
          ]
        },
        {
          "name": "mintB",
          "docs": [
            "CRIME or FRAUD mint (Token-2022)"
          ]
        },
        {
          "name": "userTokenA",
          "docs": [
            "Carnage's WSOL token account (or wrapping account)"
          ],
          "writable": true
        },
        {
          "name": "userTokenB",
          "docs": [
            "Carnage's CRIME/FRAUD token account"
          ],
          "writable": true
        },
        {
          "name": "ammProgram",
          "docs": [
            "AMM Program for swap CPI"
          ],
          "address": "5JsSAL3kJDUWD4ZveYXYZmgm1eVqueesTZVdAvtZg8cR"
        },
        {
          "name": "tokenProgramA",
          "docs": [
            "SPL Token program (for WSOL)"
          ]
        },
        {
          "name": "tokenProgramB",
          "docs": [
            "Token-2022 program (for CRIME/FRAUD)"
          ]
        },
        {
          "name": "systemProgram",
          "docs": [
            "System program (may be needed for hook accounts)"
          ],
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amountIn",
          "type": "u64"
        },
        {
          "name": "direction",
          "type": "u8"
        },
        {
          "name": "isCrime",
          "type": "bool"
        }
      ]
    },
    {
      "name": "swapSolBuy",
      "docs": [
        "Execute a SOL -> CRIME/FRAUD swap with buy tax.",
        "",
        "Tax is deducted from SOL input before swap execution.",
        "Distribution: 71% staking, 24% carnage, 5% treasury.",
        "",
        "# Arguments",
        "* `amount_in` - Total SOL amount to spend (including tax)",
        "* `minimum_output` - Minimum tokens expected (slippage protection)",
        "* `is_crime` - true = CRIME pool, false = FRAUD pool"
      ],
      "discriminator": [
        158,
        213,
        169,
        65,
        11,
        116,
        176,
        25
      ],
      "accounts": [
        {
          "name": "user",
          "docs": [
            "User initiating the swap - signs and pays SOL for tax"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "epochState",
          "docs": [
            "EpochState account from Epoch Program.",
            "Provides current tax rates for the swap.",
            "",
            "- Owner check: must be Epoch Program (prevents fake 0% tax)",
            "- Deserialization validates discriminator",
            "- initialized flag checked"
          ]
        },
        {
          "name": "swapAuthority",
          "docs": [
            "Tax Program's swap_authority PDA - signs AMM CPI"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  119,
                  97,
                  112,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "taxAuthority",
          "docs": [
            "Tax Program's tax_authority PDA - signs Staking Program CPI"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  97,
                  120,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "docs": [
            "AMM pool state - mutable for reserve updates"
          ],
          "writable": true
        },
        {
          "name": "poolVaultA",
          "docs": [
            "Pool's WSOL vault (Token A)"
          ],
          "writable": true
        },
        {
          "name": "poolVaultB",
          "docs": [
            "Pool's CRIME/FRAUD vault (Token B)"
          ],
          "writable": true
        },
        {
          "name": "mintA",
          "docs": [
            "WSOL mint"
          ]
        },
        {
          "name": "mintB",
          "docs": [
            "CRIME or FRAUD mint (Token-2022)"
          ]
        },
        {
          "name": "userTokenA",
          "docs": [
            "User's WSOL token account"
          ],
          "writable": true
        },
        {
          "name": "userTokenB",
          "docs": [
            "User's CRIME/FRAUD token account"
          ],
          "writable": true
        },
        {
          "name": "stakePool",
          "docs": [
            "Staking Program's StakePool PDA - updated by deposit_rewards CPI"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                0,
                104,
                20,
                179,
                179,
                68,
                143,
                0,
                241,
                226,
                89,
                81,
                248,
                225,
                107,
                223,
                146,
                8,
                83,
                115,
                114,
                175,
                214,
                74,
                73,
                69,
                149,
                93,
                101,
                252,
                114,
                58
              ]
            }
          }
        },
        {
          "name": "stakingEscrow",
          "docs": [
            "Staking Program escrow - receives 71% of tax (native SOL)"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  115,
                  99,
                  114,
                  111,
                  119,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                0,
                104,
                20,
                179,
                179,
                68,
                143,
                0,
                241,
                226,
                89,
                81,
                248,
                225,
                107,
                223,
                146,
                8,
                83,
                115,
                114,
                175,
                214,
                74,
                73,
                69,
                149,
                93,
                101,
                252,
                114,
                58
              ]
            }
          }
        },
        {
          "name": "carnageVault",
          "docs": [
            "Carnage Fund vault - receives 24% of tax (native SOL)"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  114,
                  110,
                  97,
                  103,
                  101,
                  95,
                  115,
                  111,
                  108,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                48,
                215,
                35,
                39,
                92,
                255,
                252,
                177,
                255,
                59,
                215,
                14,
                138,
                15,
                252,
                42,
                224,
                251,
                124,
                63,
                231,
                83,
                226,
                150,
                188,
                103,
                242,
                205,
                48,
                27,
                224,
                209
              ]
            }
          }
        },
        {
          "name": "treasury",
          "docs": [
            "Protocol treasury - receives 5% of tax (native SOL)"
          ],
          "writable": true,
          "address": "3ihhwLnEJ2duwPSLYxhLbFrdhhxXLcvcrV9rAHqMgzCv"
        },
        {
          "name": "ammProgram",
          "docs": [
            "AMM Program for swap CPI"
          ],
          "address": "5JsSAL3kJDUWD4ZveYXYZmgm1eVqueesTZVdAvtZg8cR"
        },
        {
          "name": "tokenProgramA",
          "docs": [
            "SPL Token program (for WSOL)"
          ]
        },
        {
          "name": "tokenProgramB",
          "docs": [
            "Token-2022 program (for CRIME/FRAUD)"
          ]
        },
        {
          "name": "systemProgram",
          "docs": [
            "System program (for native SOL transfers)"
          ],
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "stakingProgram",
          "docs": [
            "Staking Program for deposit_rewards CPI"
          ],
          "address": "12b3t1cNiAUoYLiWFEnFa4w6qYxVAiqCWU7KZuzLPYtH"
        }
      ],
      "args": [
        {
          "name": "amountIn",
          "type": "u64"
        },
        {
          "name": "minimumOutput",
          "type": "u64"
        },
        {
          "name": "isCrime",
          "type": "bool"
        }
      ]
    },
    {
      "name": "swapSolSell",
      "docs": [
        "Execute a CRIME/FRAUD -> SOL swap with sell tax.",
        "",
        "Tax is deducted from SOL output after swap execution.",
        "Distribution: 71% staking, 24% carnage, 5% treasury.",
        "",
        "# Arguments",
        "* `amount_in` - Token amount to sell",
        "* `minimum_output` - Minimum SOL to receive AFTER tax (slippage protection)",
        "* `is_crime` - true = CRIME pool, false = FRAUD pool"
      ],
      "discriminator": [
        136,
        242,
        218,
        149,
        17,
        222,
        250,
        240
      ],
      "accounts": [
        {
          "name": "user",
          "docs": [
            "User initiating the swap - signs SPL Token transfer of tax WSOL"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "epochState",
          "docs": [
            "EpochState account from Epoch Program.",
            "Provides current tax rates for the swap.",
            "",
            "- Owner check: must be Epoch Program (prevents fake 0% tax)",
            "- Deserialization validates discriminator",
            "- initialized flag checked"
          ]
        },
        {
          "name": "swapAuthority",
          "docs": [
            "Tax Program's swap_authority PDA - signs AMM CPI and tax distribution.",
            "Mutable because it receives lamports from close_account (unwrap)",
            "and sends them to tax destinations via system transfers."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  119,
                  97,
                  112,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "taxAuthority",
          "docs": [
            "Tax Program's tax_authority PDA - signs Staking Program CPI"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  97,
                  120,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "docs": [
            "AMM pool state - mutable for reserve updates"
          ],
          "writable": true
        },
        {
          "name": "poolVaultA",
          "docs": [
            "Pool's WSOL vault (Token A)"
          ],
          "writable": true
        },
        {
          "name": "poolVaultB",
          "docs": [
            "Pool's CRIME/FRAUD vault (Token B)"
          ],
          "writable": true
        },
        {
          "name": "mintA",
          "docs": [
            "WSOL mint"
          ]
        },
        {
          "name": "mintB",
          "docs": [
            "CRIME or FRAUD mint (Token-2022)"
          ]
        },
        {
          "name": "userTokenA",
          "docs": [
            "User's WSOL token account - receives gross output from AMM"
          ],
          "writable": true
        },
        {
          "name": "userTokenB",
          "docs": [
            "User's CRIME/FRAUD token account - sends tokens to AMM"
          ],
          "writable": true
        },
        {
          "name": "stakePool",
          "docs": [
            "Staking Program's StakePool PDA - updated by deposit_rewards CPI"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  101,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                0,
                104,
                20,
                179,
                179,
                68,
                143,
                0,
                241,
                226,
                89,
                81,
                248,
                225,
                107,
                223,
                146,
                8,
                83,
                115,
                114,
                175,
                214,
                74,
                73,
                69,
                149,
                93,
                101,
                252,
                114,
                58
              ]
            }
          }
        },
        {
          "name": "stakingEscrow",
          "docs": [
            "Staking Program escrow - receives 71% of tax (native SOL)"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  115,
                  99,
                  114,
                  111,
                  119,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                0,
                104,
                20,
                179,
                179,
                68,
                143,
                0,
                241,
                226,
                89,
                81,
                248,
                225,
                107,
                223,
                146,
                8,
                83,
                115,
                114,
                175,
                214,
                74,
                73,
                69,
                149,
                93,
                101,
                252,
                114,
                58
              ]
            }
          }
        },
        {
          "name": "carnageVault",
          "docs": [
            "Carnage Fund vault - receives 24% of tax (native SOL)"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  114,
                  110,
                  97,
                  103,
                  101,
                  95,
                  115,
                  111,
                  108,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                48,
                215,
                35,
                39,
                92,
                255,
                252,
                177,
                255,
                59,
                215,
                14,
                138,
                15,
                252,
                42,
                224,
                251,
                124,
                63,
                231,
                83,
                226,
                150,
                188,
                103,
                242,
                205,
                48,
                27,
                224,
                209
              ]
            }
          }
        },
        {
          "name": "treasury",
          "docs": [
            "Protocol treasury - receives 5% of tax (native SOL)"
          ],
          "writable": true,
          "address": "3ihhwLnEJ2duwPSLYxhLbFrdhhxXLcvcrV9rAHqMgzCv"
        },
        {
          "name": "wsolIntermediary",
          "docs": [
            "Protocol-owned WSOL intermediary for atomic tax extraction.",
            "Holds tax portion of WSOL between transfer and unwrap.",
            "Owned by swap_authority PDA.",
            "Closed and re-created each sell to convert WSOL -> native SOL.",
            "",
            "Account may be zero-lamport (just been closed) at validation time",
            "during same-TX sequential sells, but will be recreated within the handler."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  119,
                  115,
                  111,
                  108,
                  95,
                  105,
                  110,
                  116,
                  101,
                  114,
                  109,
                  101,
                  100,
                  105,
                  97,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "ammProgram",
          "docs": [
            "AMM Program for swap CPI"
          ],
          "address": "5JsSAL3kJDUWD4ZveYXYZmgm1eVqueesTZVdAvtZg8cR"
        },
        {
          "name": "tokenProgramA",
          "docs": [
            "SPL Token program (for WSOL)"
          ]
        },
        {
          "name": "tokenProgramB",
          "docs": [
            "Token-2022 program (for CRIME/FRAUD)"
          ]
        },
        {
          "name": "systemProgram",
          "docs": [
            "System program (for native SOL transfers and account creation)"
          ],
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "stakingProgram",
          "docs": [
            "Staking Program for deposit_rewards CPI"
          ],
          "address": "12b3t1cNiAUoYLiWFEnFa4w6qYxVAiqCWU7KZuzLPYtH"
        }
      ],
      "args": [
        {
          "name": "amountIn",
          "type": "u64"
        },
        {
          "name": "minimumOutput",
          "type": "u64"
        },
        {
          "name": "isCrime",
          "type": "bool"
        }
      ]
    }
  ],
  "events": [
    {
      "name": "exemptSwap",
      "discriminator": [
        23,
        109,
        122,
        58,
        241,
        240,
        226,
        146
      ]
    },
    {
      "name": "taxedSwap",
      "discriminator": [
        237,
        18,
        78,
        75,
        209,
        198,
        192,
        30
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidPoolType",
      "msg": "Invalid pool type for this operation"
    },
    {
      "code": 6001,
      "name": "taxOverflow",
      "msg": "Tax calculation overflow"
    },
    {
      "code": 6002,
      "name": "slippageExceeded",
      "msg": "Slippage tolerance exceeded"
    },
    {
      "code": 6003,
      "name": "invalidEpochState",
      "msg": "Invalid epoch state - cannot determine tax rates"
    },
    {
      "code": 6004,
      "name": "insufficientInput",
      "msg": "Insufficient input amount for swap"
    },
    {
      "code": 6005,
      "name": "outputBelowMinimum",
      "msg": "Output amount below minimum"
    },
    {
      "code": 6006,
      "name": "invalidSwapAuthority",
      "msg": "Invalid swap authority PDA"
    },
    {
      "code": 6007,
      "name": "wsolProgramMismatch",
      "msg": "Token program mismatch - expected SPL Token for WSOL"
    },
    {
      "code": 6008,
      "name": "token2022ProgramMismatch",
      "msg": "Token program mismatch - expected Token-2022 for CRIME/FRAUD/PROFIT"
    },
    {
      "code": 6009,
      "name": "invalidTokenOwner",
      "msg": "Invalid token account owner"
    },
    {
      "code": 6010,
      "name": "unauthorizedCarnageCall",
      "msg": "Carnage-only instruction called by non-Carnage authority"
    },
    {
      "code": 6011,
      "name": "invalidStakingEscrow",
      "msg": "Staking escrow PDA mismatch"
    },
    {
      "code": 6012,
      "name": "invalidCarnageVault",
      "msg": "Carnage vault PDA mismatch"
    },
    {
      "code": 6013,
      "name": "invalidTreasury",
      "msg": "Treasury address mismatch"
    },
    {
      "code": 6014,
      "name": "invalidAmmProgram",
      "msg": "AMM program address mismatch"
    },
    {
      "code": 6015,
      "name": "invalidStakingProgram",
      "msg": "Staking program address mismatch"
    },
    {
      "code": 6016,
      "name": "insufficientOutput",
      "msg": "Tax exceeds gross output -- sell amount too small"
    },
    {
      "code": 6017,
      "name": "minimumOutputFloorViolation",
      "msg": "Minimum output below protocol floor (50% of expected)"
    },
    {
      "code": 6018,
      "name": "invalidPoolOwner",
      "msg": "Pool account is not owned by AMM program"
    }
  ],
  "types": [
    {
      "name": "exemptSwap",
      "docs": [
        "Emitted after every tax-exempt Carnage swap operation.",
        "",
        "Carnage swaps bypass tax calculation entirely. This event enables",
        "off-chain monitoring of Carnage rebalancing activity that was previously",
        "invisible (only AMM's SwapEvent was emitted).",
        "",
        "Source: Phase 37 audit finding -- swap_exempt had no event emission"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "docs": [
              "Carnage authority PDA that initiated the swap"
            ],
            "type": "pubkey"
          },
          {
            "name": "pool",
            "docs": [
              "AMM pool used for the swap"
            ],
            "type": "pubkey"
          },
          {
            "name": "amountA",
            "docs": [
              "Amount swapped (SOL for buy, token for sell)"
            ],
            "type": "u64"
          },
          {
            "name": "direction",
            "docs": [
              "Swap direction: 0 = buy (AtoB), 1 = sell (BtoA)"
            ],
            "type": "u8"
          },
          {
            "name": "slot",
            "docs": [
              "Slot when swap occurred"
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "poolType",
      "docs": [
        "Pool type identifier for events.",
        "",
        "Identifies which AMM pool was used in a swap operation."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "solCrime"
          },
          {
            "name": "solFraud"
          }
        ]
      }
    },
    {
      "name": "swapDirection",
      "docs": [
        "Swap direction for events."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "buy"
          },
          {
            "name": "sell"
          }
        ]
      }
    },
    {
      "name": "taxedSwap",
      "docs": [
        "Emitted after every taxed swap operation.",
        "",
        "Contains full breakdown of the swap including tax calculation and distribution.",
        "Used by off-chain analytics and frontends."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "docs": [
              "User who initiated the swap"
            ],
            "type": "pubkey"
          },
          {
            "name": "poolType",
            "docs": [
              "Which pool was used"
            ],
            "type": {
              "defined": {
                "name": "poolType"
              }
            }
          },
          {
            "name": "direction",
            "docs": [
              "Buy or Sell direction"
            ],
            "type": {
              "defined": {
                "name": "swapDirection"
              }
            }
          },
          {
            "name": "inputAmount",
            "docs": [
              "Amount user put in (SOL for buy, tokens for sell)"
            ],
            "type": "u64"
          },
          {
            "name": "outputAmount",
            "docs": [
              "Amount user received (tokens for buy, SOL for sell)"
            ],
            "type": "u64"
          },
          {
            "name": "taxAmount",
            "docs": [
              "Total tax collected (in SOL lamports)"
            ],
            "type": "u64"
          },
          {
            "name": "taxRateBps",
            "docs": [
              "Tax rate applied (in basis points)"
            ],
            "type": "u16"
          },
          {
            "name": "stakingPortion",
            "docs": [
              "SOL sent to staking escrow (71%)"
            ],
            "type": "u64"
          },
          {
            "name": "carnagePortion",
            "docs": [
              "SOL sent to carnage fund (24%)"
            ],
            "type": "u64"
          },
          {
            "name": "treasuryPortion",
            "docs": [
              "SOL sent to treasury (5%, remainder)"
            ],
            "type": "u64"
          },
          {
            "name": "epoch",
            "docs": [
              "Epoch number when swap occurred"
            ],
            "type": "u32"
          },
          {
            "name": "slot",
            "docs": [
              "Slot when swap occurred"
            ],
            "type": "u64"
          }
        ]
      }
    }
  ]
};
