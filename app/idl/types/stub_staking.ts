/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/stub_staking.json`.
 */
export type StubStaking = {
  "address": "StUbofRk12S7JrEUoQJFjMe6FmACNoRpbNMyjn311ZU",
  "metadata": {
    "name": "stubStaking",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Stub Staking Program for testing Epoch Program CPI integration"
  },
  "instructions": [
    {
      "name": "initialize",
      "docs": [
        "Initialize the stub stake pool.",
        "",
        "Called once at deployment to create the StubStakePool PDA.",
        "Sets all tracking fields to zero and marks as initialized.",
        "",
        "# Accounts",
        "- `payer`: Pays for account creation",
        "- `stake_pool`: StubStakePool PDA to initialize",
        "- `system_program`: Required for account creation",
        "",
        "# Errors",
        "- None (Anchor handles duplicate initialization via init constraint)"
      ],
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "payer",
          "docs": [
            "Payer for account creation."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "stakePool",
          "docs": [
            "Stub stake pool PDA.",
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
      "name": "updateCumulative",
      "docs": [
        "Update cumulative epoch tracking (CPI-gated).",
        "",
        "Called by Epoch Program via CPI during consume_randomness.",
        "Records that an epoch has been finalized and increments counters.",
        "",
        "# Access Control",
        "The `epoch_authority` account MUST be a PDA derived from Epoch Program",
        "with seeds = [\"staking_authority\"]. This is enforced via the",
        "`seeds::program = epoch_program_id()` constraint.",
        "",
        "# Arguments",
        "- `epoch`: The epoch number being finalized (u32)",
        "",
        "# Errors",
        "- `NotInitialized`: Stake pool not initialized",
        "- `AlreadyUpdated`: Epoch <= last_epoch (double-finalization protection)",
        "- `Overflow`: Arithmetic overflow (extremely unlikely)"
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
            "Stub stake pool PDA.",
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
      "name": "stubStakePool",
      "discriminator": [
        82,
        168,
        94,
        46,
        183,
        143,
        143,
        147
      ]
    }
  ],
  "events": [
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
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "alreadyUpdated",
      "msg": "Cumulative already updated for this epoch"
    },
    {
      "code": 6001,
      "name": "overflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6002,
      "name": "notInitialized",
      "msg": "Stake pool not initialized"
    }
  ],
  "types": [
    {
      "name": "cumulativeUpdated",
      "docs": [
        "Emitted when cumulative epoch tracking is updated."
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
            "name": "cumulativeEpochs",
            "docs": [
              "Total number of epochs finalized."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "stubStakePool",
      "docs": [
        "Stub stake pool account.",
        "",
        "Single PDA: seeds = [\"stake_pool\"]",
        "",
        "This is a minimal staking pool implementation for testing.",
        "It tracks how many times Epoch Program has called update_cumulative,",
        "and prevents double-finalization for the same epoch.",
        "",
        "**Size calculation:**",
        "- Discriminator: 8 bytes (Anchor adds automatically)",
        "- cumulative_epochs: 8 bytes (u64)",
        "- last_epoch: 8 bytes (u64)",
        "- total_yield_distributed: 8 bytes (u64)",
        "- initialized: 1 byte (bool)",
        "- bump: 1 byte (u8)",
        "Total data: 26 bytes",
        "Total with discriminator: 8 + 26 = 34 bytes"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "cumulativeEpochs",
            "docs": [
              "Count of epoch finalize calls received.",
              "Incremented each time update_cumulative succeeds."
            ],
            "type": "u64"
          },
          {
            "name": "lastEpoch",
            "docs": [
              "Last epoch number that was finalized.",
              "Used to prevent double-finalization: new epoch must be > last_epoch."
            ],
            "type": "u64"
          },
          {
            "name": "totalYieldDistributed",
            "docs": [
              "Placeholder for total yield distributed (for future integration).",
              "Incremented by 1 each call as a stub implementation."
            ],
            "type": "u64"
          },
          {
            "name": "initialized",
            "docs": [
              "Whether the stake pool has been initialized.",
              "Must be true before update_cumulative can be called."
            ],
            "type": "bool"
          },
          {
            "name": "bump",
            "docs": [
              "PDA bump seed."
            ],
            "type": "u8"
          }
        ]
      }
    }
  ]
};
