---
'@10x-media/impersonation': minor
---

Add `inheritStrategies`. The target session takes over the impersonator's `req.user._strategy` when it is in the list, so a second-factor plugin such as `payload-totp` no longer denies every collection while impersonating. Start stores the strategy on the row as `impersonatorStrategy`. On Postgres, create a migration for the new column.
