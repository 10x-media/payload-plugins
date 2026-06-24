---
"@10x-media/analytics": minor
---

Add an opt-in scheduled cache-warm job. Set `cache: { warm: true }` (or `cache: { warm: { cron } }`) to register a Payload task (`analytics-warm-cache`) that pre-runs the dashboard's widget reads on a cron, deriving its targets from `admin.dashboard.defaultLayout`, so a provider-backed dashboard loads from warm `payload.kv` cache. Realtime and custom widgets are skipped; one provider failure does not abort the rest. Off by default.
