---
"@10x-media/analytics": patch
---

**Fixed: scroll depth read from raw events no longer collapses on Postgres.** The raw-event path (an hourly series, and any filtered read that bypasses the rollups) counted one scroll sample per event whenever the driver returned an unreported depth as `null` rather than omitting the field, which Postgres does for every event that carried no depth. The average was then divided by every event in range instead of by the pageviews that actually reported a depth, so a site whose tracker reports depth on a fraction of its pageviews saw a scroll depth several times too low on Postgres while the rollup-backed reads of the same range showed the right number. Only a depth that is a number counts as a sample now, on both adapters, and a reported `0` still counts.
