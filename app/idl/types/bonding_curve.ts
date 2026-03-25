/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/bonding_curve.json`.
 */
export type BondingCurve = {
  "address": "DpX3AhSU3BELfBiGbmBMYLPp8VAy3jbEVt6bQjrxUarV",
  "metadata": {
    "name": "bondingCurve",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Dr Fraudsworth Bonding Curve - Linear price discovery for CRIME and FRAUD"
  },
  "instructions": [
    {
      "name": "burnBcAdmin",
      "docs": [
        "Permanently burn the admin key by setting authority to Pubkey::default().",
        "After this, all admin-gated instructions become permanently uncallable.",
        "Irreversible. Only the current authority can call this."
      ],
      "discriminator": [
        130,
        113,
        240,
        122,
        168,
        198,
        235,
        246
      ],
      "accounts": [
        {
          "name": "authority",
          "docs": [
            "The current authority. Must match admin_config.authority."
          ],
          "signer": true,
          "relations": [
            "adminConfig"
          ]
        },
        {
          "name": "adminConfig",
          "docs": [
            "The BcAdminConfig PDA. After this instruction, authority will be Pubkey::default()."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  99,
                  95,
                  97,
                  100,
                  109,
                  105,
                  110
                ]
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "claimRefund",
      "docs": [
        "Burn tokens and claim proportional SOL refund.",
        "User-signed: burns the caller's entire token balance."
      ],
      "discriminator": [
        15,
        16,
        30,
        161,
        255,
        228,
        97,
        60
      ],
      "accounts": [
        {
          "name": "user",
          "docs": [
            "The user claiming the refund. Receives SOL."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "curveState",
          "docs": [
            "CurveState PDA. Seeds: [\"curve\", token_mint]."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ]
          }
        },
        {
          "name": "partnerCurveState",
          "docs": [
            "Partner CurveState PDA (read-only).",
            "Required for is_refund_eligible() compound state check.",
            "Must be a different curve than curve_state."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "partner_curve_state.token_mint",
                "account": "curveState"
              }
            ]
          }
        },
        {
          "name": "userTokenAccount",
          "docs": [
            "User's ATA for this token. Must already exist (user holds tokens).",
            "Marked mut because burn deducts from this account."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenMint",
          "docs": [
            "Token mint (CRIME or FRAUD).",
            "Marked mut because burn reduces the mint's total_supply."
          ],
          "writable": true
        },
        {
          "name": "solVault",
          "docs": [
            "SOL vault PDA -- sends SOL refund to user.",
            "Seeds: [\"curve_sol_vault\", token_mint]."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
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
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "closeTokenVault",
      "docs": [
        "Close a graduated curve's empty token vault, recovering rent to admin.",
        "Admin-only: only the protocol deployer can call.",
        "Vault must have 0 token balance."
      ],
      "discriminator": [
        30,
        14,
        239,
        231,
        79,
        189,
        15,
        252
      ],
      "accounts": [
        {
          "name": "authority",
          "docs": [
            "Protocol authority (deployer). Must match BcAdminConfig.authority. Receives rent."
          ],
          "writable": true,
          "signer": true,
          "relations": [
            "adminConfig"
          ]
        },
        {
          "name": "adminConfig",
          "docs": [
            "BcAdminConfig PDA -- gates admin operations."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  99,
                  95,
                  97,
                  100,
                  109,
                  105,
                  110
                ]
              }
            ]
          }
        },
        {
          "name": "curveState",
          "docs": [
            "CurveState PDA -- must be Graduated.",
            "Seeds: [\"curve\", token_mint]. Acts as token vault authority for close CPI."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "curve_state.token_mint",
                "account": "curveState"
              }
            ]
          }
        },
        {
          "name": "tokenVault",
          "docs": [
            "Token vault PDA to close. Must be empty (0 token balance).",
            "Seeds: [\"curve_token_vault\", token_mint]. Validated against curve_state."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
                  101,
                  95,
                  116,
                  111,
                  107,
                  101,
                  110,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "curve_state.token_mint",
                "account": "curveState"
              }
            ]
          }
        },
        {
          "name": "tokenMint",
          "docs": [
            "Token mint (for close_account CPI context)."
          ]
        },
        {
          "name": "tokenProgram",
          "docs": [
            "Token-2022 program (CRIME/FRAUD use Token-2022)."
          ]
        }
      ],
      "args": []
    },
    {
      "name": "consolidateForRefund",
      "docs": [
        "Consolidate tax escrow into SOL vault for refunds.",
        "Permissionless: anyone can call once the curve is refund-eligible."
      ],
      "discriminator": [
        71,
        201,
        201,
        251,
        86,
        195,
        59,
        26
      ],
      "accounts": [
        {
          "name": "curveState",
          "docs": [
            "CurveState PDA for the curve being consolidated.",
            "Seeds: [\"curve\", token_mint]."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "curve_state.token_mint",
                "account": "curveState"
              }
            ]
          }
        },
        {
          "name": "partnerCurveState",
          "docs": [
            "Partner CurveState PDA (read-only).",
            "Required for is_refund_eligible() compound state check.",
            "Must be a different curve than curve_state (prevents passing same curve",
            "as its own partner, which would bypass the partner status check)."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "partner_curve_state.token_mint",
                "account": "curveState"
              }
            ]
          }
        },
        {
          "name": "taxEscrow",
          "docs": [
            "Tax escrow PDA -- SOL-only, owned by bonding curve program.",
            "Seeds: [\"tax_escrow\", token_mint]."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  97,
                  120,
                  95,
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "curve_state.token_mint",
                "account": "curveState"
              }
            ]
          }
        },
        {
          "name": "solVault",
          "docs": [
            "SOL vault PDA -- receives consolidated escrow lamports.",
            "Seeds: [\"curve_sol_vault\", token_mint]."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
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
              },
              {
                "kind": "account",
                "path": "curve_state.token_mint",
                "account": "curveState"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "distributeTaxEscrow",
      "docs": [
        "Distribute tax escrow SOL to the carnage fund after graduation.",
        "Permissionless: anyone can call once the curve has graduated."
      ],
      "discriminator": [
        79,
        252,
        87,
        113,
        187,
        44,
        217,
        53
      ],
      "accounts": [
        {
          "name": "curveState",
          "docs": [
            "CurveState PDA (read-only -- no state mutations).",
            "Seeds: [\"curve\", token_mint]."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "curve_state.token_mint",
                "account": "curveState"
              }
            ]
          }
        },
        {
          "name": "taxEscrow",
          "docs": [
            "Tax escrow PDA -- SOL-only, owned by bonding curve program.",
            "Seeds: [\"tax_escrow\", token_mint]."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  97,
                  120,
                  95,
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "curve_state.token_mint",
                "account": "curveState"
              }
            ]
          }
        },
        {
          "name": "carnageFund",
          "docs": [
            "Carnage fund SOL vault PDA (owned by epoch program)."
          ],
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "fundCurve",
      "docs": [
        "Fund the curve's token vault with the 460M tokens for sale.",
        "Must be called after initialize_curve and before start_curve.",
        "Accepts remaining_accounts for Transfer Hook support."
      ],
      "discriminator": [
        107,
        84,
        250,
        5,
        251,
        214,
        240,
        30
      ],
      "accounts": [
        {
          "name": "authority",
          "docs": [
            "Protocol authority. Must match BcAdminConfig.authority. Signs the token transfer."
          ],
          "writable": true,
          "signer": true,
          "relations": [
            "adminConfig"
          ]
        },
        {
          "name": "adminConfig",
          "docs": [
            "BcAdminConfig PDA -- gates admin operations."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  99,
                  95,
                  97,
                  100,
                  109,
                  105,
                  110
                ]
              }
            ]
          }
        },
        {
          "name": "curveState",
          "docs": [
            "CurveState PDA -- must be in Initialized status.",
            "Not mutated (status doesn't change on fund, only on start)."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ]
          }
        },
        {
          "name": "authorityTokenAccount",
          "docs": [
            "Authority's token account (source of 460M tokens).",
            "This is typically the admin's ATA for this token."
          ],
          "writable": true
        },
        {
          "name": "tokenVault",
          "docs": [
            "Curve's token vault PDA (destination).",
            "Authority is curve_state PDA (set during initialize_curve)."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
                  101,
                  95,
                  116,
                  111,
                  107,
                  101,
                  110,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ]
          }
        },
        {
          "name": "tokenMint",
          "docs": [
            "Token mint for transfer_checked decimals validation."
          ]
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "initializeBcAdmin",
      "docs": [
        "Initialize the BcAdminConfig PDA. Only callable by the program's",
        "upgrade authority (verified via ProgramData). Stores the admin pubkey",
        "that gates all admin-only instructions."
      ],
      "discriminator": [
        112,
        40,
        233,
        97,
        54,
        70,
        4,
        246
      ],
      "accounts": [
        {
          "name": "authority",
          "docs": [
            "The program's upgrade authority. Must sign to prove deployer identity."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "adminConfig",
          "docs": [
            "The BcAdminConfig PDA. Initialized once; stores the authority pubkey and bump.",
            "Seeds: [b\"bc_admin\"]"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  99,
                  95,
                  97,
                  100,
                  109,
                  105,
                  110
                ]
              }
            ]
          }
        },
        {
          "name": "program",
          "docs": [
            "The BondingCurve program itself -- used to look up its programdata address."
          ],
          "address": "DpX3AhSU3BELfBiGbmBMYLPp8VAy3jbEVt6bQjrxUarV"
        },
        {
          "name": "programData",
          "docs": [
            "The program's ProgramData account (created by the BPF loader on deploy).",
            "Constraint: its upgrade_authority_address must equal the signing authority.",
            "This is how we verify the caller is the deployer."
          ]
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "admin",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "initializeCurve",
      "docs": [
        "Initialize a CurveState PDA for a given token (CRIME or FRAUD).",
        "Creates the curve in `Initialized` status with all counters zeroed.",
        "Also creates token vault, SOL vault, and tax escrow PDAs.",
        "Admin-only: only the protocol authority can call this."
      ],
      "discriminator": [
        170,
        84,
        186,
        253,
        131,
        149,
        95,
        213
      ],
      "accounts": [
        {
          "name": "authority",
          "docs": [
            "Protocol authority. Must match BcAdminConfig.authority. Pays rent for all new accounts."
          ],
          "writable": true,
          "signer": true,
          "relations": [
            "adminConfig"
          ]
        },
        {
          "name": "adminConfig",
          "docs": [
            "BcAdminConfig PDA -- gates admin operations."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  99,
                  95,
                  97,
                  100,
                  109,
                  105,
                  110
                ]
              }
            ]
          }
        },
        {
          "name": "curveState",
          "docs": [
            "CurveState PDA -- seeds: [\"curve\", token_mint].",
            "Initialized with space for the full CurveState struct."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ]
          }
        },
        {
          "name": "tokenVault",
          "docs": [
            "Token vault PDA -- holds 460M tokens for sale.",
            "Authority is the curve_state PDA (transfers out require PDA signer).",
            "Seeds: [\"curve_token_vault\", token_mint]."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
                  101,
                  95,
                  116,
                  111,
                  107,
                  101,
                  110,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ]
          }
        },
        {
          "name": "solVault",
          "docs": [
            "SOL vault PDA -- 0-byte SOL-only account that holds raised SOL.",
            "Balance is tracked via lamports, not data fields.",
            "Seeds: [\"curve_sol_vault\", token_mint]."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
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
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ]
          }
        },
        {
          "name": "taxEscrow",
          "docs": [
            "Tax escrow PDA -- 0-byte SOL-only account that holds sell tax.",
            "See Bonding_Curve_Spec.md Section 5.7.",
            "Seeds: [\"tax_escrow\", token_mint]."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  97,
                  120,
                  95,
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ]
          }
        },
        {
          "name": "tokenMint",
          "docs": [
            "Token mint (CRIME or FRAUD). Validated via feature-gated constraint.",
            "In localnet mode, any mint is accepted for testing flexibility."
          ]
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "token",
          "type": {
            "defined": {
              "name": "token"
            }
          }
        },
        {
          "name": "partnerMint",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "markFailed",
      "docs": [
        "Mark a curve as Failed after deadline + grace buffer expires.",
        "Permissionless: anyone can call once the deadline has passed."
      ],
      "discriminator": [
        58,
        234,
        53,
        63,
        84,
        15,
        46,
        105
      ],
      "accounts": [
        {
          "name": "curveState",
          "docs": [
            "CurveState PDA. Seeds: [\"curve\", token_mint].",
            "Status check is in handler (not constraint) for specific error messages."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "curve_state.token_mint",
                "account": "curveState"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "prepareTransition",
      "docs": [
        "Transition both curves from Filled to Graduated.",
        "Admin-only: only the protocol deployer can call."
      ],
      "discriminator": [
        2,
        73,
        144,
        243,
        89,
        165,
        158,
        96
      ],
      "accounts": [
        {
          "name": "authority",
          "docs": [
            "Protocol authority (deployer). Must match BcAdminConfig.authority."
          ],
          "signer": true,
          "relations": [
            "adminConfig"
          ]
        },
        {
          "name": "adminConfig",
          "docs": [
            "BcAdminConfig PDA -- gates admin operations."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  99,
                  95,
                  97,
                  100,
                  109,
                  105,
                  110
                ]
              }
            ]
          }
        },
        {
          "name": "crimeCurveState",
          "docs": [
            "CRIME CurveState PDA. Seeds: [\"curve\", crime_token_mint]."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "crime_curve_state.token_mint",
                "account": "curveState"
              }
            ]
          }
        },
        {
          "name": "fraudCurveState",
          "docs": [
            "FRAUD CurveState PDA. Seeds: [\"curve\", fraud_token_mint]."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "fraud_curve_state.token_mint",
                "account": "curveState"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "purchase",
      "docs": [
        "Purchase tokens from the curve with SOL.",
        "Walks the linear price curve forward, enforces per-wallet cap and minimum purchase.",
        "Accepts remaining_accounts for Transfer Hook support (CRIME/FRAUD use Token-2022 hooks)."
      ],
      "discriminator": [
        21,
        93,
        113,
        154,
        193,
        160,
        242,
        168
      ],
      "accounts": [
        {
          "name": "user",
          "docs": [
            "The buyer. Pays SOL and receives tokens."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "curveState",
          "docs": [
            "CurveState PDA -- must be Active. Seeds: [\"curve\", token_mint]."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ]
          }
        },
        {
          "name": "userTokenAccount",
          "docs": [
            "User's ATA for this token. Created if it doesn't exist (init_if_needed).",
            "Used for wallet cap enforcement (read balance before transfer)."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenVault",
          "docs": [
            "Curve's token vault PDA. Authority is curve_state PDA.",
            "Seeds: [\"curve_token_vault\", token_mint]."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
                  101,
                  95,
                  116,
                  111,
                  107,
                  101,
                  110,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ]
          }
        },
        {
          "name": "solVault",
          "docs": [
            "SOL vault PDA -- 0-byte SOL-only account that holds raised SOL.",
            "Seeds: [\"curve_sol_vault\", token_mint]."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
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
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ]
          }
        },
        {
          "name": "tokenMint",
          "docs": [
            "Token mint (CRIME or FRAUD)."
          ]
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "solAmount",
          "type": "u64"
        },
        {
          "name": "minimumTokensOut",
          "type": "u64"
        }
      ]
    },
    {
      "name": "sell",
      "docs": [
        "Sell tokens back to the curve for SOL minus 15% tax.",
        "Tax is routed to a separate escrow PDA.",
        "Accepts remaining_accounts for Transfer Hook support."
      ],
      "discriminator": [
        51,
        230,
        133,
        164,
        1,
        127,
        131,
        173
      ],
      "accounts": [
        {
          "name": "user",
          "docs": [
            "The seller. Receives SOL minus tax."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "curveState",
          "docs": [
            "CurveState PDA -- must be Active. Seeds: [\"curve\", token_mint]."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ]
          }
        },
        {
          "name": "userTokenAccount",
          "docs": [
            "User's ATA for this token. Must already exist (seller owns tokens)."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenVault",
          "docs": [
            "Curve's token vault PDA. Receives tokens back from seller.",
            "Seeds: [\"curve_token_vault\", token_mint]."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
                  101,
                  95,
                  116,
                  111,
                  107,
                  101,
                  110,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ]
          }
        },
        {
          "name": "solVault",
          "docs": [
            "SOL vault PDA -- sends SOL to user and tax to escrow.",
            "Seeds: [\"curve_sol_vault\", token_mint]."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
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
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ]
          }
        },
        {
          "name": "taxEscrow",
          "docs": [
            "Tax escrow PDA -- receives 15% sell tax.",
            "Seeds: [\"tax_escrow\", token_mint]."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  97,
                  120,
                  95,
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ]
          }
        },
        {
          "name": "tokenMint",
          "docs": [
            "Token mint (CRIME or FRAUD)."
          ]
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "tokensToSell",
          "type": "u64"
        },
        {
          "name": "minimumSolOut",
          "type": "u64"
        }
      ]
    },
    {
      "name": "startCurve",
      "docs": [
        "Activate the curve: sets status to Active, records start_slot and deadline_slot.",
        "Validates that the token vault is fully funded before activation."
      ],
      "discriminator": [
        145,
        211,
        49,
        178,
        173,
        221,
        188,
        0
      ],
      "accounts": [
        {
          "name": "authority",
          "docs": [
            "Protocol authority. Must match BcAdminConfig.authority."
          ],
          "signer": true,
          "relations": [
            "adminConfig"
          ]
        },
        {
          "name": "adminConfig",
          "docs": [
            "BcAdminConfig PDA -- gates admin operations."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  99,
                  95,
                  97,
                  100,
                  109,
                  105,
                  110
                ]
              }
            ]
          }
        },
        {
          "name": "curveState",
          "docs": [
            "CurveState PDA -- must be in Initialized status. Mutated to Active."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ]
          }
        },
        {
          "name": "tokenVault",
          "docs": [
            "Token vault PDA -- read-only to check balance >= TARGET_TOKENS."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
                  101,
                  95,
                  116,
                  111,
                  107,
                  101,
                  110,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "tokenMint"
              }
            ]
          }
        },
        {
          "name": "tokenMint",
          "docs": [
            "Token mint for vault validation."
          ]
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "transferBcAdmin",
      "docs": [
        "Transfer the admin authority to a new pubkey (e.g., Squads multisig vault).",
        "Only the current authority can call this. new_authority must not be Pubkey::default()."
      ],
      "discriminator": [
        219,
        248,
        102,
        85,
        182,
        244,
        4,
        229
      ],
      "accounts": [
        {
          "name": "authority",
          "docs": [
            "The current authority. Must match admin_config.authority."
          ],
          "signer": true,
          "relations": [
            "adminConfig"
          ]
        },
        {
          "name": "adminConfig",
          "docs": [
            "The BcAdminConfig PDA. After this instruction, authority will be new_authority."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  99,
                  95,
                  97,
                  100,
                  109,
                  105,
                  110
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "newAuthority",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "withdrawGraduatedSol",
      "docs": [
        "Withdraw SOL from a graduated curve's SOL vault.",
        "Admin-only: only the protocol deployer can call.",
        "Leaves rent-exempt minimum in vault. Idempotent."
      ],
      "discriminator": [
        157,
        131,
        148,
        227,
        83,
        126,
        26,
        20
      ],
      "accounts": [
        {
          "name": "authority",
          "docs": [
            "Protocol authority (deployer). Must match BcAdminConfig.authority. Receives SOL."
          ],
          "writable": true,
          "signer": true,
          "relations": [
            "adminConfig"
          ]
        },
        {
          "name": "adminConfig",
          "docs": [
            "BcAdminConfig PDA -- gates admin operations."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  99,
                  95,
                  97,
                  100,
                  109,
                  105,
                  110
                ]
              }
            ]
          }
        },
        {
          "name": "curveState",
          "docs": [
            "CurveState PDA -- must be Graduated.",
            "Seeds: [\"curve\", token_mint]."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "curve_state.token_mint",
                "account": "curveState"
              }
            ]
          }
        },
        {
          "name": "solVault",
          "docs": [
            "SOL vault PDA -- source of SOL.",
            "Seeds: [\"curve_sol_vault\", token_mint]. Validated against curve_state.sol_vault."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  117,
                  114,
                  118,
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
              },
              {
                "kind": "account",
                "path": "curve_state.token_mint",
                "account": "curveState"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "bcAdminConfig",
      "discriminator": [
        219,
        130,
        36,
        135,
        38,
        220,
        117,
        35
      ]
    },
    {
      "name": "curveState",
      "discriminator": [
        198,
        152,
        48,
        255,
        91,
        4,
        10,
        197
      ]
    }
  ],
  "events": [
    {
      "name": "curveFailed",
      "discriminator": [
        108,
        71,
        25,
        105,
        114,
        115,
        86,
        164
      ]
    },
    {
      "name": "curveFilled",
      "discriminator": [
        232,
        202,
        225,
        20,
        243,
        144,
        91,
        100
      ]
    },
    {
      "name": "curveFunded",
      "discriminator": [
        202,
        206,
        210,
        180,
        127,
        120,
        93,
        103
      ]
    },
    {
      "name": "curveInitialized",
      "discriminator": [
        190,
        125,
        131,
        238,
        194,
        229,
        201,
        66
      ]
    },
    {
      "name": "curveStarted",
      "discriminator": [
        122,
        40,
        67,
        86,
        1,
        206,
        50,
        203
      ]
    },
    {
      "name": "escrowConsolidated",
      "discriminator": [
        60,
        22,
        107,
        62,
        113,
        162,
        204,
        216
      ]
    },
    {
      "name": "escrowDistributed",
      "discriminator": [
        58,
        107,
        128,
        41,
        125,
        252,
        91,
        239
      ]
    },
    {
      "name": "refundClaimed",
      "discriminator": [
        136,
        64,
        242,
        99,
        4,
        244,
        208,
        130
      ]
    },
    {
      "name": "solWithdrawn",
      "discriminator": [
        145,
        249,
        69,
        48,
        206,
        86,
        91,
        66
      ]
    },
    {
      "name": "taxCollected",
      "discriminator": [
        101,
        55,
        1,
        91,
        200,
        239,
        83,
        30
      ]
    },
    {
      "name": "tokenVaultClosed",
      "discriminator": [
        205,
        163,
        41,
        212,
        150,
        236,
        142,
        154
      ]
    },
    {
      "name": "tokensPurchased",
      "discriminator": [
        214,
        119,
        105,
        186,
        114,
        205,
        228,
        181
      ]
    },
    {
      "name": "tokensSold",
      "discriminator": [
        217,
        83,
        68,
        137,
        134,
        225,
        94,
        45
      ]
    },
    {
      "name": "transitionComplete",
      "discriminator": [
        50,
        138,
        150,
        95,
        120,
        0,
        144,
        94
      ]
    },
    {
      "name": "transitionPrepared",
      "discriminator": [
        254,
        166,
        230,
        228,
        223,
        188,
        216,
        248
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "unauthorized",
      "msg": "Unauthorized: caller is not the admin"
    },
    {
      "code": 6001,
      "name": "overflow",
      "msg": "Arithmetic overflow in curve calculation"
    },
    {
      "code": 6002,
      "name": "curveNotActive",
      "msg": "Curve is not active for purchases"
    },
    {
      "code": 6003,
      "name": "curveNotActiveForSell",
      "msg": "Curve is not active for sells"
    },
    {
      "code": 6004,
      "name": "deadlinePassed",
      "msg": "Curve deadline has passed"
    },
    {
      "code": 6005,
      "name": "belowMinimum",
      "msg": "Purchase amount is below minimum (0.05 SOL)"
    },
    {
      "code": 6006,
      "name": "walletCapExceeded",
      "msg": "Purchase would exceed per-wallet cap of 20M tokens"
    },
    {
      "code": 6007,
      "name": "slippageExceeded",
      "msg": "Slippage exceeded -- output below minimum specified"
    },
    {
      "code": 6008,
      "name": "invalidStatus",
      "msg": "Invalid curve status for this operation"
    },
    {
      "code": 6009,
      "name": "curveNotFunded",
      "msg": "Curve token vault has not been funded"
    },
    {
      "code": 6010,
      "name": "zeroAmount",
      "msg": "Token amount must be greater than zero"
    },
    {
      "code": 6011,
      "name": "insufficientTokenBalance",
      "msg": "Insufficient token balance for sell"
    },
    {
      "code": 6012,
      "name": "escrowNotConsolidated",
      "msg": "Tax escrow must be consolidated before refund"
    },
    {
      "code": 6013,
      "name": "notRefundEligible",
      "msg": "Curve is not eligible for refunds"
    },
    {
      "code": 6014,
      "name": "curveAlreadyFilled",
      "msg": "Curve has already reached its target"
    },
    {
      "code": 6015,
      "name": "insufficientTokensOut",
      "msg": "Purchase too small -- calculated tokens out is zero"
    },
    {
      "code": 6016,
      "name": "vaultInsolvency",
      "msg": "Vault solvency invariant violated -- SOL vault balance below expected"
    },
    {
      "code": 6017,
      "name": "deadlineNotPassed",
      "msg": "Deadline and grace period have not passed yet"
    },
    {
      "code": 6018,
      "name": "curveNotGraduated",
      "msg": "Curve has not graduated"
    },
    {
      "code": 6019,
      "name": "nothingToBurn",
      "msg": "No tokens to burn -- user balance is zero"
    },
    {
      "code": 6020,
      "name": "escrowAlreadyConsolidated",
      "msg": "Tax escrow has already been consolidated"
    },
    {
      "code": 6021,
      "name": "escrowAlreadyDistributed",
      "msg": "Tax escrow has already been distributed"
    },
    {
      "code": 6022,
      "name": "crimeCurveNotFilled",
      "msg": "CRIME curve is not filled"
    },
    {
      "code": 6023,
      "name": "fraudCurveNotFilled",
      "msg": "FRAUD curve is not filled"
    },
    {
      "code": 6024,
      "name": "noTokensOutstanding",
      "msg": "No tokens outstanding -- cannot calculate refund"
    },
    {
      "code": 6025,
      "name": "partialFillOvercharge",
      "msg": "Partial fill overcharge -- actual SOL exceeds input amount"
    },
    {
      "code": 6026,
      "name": "invalidPartnerCurve",
      "msg": "Invalid partner curve -- token mint mismatch"
    },
    {
      "code": 6027,
      "name": "invalidHookAccounts",
      "msg": "Invalid hook accounts -- expected exactly 4 remaining accounts"
    },
    {
      "code": 6028,
      "name": "invalidAuthority",
      "msg": "Invalid authority: cannot transfer to Pubkey::default()"
    }
  ],
  "types": [
    {
      "name": "bcAdminConfig",
      "docs": [
        "Global admin configuration for the Bonding Curve program.",
        "",
        "This PDA is initialized once by the program's upgrade authority,",
        "storing the admin pubkey that gates all admin-only instructions",
        "(initialize_curve, fund_curve, start_curve, prepare_transition,",
        "withdraw_graduated_sol, close_token_vault).",
        "",
        "The admin can be a multisig address — not required to be the upgrade authority.",
        "Once burned (authority set to Pubkey::default()), admin operations are",
        "permanently disabled.",
        "",
        "Seeds: [b\"bc_admin\"]"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "docs": [
              "The admin pubkey authorized to perform admin operations.",
              "Set to Pubkey::default() after burn to permanently revoke."
            ],
            "type": "pubkey"
          },
          {
            "name": "bump",
            "docs": [
              "PDA bump seed for re-derivation in downstream instructions."
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "curveFailed",
      "docs": [
        "Emitted when the curve fails (deadline passed without filling)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "token",
            "type": {
              "defined": {
                "name": "token"
              }
            }
          },
          {
            "name": "tokensSold",
            "type": "u64"
          },
          {
            "name": "solRaised",
            "type": "u64"
          },
          {
            "name": "deadlineSlot",
            "type": "u64"
          },
          {
            "name": "currentSlot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "curveFilled",
      "docs": [
        "Emitted when the curve reaches its target (460M sold / 1000 SOL raised)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "token",
            "type": {
              "defined": {
                "name": "token"
              }
            }
          },
          {
            "name": "totalSold",
            "type": "u64"
          },
          {
            "name": "totalRaised",
            "type": "u64"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "curveFunded",
      "docs": [
        "Emitted when the curve's token vault is funded with 460M tokens."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "token",
            "type": {
              "defined": {
                "name": "token"
              }
            }
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "curveInitialized",
      "docs": [
        "Emitted when a new bonding curve is initialized for a token."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "token",
            "type": {
              "defined": {
                "name": "token"
              }
            }
          },
          {
            "name": "tokenMint",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "curveStarted",
      "docs": [
        "Emitted when the curve is activated for purchases."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "token",
            "type": {
              "defined": {
                "name": "token"
              }
            }
          },
          {
            "name": "startSlot",
            "type": "u64"
          },
          {
            "name": "deadlineSlot",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "curveState",
      "docs": [
        "Per-token bonding curve state account.",
        "",
        "One CurveState exists for CRIME, one for FRAUD.",
        "Seeds: [\"curve\", token_mint].",
        "",
        "Size: 8 (discriminator) + 224 (data) = 232 bytes.",
        "",
        "Field sizes:",
        "token:            1 byte  (enum Tag)",
        "token_mint:      32 bytes (Pubkey)",
        "token_vault:     32 bytes (Pubkey)",
        "sol_vault:       32 bytes (Pubkey)",
        "tokens_sold:      8 bytes (u64)",
        "sol_raised:       8 bytes (u64)",
        "status:           1 byte  (enum Tag)",
        "start_slot:       8 bytes (u64)",
        "deadline_slot:    8 bytes (u64)",
        "participant_count: 4 bytes (u32)",
        "tokens_returned:  8 bytes (u64)",
        "sol_returned:     8 bytes (u64)",
        "tax_collected:    8 bytes (u64)",
        "tax_escrow:      32 bytes (Pubkey)",
        "bump:             1 byte  (u8)",
        "escrow_consolidated: 1 byte (bool)",
        "partner_mint:    32 bytes (Pubkey)",
        "-------------------------",
        "Total data:     224 bytes"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "token",
            "docs": [
              "Token this curve is selling (CRIME or FRAUD)."
            ],
            "type": {
              "defined": {
                "name": "token"
              }
            }
          },
          {
            "name": "tokenMint",
            "docs": [
              "Mint address of the token being sold."
            ],
            "type": "pubkey"
          },
          {
            "name": "tokenVault",
            "docs": [
              "PDA holding tokens for sale."
            ],
            "type": "pubkey"
          },
          {
            "name": "solVault",
            "docs": [
              "PDA holding raised SOL."
            ],
            "type": "pubkey"
          },
          {
            "name": "tokensSold",
            "docs": [
              "Total tokens currently sold (decreases on sells)."
            ],
            "type": "u64"
          },
          {
            "name": "solRaised",
            "docs": [
              "Total SOL raised from buys (gross, does not decrease on sells)."
            ],
            "type": "u64"
          },
          {
            "name": "status",
            "docs": [
              "Curve status."
            ],
            "type": {
              "defined": {
                "name": "curveStatus"
              }
            }
          },
          {
            "name": "startSlot",
            "docs": [
              "Slot when curve started (0 if not started)."
            ],
            "type": "u64"
          },
          {
            "name": "deadlineSlot",
            "docs": [
              "Deadline slot (start_slot + DEADLINE_SLOTS)."
            ],
            "type": "u64"
          },
          {
            "name": "participantCount",
            "docs": [
              "Number of unique purchasers (incremented on first buy when user ATA balance was 0)."
            ],
            "type": "u32"
          },
          {
            "name": "tokensReturned",
            "docs": [
              "Cumulative tokens returned to curve via sells."
            ],
            "type": "u64"
          },
          {
            "name": "solReturned",
            "docs": [
              "Cumulative SOL returned to sellers (gross, before tax deduction)."
            ],
            "type": "u64"
          },
          {
            "name": "taxCollected",
            "docs": [
              "Cumulative sell tax collected (15% of gross sell proceeds)."
            ],
            "type": "u64"
          },
          {
            "name": "taxEscrow",
            "docs": [
              "PDA address of this curve's tax escrow account."
            ],
            "type": "pubkey"
          },
          {
            "name": "bump",
            "docs": [
              "PDA bump for this CurveState."
            ],
            "type": "u8"
          },
          {
            "name": "escrowConsolidated",
            "docs": [
              "Whether tax escrow has been consolidated into sol_vault for refunds."
            ],
            "type": "bool"
          },
          {
            "name": "partnerMint",
            "docs": [
              "Mint address of the partner curve's token (CRIME curve stores FRAUD mint, vice versa).",
              "Used to validate partner_curve_state identity in claim_refund / consolidate_for_refund."
            ],
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "curveStatus",
      "docs": [
        "Lifecycle status of a bonding curve.",
        "",
        "State machine transitions:",
        "Initialized -> Active      (start_curve: curve funded, authority calls)",
        "Active      -> Filled      (purchase: tokens_sold >= TARGET_TOKENS)",
        "Active      -> Failed      (mark_failed: clock.slot > deadline_slot)",
        "Filled      -> Graduated   (finalize_transition: partner also Filled/Graduated)",
        "",
        "Terminal states: Graduated, Failed."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "initialized"
          },
          {
            "name": "active"
          },
          {
            "name": "filled"
          },
          {
            "name": "failed"
          },
          {
            "name": "graduated"
          }
        ]
      }
    },
    {
      "name": "escrowConsolidated",
      "docs": [
        "Emitted when tax escrow is consolidated back into the SOL vault (for refunds)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "token",
            "type": {
              "defined": {
                "name": "token"
              }
            }
          },
          {
            "name": "escrowAmount",
            "docs": [
              "Lamports moved from escrow to vault."
            ],
            "type": "u64"
          },
          {
            "name": "newVaultBalance",
            "docs": [
              "SOL vault balance after consolidation."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "escrowDistributed",
      "docs": [
        "Emitted when tax escrow is distributed to the carnage fund (on graduation)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "token",
            "type": {
              "defined": {
                "name": "token"
              }
            }
          },
          {
            "name": "amount",
            "docs": [
              "Lamports sent to carnage fund."
            ],
            "type": "u64"
          },
          {
            "name": "destination",
            "docs": [
              "Carnage fund address."
            ],
            "type": "pubkey"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "refundClaimed",
      "docs": [
        "Emitted when a user claims a refund after curve failure."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "token",
            "type": {
              "defined": {
                "name": "token"
              }
            }
          },
          {
            "name": "tokensBurned",
            "docs": [
              "Tokens permanently destroyed (burned)."
            ],
            "type": "u64"
          },
          {
            "name": "refundAmount",
            "docs": [
              "SOL returned to user."
            ],
            "type": "u64"
          },
          {
            "name": "remainingTokensSold",
            "docs": [
              "curve.tokens_sold after this claim."
            ],
            "type": "u64"
          },
          {
            "name": "remainingVaultBalance",
            "docs": [
              "sol_vault balance after this claim."
            ],
            "type": "u64"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "solWithdrawn",
      "docs": [
        "Emitted when SOL is withdrawn from a graduated curve's SOL vault."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tokenMint",
            "docs": [
              "Token mint of the graduated curve."
            ],
            "type": "pubkey"
          },
          {
            "name": "amount",
            "docs": [
              "Lamports withdrawn."
            ],
            "type": "u64"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "taxCollected",
      "docs": [
        "Emitted when sell tax is collected into the escrow."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "token",
            "type": {
              "defined": {
                "name": "token"
              }
            }
          },
          {
            "name": "amount",
            "docs": [
              "Tax amount from this sell transaction."
            ],
            "type": "u64"
          },
          {
            "name": "escrowBalance",
            "docs": [
              "Total escrow balance after collection."
            ],
            "type": "u64"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "token",
      "docs": [
        "Which token this curve is selling."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "crime"
          },
          {
            "name": "fraud"
          }
        ]
      }
    },
    {
      "name": "tokenVaultClosed",
      "docs": [
        "Emitted when a graduated curve's empty token vault is closed."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tokenMint",
            "docs": [
              "Token mint of the graduated curve."
            ],
            "type": "pubkey"
          },
          {
            "name": "rentRecovered",
            "docs": [
              "Rent lamports recovered from closing the vault."
            ],
            "type": "u64"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "tokensPurchased",
      "docs": [
        "Emitted when a user purchases tokens from the curve."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "token",
            "type": {
              "defined": {
                "name": "token"
              }
            }
          },
          {
            "name": "solSpent",
            "type": "u64"
          },
          {
            "name": "tokensReceived",
            "type": "u64"
          },
          {
            "name": "newTokensSold",
            "type": "u64"
          },
          {
            "name": "currentPrice",
            "type": "u64"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "tokensSold",
      "docs": [
        "Emitted when a user sells tokens back to the curve."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "token",
            "type": {
              "defined": {
                "name": "token"
              }
            }
          },
          {
            "name": "tokensSold",
            "docs": [
              "Number of tokens sold back to the curve."
            ],
            "type": "u64"
          },
          {
            "name": "solReceivedNet",
            "docs": [
              "SOL sent to user (after 15% tax deduction)."
            ],
            "type": "u64"
          },
          {
            "name": "taxAmount",
            "docs": [
              "15% tax amount routed to escrow."
            ],
            "type": "u64"
          },
          {
            "name": "newTokensSold",
            "docs": [
              "Updated curve.tokens_sold after this sell."
            ],
            "type": "u64"
          },
          {
            "name": "currentPrice",
            "docs": [
              "Price after sell (curve walks backward)."
            ],
            "type": "u64"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "transitionComplete",
      "docs": [
        "Emitted when finalize_transition completes (terminal state)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "crimeSolRaised",
            "type": "u64"
          },
          {
            "name": "fraudSolRaised",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "transitionPrepared",
      "docs": [
        "Emitted when prepare_transition is called (both curves filled)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "crimeSolRaised",
            "type": "u64"
          },
          {
            "name": "fraudSolRaised",
            "type": "u64"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    }
  ]
};
