/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/amm.json`.
 */
export type Amm = {
  "address": "5JsSAL3kJDUWD4ZveYXYZmgm1eVqueesTZVdAvtZg8cR",
  "metadata": {
    "name": "amm",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Dr Fraudsworth AMM Program - Constant-product swap pools"
  },
  "instructions": [
    {
      "name": "burnAdmin",
      "docs": [
        "Burns the admin key, permanently preventing new pool creation.",
        "Only the current admin can call this. Irreversible.",
        "",
        "# Accounts",
        "* `admin` - Current admin signer",
        "* `admin_config` - AdminConfig PDA (admin set to Pubkey::default())"
      ],
      "discriminator": [
        183,
        81,
        48,
        132,
        52,
        79,
        192,
        4
      ],
      "accounts": [
        {
          "name": "admin",
          "docs": [
            "The current admin. Must match admin_config.admin."
          ],
          "signer": true,
          "relations": [
            "adminConfig"
          ]
        },
        {
          "name": "adminConfig",
          "docs": [
            "The AdminConfig PDA. After this instruction, admin will be Pubkey::default()."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
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
      "name": "initializeAdmin",
      "docs": [
        "Initialize the global AdminConfig PDA.",
        "",
        "Can only be called by the program's upgrade authority (deployer).",
        "The `admin` parameter sets who can create pools -- this can be a",
        "different key from the upgrade authority (e.g., a multisig)."
      ],
      "discriminator": [
        35,
        176,
        8,
        143,
        42,
        160,
        61,
        158
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
            "The AdminConfig PDA. Initialized once; stores the admin pubkey and bump.",
            "Seeds: [b\"admin\"]"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
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
            "The AMM program itself -- used to look up its programdata address."
          ],
          "address": "5JsSAL3kJDUWD4ZveYXYZmgm1eVqueesTZVdAvtZg8cR"
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
      "name": "initializePool",
      "docs": [
        "Initialize a new AMM pool with PDA-owned vaults and seed liquidity.",
        "",
        "Creates pool state PDA, vault token accounts (owned by pool PDA),",
        "and transfers initial liquidity atomically. Pool type is inferred",
        "from token programs, not caller-declared.",
        "",
        "# Arguments",
        "* `lp_fee_bps` - LP fee in basis points",
        "* `amount_a` - Initial seed amount for token A",
        "* `amount_b` - Initial seed amount for token B"
      ],
      "discriminator": [
        95,
        180,
        10,
        172,
        84,
        174,
        232,
        40
      ],
      "accounts": [
        {
          "name": "payer",
          "docs": [
            "The payer for account rent. Typically the admin, but can be a separate funder."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "adminConfig",
          "docs": [
            "The global AdminConfig PDA. Verified via has_one = admin constraint",
            "to ensure only the authorized admin can create pools."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
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
          "name": "admin",
          "docs": [
            "The admin signer. Must match admin_config.admin.",
            "Also acts as the authority for the initial liquidity transfers."
          ],
          "signer": true,
          "relations": [
            "adminConfig"
          ]
        },
        {
          "name": "pool",
          "docs": [
            "The pool state PDA. Derived from canonical mint pair.",
            "Seeds: [b\"pool\", mint_a.key().as_ref(), mint_b.key().as_ref()]"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "mintA"
              },
              {
                "kind": "account",
                "path": "mintB"
              }
            ]
          }
        },
        {
          "name": "vaultA",
          "docs": [
            "Vault A: PDA-owned token account for reserve A.",
            "The pool PDA is the authority, ensuring only the program can move funds.",
            "Seeds: [b\"vault\", pool.key().as_ref(), b\"a\"]"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              },
              {
                "kind": "const",
                "value": [
                  97
                ]
              }
            ]
          }
        },
        {
          "name": "vaultB",
          "docs": [
            "Vault B: PDA-owned token account for reserve B.",
            "Seeds: [b\"vault\", pool.key().as_ref(), b\"b\"]"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              },
              {
                "kind": "const",
                "value": [
                  98
                ]
              }
            ]
          }
        },
        {
          "name": "mintA",
          "docs": [
            "Mint A (the canonically smaller pubkey).",
            "Constraint: on-chain owner must match the provided token_program_a.",
            "This prevents passing a T22 mint with the SPL Token program (or vice versa)."
          ]
        },
        {
          "name": "mintB",
          "docs": [
            "Mint B (the canonically larger pubkey).",
            "Same owner validation as mint_a."
          ]
        },
        {
          "name": "sourceA",
          "docs": [
            "Admin's source token account for mint A.",
            "Must have sufficient balance for the initial seed amount."
          ],
          "writable": true
        },
        {
          "name": "sourceB",
          "docs": [
            "Admin's source token account for mint B."
          ],
          "writable": true
        },
        {
          "name": "tokenProgramA",
          "docs": [
            "Token program for mint A (SPL Token or Token-2022)."
          ]
        },
        {
          "name": "tokenProgramB",
          "docs": [
            "Token program for mint B (SPL Token or Token-2022)."
          ]
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "lpFeeBps",
          "type": "u16"
        },
        {
          "name": "amountA",
          "type": "u64"
        },
        {
          "name": "amountB",
          "type": "u64"
        }
      ]
    },
    {
      "name": "swapSolPool",
      "docs": [
        "Execute a swap in a SOL pool (CRIME/SOL or FRAUD/SOL).",
        "",
        "Routes between Token-2022 (CRIME/FRAUD) and SPL Token (WSOL) based on",
        "swap direction. LP fee is deducted before output calculation.",
        "",
        "# Arguments",
        "* `amount_in` - Input token amount (pre-fee)",
        "* `direction` - SwapDirection::AtoB or SwapDirection::BtoA",
        "* `minimum_amount_out` - Slippage protection floor"
      ],
      "discriminator": [
        222,
        128,
        30,
        123,
        85,
        39,
        145,
        138
      ],
      "accounts": [
        {
          "name": "swapAuthority",
          "docs": [
            "swap_authority PDA: must be signed by Tax Program via invoke_signed.",
            "",
            "The Signer type validates this account actually signed the transaction.",
            "The seeds + seeds::program constraint validates the PDA is derived",
            "from TAX_PROGRAM_ID with seeds [\"swap_authority\"].",
            "",
            "This ensures only the Tax Program can initiate swaps -- direct user",
            "calls without valid swap_authority will fail deserialization."
          ],
          "signer": true,
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
            ],
            "program": {
              "kind": "const",
              "value": [
                45,
                65,
                209,
                114,
                183,
                158,
                14,
                46,
                96,
                175,
                143,
                213,
                174,
                7,
                234,
                135,
                65,
                158,
                248,
                30,
                46,
                242,
                241,
                38,
                205,
                30,
                10,
                29,
                245,
                82,
                141,
                128
              ]
            }
          }
        },
        {
          "name": "pool",
          "docs": [
            "Pool state PDA. Mutable for reserve updates and reentrancy guard.",
            "Seeds validate this is the correct pool for the given mint pair."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "pool.mint_a",
                "account": "poolState"
              },
              {
                "kind": "account",
                "path": "pool.mint_b",
                "account": "poolState"
              }
            ]
          }
        },
        {
          "name": "vaultA",
          "docs": [
            "Vault A: PDA-owned token account holding reserve A.",
            "Validated against pool state to prevent vault substitution attacks."
          ],
          "writable": true
        },
        {
          "name": "vaultB",
          "docs": [
            "Vault B: PDA-owned token account holding reserve B."
          ],
          "writable": true
        },
        {
          "name": "mintA",
          "docs": [
            "Mint A: used for decimals in transfer_checked and token program routing."
          ]
        },
        {
          "name": "mintB",
          "docs": [
            "Mint B: used for decimals in transfer_checked and token program routing."
          ]
        },
        {
          "name": "userTokenA",
          "docs": [
            "User's token account for token A. Mutable for input or output transfers.",
            "No ownership constraint -- the token program validates authority during",
            "transfer_checked CPI (see 11-RESEARCH.md Open Question 3)."
          ],
          "writable": true
        },
        {
          "name": "userTokenB",
          "docs": [
            "User's token account for token B."
          ],
          "writable": true
        },
        {
          "name": "user",
          "docs": [
            "The user executing the swap. Signs as authority for user-to-vault transfers."
          ],
          "signer": true
        },
        {
          "name": "tokenProgramA",
          "docs": [
            "Token program for mint A (SPL Token or Token-2022).",
            "Validated against pool state to prevent program substitution."
          ]
        },
        {
          "name": "tokenProgramB",
          "docs": [
            "Token program for mint B (SPL Token or Token-2022)."
          ]
        }
      ],
      "args": [
        {
          "name": "amountIn",
          "type": "u64"
        },
        {
          "name": "direction",
          "type": {
            "defined": {
              "name": "swapDirection"
            }
          }
        },
        {
          "name": "minimumAmountOut",
          "type": "u64"
        }
      ]
    },
    {
      "name": "transferAdmin",
      "docs": [
        "Transfer the admin key to a new pubkey (e.g., Squads multisig vault).",
        "Only the current admin can call this. new_admin must not be Pubkey::default()."
      ],
      "discriminator": [
        42,
        242,
        66,
        106,
        228,
        10,
        111,
        156
      ],
      "accounts": [
        {
          "name": "admin",
          "docs": [
            "The current admin. Must match admin_config.admin."
          ],
          "signer": true,
          "relations": [
            "adminConfig"
          ]
        },
        {
          "name": "adminConfig",
          "docs": [
            "The AdminConfig PDA. After this instruction, admin will be new_admin."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
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
          "name": "newAdmin",
          "type": "pubkey"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "adminConfig",
      "discriminator": [
        156,
        10,
        79,
        161,
        71,
        9,
        62,
        77
      ]
    },
    {
      "name": "poolState",
      "discriminator": [
        247,
        237,
        227,
        245,
        215,
        195,
        222,
        70
      ]
    }
  ],
  "events": [
    {
      "name": "adminBurned",
      "discriminator": [
        39,
        66,
        148,
        65,
        115,
        19,
        84,
        97
      ]
    },
    {
      "name": "poolInitializedEvent",
      "discriminator": [
        249,
        103,
        129,
        77,
        214,
        169,
        88,
        24
      ]
    },
    {
      "name": "swapEvent",
      "discriminator": [
        64,
        198,
        205,
        232,
        38,
        8,
        113,
        226
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "overflow",
      "msg": "Arithmetic overflow in swap calculation"
    },
    {
      "code": 6001,
      "name": "kInvariantViolation",
      "msg": "K-invariant violation: k decreased after swap"
    },
    {
      "code": 6002,
      "name": "poolAlreadyInitialized",
      "msg": "Pool is already initialized"
    },
    {
      "code": 6003,
      "name": "mintsNotCanonicallyOrdered",
      "msg": "Mints must be in canonical order (mint_a < mint_b)"
    },
    {
      "code": 6004,
      "name": "unauthorized",
      "msg": "Unauthorized: signer is not the admin"
    },
    {
      "code": 6005,
      "name": "invalidTokenProgram",
      "msg": "Token program does not match mint owner"
    },
    {
      "code": 6006,
      "name": "zeroSeedAmount",
      "msg": "Initial seed amount must be greater than zero"
    },
    {
      "code": 6007,
      "name": "duplicateMints",
      "msg": "Mint A and Mint B must be different"
    },
    {
      "code": 6008,
      "name": "zeroAmount",
      "msg": "Transfer amount must be greater than zero"
    },
    {
      "code": 6009,
      "name": "slippageExceeded",
      "msg": "Slippage tolerance exceeded"
    },
    {
      "code": 6010,
      "name": "poolNotInitialized",
      "msg": "Pool is not initialized"
    },
    {
      "code": 6011,
      "name": "poolLocked",
      "msg": "Pool is locked"
    },
    {
      "code": 6012,
      "name": "vaultMismatch",
      "msg": "Vault does not match pool state"
    },
    {
      "code": 6013,
      "name": "invalidMint",
      "msg": "Mint does not match pool state"
    },
    {
      "code": 6014,
      "name": "zeroEffectiveInput",
      "msg": "Input amount too small: fee deduction produces zero effective input"
    },
    {
      "code": 6015,
      "name": "zeroSwapOutput",
      "msg": "Swap produces zero output tokens"
    },
    {
      "code": 6016,
      "name": "invalidSwapAuthority",
      "msg": "Swaps must go through Tax Program - direct calls not allowed"
    },
    {
      "code": 6017,
      "name": "lpFeeExceedsMax",
      "msg": "LP fee exceeds maximum allowed (500 bps)"
    },
    {
      "code": 6018,
      "name": "invalidAuthority",
      "msg": "Invalid authority: cannot transfer to Pubkey::default()"
    }
  ],
  "types": [
    {
      "name": "adminBurned",
      "docs": [
        "Emitted when the admin key is permanently burned.",
        "After this event, no new pools can be created through the AMM.",
        "This is irreversible."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "burnedBy",
            "docs": [
              "The admin who burned their own key."
            ],
            "type": "pubkey"
          },
          {
            "name": "slot",
            "docs": [
              "Slot when the burn occurred."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "adminConfig",
      "docs": [
        "Global admin configuration for the AMM program.",
        "",
        "This PDA is initialized once by the program's upgrade authority,",
        "storing the admin pubkey that gates pool creation. The admin can",
        "be a multisig address for operational security.",
        "",
        "Seeds: [b\"admin\"]"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "docs": [
              "The admin pubkey authorized to create pools.",
              "Can be a multisig address -- not required to be the upgrade authority."
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
      "name": "poolInitializedEvent",
      "docs": [
        "Emitted when a new pool is initialized with its first liquidity.",
        "",
        "`pool_type` is serialized as u8 for client compatibility:",
        "- 0 = MixedPool (one SPL Token + one Token-2022)",
        "- 1 = PureT22Pool (both Token-2022)"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "docs": [
              "The pool PDA address."
            ],
            "type": "pubkey"
          },
          {
            "name": "poolType",
            "docs": [
              "Pool type as u8 (0 = MixedPool, 1 = PureT22Pool)."
            ],
            "type": "u8"
          },
          {
            "name": "mintA",
            "docs": [
              "Canonical mint A (the \"smaller\" pubkey)."
            ],
            "type": "pubkey"
          },
          {
            "name": "mintB",
            "docs": [
              "Canonical mint B (the \"larger\" pubkey)."
            ],
            "type": "pubkey"
          },
          {
            "name": "vaultA",
            "docs": [
              "Vault A PDA address."
            ],
            "type": "pubkey"
          },
          {
            "name": "vaultB",
            "docs": [
              "Vault B PDA address."
            ],
            "type": "pubkey"
          },
          {
            "name": "reserveA",
            "docs": [
              "Initial reserve of token A after seeding."
            ],
            "type": "u64"
          },
          {
            "name": "reserveB",
            "docs": [
              "Initial reserve of token B after seeding."
            ],
            "type": "u64"
          },
          {
            "name": "lpFeeBps",
            "docs": [
              "LP fee in basis points."
            ],
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "poolState",
      "docs": [
        "On-chain state for a single AMM pool.",
        "",
        "Each pool is a PDA derived from its canonical mint pair:",
        "Seeds: [b\"pool\", mint_a.as_ref(), mint_b.as_ref()]",
        "",
        "Canonical ordering: mint_a < mint_b (byte-wise pubkey comparison).",
        "This ensures exactly one pool PDA per unordered mint pair.",
        "",
        "Space: 8 (discriminator) + 1 (pool_type) + 32*2 (mints) + 32*2 (vaults)",
        "+ 8*2 (reserves) + 2 (fee) + 1 (initialized) + 1 (locked)",
        "+ 1 (bump) + 1 (vault_a_bump) + 1 (vault_b_bump)",
        "+ 32*2 (token_programs)",
        "= 8 + 216 = 224 bytes total (216 INIT_SPACE).",
        "",
        "DEVIATION from AMM_Implementation.md Section 4.1 (157 bytes):",
        "We store vault bumps (2 bytes) and token program keys (64 bytes)",
        "on-chain, adding 66 bytes. This avoids re-deriving vault PDAs and",
        "re-validating token programs during every swap, reducing compute cost."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "poolType",
            "docs": [
              "Behavioral pool type (MixedPool or PureT22Pool)."
            ],
            "type": {
              "defined": {
                "name": "poolType"
              }
            }
          },
          {
            "name": "mintA",
            "docs": [
              "First mint in the canonical pair (mint_a < mint_b)."
            ],
            "type": "pubkey"
          },
          {
            "name": "mintB",
            "docs": [
              "Second mint in the canonical pair."
            ],
            "type": "pubkey"
          },
          {
            "name": "vaultA",
            "docs": [
              "PDA-owned token account holding reserve A."
            ],
            "type": "pubkey"
          },
          {
            "name": "vaultB",
            "docs": [
              "PDA-owned token account holding reserve B."
            ],
            "type": "pubkey"
          },
          {
            "name": "reserveA",
            "docs": [
              "Current reserve of token A (updated on every swap/deposit)."
            ],
            "type": "u64"
          },
          {
            "name": "reserveB",
            "docs": [
              "Current reserve of token B (updated on every swap/deposit)."
            ],
            "type": "u64"
          },
          {
            "name": "lpFeeBps",
            "docs": [
              "LP fee in basis points (e.g., 100 = 1.0%)."
            ],
            "type": "u16"
          },
          {
            "name": "initialized",
            "docs": [
              "Whether the pool has been fully initialized with liquidity."
            ],
            "type": "bool"
          },
          {
            "name": "locked",
            "docs": [
              "Reentrancy guard. Set to true during swap execution, cleared after.",
              "",
              "SPEC DEVIATION from AMM_Implementation.md: This field is not in the",
              "original spec. Added for defense-in-depth reentrancy protection per",
              "11-CONTEXT.md. Solana's runtime borrow rules already prevent same-pool",
              "re-entry via CPI, and CEI ordering handles reserve consistency, but",
              "this provides an explicit belt-and-suspenders guard."
            ],
            "type": "bool"
          },
          {
            "name": "bump",
            "docs": [
              "Pool PDA bump seed."
            ],
            "type": "u8"
          },
          {
            "name": "vaultABump",
            "docs": [
              "Vault A PDA bump seed (avoids re-derivation in swaps)."
            ],
            "type": "u8"
          },
          {
            "name": "vaultBBump",
            "docs": [
              "Vault B PDA bump seed (avoids re-derivation in swaps)."
            ],
            "type": "u8"
          },
          {
            "name": "tokenProgramA",
            "docs": [
              "Token program for mint A (SPL Token or Token-2022)."
            ],
            "type": "pubkey"
          },
          {
            "name": "tokenProgramB",
            "docs": [
              "Token program for mint B (SPL Token or Token-2022)."
            ],
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "poolType",
      "docs": [
        "Behavioral pool type, inferred from the token programs of each mint.",
        "",
        "DEVIATION from AMM_Implementation.md Section 4.1:",
        "The spec originally defined four protocol-specific variants. Per",
        "09-CONTEXT.md, the AMM is mint-agnostic -- it accepts any mint pair",
        "and categorizes by token program combination, not by protocol identity.",
        "",
        "- `MixedPool`: One side uses SPL Token, the other uses Token-2022.",
        "Example: CRIME/SOL (T22 + SPL), FRAUD/SOL (T22 + SPL).",
        "- `PureT22Pool`: Both sides use Token-2022.",
        "Reserved for future use; no active pools use this variant."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "mixedPool"
          },
          {
            "name": "pureT22Pool"
          }
        ]
      }
    },
    {
      "name": "swapDirection",
      "docs": [
        "Direction of a swap through a pool.",
        "",
        "Anchor serializes this as a single u8 variant index:",
        "- 0 = AtoB (Token A in, Token B out)",
        "- 1 = BtoA (Token B in, Token A out)",
        "",
        "The caller explicitly declares direction. The AMM does not infer it from",
        "account ordering (locked decision, see 11-CONTEXT.md)."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "atoB"
          },
          {
            "name": "btoA"
          }
        ]
      }
    },
    {
      "name": "swapEvent",
      "docs": [
        "Emitted when a swap executes successfully in a SOL pool.",
        "",
        "Contains all information needed for indexers and frontends to track",
        "swap activity without additional RPC lookups. Direction is encoded",
        "as u8 for client compatibility (0 = AtoB, 1 = BtoA).",
        "",
        "`lp_fee_bps` is intentionally omitted -- it is immutable on pool state,",
        "so clients can query it once and cache. See 11-CONTEXT.md."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "docs": [
              "The pool PDA address."
            ],
            "type": "pubkey"
          },
          {
            "name": "user",
            "docs": [
              "The user who initiated the swap."
            ],
            "type": "pubkey"
          },
          {
            "name": "inputMint",
            "docs": [
              "Mint of the input token."
            ],
            "type": "pubkey"
          },
          {
            "name": "outputMint",
            "docs": [
              "Mint of the output token."
            ],
            "type": "pubkey"
          },
          {
            "name": "amountIn",
            "docs": [
              "Amount of input token (pre-fee)."
            ],
            "type": "u64"
          },
          {
            "name": "amountOut",
            "docs": [
              "Amount of output token sent to user."
            ],
            "type": "u64"
          },
          {
            "name": "lpFee",
            "docs": [
              "LP fee deducted (in input token units)."
            ],
            "type": "u64"
          },
          {
            "name": "reserveA",
            "docs": [
              "Post-swap reserve of token A."
            ],
            "type": "u64"
          },
          {
            "name": "reserveB",
            "docs": [
              "Post-swap reserve of token B."
            ],
            "type": "u64"
          },
          {
            "name": "direction",
            "docs": [
              "Swap direction (0 = AtoB, 1 = BtoA)."
            ],
            "type": "u8"
          },
          {
            "name": "timestamp",
            "docs": [
              "Unix timestamp from Clock sysvar."
            ],
            "type": "i64"
          },
          {
            "name": "slot",
            "docs": [
              "Slot from Clock sysvar."
            ],
            "type": "u64"
          }
        ]
      }
    }
  ]
};
