---
task_id: db-phase1-inj-05
provides: [inj-05-findings, inj-05-invariants]
focus_area: inj-05
files_analyzed: [app/lib/bigint-json.ts, app/lib/protocol-store.ts, app/lib/event-parser.ts, app/lib/ws-subscriber.ts, app/lib/protocol-config.ts, app/lib/connection.ts, app/lib/sse-manager.ts, app/app/api/webhooks/helius/route.ts, app/app/api/sse/protocol/route.ts, app/app/api/rpc/route.ts, app/app/api/candles/route.ts, app/hooks/useProtocolState.ts, app/hooks/useChartSSE.ts, app/hooks/useChartData.ts, app/providers/SettingsProvider.tsx, app/providers/ClusterConfigProvider.tsx, scripts/crank/crank-provider.ts, scripts/deploy/upload-metadata.ts, scripts/webhook-manage.ts, shared/constants.ts]
finding_count: 3
severity_breakdown: {critical: 0, high: 0, medium: 1, low: 2}
---
<!-- CONDENSED_SUMMARY_START -->
# Prototype Pollution & Deserialization (INJ-05) -- Condensed Summary

## Key Findings (Top 5)

1. **Custom bigintReviver tag collision**: The `{ __bigint: "..." }` sentinel used for BigInt SSE serialization could be injected by a crafted Helius webhook payload, converting string values to BigInt and causing type confusion downstream -- `app/lib/bigint-json.ts:46-51`
2. **No lodash/deepmerge/YAML/XML dependency**: The codebase uses zero deep-merge libraries, zero YAML/XML parsers, and zero pickle-like deserializers. The primary attack surface (lodash.merge + user input) is absent. -- `app/package.json` (confirmed via dependency scan)
3. **SettingsProvider spread of localStorage-parsed data without schema validation**: `JSON.parse(raw)` from localStorage flows into `{ ...prev, ...partial }` (shallow spread). Individual field validation is present but the spread of the full parsed object is not structurally restricted. -- `app/providers/SettingsProvider.tsx:190-218,249`
4. **Webhook account data stored with spread of Anchor-decoded objects**: `{ ...normalized, updatedAt: Date.now() }` spreads Anchor-decoded data into protocol store. The source is Anchor's BorshCoder (trusted parser), not raw user input. -- `app/app/api/webhooks/helius/route.ts:603-606`
5. **JSON.parse of external HTTP responses in scripts**: Multiple deploy/admin scripts call `JSON.parse()` on responses from Helius API, Irys gateway, and local files without schema validation. These are admin-only scripts running in controlled environments. -- `scripts/deploy/upload-metadata.ts:286`, `scripts/webhook-manage.ts:96`

## Critical Mechanisms

- **BigInt SSE Pipeline**: Server: `anchorToJson()` converts BN fields to `{ __bigint: "..." }` tags -> `JSON.stringify(data, bigintReplacer)` -> SSE broadcast. Client: `JSON.parse(event.data, bigintReviver)` converts tags back to BigInt. The `__bigint` sentinel is a custom convention with no spec backing. -- `app/lib/bigint-json.ts:35-51`, `app/hooks/useProtocolState.ts:253,269`
- **Protocol Store data flow**: Helius webhook delivers base64 account data -> Anchor BorshCoder decodes -> `anchorToJson()` normalizes -> `protocolStore.setAccountState()` stores and broadcasts via SSE. No raw user input enters this pipeline directly. -- `app/app/api/webhooks/helius/route.ts:588-606`, `app/lib/protocol-store.ts:53-64`
- **RPC Proxy passthrough**: Browser sends JSON-RPC to `/api/rpc` -> method allowlist check -> `JSON.stringify(body)` -> forwarded verbatim to Helius. Response is returned as raw text, never parsed/merged server-side. -- `app/app/api/rpc/route.ts:92-171`
- **SettingsProvider localStorage round-trip**: `loadSettings()` does `JSON.parse(localStorage.getItem(...))` then validates each field individually with type/range checks before constructing the settings object. -- `app/providers/SettingsProvider.tsx:181-223`

## Invariants & Assumptions

- INVARIANT: No lodash, deepmerge, js-yaml, xml2js, or any deep-merge library is in any package.json dependency. -- enforced by dependency absence (confirmed via grep of all package.json files)
- INVARIANT: All database writes use Drizzle ORM's parameterized `.insert().values({...}).onConflictDoNothing()` pattern. No user input flows into SQL via string interpolation. -- enforced at `app/app/api/webhooks/helius/route.ts:664-680`, `app/db/candle-aggregator.ts`
- INVARIANT: Webhook payloads are authenticated via `timingSafeEqual` before any data processing occurs. Only authenticated payloads reach the Anchor decode + store pipeline. -- enforced at `app/app/api/webhooks/helius/route.ts:286-301`
- ASSUMPTION: `JSON.parse()` alone does NOT create prototype-polluting objects. The `__proto__` key in a JSON string becomes a regular own property, not a prototype chain modification. -- VALIDATED per ECMAScript spec and FP-010 in common-false-positives.md
- ASSUMPTION: Anchor's BorshCoder.accounts.decode() produces objects with known, structured field names from the IDL. It cannot produce `__proto__` or `constructor` keys because Borsh deserialization maps bytes to predefined struct fields. -- VALIDATED by Anchor source code behavior
- ASSUMPTION: `anchorToJson()` iterates with `Object.entries(decoded)` which only processes own enumerable properties, never prototype chain properties. -- VALIDATED at `app/lib/bigint-json.ts:102`

## Risk Observations (Prioritized)

1. **MEDIUM -- BigInt tag injection via crafted webhook payload**: If an attacker could bypass webhook auth (or a compromised Helius account), they could send a payload that, after Anchor decode, contains a field with value `{ __bigint: "malicious" }`. The reviver would convert this to `BigInt("malicious")` which throws, or `BigInt("0")` which silently changes the type from object to BigInt. Impact: type confusion in downstream React components. Likelihood: Low (requires webhook auth bypass). `app/lib/bigint-json.ts:46-51`

2. **LOW -- SettingsProvider spreads parsed localStorage without strict schema**: `updateSettings(partial)` does `{ ...prev, ...partial }`. While `loadSettings()` validates fields individually, `updateSettings` accepts `Partial<Settings>` from any caller. If a caller passes an unvalidated object, extra keys would be persisted to localStorage and spread into state. No prototype pollution (shallow spread), but unexpected properties could affect rendering. `app/providers/SettingsProvider.tsx:247-257`

3. **LOW -- Script-level JSON.parse of external API responses without schema validation**: Deploy scripts call `JSON.parse(text)` on Arweave/Irys gateway responses and Helius API responses. A compromised gateway could return malicious JSON. Impact is limited because these scripts run locally by the project owner, not in production. `scripts/deploy/upload-metadata.ts:286`, `scripts/webhook-manage.ts:96`

## Novel Attack Surface

- **BigInt sentinel as a covert channel**: The `{ __bigint: "..." }` tag could theoretically be used to encode/transmit data through the SSE pipeline that survives JSON round-trips with modified semantics. If an upstream data source (Helius, or a compromised on-chain account) could inject this tag pattern into account data fields, it would alter the type of data reaching React components (from object to BigInt). This is a protocol-specific observation not covered by standard prototype pollution catalogs.

## Cross-Focus Handoffs

- -> **ERR-01 (Error Handling)**: The `bigintReviver` silently converts any object matching `{ __bigint: "..." }` to BigInt. If `BigInt(value)` throws (e.g., non-numeric string), the error propagates to `JSON.parse()` which is wrapped in try/catch in `useProtocolState.ts:260,278`. Verify the catch blocks handle this gracefully.
- -> **CHAIN-02 (Accounts & State)**: The Anchor BorshCoder decode path is the sole deserialization boundary between untrusted on-chain data and the protocol store. If a malformed account buffer bypasses decode validation, corrupted data enters the store. Verify BorshCoder rejects malformed buffers with proper errors.
- -> **SEC-01 (Access Control)**: The webhook auth gate (timingSafeEqual) is the primary defense preventing external prototype pollution via crafted webhook payloads. If bypassed, all downstream data processing becomes attacker-controlled. Verify auth is correctly enforced.
- -> **DATA-01 (Data Persistence)**: Protocol store uses `Map<string, AccountState>` where keys are pubkeys or synthetic prefixed keys (`__slot`, `__supply:CRIME`). Verify no key injection can overwrite unrelated account states.

## Trust Boundaries

The primary trust boundary for deserialization in this codebase is the Helius webhook handler. All external data enters through this authenticated endpoint. The data then passes through Anchor's BorshCoder (a structured binary deserializer that maps bytes to predefined structs, not a general-purpose object deserializer). The `anchorToJson()` function performs shallow, explicitly-keyed conversion using `Object.entries()` which only processes own properties. No deep merge, no recursive object cloning, and no prototype chain traversal occurs anywhere in the data pipeline. The browser-side trust boundary is the SSE stream, where `JSON.parse(event.data, bigintReviver)` processes server-generated payloads. The reviver introduces a custom tag-based deserialization convention (`__bigint`) that creates a narrow type-confusion surface. Overall, the codebase has very low exposure to prototype pollution and deserialization attacks due to the absence of deep-merge libraries and the use of structured binary (Borsh) deserialization rather than flexible object merging.
<!-- CONDENSED_SUMMARY_END -->

---

# Prototype Pollution & Deserialization (INJ-05) -- Full Analysis

## Executive Summary

This audit analyzes the Dr. Fraudsworth off-chain codebase through the lens of prototype pollution and deserialization vulnerabilities (INJ-05). The codebase has **minimal exposure** to classic prototype pollution vectors because:

1. **No deep-merge libraries**: No lodash, deepmerge, deep-extend, or any recursive merge utility is used anywhere in the project.
2. **No YAML/XML/pickle parsers**: No js-yaml, xml2js, fast-xml-parser, or equivalent deserialization libraries exist.
3. **No `Object.assign` with user input**: The single `Object.assign` pattern is in framework/build output (`.next/`), not application code.
4. **Structured binary deserialization**: Account data from Solana is deserialized via Anchor's BorshCoder, which maps bytes to predefined struct fields. This cannot produce `__proto__` keys.

The one notable surface area is the custom `bigintReviver` used in the SSE data pipeline, which introduces a tag-based deserialization convention (`{ __bigint: "..." }`) that could cause type confusion if the sentinel pattern appears in upstream data.

## Scope

**Analyzed files (20):**
- Core data pipeline: `bigint-json.ts`, `protocol-store.ts`, `event-parser.ts`, `ws-subscriber.ts`
- API routes: `webhooks/helius/route.ts`, `sse/protocol/route.ts`, `rpc/route.ts`, `candles/route.ts`
- Hooks: `useProtocolState.ts`, `useChartSSE.ts`, `useChartData.ts`
- Providers: `SettingsProvider.tsx`, `ClusterConfigProvider.tsx`
- Configuration: `protocol-config.ts`, `connection.ts`, `anchor.ts`
- Scripts: `crank-provider.ts`, `upload-metadata.ts`, `webhook-manage.ts`
- Shared: `constants.ts`

**Out of scope**: All Anchor/Rust programs in `programs/` directory.

## Key Mechanisms

### 1. BigInt Serialization Pipeline (bigint-json.ts)

**Purpose**: Solana account fields (u64/u128) are BigInt values that `JSON.stringify()` cannot handle. This module provides a custom replacer/reviver pair for SSE transmission.

**Flow**:
```
Server: anchorToJson(decoded) -> { __bigint: "12345" } tags for BN fields
     -> JSON.stringify(data, bigintReplacer) -> SSE broadcast
Client: JSON.parse(event.data, bigintReviver) -> BigInt(value.__bigint)
```

**Analysis**:

The `bigintReplacer` (line 35-40) is simple and safe -- it only activates for `typeof value === "bigint"`.

The `bigintReviver` (line 46-51) checks for objects matching `{ __bigint: string }` via `isBigIntTag()` (line 18-25). The type guard checks:
1. `typeof v === "object"`
2. `v !== null`
3. `"__bigint" in v`
4. `typeof v.__bigint === "string"`

This is correct for its intended purpose. The concern is tag collision: if any upstream data naturally contains `{ __bigint: "..." }`, the reviver will convert it to BigInt. The test file (`bigint-json.test.ts:48-56`) explicitly acknowledges this as a "known trade-off" and documents that `__bigint` is not a Solana/Anchor convention.

The `anchorToJson()` function (line 93-117) uses duck-typing (`"toNumber" in val`, `"toBase58" in val`) to convert Anchor types. It iterates with `Object.entries(decoded)` which only processes own enumerable properties. For fields in the `bigintFields` set, it creates the `{ __bigint: val.toString() }` tag. For others, it calls `.toNumber()`. This is a shallow, one-level conversion with no recursion.

**Risk assessment**: The `__bigint` sentinel is a custom convention. No standard library or framework uses it. The only way to inject it would be through:
1. A corrupted on-chain account that, after Borsh deserialization, produces an object field containing `{ __bigint: "..." }` -- this is impossible because Borsh maps bytes to primitive types (u64 -> BN, Pubkey -> PublicKey).
2. A crafted Helius webhook payload that bypasses auth -- the webhook stores `item.accountData` as-is in the fallback path (line 567-568), but this data doesn't flow through `bigintReviver` on the server side. It would only affect the client if broadcast via SSE.

### 2. Protocol Store (protocol-store.ts)

**Purpose**: In-memory cache for protocol PDA states, bridging webhook updates to SSE broadcasts.

**Analysis**:

The store uses a `Map<string, AccountState>` where `AccountState = Record<string, unknown>`. Keys are Base58 pubkeys or synthetic `__`-prefixed keys.

`setAccountState()` (line 53-65):
- Serializes with `JSON.stringify(data, bigintReplacer)` for dedup comparison
- Stores in `this.accounts` Map
- Broadcasts via `sseManager.broadcast()`

No deep merge. No spread with external data. The Map-based storage is immune to prototype pollution because `Map.get()` does not traverse the prototype chain.

The `getAllAccountStates()` (line 102-108) converts the Map to a plain object for SSE initial state. The `result` object is created as `{}` (not `Object.create(null)`), so it has a prototype, but since keys are Base58 pubkeys or `__`-prefixed strings, no key collision with `Object.prototype` methods is possible.

### 3. Webhook Handler -- Account Change Path (route.ts:525-633)

**Purpose**: Receives Helius Enhanced Webhook payloads and stores decoded account data.

**Analysis of data flow**:

1. `payload = await req.json()` -- Next.js built-in JSON parser. Returns parsed object. `JSON.parse()` itself does NOT pollute prototypes (FP-010).
2. Array check: `if (!Array.isArray(payload))` -- rejects non-arrays.
3. Type detection: `if (firstItem && "accountData" in firstItem)` -- uses `in` operator on first array element.
4. For each account: lookup in `KNOWN_PROTOCOL_ACCOUNTS` (hardcoded map). Unknown accounts are logged and skipped (line 542-548).
5. Anchor decode: `program.coder.accounts.decode(accountType, rawBuffer)` -- BorshCoder deserializes from a raw byte buffer. The account type is hardcoded (from `ANCHOR_DECODE_MAP`), not from user input.
6. Normalization: `anchorToJson(decoded, options)` -- shallow conversion.
7. Storage: `protocolStore.setAccountState(pubkey, { ...normalized, updatedAt: Date.now() })` -- spread of Anchor-decoded data. Since Anchor's BorshCoder produces objects with known struct field names, this spread cannot introduce `__proto__` or `constructor` keys.

**Fallback path (line 566-575)**: When decode info is missing or raw data is absent, the handler stores:
```typescript
{ label, accountData: item.accountData, rawAccountData: item.rawAccountData, updatedAt: Date.now(), decodeError: "..." }
```
Here, `item.accountData` and `item.rawAccountData` are from the webhook payload (authenticated). They are stored as property values, not spread into the object. No prototype pollution possible.

### 4. SSE Protocol Endpoint (sse/protocol/route.ts)

**Purpose**: Long-lived SSE connection pushing protocol state updates to browsers.

**Analysis**:

Initial state: `JSON.stringify(initialState, bigintReplacer)` -- serializes the protocol store snapshot. This is server-generated data.

Updates: `sseManager.subscribe((payload: string) => {...})` -- the payload string is already formatted as an SSE event by the manager. It's forwarded verbatim to the client.

No deserialization happens in this route. No merge. No external data processing.

### 5. useProtocolState Hook (useProtocolState.ts)

**Purpose**: Client-side SSE consumer that deserializes protocol state updates.

**Analysis**:

Line 253: `JSON.parse(event.data, bigintReviver)` for initial state
Line 269: `JSON.parse(event.data, bigintReviver)` for protocol updates
Line 273: `setAccounts((prev) => ({ ...prev, [account]: data }))` -- spread of previous state + new account data.

The `account` key comes from the SSE event data which originates from the authenticated webhook handler. The `data` object is the Anchor-decoded, normalized account state. The spread `{ ...prev, [account]: data }` is a shallow merge into React state -- it updates one key at a time. No deep merge. The `account` key is a Base58 pubkey string which cannot be `__proto__` (Base58 excludes the characters needed for that string).

### 6. SettingsProvider (SettingsProvider.tsx)

**Purpose**: User preferences (slippage, priority fee, volume, mute) stored in localStorage.

**Analysis of deserialization**:

`loadSettings()` (line 181-223):
1. `localStorage.getItem(STORAGE_KEY)` -- user-controlled data
2. `JSON.parse(raw)` -- parses to an object
3. Validates each field individually:
   - `slippageBps`: `typeof === 'number' && >= 0 && <= 10_000`
   - `priorityFeePreset`: `typeof === 'string' && in VALID_PRIORITY_PRESETS`
   - `muted`: `typeof === 'boolean'`
   - `volume`: `typeof === 'number' && >= 0 && <= 100`
4. Constructs a new object with only the validated fields.

This is a safe pattern. The function does not spread or merge the parsed object. It explicitly picks validated fields into a new object. Even if `parsed.__proto__` existed, it would be ignored because the function only reads `parsed.slippageBps`, `parsed.priorityFeePreset`, `parsed.muted`, `parsed.volume`.

`updateSettings()` (line 247-257):
```typescript
const next = { ...prev, ...partial };
```
This spreads `partial: Partial<Settings>` into the previous state. The callers (`setSlippageBps`, `setPriorityFeePreset`, `setMuted`, `setVolume`) each pass a single known key. The `updateSettings` function is exported and could be called by other components with arbitrary objects, but since `Settings` is a TypeScript interface (compile-time only), there is no runtime schema validation on the `partial` argument. However, this is a client-side-only concern with no security impact beyond localStorage pollution.

### 7. RPC Proxy (rpc/route.ts)

**Purpose**: Proxies JSON-RPC requests from browser to Helius.

**Analysis**:

1. `body = await request.json()` -- parse incoming JSON
2. Method allowlist check against `ALLOWED_METHODS` Set
3. `JSON.stringify(body)` -- re-serialize for forwarding
4. Response: `await upstream.text()` -- returned as raw text, never parsed

No merge, no spread, no deserialization of the upstream response on the server. The browser receives the raw JSON text and parses it via `@solana/web3.js` Connection internals. The proxy is a pure passthrough.

### 8. Event Parser (event-parser.ts)

**Purpose**: Decodes Anchor events from transaction log messages.

**Analysis**:

Uses `EventParser.parseLogs(logMessages)` from `@coral-xyz/anchor`. The log messages are base64-encoded Borsh data. The parser:
1. Identifies `Program data:` log lines
2. Decodes base64 to bytes
3. Matches 8-byte discriminator to IDL event names
4. Borsh-deserializes remaining bytes to event struct

The `data` object from `event.data` has Anchor-defined field names. Helper functions (`enumVariant`, `bnToNumber`, `pubkeyToString`) extract specific typed values. No deep merge. No spread of event data. Each parsed event is explicitly constructed field-by-field.

### 9. WebSocket Subscriber (ws-subscriber.ts)

**Purpose**: Server-side data pipeline feeding the protocol store with slot, supply, and staker data.

**Analysis**:

`batchSeed()` (line 113-244):
- Calls `connection.getMultipleAccountsInfo()` (RPC response)
- For each account: `program.coder.accounts.decode(accountType, info.data)` (Borsh decode of on-chain data)
- `anchorToJson(decoded, ...)` (shallow normalization)
- `protocolStore.setAccountStateQuiet(pubkey, { ...normalized, updatedAt: Date.now() })` (spread of normalized data)

Same pattern as the webhook handler. The spread is of Anchor-decoded data with known field names. Safe.

Token supply and slot data are simple primitive values stored directly:
```typescript
protocolStore.setAccountStateQuiet("__supply:CRIME", { amount, decimals, uiAmount });
protocolStore.setAccountStateQuiet("__slot", { slot });
```

No deserialization concerns.

### 10. Scripts (crank-provider.ts, upload-metadata.ts, webhook-manage.ts)

**Purpose**: Admin deployment and operational scripts.

**Analysis**:

Multiple `JSON.parse(fs.readFileSync(...))` calls for:
- Keypair files (JSON arrays of bytes)
- IDL files (Anchor-generated JSON)
- Deployment config files
- Arweave/Irys API responses

These are all admin-controlled inputs. The keypair parsing flows into `Keypair.fromSecretKey(new Uint8Array(secretKey))` which validates the byte array format. IDL parsing flows into Anchor's `Program` constructor. None of these paths involve deep merge or prototype-polluting operations.

The `upload-metadata.ts` script fetches from Irys gateway and parses the response (line 286: `json = JSON.parse(text)`). A compromised gateway could return malicious JSON, but:
1. The script runs locally, not in production
2. The parsed JSON is validated for expected fields (`json.name`, `json.image`, etc.)
3. No deep merge occurs

## Trust Model

### Data Input Points (Deserialization Boundaries)

| Input | Parser | Deep Merge? | Schema Validation? | Risk |
|-------|--------|-------------|-------------------|------|
| Helius webhook POST body | `req.json()` (Next.js) | No | Array check + type detection | Low (authenticated) |
| Helius account data (base64) | Anchor BorshCoder | No | Borsh schema (IDL-defined) | Minimal |
| SSE event data (browser) | `JSON.parse(event.data, bigintReviver)` | No | TypeScript type assertion | Low (server-generated) |
| localStorage settings | `JSON.parse(raw)` | No | Individual field validation | Minimal (client-only) |
| RPC proxy request body | `request.json()` | No | Method allowlist | Minimal (passthrough) |
| Keypair files (scripts) | `JSON.parse(fs.readFileSync(...))` | No | `Uint8Array` coercion | Minimal (admin-only) |

### Prototype Pollution Vectors Assessed

| Vector | Present? | Details |
|--------|----------|---------|
| lodash.merge / _.defaultsDeep | **NO** | Not in any dependency |
| deepmerge / deep-extend | **NO** | Not in any dependency |
| Custom recursive merge | **NO** | No recursive object merge functions in codebase |
| Object.assign with user input | **NO** | No `Object.assign(target, req.body)` patterns |
| YAML parsing | **NO** | No js-yaml or yaml dependency |
| XML parsing | **NO** | No xml2js or similar dependency |
| Pickle/marshal | **NO** | Node.js, not Python |
| `for...in` with user objects | **NO** | `Object.entries()` used in `anchorToJson()` |

## State Analysis

### In-Memory State (Protocol Store)
- `Map<string, AccountState>` -- Map-based, immune to prototype pollution
- Keys: Base58 pubkeys or `__`-prefixed synthetic keys
- Values: Anchor-decoded, shallow-normalized objects

### Persistent State (PostgreSQL via Drizzle)
- All writes use parameterized ORM queries
- No string interpolation in SQL
- `onConflictDoNothing()` for idempotency

### Client State (React + localStorage)
- React state updates via `useState` setter with spread
- localStorage: `JSON.stringify(settings)` on write, validated `JSON.parse` on read
- No prototype chain interaction

## Dependencies (External Packages)

Packages analyzed for deserialization risk:

| Package | Usage | Deserialization? | Risk |
|---------|-------|-----------------|------|
| `@coral-xyz/anchor` | BorshCoder, EventParser | Yes (Borsh binary) | Low -- structured binary format |
| `@solana/web3.js` | Connection, PublicKey | Yes (JSON-RPC responses) | Low -- internal parsing |
| `drizzle-orm` | DB queries | No | N/A |
| `next` (framework) | Request parsing | Yes (req.json()) | Low -- standard JSON.parse |

**No** lodash, underscore, ramda, deepmerge, js-yaml, xml2js, or any deep merge/recursive deserializer in the dependency tree (confirmed via package.json scan).

## Focus-Specific Analysis

### Prototype Pollution Surface

**Verdict: MINIMAL EXPOSURE**

The codebase has no classic prototype pollution vectors because:
1. No deep merge functions exist
2. No `Object.assign(config, userInput)` patterns exist
3. No `for (key in source) { target[key] = source[key] }` patterns exist with user input
4. All object spreads (`{ ...prev, ...data }`) are shallow and operate on server-generated or validated data
5. The framework (Next.js App Router) does not use Express middleware that parses query strings with nested object support (`qs` with `extended: true`)

### Deserialization Surface

**Verdict: LOW EXPOSURE**

All deserialization paths use structured or validated approaches:
1. **Borsh** (binary, schema-defined) for on-chain account data
2. **JSON.parse** for webhook payloads, SSE events, localStorage, config files
3. No YAML, XML, pickle, or other flexible deserializers

The one custom deserializer (`bigintReviver`) introduces a sentinel-based type conversion that is narrowly scoped and explicitly documented.

### JSON.parse with External Input

Every `JSON.parse()` call was traced:

| File | Source of Input | Flows Into | Safe? |
|------|----------------|------------|-------|
| `route.ts` (webhook) | Helius webhook body | `req.json()` (framework) | Yes -- standard JSON.parse |
| `useProtocolState.ts` | SSE event data | React state | Yes -- server-generated data |
| `useChartSSE.ts` | SSE event data | Chart update callback | Yes -- server-generated data |
| `SettingsProvider.tsx` | localStorage | Validated settings object | Yes -- field-by-field validation |
| `crank-provider.ts` | Env var / file | Keypair byte array | Yes -- `Uint8Array` coercion |
| `upload-metadata.ts` | Irys gateway response | Metadata validation | Low risk -- admin script |
| `webhook-manage.ts` | Helius API response | Console output | Low risk -- admin script |

None of these paths flow into deep merge operations.

## Cross-Focus Intersections

### INJ-05 x SEC-01 (Access Control)
The webhook authentication gate is the primary defense preventing external data from entering the protocol store. If this gate is bypassed, an attacker controls the data that flows through `anchorToJson()` and into the protocol store/SSE pipeline. However, even in this case, no prototype pollution is possible because no deep merge occurs.

### INJ-05 x CHAIN-02 (Accounts & State)
The Anchor BorshCoder is the deserialization boundary for on-chain data. If BorshCoder had a vulnerability that produced unexpected object shapes, it could affect downstream processing. This is a library-level concern, not codebase-specific.

### INJ-05 x DATA-01 (Data Persistence)
The protocol store uses Map-based storage which is immune to key-based pollution. Database writes use parameterized ORM queries which prevent SQL injection. No concerns.

### INJ-05 x LOGIC-02 (BigInt/Financial)
The `bigintReviver` converts `{ __bigint: "..." }` tags to BigInt values. If a non-numeric string were injected as the `__bigint` value, `BigInt("...")` would throw, which is caught by the `try/catch` around `JSON.parse()` in `useProtocolState.ts`. Financial calculations that depend on BigInt values would receive `null` or stale data rather than corrupted data.

## Cross-Reference Handoffs

- -> **ERR-01**: Verify that `JSON.parse()` failures in `useProtocolState.ts:260,278` are handled gracefully and don't leave the UI in an inconsistent state.
- -> **CHAIN-02**: Verify that Anchor BorshCoder rejects malformed account buffers rather than producing unexpected object shapes.
- -> **SEC-01**: Verify webhook auth bypass is impossible. The auth gate is the primary defense for all deserialization concerns.
- -> **DATA-01**: Verify protocol store Map keys cannot collide (e.g., a Base58 pubkey that happens to equal a synthetic `__` key).

## Risk Observations

### 1. MEDIUM: BigInt Tag Injection via Crafted Webhook (Theoretical)

**File**: `app/lib/bigint-json.ts:46-51`
**Precondition**: Attacker must bypass webhook authentication (timingSafeEqual)
**Mechanism**: A crafted Helius-like payload could include an account whose data, after Anchor decode, contains a field with value `{ __bigint: "0" }`. The `bigintReviver` would convert this to `BigInt(0)`, changing the type from object to BigInt. Downstream React components expecting an object would encounter a BigInt.
**Impact**: Type confusion in UI, potential NaN in calculations, component crash
**Likelihood**: Low -- requires auth bypass AND control over on-chain account data that Borsh-decodes to this specific shape (practically impossible with BorshCoder)
**Mitigation**: The test file explicitly documents this as a known trade-off. Consider adding a `__bigint` key check in `anchorToJson()` that warns if any decoded field value happens to be an object containing only `__bigint`.

### 2. LOW: SettingsProvider Partial Spread Without Runtime Schema

**File**: `app/providers/SettingsProvider.tsx:247-257`
**Mechanism**: `updateSettings(partial)` spreads `partial` into state without runtime validation. If a component passes an object with extra keys (e.g., `{ slippageBps: 100, __proto__: {...} }`), the spread `{ ...prev, ...partial }` would add `__proto__` as a regular own property on the new object (no prototype pollution, but unexpected data in state and localStorage).
**Impact**: Minimal -- localStorage gets extra data, but no prototype chain modification occurs with shallow spread.
**Likelihood**: Very low -- would require a bug in a calling component, not external attack.

### 3. LOW: Admin Script JSON.parse Without Schema Validation

**File**: `scripts/deploy/upload-metadata.ts:286`, `scripts/webhook-manage.ts:96`
**Mechanism**: Admin scripts parse external API responses with `JSON.parse(text)` and don't validate the schema of the response. A compromised CDN/gateway could return unexpected data.
**Impact**: Minimal -- scripts are run locally by the project owner, not in production.
**Likelihood**: Very low.

## Novel Attack Surface Observations

### BigInt Sentinel as Type Coercion Vector

The `{ __bigint: "..." }` tag convention creates a unique attack surface specific to this protocol's SSE pipeline. Unlike standard JSON deserialization where types are preserved, the reviver introduces a **type coercion layer** that converts objects to BigInts. This is not prototype pollution but rather a **type confusion** vector.

In theory, if an attacker could control any object in the protocol store that contains a nested `{ __bigint: "NaN" }` value, the client would receive `BigInt("NaN")` which throws a `SyntaxError`. This would crash the `JSON.parse()` call, but the catch blocks in `useProtocolState.ts` handle this by ignoring the malformed update.

More subtly, if the value is `{ __bigint: "999999999999999999999999999" }`, the client would receive a legitimate BigInt that might overflow display logic (React components rendering it as a string). This is not a security vulnerability per se, but it demonstrates that the BigInt sentinel introduces a data integrity consideration not present in standard JSON deserialization.

### Absence of Deep Merge as a Security Property

The complete absence of deep merge libraries is itself a security property worth documenting. Many Next.js/React projects use lodash or similar for state management. This codebase's deliberate use of shallow spreads and explicit field-by-field construction (as in `loadSettings()`, event parser, `anchorToJson()`) eliminates the largest class of prototype pollution vulnerabilities. This should be maintained as a conscious architecture decision.

## Questions for Other Focus Areas

1. **For ERR-01**: What happens when `BigInt("malformed")` throws inside `JSON.parse()` with `bigintReviver`? Does the catch block in `useProtocolState.ts` properly handle this without leaving stale state?
2. **For CHAIN-02**: Can Anchor BorshCoder ever produce an object with a key named `__bigint`? (Likely not, since Rust struct fields follow snake_case naming, but worth verifying.)
3. **For SEC-01**: If the webhook secret is leaked, what is the blast radius for data injection through the webhook -> store -> SSE pipeline?
4. **For DATA-01**: Are protocol store keys (Base58 pubkeys) ever derived from user input, or are they always hardcoded constants from `protocol-config.ts`?

## Raw Notes

### Files Confirmed Safe (No Deserialization Concerns)
- `app/lib/protocol-config.ts` -- Pure re-exports from `@dr-fraudsworth/shared`, no parsing
- `app/lib/connection.ts` -- Connection factory, no deserialization
- `app/lib/sse-manager.ts` -- Pub/sub for SSE, formats strings, no parsing
- `app/providers/ClusterConfigProvider.tsx` -- React context wrapper, reads from config
- `app/app/api/candles/route.ts` -- Drizzle ORM queries, no user data parsing
- `app/hooks/useChartData.ts` -- Consumes already-parsed CandleSSEUpdate
- `shared/constants.ts` -- Static PublicKey constants, no parsing

### Pattern Search Results
- `lodash`: Not in any package.json or source file (only in `.claude/settings.local.json`)
- `deepmerge`/`deep-extend`: Not present anywhere
- `yaml`/`js-yaml`: Not present anywhere
- `xml2js`/`xmldom`: Not present anywhere
- `__proto__`: Only in `.next/` build output (runtime framework code), not in source
- `Object.assign`: Only in `.next/` build output and one DB connection config spread
- `eval()`/`new Function()`: Not present in application code

### Dependency Confirmation
Grepped all `package.json` files for lodash, deepmerge, yaml, xml2js -- zero matches. The codebase is clean of dangerous deserialization libraries.
