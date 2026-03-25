/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/staking.json`.
 */
export type Staking = {
  "address": "12b3t1cNiAUoYLiWFEnFa4w6qYxVAiqCWU7KZuzLPYtH",
  "metadata": {
    "name": "staking",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Dr Fraudsworth Staking Program - PROFIT staking for SOL yield"
  },
  "instructions": [
    {
      "name": "claim",
      "docs": [
        "Claim pending SOL rewards without unstaking.",
        "",
        "Transfers accumulated SOL rewards from escrow to user.",
        "User's staked_balance remains unchanged.",
        "Fails if no rewards to claim."
      ],
      "discriminator": [
        62,
        198,
        214,
        193,
        213,
        159,
        108,
        210
      ],
      "accounts": [
        {
          "name": "user",
          "docs": [
            "User claiming rewards (receives SOL)."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "stakePool",
          "docs": [
            "Global stake pool state."
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
            ]
          }
        },
        {
          "name": "userStake",
          "docs": [
            "User's stake account."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  101,
                  114,
                  95,
                  115,
                  116,
                  97,
                  107,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "escrowVault",
          "docs": [
            "Escrow vault PDA (source of SOL rewards)."
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
            ]
          }
        },
        {
          "name": "systemProgram",
          "docs": [
            "System program."
          ],
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "depositRewards",
      "docs": [
        "Deposit SOL rewards (called by Tax Program via CPI).",
        "",
        "Increments pending_rewards counter. SOL already transferred by caller.",
        "Access restricted to Tax Program via seeds::program constraint.",
        "",
        "# Arguments",
        "* `amount` - Amount of SOL deposited in lamports"
      ],
      "discriminator": [
        52,
        249,
        112,
        72,
        206,
        161,
        196,
        1
      ],
      "accounts": [
        {
          "name": "taxAuthority",
          "docs": [
            "Tax Program's tax authority PDA.",
            "",
            "CRITICAL SECURITY: seeds::program ensures this PDA is derived from Tax Program.",
            "Only Tax Program can produce a valid signer with these seeds.",
            "",
            "CROSS-PROGRAM DEPENDENCY:",
            "- TAX_AUTHORITY_SEED must match Tax Program's derivation",
            "- tax_program_id() must match Tax Program's declare_id!",
            "- If either mismatch, deposit_rewards will reject all Tax Program calls",
            ""
          ],
          "signer": true,
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
          "name": "stakePool",
          "docs": [
            "Stake pool global state - pending_rewards updated here."
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
            ]
          }
        },
        {
          "name": "escrowVault",
          "docs": [
            "SOL escrow vault PDA - used for balance reconciliation.",
            "",
            "After updating pending_rewards, we verify escrow_vault.lamports() >= pending_rewards.",
            "This catches silent transfer failures or short-changed CPI amounts.",
            "",
            "Note: AccountInfo (not SystemAccount) because this PDA was created via `init` in",
            "initialize_stake_pool, making the Staking Program the owner (not system program).",
            ""
          ],
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
            ]
          }
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initializeStakePool",
      "docs": [
        "Initialize the global stake pool with dead stake.",
        "",
        "Creates StakePool, EscrowVault, and StakeVault PDAs.",
        "Transfers MINIMUM_STAKE (1 PROFIT) as dead stake to prevent",
        "first-depositor attack.",
        "",
        "Can only be called once (Anchor's init constraint prevents re-init)."
      ],
      "discriminator": [
        48,
        189,
        243,
        73,
        19,
        67,
        36,
        83
      ],
      "accounts": [
        {
          "name": "authority",
          "docs": [
            "Authority who pays for account creation and provides dead stake.",
            "Must own `authority_token_account` with at least MINIMUM_STAKE PROFIT."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "stakePool",
          "docs": [
            "Global stake pool state PDA.",
            "Seeds: [\"stake_pool\"]"
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
            ]
          }
        },
        {
          "name": "escrowVault",
          "docs": [
            "Native SOL escrow vault PDA (holds undistributed yield).",
            "Seeds: [\"escrow_vault\"]",
            "This is a system account, not a token account.",
            ""
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
            ]
          }
        },
        {
          "name": "stakeVault",
          "docs": [
            "Token-2022 stake vault PDA (holds staked PROFIT tokens).",
            "Seeds: [\"stake_vault\"]",
            "Authority: stake_pool PDA (so pool can transfer out on unstake)"
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
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "authorityTokenAccount",
          "docs": [
            "Authority's PROFIT token account (source of dead stake).",
            "Must have at least MINIMUM_STAKE tokens."
          ],
          "writable": true
        },
        {
          "name": "profitMint",
          "docs": [
            "PROFIT token mint (Token-2022)."
          ]
        },
        {
          "name": "tokenProgram",
          "docs": [
            "Token-2022 program for PROFIT transfers."
          ]
        },
        {
          "name": "program",
          "docs": [
            "The Staking program — used to look up its ProgramData address."
          ],
          "address": "12b3t1cNiAUoYLiWFEnFa4w6qYxVAiqCWU7KZuzLPYtH"
        },
        {
          "name": "programData",
          "docs": [
            "ProgramData account — upgrade_authority must match authority."
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
      "name": "stake",
      "docs": [
        "Stake PROFIT tokens to begin earning yield.",
        "",
        "Transfers PROFIT from user to stake vault.",
        "Creates UserStake account if first stake.",
        "Updates rewards checkpoint before balance change."
      ],
      "discriminator": [
        206,
        176,
        202,
        18,
        200,
        209,
        179,
        108
      ],
      "accounts": [
        {
          "name": "user",
          "docs": [
            "User staking tokens."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "stakePool",
          "docs": [
            "Global stake pool state."
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
            ]
          }
        },
        {
          "name": "userStake",
          "docs": [
            "User's stake account (created if doesn't exist).",
            "Seeds: [\"user_stake\", user_pubkey]"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  101,
                  114,
                  95,
                  115,
                  116,
                  97,
                  107,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "userTokenAccount",
          "docs": [
            "User's PROFIT token account (source)."
          ],
          "writable": true
        },
        {
          "name": "stakeVault",
          "docs": [
            "Stake vault PDA (destination)."
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
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "profitMint",
          "docs": [
            "PROFIT token mint."
          ]
        },
        {
          "name": "tokenProgram",
          "docs": [
            "Token-2022 program."
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
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "unstake",
      "docs": [
        "Unstake PROFIT tokens and auto-claim pending rewards.",
        "",
        "Transfers PROFIT from stake vault to user.",
        "Automatically claims any pending SOL rewards.",
        "If partial unstake would leave < MINIMUM_STAKE, does full unstake."
      ],
      "discriminator": [
        90,
        95,
        107,
        42,
        205,
        124,
        50,
        225
      ],
      "accounts": [
        {
          "name": "user",
          "docs": [
            "User unstaking tokens (receives PROFIT back)."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "stakePool",
          "docs": [
            "Global stake pool state."
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
            ]
          }
        },
        {
          "name": "userStake",
          "docs": [
            "User's stake account."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  115,
                  101,
                  114,
                  95,
                  115,
                  116,
                  97,
                  107,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "userTokenAccount",
          "docs": [
            "User's PROFIT token account (destination for unstaked tokens)."
          ],
          "writable": true
        },
        {
          "name": "stakeVault",
          "docs": [
            "Stake vault PDA (source for unstaked tokens)."
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
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "profitMint",
          "docs": [
            "PROFIT token mint."
          ]
        },
        {
          "name": "tokenProgram",
          "docs": [
            "Token-2022 program."
          ]
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "updateCumulative",
      "docs": [
        "Finalize epoch rewards (called by Epoch Program via CPI).",
        "",
        "Moves pending_rewards to cumulative rewards_per_token_stored.",
        "Access restricted to Epoch Program via seeds::program constraint.",
        "",
        "# Arguments",
        "* `epoch` - The epoch number being finalized"
      ],
      "discriminator": [
        147,
        132,
        219,
        101,
        165,
        23,
        61,
        113
      ],
      "accounts": [
        {
          "name": "epochAuthority",
          "docs": [
            "Epoch Program's staking authority PDA.",
            "",
            "CRITICAL SECURITY: seeds::program ensures this PDA is derived from Epoch Program.",
            "Only Epoch Program can produce a valid signer with these seeds.",
            "",
            "CROSS-PROGRAM DEPENDENCY:",
            "- STAKING_AUTHORITY_SEED must match Epoch Program's derivation",
            "- epoch_program_id() must match Epoch Program's declare_id!",
            "- If either mismatch, update_cumulative will reject all Epoch Program calls",
            ""
          ],
          "signer": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  107,
                  105,
                  110,
                  103,
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
          "name": "stakePool",
          "docs": [
            "Stake pool global state - cumulative and pending updated here."
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
            ]
          }
        }
      ],
      "args": [
        {
          "name": "epoch",
          "type": "u32"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "stakePool",
      "discriminator": [
        121,
        34,
        206,
        21,
        79,
        127,
        255,
        28
      ]
    },
    {
      "name": "userStake",
      "discriminator": [
        102,
        53,
        163,
        107,
        9,
        138,
        87,
        153
      ]
    }
  ],
  "events": [
    {
      "name": "claimed",
      "discriminator": [
        217,
        192,
        123,
        72,
        108,
        150,
        248,
        33
      ]
    },
    {
      "name": "cumulativeUpdated",
      "discriminator": [
        249,
        152,
        121,
        101,
        249,
        135,
        130,
        154
      ]
    },
    {
      "name": "escrowInsufficientAttempt",
      "discriminator": [
        22,
        108,
        172,
        15,
        147,
        89,
        160,
        194
      ]
    },
    {
      "name": "rewardsDeposited",
      "discriminator": [
        120,
        19,
        149,
        33,
        111,
        163,
        248,
        156
      ]
    },
    {
      "name": "stakePoolInitialized",
      "discriminator": [
        87,
        0,
        226,
        242,
        252,
        77,
        61,
        16
      ]
    },
    {
      "name": "staked",
      "discriminator": [
        11,
        146,
        45,
        205,
        230,
        58,
        213,
        240
      ]
    },
    {
      "name": "unstaked",
      "discriminator": [
        27,
        179,
        156,
        215,
        47,
        71,
        195,
        7
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "zeroAmount",
      "msg": "Amount must be greater than zero"
    },
    {
      "code": 6001,
      "name": "insufficientBalance",
      "msg": "Insufficient staked balance"
    },
    {
      "code": 6002,
      "name": "insufficientEscrowBalance",
      "msg": "Insufficient SOL in escrow vault"
    },
    {
      "code": 6003,
      "name": "nothingToClaim",
      "msg": "No rewards to claim"
    },
    {
      "code": 6004,
      "name": "unauthorized",
      "msg": "Unauthorized: signer does not own this stake account"
    },
    {
      "code": 6005,
      "name": "overflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6006,
      "name": "underflow",
      "msg": "Arithmetic underflow"
    },
    {
      "code": 6007,
      "name": "divisionByZero",
      "msg": "Division by zero"
    },
    {
      "code": 6008,
      "name": "alreadyUpdated",
      "msg": "Cumulative already updated for this epoch"
    },
    {
      "code": 6009,
      "name": "notInitialized",
      "msg": "Pool not initialized"
    },
    {
      "code": 6010,
      "name": "alreadyInitialized",
      "msg": "Pool already initialized"
    },
    {
      "code": 6011,
      "name": "cooldownActive",
      "msg": "Cooldown active: must wait 12 hours after claiming before unstaking"
    }
  ],
  "types": [
    {
      "name": "claimed",
      "docs": [
        "EVNT-04: Emitted when a user claims SOL rewards.",
        "",
        "Separate from unstake - user can claim without changing stake position."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "docs": [
              "The user who claimed."
            ],
            "type": "pubkey"
          },
          {
            "name": "amount",
            "docs": [
              "Amount of SOL claimed."
            ],
            "type": "u64"
          },
          {
            "name": "stakedBalance",
            "docs": [
              "User's current staked balance (unchanged by claim)."
            ],
            "type": "u64"
          },
          {
            "name": "totalClaimed",
            "docs": [
              "User's lifetime total claimed after this claim."
            ],
            "type": "u64"
          },
          {
            "name": "slot",
            "docs": [
              "Slot when claim occurred."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "cumulativeUpdated",
      "docs": [
        "Emitted when Epoch Program updates cumulative via CPI.",
        "",
        "Signals that pending rewards have been added to the global accumulator."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "epoch",
            "docs": [
              "The epoch number that was finalized."
            ],
            "type": "u32"
          },
          {
            "name": "rewardsAdded",
            "docs": [
              "Amount of SOL added to cumulative (was pending_rewards)."
            ],
            "type": "u64"
          },
          {
            "name": "newCumulative",
            "docs": [
              "New rewards_per_token_stored value."
            ],
            "type": "u128"
          },
          {
            "name": "totalStaked",
            "docs": [
              "Total staked at time of update (denominator for calculation)."
            ],
            "type": "u64"
          },
          {
            "name": "slot",
            "docs": [
              "Slot when update occurred."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "escrowInsufficientAttempt",
      "docs": [
        "Emitted when claim fails due to insufficient escrow balance.",
        "",
        "This should never happen in normal operation - it indicates a bug",
        "in reward accounting or an external exploit. The event is emitted",
        "before the error is returned so it gets logged even on failure,",
        "enabling monitoring/alerting systems to detect anomalies."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "docs": [
              "The user who attempted to claim."
            ],
            "type": "pubkey"
          },
          {
            "name": "requested",
            "docs": [
              "Amount of SOL the user tried to claim (lamports)."
            ],
            "type": "u64"
          },
          {
            "name": "available",
            "docs": [
              "Actual SOL balance available in the escrow vault (lamports)."
            ],
            "type": "u64"
          },
          {
            "name": "slot",
            "docs": [
              "Slot when the failed attempt occurred."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "rewardsDeposited",
      "docs": [
        "Emitted when Tax Program deposits rewards via CPI.",
        "",
        "This is the 71% yield portion from taxed swaps."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "amount",
            "docs": [
              "Amount of SOL deposited."
            ],
            "type": "u64"
          },
          {
            "name": "newPending",
            "docs": [
              "New pending_rewards balance after deposit."
            ],
            "type": "u64"
          },
          {
            "name": "escrowVault",
            "docs": [
              "Escrow vault pubkey (for monitoring/filtering).",
              "Enables off-chain dashboards to filter events per vault and verify",
              "the vault address matches expectations without additional RPC calls."
            ],
            "type": "pubkey"
          },
          {
            "name": "escrowBalance",
            "docs": [
              "Escrow vault SOL balance at time of deposit (for reconciliation monitoring).",
              "If escrow_balance < new_pending, something is wrong. The on-chain require!",
              "already catches this and reverts, but the event gives visibility into",
              "healthy deposits too."
            ],
            "type": "u64"
          },
          {
            "name": "slot",
            "docs": [
              "Slot when deposit occurred."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "stakePool",
      "docs": [
        "StakePool global singleton.",
        "",
        "Seeds: [\"stake_pool\"]",
        "Size: 62 bytes (8 discriminator + 54 data)"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "totalStaked",
            "docs": [
              "Total PROFIT currently staked across all users.",
              "Updated on every stake/unstake operation."
            ],
            "type": "u64"
          },
          {
            "name": "rewardsPerTokenStored",
            "docs": [
              "Cumulative rewards per staked token, scaled by PRECISION (1e18).",
              "This value only increases, never decreases.",
              "Used for fair pro-rata reward distribution."
            ],
            "type": "u128"
          },
          {
            "name": "pendingRewards",
            "docs": [
              "SOL rewards accumulated this epoch, not yet added to cumulative.",
              "Reset to 0 after update_cumulative is called."
            ],
            "type": "u64"
          },
          {
            "name": "lastUpdateEpoch",
            "docs": [
              "Last epoch when cumulative was updated.",
              "Prevents double-update within same epoch."
            ],
            "type": "u32"
          },
          {
            "name": "totalDistributed",
            "docs": [
              "Total SOL distributed lifetime (analytics).",
              "Incremented when pending_rewards is added to cumulative."
            ],
            "type": "u64"
          },
          {
            "name": "totalClaimed",
            "docs": [
              "Total SOL claimed lifetime (analytics).",
              "Incremented when users claim rewards."
            ],
            "type": "u64"
          },
          {
            "name": "initialized",
            "docs": [
              "Initialization flag.",
              "Set to true during initialize_stake_pool."
            ],
            "type": "bool"
          },
          {
            "name": "bump",
            "docs": [
              "PDA bump seed.",
              "Stored for efficient re-derivation during transfers."
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "stakePoolInitialized",
      "docs": [
        "EVNT-01: Emitted when stake pool is initialized.",
        "",
        "Includes vault addresses for indexers to track and timestamp",
        "for initialization timeline."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "escrowVault",
            "docs": [
              "The SOL escrow vault PDA address."
            ],
            "type": "pubkey"
          },
          {
            "name": "stakeVault",
            "docs": [
              "The PROFIT stake vault PDA address."
            ],
            "type": "pubkey"
          },
          {
            "name": "deadStakeAmount",
            "docs": [
              "Amount of dead stake deposited (MINIMUM_STAKE).",
              "This is the protocol's initial stake to prevent first-depositor attack."
            ],
            "type": "u64"
          },
          {
            "name": "timestamp",
            "docs": [
              "Unix timestamp from Clock sysvar."
            ],
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "staked",
      "docs": [
        "EVNT-02: Emitted when a user stakes PROFIT.",
        "",
        "Contains all information needed for indexers to track stake activity",
        "without additional RPC lookups."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "docs": [
              "The user who staked."
            ],
            "type": "pubkey"
          },
          {
            "name": "amount",
            "docs": [
              "Amount of PROFIT staked in this transaction."
            ],
            "type": "u64"
          },
          {
            "name": "newBalance",
            "docs": [
              "User's new total staked balance after this stake."
            ],
            "type": "u64"
          },
          {
            "name": "totalStaked",
            "docs": [
              "Pool's new total staked after this stake."
            ],
            "type": "u64"
          },
          {
            "name": "slot",
            "docs": [
              "Slot when stake occurred."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "unstaked",
      "docs": [
        "EVNT-03: Emitted when a user unstakes PROFIT.",
        "",
        "Includes the unstaked amount and any rewards forfeited back to the pool.",
        "Unstake forfeits unclaimed rewards to remaining stakers."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "docs": [
              "The user who unstaked."
            ],
            "type": "pubkey"
          },
          {
            "name": "amount",
            "docs": [
              "Amount of PROFIT unstaked in this transaction."
            ],
            "type": "u64"
          },
          {
            "name": "rewardsForfeited",
            "docs": [
              "Amount of SOL rewards forfeited back to the staking pool.",
              "Redistributed to remaining stakers via pending_rewards."
            ],
            "type": "u64"
          },
          {
            "name": "newBalance",
            "docs": [
              "User's new staked balance after unstake (may be 0)."
            ],
            "type": "u64"
          },
          {
            "name": "totalStaked",
            "docs": [
              "Pool's new total staked after unstake."
            ],
            "type": "u64"
          },
          {
            "name": "slot",
            "docs": [
              "Slot when unstake occurred."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "userStake",
      "docs": [
        "UserStake per-user account.",
        "",
        "Seeds: [\"user_stake\", user_pubkey]",
        "Size: 105 bytes (8 discriminator + 97 data)"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "docs": [
              "Owner of this stake account.",
              "Validated on unstake/claim to prevent unauthorized access."
            ],
            "type": "pubkey"
          },
          {
            "name": "stakedBalance",
            "docs": [
              "Amount of PROFIT staked.",
              "Updated on stake/unstake operations."
            ],
            "type": "u64"
          },
          {
            "name": "rewardsPerTokenPaid",
            "docs": [
              "User's checkpoint of rewards_per_token at last update.",
              "Used to calculate pending rewards since last interaction."
            ],
            "type": "u128"
          },
          {
            "name": "rewardsEarned",
            "docs": [
              "Accumulated rewards not yet claimed.",
              "Updated by update_rewards helper before any balance change."
            ],
            "type": "u64"
          },
          {
            "name": "totalClaimed",
            "docs": [
              "Total SOL claimed lifetime (analytics).",
              "Incremented on each claim."
            ],
            "type": "u64"
          },
          {
            "name": "firstStakeSlot",
            "docs": [
              "Slot when user first staked.",
              "Set once on first stake, never updated."
            ],
            "type": "u64"
          },
          {
            "name": "lastUpdateSlot",
            "docs": [
              "Slot when user last interacted (stake/unstake/claim).",
              "Updated by update_rewards helper."
            ],
            "type": "u64"
          },
          {
            "name": "lastClaimTs",
            "docs": [
              "Unix timestamp of user's last claim.",
              "Used for cooldown gate: unstake blocked until COOLDOWN_SECONDS after last claim.",
              "0 = never claimed (no cooldown applies)."
            ],
            "type": "i64"
          },
          {
            "name": "bump",
            "docs": [
              "PDA bump seed.",
              "Stored for efficient re-derivation."
            ],
            "type": "u8"
          }
        ]
      }
    }
  ]
};
