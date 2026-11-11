---
"@10x-media/analytics": minor
---

**Fixed (PostHog): hourly series read again.** The adapter bucketed hours with `toStartOfHour(timestamp, '<zone>')`, which HogQL refuses ("Function 'toStartOfHour' expects 1 argument, found 2"), so every hourly read failed, the platform source's included, and the today and 24-hour views showed nothing. Hours are now bucketed as `toStartOfHour(toTimeZone(timestamp, '<zone>'))`, still in the reporting timezone. Day series are unchanged.

**Behavioral (PostHog): with no `host`, reads go to the region's cloud.** `region` used to steer capture alone, and reads went to US Cloud whenever `host` was unset, so a provider document on EU Cloud with a blank **Host** sent its EU key to `us.posthog.com`, was refused with a 403 and was rested. Reads now go to `https://<region>.posthog.com`, the cloud capture already used; US Cloud stays the default with neither set. A stored document reads from its region as it is: nothing to migrate, and its key is kept.

**Behavioral (PostHog): a provider document with a blank Host needs a Region.** The Region then decides where reads and capture go, and leaving it unset used to read from US Cloud without anyone picking it. A stored document without one saves again once a Region is picked.

**Additive: a PostHog provider document refuses three paste mistakes.** A **Host** on the other PostHog Cloud region than the **Region** picked, a project token (`phc_...`) in **API key**, and a private key (`phx_...`, `phs_...`) in **Project token**, which the browser receives, are refused with a field error in all 11 locales.

**Additive: a Test connection button on provider documents.** The sidebar of a vendor document shows what its connection last came to (works, refused, unreachable), when it last worked and failed, the vendor's own words and until when reads rest, and checks the saved settings with the vendor's cheapest read on a click. Ordinary reads keep the result current. It is kept in the new `analytics-provider-status` collection (`providers.collection.status`, `PROVIDER_STATUS_SLUG`), answered by `GET` and `POST /api/_x/provider-status?id=`, which take the caller's own read and update access to the document. The analytics view shows the vendor's words under a source's setup error to a reader who may read its document. Adapters may implement `checkConnection(ctx)` (`ConnectionCheckContext`); every built-in vendor adapter does.

**Behavioral: a vendor's error names its own message.** A refused read carries the vendor's JSON `detail`, `message` or `error` rather than the first 200 characters of the body, and the query endpoint's warning names the scope it read for.


**Fixed (Umami): a website id Umami does not know fails the connection check.** Self-hosted Umami answers an unknown website with `200` and a `null` body, and the check took that for a connection that works. It now fails with "umami: no website <id>; check the Website ID".

**Fixed (Umami): the key fields say which key goes where.** **API token** said "Umami Cloud token" though it is the self-hosted key, sent as `Bearer`. It now names self-hosted Umami, and **API key** on an Umami document names Umami Cloud, in all 11 locales.

**Behavioral: under a `fallback` policy, a tenant whose own sources all fail reads the shared source.** A provider document that was configured but failing used to switch its tenant off the shared platform source, so one bad key cost the tenant every number. While the last result of each of the tenant's documents is a failure, the shared source is listed beside them and opens as the default, and the view and the providers list say why (`notice: 'ownSourceFailing'` on `GET /api/_x/sources`). A document failing for more than 10 minutes is checked again in the background when its tenant's listing is read, so it takes its tenant back once it answers.

**Fixed: credential fields are labelled in the reader's language.** The **API key**, **API token** and **Private key** fields kept their English label in every admin language, because Payload drops a function label from the client field the write-only editor renders. They now carry a label per locale, as their help already did.

**Fixed: the providers list's notice lines up with the list.** It rendered outside the page's gutter, edge to edge. It now sits inside it.
