WITH m AS (SELECT "scope", "day", "gen" FROM "analytics"."analytics_state"
		WHERE "kind" = 'day' AND "gen" IS NOT NULL AND "scope" = $1 AND (("day" >= $2 AND "day" <= $3))),
	r AS (SELECT "g"."value" AS "value",
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
		WHERE "g"."scope" = $4
			AND "g"."dim" = $5
			AND "g"."dim2" = $6
			AND (("g"."day" >= $7 AND "g"."day" <= $8))
			AND "g"."value" <> ''
		GROUP BY "g"."value")
	SELECT * FROM r
	WHERE COALESCE("pageviews", 0) + COALESCE("events", 0) + COALESCE("impressions", 0) > 0
	ORDER BY "pageviews" DESC NULLS LAST, "value" COLLATE "C" ASC
	LIMIT $9

-- parameters
-- 1: "tenant-a"
-- 2: 20261001
-- 3: 20261030
-- 4: "tenant-a"
-- 5: "page"
-- 6: ""
-- 7: 20261001
-- 8: 20261030
-- 9: 10
