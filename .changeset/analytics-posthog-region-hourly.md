---
"@10x-media/analytics": minor
---

**Fixed (PostHog): hourly series read again.** The adapter bucketed hours with `toStartOfHour(timestamp, '<zone>')`, which HogQL refuses ("Function 'toStartOfHour' expects 1 argument, found 2"), so every hourly read failed, the platform source's included, and the today and 24-hour views showed nothing. Hours are now bucketed as `toStartOfHour(toTimeZone(timestamp, '<zone>'))`, still in the reporting timezone. Day series are unchanged.

**Behavioral (PostHog): with no `host`, reads go to the region's cloud.** `region` used to steer capture alone, and reads went to US Cloud whenever `host` was unset, so a provider document on EU Cloud with a blank **Host** sent its EU key to `us.posthog.com`, was refused with a 403 and was rested. Reads now go to `https://<region>.posthog.com`, the cloud capture already used; US Cloud stays the default with neither set. A stored document reads from its region as it is: nothing to migrate, and its key is kept.

**Behavioral (PostHog): a provider document with a blank Host needs a Region.** The Region then decides where reads and capture go, and leaving it unset used to read from US Cloud without anyone picking it. A stored document without one saves again once a Region is picked.

**Additive: a PostHog provider document refuses three paste mistakes.** A **Host** on the other PostHog Cloud region than the **Region** picked, a project token (`phc_...`) in **API key**, and a private key (`phx_...`, `phs_...`) in **Project token**, which the browser receives, are refused with a field error in all 11 locales.

**Additive: a Test connection button on provider documents.** The sidebar of a vendor document shows what its connection last came to (works, refused, unreachable), when it last worked and failed, the vendor's own words and until when reads rest, and checks the saved settings with the vendor's cheapest read on a click. Ordinary reads keep the result current. It is kept in the new `analytics-provider-status` collection (`providers.collection.status`, `PROVIDER_STATUS_SLUG`), answered by `GET` and `POST /api/_x/provider-status?id=`, which take the caller's own read and update access to the document. The analytics view shows the vendor's words under a source's setup error to a reader who may read its document. Adapters may implement `checkConnection(ctx)` (`ConnectionCheckContext`); every built-in vendor adapter does.

**Behavioral: a vendor's error names its own message.** A refused read carries the vendor's JSON `detail`, `message` or `error` rather than the first 200 characters of the body, and the query endpoint's warning names the scope it read for.

