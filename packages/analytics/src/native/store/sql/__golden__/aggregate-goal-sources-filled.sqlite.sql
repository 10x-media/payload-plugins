WITH m AS (SELECT "scope", "day", "gen" FROM "analytics_state"
		WHERE "kind" = 'day' AND "gen" IS NOT NULL AND (("day" >= ? AND "day" <= ?))),
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
		SUM("g"."pageviews_without_visitor") AS "pageviewsWithoutVisitor",
		SUM("g"."pageviews_without_consent") AS "pageviewsWithoutConsent",
		COUNT(*) AS "n"
		FROM "analytics_aggregates" AS "g"
			JOIN m ON "m"."scope" = "g"."scope" AND "m"."day" = "g"."day" AND "m"."gen" = "g"."gen"
		WHERE "g"."dim" = ?
			AND "g"."dim2" = ?
			AND (("g"."day" >= ? AND "g"."day" <= ?))
			AND "g"."value" = ?
			AND "g"."value2" IN (?, ?)
			AND "g"."value2" <> ''
		GROUP BY "g"."value2")
	SELECT * FROM r
	WHERE COALESCE("pageviews", 0) + COALESCE("events", 0) + COALESCE("impressions", 0) > 0
	ORDER BY CAST("revenue" AS REAL) / NULLIF(CAST("conversions" AS REAL), 0) DESC NULLS LAST, "value" ASC

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
