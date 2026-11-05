# Native engine load tests

On demand only: `test`, `test:int` and turbo never run them. Run them from `packages/analytics`:

```sh
pnpm test:load                                   # MongoDB (in-memory replica set)
DB_MATRIX=postgres pnpm test:load                # Postgres in its own container (Docker)
DB_MATRIX=sqlite pnpm test:load                  # SQLite, the engine on worker threads (WAL file, 5 s busy timeout)
ANALYTICS_SQLITE_THREAD=main DB_MATRIX=sqlite pnpm test:load   # SQLite, the engine on the main thread
DB_MATRIX=sqlite pnpm test:load tenants          # one file only: vitest's file filter
```

`LOAD_SCALE=0.05` shrinks every volume for a quick check (the tenant count too, to at least 2), `LOAD_DASHBOARD_SCALE=11` multiplies the dashboard's days again, to about 10 million hits a month, and `LOAD_OUT=<file>` appends each measure as a JSON line. On SQLite the first line says where the engine ran its statements. Postgres runs in its own `postgres:16` container with default settings, not the int suite's shared server with durability off.

## What it measures

`generator.ts` builds synthetic traffic from a seed: Zipf-skewed pages (3,000), referrers (1,500), campaigns (200), places and items (500), visits of one or more pageviews with an engagement after most of them, events, item clicks and goals with revenue. As under a daily salt, every visitor's id is new each day, and a visitor keeps one place and one device all day. With `orders`, every purchase is an order the browser recorded (`ow.`), and the `server` share of them the server recorded too (`os.`), keyed with `orders.key`, the `orderDigestKey` of the instance's secret, exactly as ingest keys them.

`engine.load.ts` runs on three scopes. On its 670,000-hit day half the purchases are recorded by the server too, so counting it takes the browser's sales away where the server has them.

| Phase | How |
|---|---|
| Ingest | 10,000 beacons, 32 in flight, through Payload's endpoint routing (`handleEndpoints`), through `ingestRoute`, and through `ingestRoute` with `native({ buffer: true })` (until the flush) |
| Append | `store.append` in chunks of 5,000 rows, and one row per call with 32 in flight |
| Aggregation | one day of 670,000 hits, counted three times; while the first count runs, and again while the second counts it again over its own rows, one hit stored per call back to back and a host write through Payload (`payload.create`) every 20 ms; over all three, the longest the event loop went without running a 10 ms timer |
| Uncounted big day | that day marked to be counted again, then a week's totals read once with no runner heartbeat and once with a fresh one |
| Realtime at scale | the last 30 minutes of that day at 18:30: the counter's totals, the widget's minutes, and the top 10 sources |
| Dashboard reads | 30 closed days of 30,000 hits (times `LOAD_DASHBOARD_SCALE`), and today with up to 20,000 so far, every read uncached through the adapter: totals, series and top 10 lists, a country filtered broadly and narrowly, a document panel's sources, countries and devices of one page and that page's totals, today's totals, sources and hours, and the live minutes; 2 warm-ups (and the background work they start), then p50 and p95 of 15, or 3 for a read whose first run passes 2 seconds; and the event loop's longest stall across all of them, the snapshots they start included |
| Storage | after every phase above, the rows of the aggregates and of the hits, and the bytes per row of each table and of its indexes: Postgres `pg_table_size` and `pg_indexes_size`, SQLite `dbstat` (skipped where the build lacks it), MongoDB `collStats` (`storageSize` and `totalIndexSize`, compressed) |

`tenants.load.ts` runs a platform of 1,000 small tenants (`LOAD_SCALE` scales the count), each with 30 hits on each of its two closed days, straight through the engine (`maintain` with a 240-second budget, `read` and `realtime`):

| Phase | How |
|---|---|
| Upkeep | a first maintenance run that counts every day and must finish, three idle runs with nothing new that must each stay under a tenth of the budget, then three runs after every tenant had one visit since, which must each pass every scope (a light pass) |
| Reads | All sites totals and top 10 sources over 30 days, one site's totals, and All sites live visitors over 30 minutes; one warm-up, then p50 and the longest of 4 |

## Results

2026-10-07 on an Apple Silicon laptop (12 cores, 24 GB), Node 24.14, one process sending in-process requests (no HTTP): MongoDB 7.0.24 from mongodb-memory-server, Postgres 16 in OrbStack (12 CPUs, 12 GB) with its default settings (the engine turns JIT off for its own long statements), SQLite through libsql on a WAL file. Times in ms unless a row says otherwise, p50 / p95. Targets are set for a 4-vCPU Postgres. The capacity the docs publish for each database (`native.mdx`, Capacity) comes from these tables. The live top 10 sources on Postgres and SQLite are from the 2026-10-09 run below.

| | MongoDB | Postgres | SQLite | Target |
|---|---|---|---|---|
| Ingest, Payload endpoint (hits/s, p95 ms) | 3,875 / 11 | 4,444 / 10 | 4,597 / 12 | 2,000 |
| Ingest, `ingestRoute` (hits/s, p95 ms) | 3,928 / 10 | 4,605 / 10 | 5,234 / 12 | 2,000 |
| Ingest, `ingestRoute` buffered (hits/s) | 9,446 | 8,449 | 6,550 | 10,000 |
| Append, chunks of 5,000 (rows/s) | 37,295 | 29,265 | 45,234 |  |
| Append, one row per call (rows/s) | 3,934 | 4,698 | 10,902 |  |
| Count a 670,000-hit day (s, median of 3) | 44 | 11.5 | 19.6 | 3-6 Postgres, 5-15 others |
| Count a 30,000-hit day (ms, p50 / p95) | 2,071 / 2,225 | 717 / 867 | 987 / 1,064 |  |
| A week's totals with that day uncounted, no runner (ms) | 6.2, 1 day missing | 49, 1 day missing | 4.5, 1 day missing | < 3,000 |
| The same with the runner on time (ms) | 3.0, 1 day missing | 2.9, 1 day missing | 1.1, 1 day missing | < 3,000 |
| Live counter on that day, 30 minutes (ms, p50) | 103 | 27 | 26 |  |
| Live widget on that day, by the minute (ms, p50) | 127 | 31 | 58 |  |
| Live top 10 sources on that day (ms, p50) | 2,207 | 332 | fails as busy (503) in 31 |  |
| Day series, closed days (ms, p50 / p95) | 4.8 / 11 | 4.0 / 5.0 | 2.8 / 3.0 | < 20 |
| Day series, 30 days to now | 4.2 / 4.9 | 4.2 / 4.9 | 2.8 / 3.2 |  |
| Totals, 8 metrics | 3.9 / 4.6 | 3.5 / 4.4 | 2.0 / 7.4 |  |
| Top 10 pages | 195 / 226 | 90 / 137 | 56 / 66 | < 120, p95 < 400 |
| Top 10 sources | 41 / 47 | 23 / 25 | 18 / 57 | < 120, p95 < 400 |
| Top 10 countries | 11 / 15 | 30 / 39 | 4.5 / 5.0 | < 120, p95 < 400 |
| Total where country is one value | 3.6 / 5.7 | 4.3 / 5.5 | 3.4 / 3.5 |  |
| Top 10 pages, a third of visitors by country | 13,161 / 13,453, 16 days missing | 2,553 / 2,785 | 4,035 / 4,048, 5 days missing |  |
| Top 10 pages, 3% of visitors by country | 2,242 / 2,269 | 431 / 484 | 886 / 979 |  |
| Top 10 sources of one page (a document panel) | 4,925 / 4,954 | 723 / 781 | 2,399 / 2,429 |  |
| Top 10 pages where page contains | 4,738 / 4,821 | 957 / 1,344 | 1,266 / 1,329 |  |
| Today, totals | 2.0 / 18 | 1.5 / 4.1 | 0.4 / 0.8 | < 300 |
| Today, top 10 sources | 4.1 / 9.4 | 4.3 / 7.4 | 1.1 / 1.4 | < 300 |
| Today, by hour | 308 / 341 | 45 / 63 | 76 / 89 | < 300 |
| Realtime, 30 minutes by the minute | 61 / 69 | 18 / 25 | 30 / 33 |  |

Today held about 20,000 hits here, past what each database reads live, so every read that reaches today is served from a snapshot of it (taken in the background after the warm-ups, and again whenever it ages out between runs) and the closed days from their daily totals. Counting the 670,000-hit day is too big for a read's three seconds: the week around it reads the other days and says one is missing. MongoDB folds that day's rows in sets of visitors, and would fold them per visitor had a set outgrown the memory MongoDB gives it. The live sources keep the visitors active in the window before cutting the day's visits; MongoDB, with no index on the visitor, still reads the day to find their hits, and SQLite refuses the read up front, its count off the index predicting more than the read's time, so the live view answers busy (503). Filtered breakdowns read 30 days of raw hits for their rows, of the visitors their filter keeps, and their totals from the daily totals: a filter kept by a third of the visitors is too much for the read's time on MongoDB and SQLite, which then read the newest days one by one and leave the rest out (`meta.partial`).

### SQLite: worker threads and the main thread

2026-10-07, same laptop, the SQLite column of the table above measured again with the engine on worker threads (the default on a WAL file with a 5 s busy timeout) and forced onto the main thread (`ANALYTICS_SQLITE_THREAD=main`). "Gap" is the longest the event loop went without running a 10 ms timer, so 10 means no stall at all. The worker-thread rows for the gap while the day is counted, a stored hit and a host write are from the 2026-10-09 run below.

| | Worker threads | Main thread |
|---|---|---|
| Ingest, Payload endpoint (hits/s, p95 ms) | 6,687 / 8.2 | 3,647 / 15 |
| Ingest, `ingestRoute` (hits/s, p95 ms) | 7,646 / 8.7 | 4,738 / 13 |
| Ingest, `ingestRoute` buffered (hits/s) | 12,268 | 13,084 |
| Count a 670,000-hit day (s, median of 3) | 17.7 | 18.1 |
| Gap while that day is counted (ms, worst of 3) | 298 | 17,524 |
| One hit stored while it is counted (calls, p95 ms, max ms) | 111,968, 0.3, 289 | 69, 18.5, 17,517 |
| The same, counted again over its own rows | 112,023, 0.3, 268 | not measured |
| A host write through Payload while it is counted (calls, p95 ms, max ms) | 1,232, 2.0, 288 | 23, 2.0, 5.4 |
| The same, counted again over its own rows | 1,311, 2.1, 81 | not measured |
| Gap across every dashboard read (ms) | 22 | 66 |
| Top 10 pages, a third of visitors by country | 4,080 / 4,101, 1 day missing | 12 / 17, 30 days missing |
| Top 10 sources of one page (a document panel) | 2,339 / 2,350 | 24 / 30, 30 days missing |
| Top 10 pages where page contains | 1,254 / 1,386 | 1,233 / 1,303, 1 day missing |

On worker threads the count runs beside everything else. It writes the day's totals beside the rows reads use, 500 rows per statement, and deletes the old rows 2,000 per statement, so the slowest stored hit and host write each waited out one of those statements; a host write waits on the main thread, since the adapter's client is synchronous. On the main thread the count, run here directly as the jobs runner would, holds the process for all of it, and every read stays within the engine's 150 ms bound per statement by leaving out what does not fit: the filtered reads of those 30,000-hit days answer no day, and today, past what a read may count, comes from an older snapshot or not at all.

Choosing the threads: one thread for everything makes a beacon wait out a whole count (16.9 s at most beside a 670,000-hit count), two threads (writes, then reads and counts together) keep beacons at 0.3 ms p95 but let a dashboard read wait 24.8 s behind the count, and three (writes, reads, counts) keep both: beacons 0.5 ms and reads 1.2 ms at p95, measured on a separate run of the same day with one hit stored back to back and a bounded count read every 50 ms.

### 2026-10-09: day writes, document panels and storage

Same laptop, shared with other work that day (load average around 8), so its counts ran slower than the 2026-10-07 ones. Postgres and SQLite (worker threads) ran the whole of `engine.load.ts`; MongoDB ran the dashboard and the storage test alone, so its hits table holds the dashboard's 920,000 hits only. p50 / p95 in ms unless a row says otherwise.

| | MongoDB | Postgres | SQLite |
|---|---|---|---|
| Count a 670,000-hit day (s, median of 3) | not run | 13.5 | 26.3 |
| One hit stored while it is counted (calls, p95 ms, max ms) | not run | 9,090, 2.1, 124 | 111,968, 0.3, 289 |
| The same, counted again over its own rows | not run | 10,070, 1.9, 61 | 112,023, 0.3, 268 |
| A host write through Payload while it is counted (calls, p95 ms, max ms) | not run | 545, 6.6, 134 | 1,232, 2.0, 288 |
| The same, counted again over its own rows | not run | 586, 6.5, 67 | 1,311, 2.1, 81 |
| Gap while that day is counted (ms, worst of 3) | not run | 70 | 298 |
| Live counter on that day, 30 minutes (p50) | not run | 29 | 25 |
| Live widget on that day, by the minute (p50) | not run | 32 | 59 |
| Live top 10 sources on that day (p50) | not run | 332 | fails as busy (503) in 31 |
| Top 10 sources of one page (a document panel) | 4,758 / 4,786 | 719 / 745 | 2,334 / 2,365 |
| Top 10 countries of one page (a document panel) | 4,029 / 4,102 | 616 / 704 | 2,271 / 2,276 |
| Top 10 devices of one page (a document panel) | 4,024 / 4,049 | 619 / 672 | 2,256 / 2,262 |
| A page's totals (a document panel) | 2.1 / 2.7 | 2.8 / 3.7 | 15.6 / 18.9 |
| Aggregates: rows; table + index bytes per row | 288,645; 104 + 193 | 354,451; 186 + 189 | 354,866; 127 + 107 |
| Hits: rows; table + index bytes per row | 920,000; 85 + 68 | 1,744,160; 190 + 99 | 1,948,991; 198 + 82 |

A document panel's breakdowns read 30 days of raw hits for one page, so they cost with the month's hits whatever the page draws; its totals come from that page's daily totals. `LOAD_DASHBOARD_SCALE=11` runs the same reads over about 10 million hits a month.

### 2026-10-09: 1,000 tenants

Same laptop, `tenants.load.ts` at `LOAD_SCALE=1` on Postgres and SQLite (worker threads); MongoDB was not run. The 670,000-hit count is `engine.load.ts` from the same session, for scale.

| | Postgres | SQLite |
|---|---|---|
| Append 60,000 hits (s) | 11.6 | 1.6 |
| First maintenance run: 2,000 days counted, 31,000 marked empty (s) | 196.5 | 31.7 |
| Idle maintenance run, every scope skipped (ms, 3 runs) | 301 to 348 | 88 to 97 |
| Maintenance run after every tenant had a visit since, a light pass each (ms, 3 runs) | 2,298 to 2,626 | 353 to 358 |
| All sites, totals of 30 days (p50 / max) | 212 / 220 | 266 / 276 |
| All sites, top 10 sources of 30 days (p50 / max) | 221 / 224 | 328 / 355 |
| One site, totals of 30 days (p50 / max) | 2.4 / 2.6 | 0.9 / 1.0 |
| All sites, live visitors of 30 minutes (p50 / max) | 14.2 / 14.3 | 10.8 / 11.7 |
| Count a 670,000-hit day (s, median of 3) | 13.5 | 17.7 |

Upkeep and All sites reads stay well inside the budget and the read timeout at this many tenants on both databases: a run with nothing new skips each scope on its pass record (`cursor:maintain:<scope>`), and an All sites read finds every scope's day markers through the `(kind, scope, day)` index of `analytics-state`.

### 2026-10-09: both suites, one session per database

Same laptop, beside other work (load average about 4), `engine.load.ts` and `tenants.load.ts` at `LOAD_SCALE=1` on Postgres and SQLite (worker threads), one session per database. p50 / p95 in ms unless a row says otherwise.

| | Postgres | SQLite |
|---|---|---|
| Ingest, Payload endpoint (hits/s, p95 ms) | 4,311 / 9.7 | 6,884 / 9.7 |
| Ingest, `ingestRoute` buffered (hits/s) | 16,506 | 18,972 |
| Count a 670,000-hit day (s, median of 3) | 13.6 | 26.3 |
| One hit stored while it is counted (calls, p95 ms, max ms) | 8,978, 2.2, 171 | 95,921, 0.3, 1,411 |
| The same, counted again over its own rows | 9,999, 1.9, 89 | 102,609, 0.3, 1,221 |
| A host write through Payload while it is counted (calls, p95 ms, max ms) | 551, 6.7, 157 | 1,202, 4.6, 101 |
| The same, counted again over its own rows | 590, 5.6, 80 | 1,235, 4.9, 490 |
| Gap while that day is counted (ms, worst of 3) | 51 | 501 |
| Live counter, live widget, live top 10 sources on that day (p50) | 28, 32, 330 | 25, 59, fails as busy (503) in 30 |
| Top 10 pages | 79 / 80 | 63 / 71 |
| Top 10 sources of one page (a document panel) | 722 / 796 | 2,320 / 2,324 |
| Gap across every dashboard read (ms) | 24 | 21 |
| 1,000 tenants: idle maintenance run (ms, 3 runs) | 331 to 414 | 88 to 99 |
| 1,000 tenants: a light pass of every scope (ms, 3 runs) | 2,347 to 2,507 | 354 to 403 |
| 1,000 tenants: All sites totals, top 10 sources of 30 days (p50) | 217, 231 | 268, 330 |
| 1,000 tenants: one site's totals, All sites live visitors (p50) | 2.4, 14.1 | 1.0, 10.8 |

The SQLite count matches the earlier 2026-10-09 run (26.3 s) rather than the 2026-10-07 ones (17.7 to 19.6 s), so the docs give the count as a range across runs. On SQLite the longest single stored hit (1.4 s) and the event loop's longest gap during the count (0.5 s) were longer than in the earlier runs, while their p95 stayed at 0.3 ms.
