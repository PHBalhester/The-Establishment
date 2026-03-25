# Focus Manifest: State Machine

## Core Patterns (always load)

### Logic / State Machine (EP-033-041)
- EP-033: CEI Violation (CRITICAL)
- EP-034: Missing State Transition Check (MEDIUM)
- EP-035: Closed Account Data Reuse (HIGH)
- EP-036: Account Revival / Resurrection (HIGH)
- EP-037: Reinitialization Attack (HIGH)
- EP-038: Cross-Instruction State Attack (CRITICAL)
- EP-039: Instruction Introspection Abuse (HIGH)
- EP-040: Closing Account With Obligations (HIGH)
- EP-041: Order Book Stale Cache (MEDIUM)

### Resource / DoS (EP-084-088)
- EP-084: Compute Unit Exhaustion (MEDIUM)
- EP-085: Unbounded Iteration (MEDIUM)
- EP-086: Stack Overflow (MEDIUM)
- EP-087: Heap Exhaustion (MEDIUM)
- EP-088: Borsh Deserialization Bomb (HIGH)

## Conditional (load if detected)
- AMM/DEX attacks playbook (AMM detected)
