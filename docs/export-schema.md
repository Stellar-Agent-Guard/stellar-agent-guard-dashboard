# Policy and Telemetry Interchange Schemas

This document defines the machine-readable interchange formats for guard policy configurations and telemetry events. Implementation validators in `lib/guard/exportFormats.ts`, `lib/guard/eventExport.ts`, and `lib/guard/policySchema.ts` enforce these schemas at runtime.

---

## State Authority Directive

> **Chain state is authoritative.** Local draft exports, telemetry files, and JSON policy files are local interchange artifacts or historical logs only. They **must never** stand in for a live read of the chain. Every dashboard state display and policy enforcement action reads directly from the Soroban RPC endpoint (`status()`, `policy()`).

---

## 1. Telemetry Feed Interchange Schemas

The telemetry feed provides three export formats: **CSV**, **JSON**, and **NDJSON Audit Log**.

### Compatibility Rule: Append-Only

Columns and row fields are **append-only**. Schema changes may add new fields at the end of lists/objects; existing fields will never be renamed, reordered, or removed.

### Telemetry Columns (Schema Version 1)

| #   | Column             | Meaning                                                          | Empty When         |
| --- | ------------------ | ---------------------------------------------------------------- | ------------------ |
| 1   | `schema_version`   | Export schema version (currently `"1"`).                         | Never              |
| 2   | `guard`            | Guard contract address (e.g. `C...`).                            | Never              |
| 3   | `topic`            | Event topic symbol (e.g. `event_auth_checked`).                  | Never              |
| 4   | `kind`             | Event classification (`auth_checked`, `heartbeat`, `frozen`, …). | Never              |
| 5   | `source`           | `ledger` (committed) or `diagnostic` (pre-broadcast refusal).    | Never              |
| 6   | `decision`         | `allowed` or `blocked`.                                          | Non-auth events    |
| 7   | `reason`           | Raw contract reason symbol (e.g. `per_tx_cap_exceeded`).         | Allowed / non-auth |
| 8   | `reason_label`     | Explanation of reason code via `explainReason`.                  | Allowed / non-auth |
| 9   | `ledger`           | Ledger sequence number string.                                   | Diagnostic events  |
| 10  | `ledger_closed_at` | ISO-8601 UTC ledger close time.                                  | Diagnostic events  |
| 11  | `transaction_hash` | Hash of committed transaction.                                   | Diagnostic events  |

### Cell & File Conventions

- **String Representation**: Every cell in CSV and row in JSON is stringified. Ledger sequences, stroop amounts, and timestamps are decimal strings to preserve precision.
- **CSV Format**: RFC 4180 compliant with UTF-8 BOM (`\uFEFF`) prefix.
- **JSON Format**: Single object containing `schemaVersion`, `columns` array, `guard` address, and `rows` array.
- **NDJSON Audit Log**: Line-delimited JSON (`application/x-ndjson`). First line is `audit_header` (`record: "audit_header"`, `schema: "stellar-agent-guard/telemetry-audit@1"`), followed by one `guard_event` line per event.

### Example: Telemetry JSON

```json
{
  "schemaVersion": 1,
  "columns": [
    "schema_version",
    "guard",
    "topic",
    "kind",
    "source",
    "decision",
    "reason",
    "reason_label",
    "ledger",
    "ledger_closed_at",
    "transaction_hash"
  ],
  "guard": "CAYJZT4XH5SWDXNR7MZJCCUBIDAT2KZDDUTZ7OZQEMKCPJGD4P3X4CU7",
  "rows": [
    {
      "schema_version": "1",
      "guard": "CAYJZT4XH5SWDXNR7MZJCCUBIDAT2KZDDUTZ7OZQEMKCPJGD4P3X4CU7",
      "topic": "event_auth_checked",
      "kind": "auth_checked",
      "source": "ledger",
      "decision": "allowed",
      "reason": "",
      "reason_label": "",
      "ledger": "4691628",
      "ledger_closed_at": "2026-09-25T14:03:07Z",
      "transaction_hash": "abababababababababababababababababababababababababababababababab"
    }
  ]
}
```

---

## 2. Guard Policy Interchange Schema (`PolicyExportV1`)

Guard policy configurations are exported and imported as versioned JSON files (`POLICY_SCHEMA_VERSION = 1`). This allows policy drafts to be shared across staging and production without manual re-typing.

### Policy JSON Fields

| Field                     | Type                                                                                 | Description                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `version`                 | `1`                                                                                  | Schema version identifier (must be integer `1`).                                         |
| `max_amount_per_tx`       | `string`                                                                             | Decimal string cap per transaction (empty string or `"0"` disables).                     |
| `window_cap`              | `string`                                                                             | Decimal string cap for the rolling window.                                               |
| `window_seconds`          | `string`                                                                             | Rolling window duration in seconds.                                                      |
| `dead_man_switch_seconds` | `string`                                                                             | Dead-man switch heartbeat grace period in seconds.                                       |
| `allowed_protocols`       | `Array<{ contract: string, functions: string[] \| null }>`                           | Protocol allowlist contract addresses and function names (`null` allows all functions).  |
| `denied_recipients`       | `string[]`                                                                           | Recipient allowlist addresses (enforced by `PolicyConfig.recipients`).                   |
| `per_asset_caps`          | `Array<{ asset_contract_address: string, max_cap_stroops: string, symbol: string }>` | Per-asset cap overrides in stroops.                                                      |
| `assets`                  | `string[]`                                                                           | Allowed asset contract addresses.                                                        |
| `allow_any_recipient`     | `boolean`                                                                            | When `true`, recipient allowlist is bypassed.                                            |
| `active_from`             | `string`                                                                             | Unix timestamp string (seconds) after which policy becomes active (`"0"` for immediate). |
| `active_until`            | `string`                                                                             | Unix timestamp string (seconds) after which policy expires (`"0"` for no expiration).    |
| `paused`                  | `boolean`                                                                            | When `true`, policy enforcement is paused.                                               |

### Numeric and Address Validation Semantics

- **64-bit / 128-bit Integers**: Encoded as decimal strings (e.g. `"1000"`). JavaScript numbers are not used for cap amounts to avoid loss of precision on 128-bit values.
- **Address Validation**: All addresses (`contract`, `denied_recipients`, `assets`, `asset_contract_address`) must be valid Stellar StrKey addresses (`G...` or `C...`).
- **Import Validation**: Imports run through `policyExportSchemaV1` (Zod). Invalid entries return detailed issues with formatted paths (e.g., `per_asset_caps[0].symbol`).

### Example: Policy JSON

```json
{
  "version": 1,
  "max_amount_per_tx": "1000000000",
  "window_cap": "5000000000",
  "window_seconds": "86400",
  "dead_man_switch_seconds": "3600",
  "allowed_protocols": [
    {
      "contract": "CAYJZT4XH5SWDXNR7MZJCCUBIDAT2KZDDUTZ7OZQEMKCPJGD4P3X4CU7",
      "functions": ["swap", "deposit"]
    }
  ],
  "denied_recipients": ["GD5S5O2MZ6FSMFH6QILG37KSQNRVR3RPSWBTTV4JOUJ7J6TWLLL5LAVS"],
  "per_asset_caps": [
    {
      "asset_contract_address": "CAYJZT4XH5SWDXNR7MZJCCUBIDAT2KZDDUTZ7OZQEMKCPJGD4P3X4CU7",
      "max_cap_stroops": "500000000",
      "symbol": "USDC"
    }
  ],
  "assets": ["CAYJZT4XH5SWDXNR7MZJCCUBIDAT2KZDDUTZ7OZQEMKCPJGD4P3X4CU7"],
  "allow_any_recipient": false,
  "active_from": "0",
  "active_until": "0",
  "paused": false
}
```
