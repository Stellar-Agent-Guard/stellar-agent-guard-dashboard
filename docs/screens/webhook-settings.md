# Webhook Alerts & Settings

The Webhook settings dialog allows operators to configure outbound HTTP alerts for high-priority security incidents:

- `FREEZE_ACTIVATED`: Admin freeze or dead-man switch expiration.
- `DMS_EXPIRING`: Heartbeat grace period entering critical expiration window.
- `BLOCK_THRESHOLD_EXCEEDED`: Refusal bursts exceeding operator-defined thresholds.

## Delivery History Retention & Clear Controls

- **Bounded History**: The dashboard tracks the last 50 webhook delivery attempts in browser storage.
- **24-Hour Eviction**: Outcomes older than 24 hours are automatically evicted to avoid indefinite accumulation.
- **Retention Disclosure**: The settings modal clearly discloses the retention window and record bounds to the operator.
- **Independent History Clearing**: Operators can clear local delivery history at any time without changing webhook URLs, signing secrets, or event subscriptions.
