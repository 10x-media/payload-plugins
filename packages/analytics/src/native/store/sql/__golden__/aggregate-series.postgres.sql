WITH m AS (SELECT "scope", "day", "gen" FROM "analytics"."analytics_state"
		WHERE "kind" = 'day' AND "gen" IS NOT NULL AND "scope" = $1 AND ("day" >= $2 AND "day" <= $3 AND (("day" >= $4 AND "day" <= $5) OR ("day" >= $6 AND "day" <= $7)))),
	r AS (SELECT "g"."day" AS "day",
		SUM("g"."pageviews") AS "pageviews",
		SUM("g"."events") AS "events",
		SUM("g"."visitors") AS "visitors",
		SUM("g"."sessions") AS "sessions",
		SUM("g"."entries") AS "entries",
		SUM("g"."bounces") AS "bounces",
		SUM("g"."session_ms") AS "sessionMs",
		SUM("g"."duration_ms") AS "durationMs",
		SUM("g"."scroll_sum") AS "scrollSum",
		SUM("g"."scroll_samples") AS "scrollSamples",
		SUM("g"."conversions") AS "conversions",
		SUM("g"."revenue") AS "revenue",
		SUM("g"."impressions") AS "impressions",
		SUM("g"."interactions") AS "interactions",
		COUNT(*) AS "n"
		FROM "analytics"."analytics_aggregates" AS "g"
			JOIN m ON "m"."scope" = "g"."scope" AND "m"."day" = "g"."day" AND "m"."gen" = "g"."gen"
		WHERE "g"."scope" = $8
			AND "g"."dim" = $9
			AND "g"."dim2" = $10
			AND ("g"."day" >= $11 AND "g"."day" <= $12 AND (("g"."day" >= $13 AND "g"."day" <= $14) OR ("g"."day" >= $15 AND "g"."day" <= $16)))
			AND "g"."hostname" = $17
		GROUP BY "g"."day")
	SELECT * FROM r
	WHERE COALESCE("pageviews", 0) + COALESCE("events", 0) + COALESCE("impressions", 0) > 0
	ORDER BY "day" ASC

-- parameters
-- 1: "tenant-a"
-- 2: 20261001
-- 3: 20261010
-- 4: 20261001
-- 5: 20261003
-- 6: 20261010
-- 7: 20261010
-- 8: "tenant-a"
-- 9: ""
-- 10: ""
-- 11: 20261001
-- 12: 20261010
-- 13: 20261001
-- 14: 20261003
-- 15: 20261010
-- 16: 20261010
-- 17: "a.example"
