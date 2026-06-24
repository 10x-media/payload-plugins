---
"@10x-media/analytics": minor
---

Add a realtime "active now" dashboard widget: native serves a live count of active visitors (or pageviews) in the last N minutes plus a per-minute sparkline, polled from an authenticated endpoint every 15 seconds. The widget registers only when a realtime-capable adapter is configured; providers can implement realtime later through the same capability gate.
