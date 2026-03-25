/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/transfer_hook.json`.
 */
export type TransferHook = {
  "address": "CiQPQrmQh6BPhb9k7dFnsEs5gKPgdrvNKFc5xie5xVGd",
  "metadata": {
    "name": "transferHook",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Transfer Hook program for whitelist-based transfer validation"
  },
  "instructions": [
    {
      "name": "addWhitelistEntry",
      "docs": [
        "Add an address to the whitelist.",
        "",
        "Creates WhitelistEntry PDA for the given address. Only callable by",
        "the whitelist authority while authority is not burned.",
        "",
        "# Errors",
        "- Unauthorized: Signer is not the authority",
        "- AuthorityAlreadyBurned: Authority has been burned",
        "- (Anchor init failure): Address already whitelisted (PDA exists)",
        "",
        "Spec reference: Transfer_Hook_Spec.md Section 7.2"
      ],
      "discriminator": [
        150,
        200,
        2,
        55,
        226,
        43,
        50,
        203
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "whitelistAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
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
          "name": "whitelistEntry",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  119,
                  104,
                  105,
                  116,
                  101,
                  108,
                  105,
                  115,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "addressToWhitelist"
              }
            ]
          }
        },
        {
          "name": "addressToWhitelist",
          "docs": [
            "Validated in handler to reject system program and null pubkey."
          ]
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "burnAuthority",
      "docs": [
        "Permanently burn the whitelist authority.",
        "",
        "Sets authority to None, making the whitelist immutable. This is",
        "idempotent: calling on an already-burned authority succeeds silently.",
        "",
        "# Errors",
        "- Unauthorized: Signer is not the authority (when authority exists)",
        "",
        "# Events",
        "- AuthorityBurned: Emitted on successful burn (not on idempotent call)",
        "",
        "Spec reference: Transfer_Hook_Spec.md Section 6.3, 7.3"
      ],
      "discriminator": [
        189,
        145,
        222,
        55,
        141,
        234,
        245,
        94
      ],
      "accounts": [
        {
          "name": "authority",
          "docs": [
            "Authority that will burn itself (must be current authority)."
          ],
          "signer": true
        },
        {
          "name": "whitelistAuthority",
          "docs": [
            "Whitelist authority PDA being burned."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
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
        }
      ],
      "args": []
    },
    {
      "name": "initializeAuthority",
      "docs": [
        "Initialize the whitelist authority account.",
        "",
        "Creates WhitelistAuthority PDA with the transaction signer as authority.",
        "Can only be called once (Anchor init constraint prevents reinitialization).",
        "",
        "Spec reference: Transfer_Hook_Spec.md Section 7.1"
      ],
      "discriminator": [
        13,
        186,
        25,
        16,
        218,
        31,
        90,
        1
      ],
      "accounts": [
        {
          "name": "signer",
          "docs": [
            "The transaction signer who will become the whitelist authority.",
            "Must be mutable to pay for account creation."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "whitelistAuthority",
          "docs": [
            "The WhitelistAuthority PDA. Initialized once; stores the authority pubkey.",
            "Seeds: [b\"authority\"]"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
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
          "name": "program",
          "docs": [
            "The Transfer Hook program — used to look up its ProgramData address."
          ],
          "address": "CiQPQrmQh6BPhb9k7dFnsEs5gKPgdrvNKFc5xie5xVGd"
        },
        {
          "name": "programData",
          "docs": [
            "ProgramData account — upgrade_authority must match signer."
          ]
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initializeExtraAccountMetaList",
      "docs": [
        "Initialize ExtraAccountMetaList for a mint.",
        "",
        "Creates the PDA that Token-2022 uses to resolve whitelist accounts",
        "at transfer time. Must be called once per mint before transfers.",
        "",
        "# Requirements",
        "- Mint must be Token-2022 with TransferHook extension pointing to this program",
        "- Authority must not be burned",
        "- ExtraAccountMetaList must not already exist for this mint",
        "",
        "# Events",
        "- ExtraAccountMetaListInitialized: Emitted on successful initialization",
        "",
        "Spec reference: Transfer_Hook_Spec.md Section 8",
        "",
        "Note: Uses SPL discriminator for Token-2022 transfer hook interface compatibility."
      ],
      "discriminator": [
        43,
        34,
        13,
        49,
        167,
        88,
        235,
        235
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "whitelistAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
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
          "name": "authority",
          "docs": [
            "Authority that controls whitelist operations. Must match WhitelistAuthority.authority."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "extraAccountMetaList",
          "docs": [
            "Seeds: [\"extra-account-metas\", mint.key()]"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  120,
                  116,
                  114,
                  97,
                  45,
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116,
                  45,
                  109,
                  101,
                  116,
                  97,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "mint",
          "docs": [
            "The mint for which to initialize ExtraAccountMetaList.",
            "Must be Token-2022 with TransferHook extension pointing to this program."
          ]
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "transferAuthority",
      "docs": [
        "Transfer the whitelist authority to a new pubkey (e.g., Squads multisig vault).",
        "Only the current authority can call this. new_authority must not be Pubkey::default()."
      ],
      "discriminator": [
        48,
        169,
        76,
        72,
        229,
        180,
        55,
        161
      ],
      "accounts": [
        {
          "name": "authority",
          "docs": [
            "Authority that will transfer control (must be current authority)."
          ],
          "signer": true
        },
        {
          "name": "whitelistAuthority",
          "docs": [
            "Whitelist authority PDA being transferred."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
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
      "name": "transferHook",
      "docs": [
        "Transfer hook invoked by Token-2022 during transfer_checked.",
        "",
        "Validates that at least one party (source or destination) is whitelisted.",
        "Rejects zero-amount transfers and direct hook invocations.",
        "",
        "# Account Indices (SPL Transfer Hook Spec)",
        "- 0: source_token_account",
        "- 1: mint",
        "- 2: destination_token_account",
        "- 3: owner/authority",
        "- 4: extra_account_meta_list",
        "- 5: whitelist_source (resolved from ExtraAccountMetaList)",
        "- 6: whitelist_destination (resolved from ExtraAccountMetaList)",
        "",
        "# Errors",
        "- ZeroAmountTransfer: Amount is zero",
        "- InvalidMint: Mint not owned by Token-2022 (defense-in-depth)",
        "- DirectInvocationNotAllowed: Not called from Token-2022 transfer",
        "- NoWhitelistedParty: Neither source nor destination is whitelisted",
        "",
        "Spec reference: Transfer_Hook_Spec.md Section 7.4"
      ],
      "discriminator": [
        105,
        37,
        101,
        197,
        75,
        251,
        102,
        26
      ],
      "accounts": [
        {
          "name": "sourceToken",
          "docs": [
            "Source token account (SPL account index 0)"
          ]
        },
        {
          "name": "mint",
          "docs": [
            "Token mint (SPL account index 1)"
          ]
        },
        {
          "name": "destinationToken",
          "docs": [
            "Destination token account (SPL account index 2)"
          ]
        },
        {
          "name": "owner",
          "docs": [
            "Source token owner/authority (SPL account index 3)"
          ]
        },
        {
          "name": "extraAccountMetaList",
          "docs": [
            "ExtraAccountMetaList PDA (SPL account index 4)"
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  120,
                  116,
                  114,
                  97,
                  45,
                  97,
                  99,
                  99,
                  111,
                  117,
                  110,
                  116,
                  45,
                  109,
                  101,
                  116,
                  97,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "whitelistSource",
          "docs": [
            "Whitelist PDA for source token account (extra account index 5)",
            "Resolved from ExtraAccountMetaList: [\"whitelist\", source_token.key()]"
          ]
        },
        {
          "name": "whitelistDestination",
          "docs": [
            "Whitelist PDA for destination token account (extra account index 6)",
            "Resolved from ExtraAccountMetaList: [\"whitelist\", destination_token.key()]"
          ]
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "whitelistAuthority",
      "discriminator": [
        167,
        40,
        232,
        217,
        167,
        89,
        19,
        92
      ]
    },
    {
      "name": "whitelistEntry",
      "discriminator": [
        51,
        70,
        173,
        81,
        219,
        192,
        234,
        62
      ]
    }
  ],
  "events": [
    {
      "name": "addressWhitelisted",
      "discriminator": [
        52,
        227,
        249,
        242,
        247,
        216,
        187,
        89
      ]
    },
    {
      "name": "authorityBurned",
      "discriminator": [
        140,
        127,
        146,
        34,
        91,
        207,
        199,
        223
      ]
    },
    {
      "name": "extraAccountMetaListInitialized",
      "discriminator": [
        111,
        68,
        225,
        225,
        90,
        164,
        193,
        206
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "noWhitelistedParty",
      "msg": "Neither source nor destination is whitelisted"
    },
    {
      "code": 6001,
      "name": "zeroAmountTransfer",
      "msg": "Zero amount transfers are not allowed"
    },
    {
      "code": 6002,
      "name": "unauthorized",
      "msg": "Unauthorized: signer is not the authority"
    },
    {
      "code": 6003,
      "name": "authorityAlreadyBurned",
      "msg": "Whitelist authority has already been burned"
    },
    {
      "code": 6004,
      "name": "alreadyWhitelisted",
      "msg": "Address is already whitelisted"
    },
    {
      "code": 6005,
      "name": "invalidWhitelistPda",
      "msg": "Invalid whitelist PDA derivation"
    },
    {
      "code": 6006,
      "name": "directInvocationNotAllowed",
      "msg": "Transfer hook must be invoked through Token-2022 transfer"
    },
    {
      "code": 6007,
      "name": "invalidMint",
      "msg": "Mint is not a valid Token-2022 mint"
    },
    {
      "code": 6008,
      "name": "invalidTransferHook",
      "msg": "Mint's transfer hook extension does not point to this program"
    },
    {
      "code": 6009,
      "name": "notToken2022Mint",
      "msg": "Mint is not a Token-2022 mint"
    }
  ],
  "types": [
    {
      "name": "addressWhitelisted",
      "docs": [
        "Emitted when a new address is added to the whitelist.",
        "",
        "Provides audit trail for all whitelist additions.",
        "",
        "Spec reference: Transfer_Hook_Spec.md Section 11"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "address",
            "docs": [
              "The address that was whitelisted."
            ],
            "type": "pubkey"
          },
          {
            "name": "addedBy",
            "docs": [
              "The authority pubkey that added this entry."
            ],
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "docs": [
              "Unix timestamp when the entry was created."
            ],
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "authorityBurned",
      "docs": [
        "Emitted when the whitelist authority is permanently burned.",
        "",
        "After this event, no new whitelist entries can be added.",
        "The whitelist becomes immutable.",
        "",
        "Spec reference: Transfer_Hook_Spec.md Section 11"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "burnedBy",
            "docs": [
              "The pubkey that burned the authority (must have been the authority)."
            ],
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "docs": [
              "Unix timestamp when the authority was burned."
            ],
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "extraAccountMetaListInitialized",
      "docs": [
        "Emitted when ExtraAccountMetaList is initialized for a mint.",
        "",
        "This signifies the mint is now configured for transfer hook invocation.",
        "Token-2022 can now resolve whitelist PDAs at transfer time.",
        "",
        "Spec reference: Transfer_Hook_Spec.md Section 8"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "docs": [
              "The mint for which ExtraAccountMetaList was created."
            ],
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "whitelistAuthority",
      "docs": [
        "Whitelist authority configuration for the Transfer Hook program.",
        "",
        "This PDA controls who can add whitelist entries. Once `authority` is set",
        "to `None` via burn_authority instruction, the whitelist becomes immutable.",
        "",
        "Seeds: [b\"authority\"]",
        "Space: 8 (discriminator) + 33 (Option<Pubkey>) + 1 (bool) = 42 bytes",
        "",
        "Spec reference: Transfer_Hook_Spec.md Section 6.1"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "docs": [
              "Authority pubkey. None = authority has been burned (whitelist immutable).",
              "Option<Pubkey> serializes as 1 byte discriminant + 32 bytes pubkey = 33 bytes."
            ],
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "initialized",
            "docs": [
              "Whether this account has been initialized."
            ],
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "whitelistEntry",
      "docs": [
        "A whitelisted address entry.",
        "",
        "Whitelist uses existence-based PDA pattern: if this PDA exists for an address,",
        "that address is whitelisted. PDA non-existence = not whitelisted.",
        "",
        "Seeds: [b\"whitelist\", address.as_ref()]",
        "Space: 8 (discriminator) + 32 (Pubkey) + 8 (i64) = 48 bytes",
        "",
        "Spec reference: Transfer_Hook_Spec.md Section 5.3"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "address",
            "docs": [
              "The whitelisted address (token account pubkey, not wallet)."
            ],
            "type": "pubkey"
          },
          {
            "name": "createdAt",
            "docs": [
              "Timestamp when this entry was created (audit trail)."
            ],
            "type": "i64"
          }
        ]
      }
    }
  ]
};
