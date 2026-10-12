WITH m AS (SELECT "scope", "day", "gen" FROM "analytics"."analytics_state"
		WHERE "kind" = 'day' AND "gen" IS NOT NULL AND (("day" >= $1 AND "day" <= $2))),
	r AS (SELECT "g"."value2" AS "value",
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
		WHERE "g"."dim" = $3
			AND "g"."dim2" = $4
			AND (("g"."day" >= $5 AND "g"."day" <= $6))
			AND "g"."value" = $7
			AND "g"."value2" IN ($8, $9)
			AND "g"."value2" <> ''
		GROUP BY "g"."value2")
	SELECT * FROM r
	WHERE COALESCE("pageviews", 0) + COALESCE("events", 0) + COALESCE("impressions", 0) > 0
	ORDER BY ("revenue")::double precision / NULLIF(("conversions")::double precision, 0) DESC NULLS LAST, "value" COLLATE "C" ASC

-- parameters
-- 1: 20261001
-- 2: 20261030
-- 3: "goal"
-- 4: "source"
-- 5: 20261001
-- 6: 20261030
-- 7: "purchase"
-- 8: "google"
-- 9: "bing"
