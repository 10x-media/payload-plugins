---
"@10x-media/analytics": minor
---

Add an opt-in sync tier. Set `sync: true` (or `sync: { cron, lookbackDays, collectionSlug, adapters }`) to register a queryable `analytics-daily` collection and a Payload task (`analytics-sync`) that, on a cron, ETLs each configured provider's last N days of daily metrics into one upserted row per `(source, date)`. The collection is queryable via Payload's APIs; native is excluded; one provider failure does not abort the rest. Off by default.
