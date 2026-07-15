---
"@10x-media/analytics": minor
---

Add `reportingTimezone` so daily analytics boundaries can align to an IANA timezone instead of always UTC.

Day boundaries (timeframe windows, the daily series axis, native rollup buckets, and the surfacing cache key) now resolve through a reporting timezone that defaults to `'UTC'`. An install that does not set the option is unchanged.

`reportingTimezone` accepts a fixed string (single-site, or forcing one zone) or a resolver `({ req, scope }) => string | null`. The resolver receives the already-resolved scope, so per-tenant (look up by scope), per-user-account (`req.user`), and selector (cookie/preference) strategies are all expressible with one option. Invalid or unresolvable zones fall back to UTC with a warning.

Native rollups bucket into the resolved timezone's day at ingest. This keeps reads cheap and correct for a tenant's own zone, at the cost that changing the timezone does not re-bucket existing history, and a per-user selector cannot re-slice already-written native days (documented). External providers that accept a timezone are told the resolved zone: Umami via its `timezone` param, PostHog via `toStartOfDay(timestamp, '<zone>')`. GA4 and Plausible continue to bucket in their own account timezone.

Options considered: (1) a fixed string only, rejected because it cannot vary per tenant or user; (2) a resolver only, rejected because it forces single-site consumers to write a function for a constant; (3) the shipped `string | resolver` union, chosen because it mirrors the existing `scopeResolver` pattern and serves every named use case with one familiar, testable option. For bucketing, write-time (per the "go for B, no historical re-bucketing" decision) was chosen over read-time re-bucketing, which would have required storing finer-grained rollups.
