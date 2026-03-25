/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/epoch_program.json`.
 */
export type EpochProgram = {
  "address": "4Heqc8QEjJCspHR8y96wgZBnBfbe3Qb8N6JBZMQt9iw2",
  "metadata": {
    "name": "epochProgram",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Dr Fraudsworth Epoch Program - VRF-driven tax regime coordination"
  },
  "instructions": [
    {
      "name": "consumeRandomness",
      "docs": [
        "Consume revealed VRF randomness and update taxes.",
        "",
        "Called after Switchboard oracle has revealed randomness (~3 slots after trigger).",
        "Verifies anti-reroll protection, reads VRF bytes, derives tax rates.",
        "Client must bundle this with Switchboard SDK revealIx.",
        "",
        "This is the third instruction in the VRF three-transaction flow:",
        "1. TX 1: Client creates randomness account (separate transaction)",
        "2. TX 2: Client bundles SDK commitIx + trigger_epoch_transition",
        "3. TX 3: Client bundles SDK revealIx + consume_randomness (this instruction)",
        "",
        "# Accounts",
        "- `caller`: Anyone",
        "- `epoch_state`: Global epoch state (mutated)",
        "- `randomness_account`: Same Switchboard account from trigger (verified)",
        "",
        "# Errors",
        "- `NoVrfPending` if no VRF request is pending",
        "- `RandomnessAccountMismatch` if account doesn't match bound account (anti-reroll)",
        "- `RandomnessParseError` if randomness account data is invalid",
        "- `RandomnessNotRevealed` if oracle hasn't revealed yet",
        "- `InsufficientRandomness` if less than 6 bytes revealed"
      ],
      "discriminator": [
        190,
        217,
        49,
        162,
        99,
        26,
        73,
        234
      ],
      "accounts": [
        {
          "name": "caller",
          "docs": [
            "Caller (anyone can call after oracle reveals)."
          ],
          "signer": true
        },
        {
          "name": "epochState",
          "docs": [
            "Global epoch state."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "randomnessAccount",
          "docs": [
            "Switchboard randomness account (MUST match pending_randomness_account)."
          ]
        },
        {
          "name": "stakingAuthority",
          "docs": [
            "Staking authority PDA - Epoch Program signs CPIs to Staking."
          ],
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
            ]
          }
        },
        {
          "name": "stakePool",
          "docs": [
            "Staking Program's pool state (mutable for update_cumulative)."
          ],
          "writable": true
        },
        {
          "name": "stakingProgram",
          "docs": [
            "Staking Program for update_cumulative CPI."
          ],
          "address": "12b3t1cNiAUoYLiWFEnFa4w6qYxVAiqCWU7KZuzLPYtH"
        },
        {
          "name": "carnageState",
          "docs": [
            "Carnage Fund state (for checking holdings and auto-expire).",
            "Optional - if not provided, Carnage trigger check is skipped.",
            "This allows backward compatibility and gradual rollout."
          ],
          "optional": true,
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
                  102,
                  117,
                  110,
                  100
                ]
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "executeCarnage",
      "docs": [
        "Execute pending Carnage (fallback).",
        "",
        "Called permissionlessly when atomic Carnage execution failed.",
        "Must be called within 100 slots of the failure (carnage_deadline_slot).",
        "",
        "This instruction performs the same execution as atomic Carnage:",
        "1. If holdings exist and action = Burn: burn tokens, then buy target",
        "2. If holdings exist and action = Sell: sell tokens to SOL, then buy target",
        "3. If no holdings: just buy target token",
        "",
        "All swaps are tax-exempt (0% tax, 1% LP fee only).",
        "",
        "# Accounts",
        "- `caller`: Anyone (permissionless)",
        "- `epoch_state`: Global epoch state (has pending flags)",
        "- `carnage_state`: Carnage Fund state (updated)",
        "- `sol_vault`: Carnage SOL vault",
        "",
        "# Errors",
        "- `NoCarnagePending` if no Carnage execution is pending",
        "- `CarnageDeadlineExpired` if current_slot > carnage_deadline_slot",
        "- `CarnageNotInitialized` if Carnage Fund not initialized",
        "",
        "Source: Carnage_Fund_Spec.md Section 13.3"
      ],
      "discriminator": [
        26,
        108,
        25,
        23,
        27,
        231,
        145,
        117
      ],
      "accounts": [
        {
          "name": "caller",
          "docs": [
            "Caller (anyone - permissionless)"
          ],
          "signer": true
        },
        {
          "name": "epochState",
          "docs": [
            "Global epoch state (has pending Carnage flags)"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "carnageState",
          "docs": [
            "Carnage Fund state (updated after execution)"
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
                  102,
                  117,
                  110,
                  100
                ]
              }
            ]
          }
        },
        {
          "name": "carnageSigner",
          "docs": [
            "Carnage signer PDA - signs Tax::swap_exempt CPI"
          ],
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
            ]
          }
        },
        {
          "name": "solVault",
          "docs": [
            "Carnage SOL vault (holds native SOL as lamports)"
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
            ]
          }
        },
        {
          "name": "carnageWsol",
          "docs": [
            "Carnage's WSOL token account (for swap_exempt user_token_a)",
            "Box'd for stack savings (~165 bytes -> 8 bytes)"
          ],
          "writable": true
        },
        {
          "name": "crimeVault",
          "docs": [
            "Carnage CRIME vault (Token-2022 account)",
            "Box'd for stack savings (~165 bytes -> 8 bytes)"
          ],
          "writable": true
        },
        {
          "name": "fraudVault",
          "docs": [
            "Carnage FRAUD vault (Token-2022 account)",
            "Box'd for stack savings (~165 bytes -> 8 bytes)"
          ],
          "writable": true
        },
        {
          "name": "crimePool",
          "docs": [
            "CRIME/SOL AMM pool"
          ],
          "writable": true
        },
        {
          "name": "crimePoolVaultA",
          "docs": [
            "CRIME/SOL pool's SOL vault"
          ],
          "writable": true
        },
        {
          "name": "crimePoolVaultB",
          "docs": [
            "CRIME/SOL pool's token vault"
          ],
          "writable": true
        },
        {
          "name": "fraudPool",
          "docs": [
            "FRAUD/SOL AMM pool"
          ],
          "writable": true
        },
        {
          "name": "fraudPoolVaultA",
          "docs": [
            "FRAUD/SOL pool's SOL vault"
          ],
          "writable": true
        },
        {
          "name": "fraudPoolVaultB",
          "docs": [
            "FRAUD/SOL pool's token vault"
          ],
          "writable": true
        },
        {
          "name": "mintA",
          "docs": [
            "WSOL mint (CPI passthrough, shared by both pools)"
          ]
        },
        {
          "name": "crimeMint",
          "docs": [
            "CRIME token mint (mut: Token-2022 burn decrements supply)"
          ],
          "writable": true
        },
        {
          "name": "fraudMint",
          "docs": [
            "FRAUD token mint (mut: Token-2022 burn decrements supply)"
          ],
          "writable": true
        },
        {
          "name": "taxProgram",
          "docs": [
            "Tax Program (for swap_exempt CPI)"
          ],
          "address": "43fZGRtmEsP7ExnJE1dbTbNjaP1ncvVmMPusSeksWGEj"
        },
        {
          "name": "ammProgram",
          "docs": [
            "AMM Program (passed to Tax for swap)"
          ],
          "address": "5JsSAL3kJDUWD4ZveYXYZmgm1eVqueesTZVdAvtZg8cR"
        },
        {
          "name": "swapAuthority",
          "docs": [
            "Tax Program's swap_authority PDA (signs AMM CPI within Tax::swap_exempt)"
          ]
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
            "System program"
          ],
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "executeCarnageAtomic",
      "docs": [
        "Execute Carnage atomically (primary path).",
        "",
        "Called immediately after consume_randomness when Carnage is triggered.",
        "Typically bundled in the same transaction for MEV protection.",
        "",
        "This instruction executes the full Carnage flow:",
        "1. If holdings exist and action = Burn: burn tokens, then buy target",
        "2. If holdings exist and action = Sell: sell tokens to SOL via Tax::swap_exempt, then buy target",
        "3. If no holdings: just buy target token via Tax::swap_exempt",
        "",
        "All swaps are tax-exempt (0% tax, 1% LP fee only) via Tax::swap_exempt.",
        "Swap amount capped at MAX_CARNAGE_SWAP_LAMPORTS (1000 SOL).",
        "",
        "CRITICAL CPI DEPTH: This path reaches Solana's 4-level limit:",
        "execute_carnage_atomic -> Tax::swap_exempt -> AMM::swap_sol_pool",
        "-> Token-2022::transfer_checked -> Transfer Hook::execute",
        "",
        "# Accounts",
        "- `caller`: Anyone (permissionless when carnage_pending = true)",
        "- `epoch_state`: Global epoch state (has pending Carnage flags)",
        "- `carnage_state`: Carnage Fund state (updated with holdings/stats)",
        "- `carnage_signer`: PDA that signs Tax::swap_exempt calls",
        "- `sol_vault`: Carnage SOL vault (native lamports)",
        "- `carnage_wsol`: Carnage WSOL account for swap operations",
        "- `crime_vault`: Carnage CRIME vault (Token-2022)",
        "- `fraud_vault`: Carnage FRAUD vault (Token-2022)",
        "- `target_pool`: AMM pool for target token",
        "- `pool_vault_a/b`: Pool vaults",
        "- `mint_a/b`: Token mints",
        "- `tax_program`: Tax Program for swap_exempt CPI",
        "- `amm_program`: AMM Program (passed through to Tax)",
        "- `token_program_a/b`: Token programs",
        "- `system_program`: System program",
        "",
        "# Errors",
        "- `NoCarnagePending` if carnage_pending = false",
        "- `CarnageNotInitialized` if Carnage Fund not initialized",
        "- `InvalidCarnageTargetPool` if target pool doesn't match pending target",
        "- `Overflow` if statistics overflow",
        "",
        "Source: Carnage_Fund_Spec.md Sections 8-10, 13.2"
      ],
      "discriminator": [
        237,
        52,
        41,
        40,
        215,
        9,
        198,
        53
      ],
      "accounts": [
        {
          "name": "caller",
          "docs": [
            "Caller (anyone - permissionless execution)"
          ],
          "signer": true
        },
        {
          "name": "epochState",
          "docs": [
            "Global epoch state (has pending Carnage flags)",
            "NOTE: EpochState already has carnage_pending, carnage_action, carnage_target,",
            "carnage_deadline_slot fields from Phase 23 - we READ these existing fields."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "carnageState",
          "docs": [
            "Carnage Fund state"
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
                  102,
                  117,
                  110,
                  100
                ]
              }
            ]
          }
        },
        {
          "name": "carnageSigner",
          "docs": [
            "Carnage signer PDA - signs Tax::swap_exempt CPI"
          ],
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
            ]
          }
        },
        {
          "name": "solVault",
          "docs": [
            "Carnage SOL vault (holds native SOL as lamports)"
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
            ]
          }
        },
        {
          "name": "carnageWsol",
          "docs": [
            "Carnage's WSOL token account (for swap_exempt user_token_a)",
            "This receives wrapped SOL before swap and unwraps after",
            "Box'd for stack savings (~165 bytes -> 8 bytes)"
          ],
          "writable": true
        },
        {
          "name": "crimeVault",
          "docs": [
            "Carnage CRIME vault (Token-2022 account)",
            "Box'd for stack savings (~165 bytes -> 8 bytes)"
          ],
          "writable": true
        },
        {
          "name": "fraudVault",
          "docs": [
            "Carnage FRAUD vault (Token-2022 account)",
            "Box'd for stack savings (~165 bytes -> 8 bytes)"
          ],
          "writable": true
        },
        {
          "name": "crimePool",
          "docs": [
            "CRIME/SOL AMM pool"
          ],
          "writable": true
        },
        {
          "name": "crimePoolVaultA",
          "docs": [
            "CRIME/SOL pool's SOL vault"
          ],
          "writable": true
        },
        {
          "name": "crimePoolVaultB",
          "docs": [
            "CRIME/SOL pool's token vault"
          ],
          "writable": true
        },
        {
          "name": "fraudPool",
          "docs": [
            "FRAUD/SOL AMM pool"
          ],
          "writable": true
        },
        {
          "name": "fraudPoolVaultA",
          "docs": [
            "FRAUD/SOL pool's SOL vault"
          ],
          "writable": true
        },
        {
          "name": "fraudPoolVaultB",
          "docs": [
            "FRAUD/SOL pool's token vault"
          ],
          "writable": true
        },
        {
          "name": "mintA",
          "docs": [
            "WSOL mint (CPI passthrough, shared by both pools)"
          ]
        },
        {
          "name": "crimeMint",
          "docs": [
            "CRIME token mint (mut: Token-2022 burn decrements supply)"
          ],
          "writable": true
        },
        {
          "name": "fraudMint",
          "docs": [
            "FRAUD token mint (mut: Token-2022 burn decrements supply)"
          ],
          "writable": true
        },
        {
          "name": "taxProgram",
          "docs": [
            "Tax Program (for swap_exempt CPI)"
          ],
          "address": "43fZGRtmEsP7ExnJE1dbTbNjaP1ncvVmMPusSeksWGEj"
        },
        {
          "name": "ammProgram",
          "docs": [
            "AMM Program (passed to Tax for swap)"
          ],
          "address": "5JsSAL3kJDUWD4ZveYXYZmgm1eVqueesTZVdAvtZg8cR"
        },
        {
          "name": "swapAuthority",
          "docs": [
            "Tax Program's swap_authority PDA (signs AMM CPI within Tax::swap_exempt)"
          ]
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
            "System program"
          ],
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "expireCarnage",
      "docs": [
        "Expire pending Carnage after deadline.",
        "",
        "Called permissionlessly after the 100-slot deadline has passed.",
        "Clears the pending Carnage state. SOL is retained in vault for",
        "the next Carnage trigger.",
        "",
        "This instruction does NOT execute Carnage - it simply clears the",
        "pending state so the protocol can continue. The accumulated SOL",
        "remains in the Carnage vault and will be used on the next trigger.",
        "",
        "# Accounts",
        "- `caller`: Anyone (permissionless)",
        "- `epoch_state`: Global epoch state (pending flags cleared)",
        "- `carnage_state`: Carnage Fund state (read for vault balance)",
        "- `sol_vault`: Carnage SOL vault (read for balance in event)",
        "",
        "# Errors",
        "- `NoCarnagePending` if no Carnage execution is pending",
        "- `CarnageDeadlineNotExpired` if current_slot <= carnage_deadline_slot",
        "",
        "Source: Carnage_Fund_Spec.md Section 13.4"
      ],
      "discriminator": [
        49,
        220,
        141,
        236,
        248,
        225,
        67,
        51
      ],
      "accounts": [
        {
          "name": "caller",
          "docs": [
            "Caller (anyone - permissionless)"
          ],
          "signer": true
        },
        {
          "name": "epochState",
          "docs": [
            "Global epoch state (has pending Carnage flags)"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "carnageState",
          "docs": [
            "Carnage Fund state (read for sol_vault balance in event)"
          ],
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
                  102,
                  117,
                  110,
                  100
                ]
              }
            ]
          }
        },
        {
          "name": "solVault",
          "docs": [
            "Carnage SOL vault (read for balance in event)"
          ],
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
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "initializeCarnageFund",
      "docs": [
        "Initialize the Carnage Fund.",
        "",
        "Called once at protocol deployment. Creates the Carnage Fund state",
        "account and token vaults for CRIME and FRAUD.",
        "",
        "The SOL vault is a SystemAccount PDA that will hold native lamports",
        "from protocol fees. The token vaults are Token-2022 accounts that",
        "will hold purchased tokens before burning.",
        "",
        "# Accounts",
        "- `authority`: Deployer (pays for account creation)",
        "- `carnage_state`: Carnage Fund state PDA (created)",
        "- `sol_vault`: SOL vault PDA (SystemAccount)",
        "- `crime_vault`: CRIME token vault PDA (Token-2022, created)",
        "- `fraud_vault`: FRAUD token vault PDA (Token-2022, created)",
        "- `crime_mint`: CRIME token mint",
        "- `fraud_mint`: FRAUD token mint",
        "- `token_program`: Token-2022 program",
        "- `system_program`: System program",
        "",
        "# Errors",
        "- `CarnageAlreadyInitialized` if called more than once"
      ],
      "discriminator": [
        1,
        57,
        249,
        77,
        171,
        11,
        177,
        163
      ],
      "accounts": [
        {
          "name": "authority",
          "docs": [
            "Deployer (one-time, pays for account creation)"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "carnageState",
          "docs": [
            "Carnage Fund state account (PDA)"
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
                  102,
                  117,
                  110,
                  100
                ]
              }
            ]
          }
        },
        {
          "name": "solVault",
          "docs": [
            "SOL vault PDA (SystemAccount holding native SOL).",
            "Note: This is just a PDA address that will receive lamports.",
            "We don't create an account here - SOL is stored as lamports in the PDA."
          ],
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
            ]
          }
        },
        {
          "name": "crimeVault",
          "docs": [
            "CRIME token vault PDA (Token-2022 account)"
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
                  99,
                  114,
                  105,
                  109,
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
          "name": "fraudVault",
          "docs": [
            "FRAUD token vault PDA (Token-2022 account)"
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
                  102,
                  114,
                  97,
                  117,
                  100,
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
          "name": "crimeMint",
          "docs": [
            "CRIME token mint (Token-2022)"
          ]
        },
        {
          "name": "fraudMint",
          "docs": [
            "FRAUD token mint (Token-2022)"
          ]
        },
        {
          "name": "tokenProgram",
          "docs": [
            "Token-2022 program (for CRIME and FRAUD vaults)"
          ]
        },
        {
          "name": "program",
          "docs": [
            "The Epoch program — used to look up its ProgramData address."
          ],
          "address": "4Heqc8QEjJCspHR8y96wgZBnBfbe3Qb8N6JBZMQt9iw2"
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
            "System program"
          ],
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initializeEpochState",
      "docs": [
        "Initialize the global epoch state.",
        "",
        "Called once at protocol deployment. Sets up genesis configuration",
        "with CRIME as the cheap side, 3% low tax, 14% high tax.",
        "",
        "# Arguments",
        "None - all values are hardcoded for genesis.",
        "",
        "# Errors",
        "- `AlreadyInitialized` if called more than once"
      ],
      "discriminator": [
        139,
        122,
        53,
        254,
        85,
        205,
        138,
        245
      ],
      "accounts": [
        {
          "name": "payer",
          "docs": [
            "Payer for account creation rent.",
            "Typically the protocol deployer."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "epochState",
          "docs": [
            "Global epoch state PDA.",
            "seeds = [\"epoch_state\"]"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "program",
          "docs": [
            "The Epoch program — used to look up its ProgramData address."
          ],
          "address": "4Heqc8QEjJCspHR8y96wgZBnBfbe3Qb8N6JBZMQt9iw2"
        },
        {
          "name": "programData",
          "docs": [
            "ProgramData account — upgrade_authority must match payer."
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
      "name": "retryEpochVrf",
      "docs": [
        "Retry VRF after timeout.",
        "",
        "Called permissionlessly if oracle fails to reveal within 300 slots (~2 min).",
        "Replaces the stale randomness account with a fresh one.",
        "Client must bundle this with Switchboard SDK commitIx.",
        "",
        "This is a recovery mechanism to prevent protocol deadlock. If the original",
        "oracle fails to reveal, anyone can call this instruction with a new",
        "randomness account to restart the VRF process.",
        "",
        "# Accounts",
        "- `payer`: Anyone",
        "- `epoch_state`: Global epoch state (mutated)",
        "- `randomness_account`: Fresh Switchboard account",
        "",
        "# Errors",
        "- `NoVrfPending` if no VRF request is pending",
        "- `VrfTimeoutNotElapsed` if 300 slots haven't passed since original request",
        "- `RandomnessParseError` if randomness account data is invalid",
        "- `RandomnessExpired` if seed_slot is stale",
        "- `RandomnessAlreadyRevealed` if randomness was already revealed"
      ],
      "discriminator": [
        224,
        172,
        84,
        142,
        193,
        90,
        137,
        142
      ],
      "accounts": [
        {
          "name": "payer",
          "docs": [
            "Payer for the retry (anyone can call)."
          ],
          "signer": true
        },
        {
          "name": "epochState",
          "docs": [
            "Global epoch state."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "randomnessAccount",
          "docs": [
            "Fresh Switchboard randomness account (replaces stale one)."
          ]
        }
      ],
      "args": []
    },
    {
      "name": "triggerEpochTransition",
      "docs": [
        "Trigger an epoch transition.",
        "",
        "Called permissionlessly when epoch boundary is reached. Validates and",
        "binds a Switchboard randomness account for anti-reroll protection.",
        "Client must bundle this with Switchboard SDK commitIx.",
        "",
        "This is the first instruction in the VRF three-transaction flow:",
        "1. TX 1: Client creates randomness account (separate transaction)",
        "2. TX 2: Client bundles SDK commitIx + trigger_epoch_transition",
        "3. TX 3: Client bundles SDK revealIx + consume_randomness",
        "",
        "# Accounts",
        "- `payer`: Anyone, receives 0.001 SOL bounty from Carnage SOL vault",
        "- `epoch_state`: Global epoch state (mutated)",
        "- `carnage_sol_vault`: Carnage SOL vault PDA (funds bounty via invoke_signed)",
        "- `randomness_account`: Switchboard On-Demand account",
        "",
        "# Errors",
        "- `EpochBoundaryNotReached` if current slot hasn't passed next epoch boundary",
        "- `VrfAlreadyPending` if a VRF request is already in progress",
        "- `RandomnessParseError` if randomness account data is invalid",
        "- `RandomnessExpired` if seed_slot is stale (> 1 slot behind)",
        "- `RandomnessAlreadyRevealed` if randomness was already revealed"
      ],
      "discriminator": [
        54,
        133,
        174,
        185,
        145,
        124,
        78,
        58
      ],
      "accounts": [
        {
          "name": "payer",
          "docs": [
            "Payer who triggers the transition. Receives the trigger bounty.",
            "Anyone can call - permissionless epoch advancement."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "epochState",
          "docs": [
            "Global epoch state singleton.",
            "Validated via seeds and bump."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "carnageSolVault",
          "docs": [
            "Carnage SOL vault PDA that funds the trigger bounty.",
            "The vault accrues 24% of all trade tax and has ample balance for bounties.",
            "Uses invoke_signed with PDA seeds to authorize the transfer."
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
            ]
          }
        },
        {
          "name": "randomnessAccount",
          "docs": [
            "Switchboard On-Demand randomness account.",
            "Created by the client in a prior transaction, passed here for validation."
          ]
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
      "name": "carnageFundState",
      "discriminator": [
        154,
        96,
        78,
        113,
        241,
        43,
        56,
        17
      ]
    },
    {
      "name": "epochState",
      "discriminator": [
        191,
        63,
        139,
        237,
        144,
        12,
        223,
        210
      ]
    }
  ],
  "events": [
    {
      "name": "carnageExecuted",
      "discriminator": [
        7,
        173,
        133,
        145,
        15,
        100,
        42,
        136
      ]
    },
    {
      "name": "carnageExpired",
      "discriminator": [
        43,
        0,
        226,
        140,
        190,
        109,
        64,
        239
      ]
    },
    {
      "name": "carnageFailed",
      "discriminator": [
        149,
        121,
        32,
        157,
        25,
        171,
        166,
        38
      ]
    },
    {
      "name": "carnageFundInitialized",
      "discriminator": [
        246,
        35,
        148,
        145,
        52,
        20,
        180,
        42
      ]
    },
    {
      "name": "carnageNotTriggered",
      "discriminator": [
        17,
        67,
        78,
        119,
        74,
        91,
        100,
        218
      ]
    },
    {
      "name": "carnagePending",
      "discriminator": [
        212,
        146,
        227,
        79,
        190,
        121,
        70,
        155
      ]
    },
    {
      "name": "epochStateInitialized",
      "discriminator": [
        128,
        4,
        123,
        70,
        242,
        219,
        119,
        231
      ]
    },
    {
      "name": "epochTransitionTriggered",
      "discriminator": [
        44,
        154,
        185,
        124,
        135,
        190,
        133,
        125
      ]
    },
    {
      "name": "taxesUpdated",
      "discriminator": [
        173,
        137,
        202,
        71,
        9,
        218,
        206,
        193
      ]
    },
    {
      "name": "vrfRetryRequested",
      "discriminator": [
        145,
        69,
        234,
        127,
        127,
        230,
        121,
        161
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "alreadyInitialized",
      "msg": "Epoch state already initialized"
    },
    {
      "code": 6001,
      "name": "notInitialized",
      "msg": "Epoch state not initialized"
    },
    {
      "code": 6002,
      "name": "invalidEpochState",
      "msg": "Invalid epoch state"
    },
    {
      "code": 6003,
      "name": "epochBoundaryNotReached",
      "msg": "Epoch boundary has not been reached yet"
    },
    {
      "code": 6004,
      "name": "vrfAlreadyPending",
      "msg": "VRF request is already pending"
    },
    {
      "code": 6005,
      "name": "noVrfPending",
      "msg": "No VRF request is pending"
    },
    {
      "code": 6006,
      "name": "randomnessParseError",
      "msg": "Randomness account data could not be parsed"
    },
    {
      "code": 6007,
      "name": "randomnessExpired",
      "msg": "Randomness account is stale (seed_slot too old)"
    },
    {
      "code": 6008,
      "name": "randomnessAlreadyRevealed",
      "msg": "Randomness has already been revealed (cannot commit)"
    },
    {
      "code": 6009,
      "name": "randomnessAccountMismatch",
      "msg": "Randomness account does not match committed account"
    },
    {
      "code": 6010,
      "name": "randomnessNotRevealed",
      "msg": "Randomness has not been revealed by oracle yet"
    },
    {
      "code": 6011,
      "name": "insufficientRandomness",
      "msg": "Insufficient randomness bytes (need 8)"
    },
    {
      "code": 6012,
      "name": "vrfTimeoutNotElapsed",
      "msg": "VRF timeout has not elapsed (wait 300 slots)"
    },
    {
      "code": 6013,
      "name": "noCarnagePending",
      "msg": "No Carnage execution is pending"
    },
    {
      "code": 6014,
      "name": "carnageDeadlineExpired",
      "msg": "Carnage execution deadline has expired"
    },
    {
      "code": 6015,
      "name": "carnageDeadlineNotExpired",
      "msg": "Carnage deadline has not expired yet"
    },
    {
      "code": 6016,
      "name": "carnageLockActive",
      "msg": "Carnage lock window active (atomic-only period)"
    },
    {
      "code": 6017,
      "name": "invalidCarnageTargetPool",
      "msg": "Invalid Carnage target pool"
    },
    {
      "code": 6018,
      "name": "carnageNotInitialized",
      "msg": "Carnage fund not initialized"
    },
    {
      "code": 6019,
      "name": "carnageAlreadyInitialized",
      "msg": "Carnage fund already initialized"
    },
    {
      "code": 6020,
      "name": "insufficientCarnageSol",
      "msg": "Insufficient SOL in Carnage vault"
    },
    {
      "code": 6021,
      "name": "carnageSwapFailed",
      "msg": "Carnage swap execution failed"
    },
    {
      "code": 6022,
      "name": "carnageBurnFailed",
      "msg": "Carnage burn execution failed"
    },
    {
      "code": 6023,
      "name": "overflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6024,
      "name": "insufficientTreasuryBalance",
      "msg": "Insufficient SOL in treasury for bounty"
    },
    {
      "code": 6025,
      "name": "invalidRandomnessOwner",
      "msg": "Randomness account not owned by Switchboard program"
    },
    {
      "code": 6026,
      "name": "invalidCarnageWsolOwner",
      "msg": "Carnage WSOL account not owned by CarnageSigner PDA"
    },
    {
      "code": 6027,
      "name": "invalidStakingProgram",
      "msg": "Staking program address mismatch"
    },
    {
      "code": 6028,
      "name": "invalidMint",
      "msg": "Invalid mint account"
    },
    {
      "code": 6029,
      "name": "carnageSlippageExceeded",
      "msg": "Carnage swap slippage exceeded (below minimum output floor)"
    },
    {
      "code": 6030,
      "name": "invalidTaxProgram",
      "msg": "Tax program address mismatch"
    },
    {
      "code": 6031,
      "name": "invalidAmmProgram",
      "msg": "AMM program address mismatch"
    },
    {
      "code": 6032,
      "name": "invalidCheapSide",
      "msg": "Invalid cheap_side value -- expected 0 (CRIME) or 1 (FRAUD)"
    }
  ],
  "types": [
    {
      "name": "carnageExecuted",
      "docs": [
        "Emitted when Carnage executes successfully.",
        "",
        "Contains full details of the buyback-and-burn (or sell) operation.",
        "Source: Carnage_Fund_Spec.md Section 14"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "epoch",
            "docs": [
              "Epoch when Carnage executed"
            ],
            "type": "u32"
          },
          {
            "name": "action",
            "docs": [
              "0=None, 1=Burn, 2=Sell (matches CarnageAction enum)"
            ],
            "type": "u8"
          },
          {
            "name": "target",
            "docs": [
              "0=CRIME, 1=FRAUD (matches Token enum)"
            ],
            "type": "u8"
          },
          {
            "name": "solSpent",
            "docs": [
              "SOL spent on the swap (in lamports)"
            ],
            "type": "u64"
          },
          {
            "name": "tokensBought",
            "docs": [
              "Tokens bought from the pool"
            ],
            "type": "u64"
          },
          {
            "name": "tokensBurned",
            "docs": [
              "Tokens burned (0 if action=Sell)"
            ],
            "type": "u64"
          },
          {
            "name": "solFromSale",
            "docs": [
              "SOL received from sale (0 if action=Burn)"
            ],
            "type": "u64"
          },
          {
            "name": "atomic",
            "docs": [
              "true if executed atomically in consume_randomness, false if via fallback"
            ],
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "carnageExpired",
      "docs": [
        "Emitted when pending Carnage expires without execution.",
        "",
        "Indicates that the fallback window (300 slots) elapsed without",
        "anyone calling execute_pending_carnage. SOL is retained for next time.",
        "Source: Carnage_Fund_Spec.md Section 14"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "epoch",
            "docs": [
              "Epoch when Carnage was originally triggered"
            ],
            "type": "u32"
          },
          {
            "name": "target",
            "docs": [
              "0=CRIME, 1=FRAUD (matches Token enum)"
            ],
            "type": "u8"
          },
          {
            "name": "action",
            "docs": [
              "0=None, 1=Burn, 2=Sell (matches CarnageAction enum)"
            ],
            "type": "u8"
          },
          {
            "name": "deadlineSlot",
            "docs": [
              "Slot deadline that was missed"
            ],
            "type": "u64"
          },
          {
            "name": "solRetained",
            "docs": [
              "SOL that remains in vault for next trigger"
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "carnageFailed",
      "docs": [
        "Emitted when Carnage execution fails and funds carry forward.",
        "",
        "Only emitted from expire_carnage when stale pending Carnage is cleared,",
        "since failing transactions roll back entirely (no event emission).",
        "Source: Phase 47 CONTEXT.md"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "epoch",
            "docs": [
              "Epoch when Carnage was triggered"
            ],
            "type": "u32"
          },
          {
            "name": "action",
            "docs": [
              "0=None, 1=Burn, 2=Sell (matches CarnageAction enum)"
            ],
            "type": "u8"
          },
          {
            "name": "target",
            "docs": [
              "0=CRIME, 1=FRAUD (matches Token enum)"
            ],
            "type": "u8"
          },
          {
            "name": "attemptedAmount",
            "docs": [
              "SOL that was attempted (lamports)"
            ],
            "type": "u64"
          },
          {
            "name": "vaultBalance",
            "docs": [
              "SOL remaining in vault (lamports)"
            ],
            "type": "u64"
          },
          {
            "name": "slot",
            "docs": [
              "Slot when failure was detected"
            ],
            "type": "u64"
          },
          {
            "name": "atomic",
            "docs": [
              "Whether the atomic path was attempted (always true for expire, distinguishes from future use)"
            ],
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "carnageFundInitialized",
      "docs": [
        "Emitted when Carnage Fund is initialized.",
        "",
        "This event marks the initialization of the Carnage Fund vaults.",
        "Source: Carnage_Fund_Spec.md Section 14"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "solVault",
            "docs": [
              "PDA of the SOL vault"
            ],
            "type": "pubkey"
          },
          {
            "name": "crimeVault",
            "docs": [
              "PDA of the CRIME token vault"
            ],
            "type": "pubkey"
          },
          {
            "name": "fraudVault",
            "docs": [
              "PDA of the FRAUD token vault"
            ],
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "docs": [
              "Unix timestamp of initialization"
            ],
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "carnageFundState",
      "docs": [
        "Global Carnage Fund state account.",
        "",
        "Single PDA: seeds = [\"carnage_fund\"]",
        "",
        "This account tracks the Carnage Fund's holdings, vault addresses,",
        "and lifetime statistics. The Carnage Fund accumulates SOL from protocol",
        "fees and uses it for random buyback-and-burn operations.",
        "",
        "**Size calculation:**",
        "- Discriminator: 8 bytes",
        "- sol_vault: 32 bytes",
        "- crime_vault: 32 bytes",
        "- fraud_vault: 32 bytes",
        "- held_token: 1 byte",
        "- held_amount: 8 bytes",
        "- last_trigger_epoch: 4 bytes",
        "- total_sol_spent: 8 bytes",
        "- total_crime_burned: 8 bytes",
        "- total_fraud_burned: 8 bytes",
        "- total_triggers: 4 bytes",
        "- initialized: 1 byte",
        "- bump: 1 byte",
        "Total: 8 + 139 = 147 bytes",
        "",
        "Source: Carnage_Fund_Spec.md Section 4"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "solVault",
            "docs": [
              "PDA of the SOL vault (SystemAccount holding native SOL).",
              "Seeds = [\"carnage_sol_vault\"]"
            ],
            "type": "pubkey"
          },
          {
            "name": "crimeVault",
            "docs": [
              "PDA of the CRIME token vault (Token-2022 account).",
              "Seeds = [\"carnage_crime_vault\"]"
            ],
            "type": "pubkey"
          },
          {
            "name": "fraudVault",
            "docs": [
              "PDA of the FRAUD token vault (Token-2022 account).",
              "Seeds = [\"carnage_fraud_vault\"]"
            ],
            "type": "pubkey"
          },
          {
            "name": "heldToken",
            "docs": [
              "Which token is currently held (0=None, 1=CRIME, 2=FRAUD).",
              "Use u8 to avoid Borsh enum serialization complexity.",
              "See HeldToken enum for type-safe operations."
            ],
            "type": "u8"
          },
          {
            "name": "heldAmount",
            "docs": [
              "Amount of held token (0 if held_token = None).",
              "Represents tokens purchased during Carnage trigger,",
              "waiting for next Carnage to burn or sell."
            ],
            "type": "u64"
          },
          {
            "name": "lastTriggerEpoch",
            "docs": [
              "Last epoch when Carnage triggered.",
              "Used to track Carnage frequency for analytics."
            ],
            "type": "u32"
          },
          {
            "name": "totalSolSpent",
            "docs": [
              "Lifetime statistics: total SOL spent on buys (in lamports).",
              "Monotonically increasing."
            ],
            "type": "u64"
          },
          {
            "name": "totalCrimeBurned",
            "docs": [
              "Lifetime statistics: total CRIME burned.",
              "Monotonically increasing."
            ],
            "type": "u64"
          },
          {
            "name": "totalFraudBurned",
            "docs": [
              "Lifetime statistics: total FRAUD burned.",
              "Monotonically increasing."
            ],
            "type": "u64"
          },
          {
            "name": "totalTriggers",
            "docs": [
              "Lifetime statistics: total triggers executed.",
              "Monotonically increasing counter."
            ],
            "type": "u32"
          },
          {
            "name": "initialized",
            "docs": [
              "Initialization flag.",
              "Set to true in initialize_carnage_fund, prevents re-initialization."
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
    },
    {
      "name": "carnageNotTriggered",
      "docs": [
        "Emitted when Carnage trigger check occurs but doesn't trigger.",
        "",
        "Indicates that VRF byte 5 did not meet the trigger threshold.",
        "Source: Carnage_Fund_Spec.md Section 14"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "epoch",
            "docs": [
              "Epoch when trigger was checked"
            ],
            "type": "u32"
          },
          {
            "name": "vrfByte",
            "docs": [
              "VRF byte 5 value that didn't meet threshold (<11 required)"
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "carnagePending",
      "docs": [
        "Emitted when atomic Carnage fails and enters pending state.",
        "",
        "Indicates that Carnage was triggered but could not execute atomically",
        "(e.g., due to compute limits). Fallback execution is now available.",
        "Source: Carnage_Fund_Spec.md Section 14"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "epoch",
            "docs": [
              "Epoch when Carnage was triggered"
            ],
            "type": "u32"
          },
          {
            "name": "target",
            "docs": [
              "0=CRIME, 1=FRAUD (matches Token enum)"
            ],
            "type": "u8"
          },
          {
            "name": "action",
            "docs": [
              "0=None, 1=Burn, 2=Sell (matches CarnageAction enum)"
            ],
            "type": "u8"
          },
          {
            "name": "deadlineSlot",
            "docs": [
              "Slot deadline for fallback execution"
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "epochState",
      "docs": [
        "Global epoch state account.",
        "",
        "Single PDA: seeds = [\"epoch_state\"]",
        "",
        "This account is the coordination hub for all protocol dynamics:",
        "- Tax rates (read by Tax Program during swaps)",
        "- VRF state (commit-reveal randomness lifecycle)",
        "- Carnage state (pending execution tracking)",
        "",
        "**Size calculation:**",
        "- Discriminator: 8 bytes",
        "- genesis_slot: 8 bytes",
        "- current_epoch: 4 bytes",
        "- epoch_start_slot: 8 bytes",
        "- cheap_side: 1 byte",
        "- low_tax_bps: 2 bytes",
        "- high_tax_bps: 2 bytes",
        "- crime_buy_tax_bps: 2 bytes",
        "- crime_sell_tax_bps: 2 bytes",
        "- fraud_buy_tax_bps: 2 bytes",
        "- fraud_sell_tax_bps: 2 bytes",
        "- vrf_request_slot: 8 bytes",
        "- vrf_pending: 1 byte",
        "- taxes_confirmed: 1 byte",
        "- pending_randomness_account: 32 bytes",
        "- carnage_pending: 1 byte",
        "- carnage_target: 1 byte",
        "- carnage_action: 1 byte",
        "- carnage_deadline_slot: 8 bytes",
        "- carnage_lock_slot: 8 bytes",
        "- last_carnage_epoch: 4 bytes",
        "- initialized: 1 byte",
        "- bump: 1 byte",
        "- reserved: 64 bytes (future schema evolution padding)",
        "- initialized: 1 byte",
        "- bump: 1 byte",
        "Total: 8 + 164 = 172 bytes",
        "",
        "Source: Epoch_State_Machine_Spec.md Section 4.1, Phase 47 CONTEXT.md"
      ],
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "genesisSlot",
            "docs": [
              "Slot when protocol was initialized (genesis).",
              "Used for epoch calculation: epoch = (current_slot - genesis_slot) / SLOTS_PER_EPOCH"
            ],
            "type": "u64"
          },
          {
            "name": "currentEpoch",
            "docs": [
              "Current epoch number (0-indexed).",
              "Increments each time trigger_epoch_transition succeeds."
            ],
            "type": "u32"
          },
          {
            "name": "epochStartSlot",
            "docs": [
              "Slot when the current epoch started.",
              "Calculated: genesis_slot + (current_epoch * SLOTS_PER_EPOCH)"
            ],
            "type": "u64"
          },
          {
            "name": "cheapSide",
            "docs": [
              "Current cheap side: 0 = CRIME, 1 = FRAUD.",
              "Cheap side gets low tax on buy, high tax on sell."
            ],
            "type": "u8"
          },
          {
            "name": "lowTaxBps",
            "docs": [
              "Low tax rate in basis points (100-400, i.e., 1-4%).",
              "Applied to cheap side buys and expensive side sells."
            ],
            "type": "u16"
          },
          {
            "name": "highTaxBps",
            "docs": [
              "High tax rate in basis points (1100-1400, i.e., 11-14%).",
              "Applied to cheap side sells and expensive side buys."
            ],
            "type": "u16"
          },
          {
            "name": "crimeBuyTaxBps",
            "docs": [
              "CRIME buy tax rate in basis points.",
              "If CRIME cheap: low_tax_bps. If FRAUD cheap: high_tax_bps."
            ],
            "type": "u16"
          },
          {
            "name": "crimeSellTaxBps",
            "docs": [
              "CRIME sell tax rate in basis points.",
              "If CRIME cheap: high_tax_bps. If FRAUD cheap: low_tax_bps."
            ],
            "type": "u16"
          },
          {
            "name": "fraudBuyTaxBps",
            "docs": [
              "FRAUD buy tax rate in basis points.",
              "If FRAUD cheap: low_tax_bps. If CRIME cheap: high_tax_bps."
            ],
            "type": "u16"
          },
          {
            "name": "fraudSellTaxBps",
            "docs": [
              "FRAUD sell tax rate in basis points.",
              "If FRAUD cheap: high_tax_bps. If CRIME cheap: low_tax_bps."
            ],
            "type": "u16"
          },
          {
            "name": "vrfRequestSlot",
            "docs": [
              "Slot when VRF randomness was committed (0 = none pending).",
              "Used for timeout detection: if current_slot > vrf_request_slot + VRF_TIMEOUT_SLOTS, retry allowed."
            ],
            "type": "u64"
          },
          {
            "name": "vrfPending",
            "docs": [
              "Whether a VRF request is pending (waiting for consume_randomness)."
            ],
            "type": "bool"
          },
          {
            "name": "taxesConfirmed",
            "docs": [
              "Whether taxes have been confirmed for the current epoch.",
              "False between trigger_epoch_transition and consume_randomness."
            ],
            "type": "bool"
          },
          {
            "name": "pendingRandomnessAccount",
            "docs": [
              "Pubkey of the Switchboard randomness account bound at commit time.",
              "Anti-reroll protection: consume_randomness must use this exact account."
            ],
            "type": "pubkey"
          },
          {
            "name": "carnagePending",
            "docs": [
              "Whether Carnage execution is pending (atomic failed, fallback active)."
            ],
            "type": "bool"
          },
          {
            "name": "carnageTarget",
            "docs": [
              "Target token for Carnage buy: 0 = CRIME, 1 = FRAUD.",
              "Only valid when carnage_pending = true."
            ],
            "type": "u8"
          },
          {
            "name": "carnageAction",
            "docs": [
              "Carnage action type: 0 = None, 1 = Burn, 2 = Sell.",
              "Only valid when carnage_pending = true."
            ],
            "type": "u8"
          },
          {
            "name": "carnageDeadlineSlot",
            "docs": [
              "Slot deadline for fallback Carnage execution.",
              "If current_slot > carnage_deadline_slot, Carnage expires."
            ],
            "type": "u64"
          },
          {
            "name": "carnageLockSlot",
            "docs": [
              "Slot until which only the atomic Carnage path can execute.",
              "After lock expires, fallback execute_carnage becomes callable.",
              "Set to current_slot + CARNAGE_LOCK_SLOTS when Carnage triggers."
            ],
            "type": "u64"
          },
          {
            "name": "lastCarnageEpoch",
            "docs": [
              "Last epoch when Carnage was triggered.",
              "Used to track Carnage frequency."
            ],
            "type": "u32"
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          },
          {
            "name": "initialized",
            "docs": [
              "Whether the epoch state has been initialized.",
              "Set to true in initialize_epoch_state, prevents re-initialization."
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
    },
    {
      "name": "epochStateInitialized",
      "docs": [
        "Emitted when epoch state is initialized at protocol deployment.",
        "",
        "This event marks the genesis of the epoch system.",
        "Source: Epoch_State_Machine_Spec.md Section 12"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "genesisSlot",
            "docs": [
              "Slot when protocol was initialized"
            ],
            "type": "u64"
          },
          {
            "name": "initialCheapSide",
            "docs": [
              "Initial cheap side: 0 = CRIME, 1 = FRAUD"
            ],
            "type": "u8"
          },
          {
            "name": "timestamp",
            "docs": [
              "Unix timestamp of initialization"
            ],
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "epochTransitionTriggered",
      "docs": [
        "Emitted when an epoch transition is triggered.",
        "",
        "This event indicates that the VRF commitment phase has begun.",
        "Client should bundle with Switchboard SDK commitIx.",
        "Source: Epoch_State_Machine_Spec.md Section 12"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "epoch",
            "docs": [
              "The new epoch number"
            ],
            "type": "u32"
          },
          {
            "name": "triggeredBy",
            "docs": [
              "Public key of the account that triggered the transition"
            ],
            "type": "pubkey"
          },
          {
            "name": "slot",
            "docs": [
              "Slot when transition was triggered"
            ],
            "type": "u64"
          },
          {
            "name": "bountyPaid",
            "docs": [
              "Bounty paid to triggerer in lamports"
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "taxesUpdated",
      "docs": [
        "Emitted when taxes are updated after VRF randomness is consumed.",
        "",
        "Contains the new tax configuration derived from VRF bytes.",
        "Source: Epoch_State_Machine_Spec.md Section 12"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "epoch",
            "docs": [
              "Current epoch number"
            ],
            "type": "u32"
          },
          {
            "name": "cheapSide",
            "docs": [
              "New cheap side: 0 = CRIME, 1 = FRAUD"
            ],
            "type": "u8"
          },
          {
            "name": "lowTaxBps",
            "docs": [
              "Low tax rate in basis points (100-400)"
            ],
            "type": "u16"
          },
          {
            "name": "highTaxBps",
            "docs": [
              "High tax rate in basis points (1100-1400)"
            ],
            "type": "u16"
          },
          {
            "name": "flipped",
            "docs": [
              "Whether the cheap side flipped from previous epoch"
            ],
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "vrfRetryRequested",
      "docs": [
        "Emitted when a VRF retry is requested after timeout.",
        "",
        "Indicates the original VRF request timed out (300 slots) and a fresh",
        "randomness account was committed.",
        "Source: Epoch_State_Machine_Spec.md Section 12"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "epoch",
            "docs": [
              "Current epoch number"
            ],
            "type": "u32"
          },
          {
            "name": "originalRequestSlot",
            "docs": [
              "Slot of the original (failed) VRF request"
            ],
            "type": "u64"
          },
          {
            "name": "retrySlot",
            "docs": [
              "Slot of this retry request"
            ],
            "type": "u64"
          },
          {
            "name": "requestedBy",
            "docs": [
              "Public key of the account that requested the retry"
            ],
            "type": "pubkey"
          }
        ]
      }
    }
  ]
};
