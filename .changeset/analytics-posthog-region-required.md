---
"@10x-media/analytics": minor
---

**Behavioral (PostHog): a provider document with a blank Host needs a Region.** The Region then decides where reads and capture go, and leaving it unset used to read from US Cloud without anyone picking it. A stored document without one saves again once a Region is picked. Its personal API key is kept while its reads still go to the same place: picking US on a document that read from US Cloud keeps it, picking EU clears it, as any change of where a document connects does. Upgrade: pick a **Region** on every PostHog provider document whose **Host** is blank ([From 1.0.0-beta.16](https://docs.10xmedia.de/analytics/upgrading/beta-17#posthogs-region)).
