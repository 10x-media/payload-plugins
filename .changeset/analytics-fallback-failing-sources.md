---
"@10x-media/analytics": minor
---

**Behavioral: under a `fallback` policy, a tenant whose own sources all fail reads the shared source.** A provider document that was configured but failing used to switch its tenant off the shared platform source, so one bad key cost the tenant every number. A document now counts as failing while its last result is a refusal, or a vendor that did not answer while its reads rest. While every one of a tenant's documents is failing, the shared source is listed beside them, opens as the default in place of a failing one, and the view and the providers list say why (`notice: 'ownSourceFailing'` on `GET /api/_x/sources`). A document failing for more than 10 minutes is checked again in the background when its tenant's listing is read, at most once every 10 minutes, so it takes its tenant back once it works.
