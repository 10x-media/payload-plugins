WITH m AS (SELECT "scope", "day", "gen" FROM "analytics_state"
		WHERE "kind" = 'day' AND "gen" IS NOT NULL AND "scope" = ? AND (("day" >= ? AND "day" <= ?))),
	r AS (SELECT SUM("g"."pageviews") AS "pageviews",
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
		WHERE "g"."scope" = ?
			AND "g"."dim" = ?
			AND "g"."dim2" = ?
			AND (("g"."day" >= ? AND "g"."day" <= ?)))
	SELECT * FROM r

-- parameters
-- 1: "tenant-a"
-- 2: 20261001
-- 3: 20261030
-- 4: "tenant-a"
-- 5: ""
-- 6: ""
-- 7: 20261001
-- 8: 20261030
