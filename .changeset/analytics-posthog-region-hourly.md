---
"@10x-media/analytics": minor
---

**Fixed (PostHog): hourly series read again.** The adapter bucketed hours with `toStartOfHour(timestamp, '<zone>')`, which HogQL refuses ("Function 'toStartOfHour' expects 1 argument, found 2"), so every hourly read failed, the platform source's included, and the today and 24-hour views showed nothing. Hours are now bucketed as `toStartOfHour(toTimeZone(timestamp, '<zone>'))`, still in the reporting timezone. Day series are unchanged.

**Behavioral (PostHog): with no `host`, reads go to the region's cloud.** `region` used to steer capture alone, and reads went to US Cloud whenever `host` was unset, so a provider document on EU Cloud with a blank **Host** sent its EU key to `us.posthog.com`, was refused with a 403 and was rested. Reads now go to `https://<region>.posthog.com`, the cloud capture already used; US Cloud stays the default with neither set. A stored document reads from its region as it is: nothing to migrate, and its key is kept.

**Additive: a PostHog provider document refuses three paste mistakes.** A **Host** on the other PostHog Cloud region than the **Region** picked, a project token (`phc_...`) in **API key**, and a private key (`phx_...`, `phs_...`) in **Project token**, which the browser receives, are refused with a field error in all 11 locales.
