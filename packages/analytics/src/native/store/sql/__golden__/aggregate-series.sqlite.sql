WITH m AS (SELECT "scope", "day", "gen" FROM "analytics_state"
		WHERE "kind" = 'day' AND "gen" IS NOT NULL AND "scope" = ? AND ("day" >= ? AND "day" <= ? AND (("day" >= ? AND "day" <= ?) OR ("day" >= ? AND "day" <= ?)))),
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
		SUM("g"."pageviews_without_visitor") AS "pageviewsWithoutVisitor",
		SUM("g"."pageviews_without_consent") AS "pageviewsWithoutConsent",
		COUNT(*) AS "n"
		FROM "analytics_aggregates" AS "g"
			JOIN m ON "m"."scope" = "g"."scope" AND "m"."day" = "g"."day" AND "m"."gen" = "g"."gen"
		WHERE "g"."scope" = ?
			AND "g"."dim" = ?
			AND "g"."dim2" = ?
			AND ("g"."day" >= ? AND "g"."day" <= ? AND (("g"."day" >= ? AND "g"."day" <= ?) OR ("g"."day" >= ? AND "g"."day" <= ?)))
			AND "g"."hostname" = ?
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
