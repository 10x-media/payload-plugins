WITH h AS (SELECT "id", "scope" COLLATE "C" AS "scope", "ts", "hostname" COLLATE "C" AS "hostname", "v" COLLATE "C" AS "v", "type", "path" COLLATE "C" AS "path", "name" COLLATE "C" AS "name", "duration_ms", "scroll_depth", CASE WHEN substr("hit"."id", 1, 3) = 'ow.' THEN COALESCE((SELECT "item" FROM "analytics"."analytics_hits" AS "twin"
				WHERE "twin"."id" = 'os.' || substr("hit"."id", 4) AND "twin"."ts" BETWEEN "hit"."ts" - interval '86400 seconds' AND "hit"."ts" + interval '86400 seconds'), "hit"."item") ELSE "hit"."item" END COLLATE "C" AS "item", CASE WHEN substr("hit"."id", 1, 3) = 'ow.' AND (SELECT "item" FROM "analytics"."analytics_hits" AS "twin"
				WHERE "twin"."id" = 'os.' || substr("hit"."id", 4) AND "twin"."ts" BETWEEN "hit"."ts" - interval '86400 seconds' AND "hit"."ts" + interval '86400 seconds') IS NOT NULL THEN $1 ELSE "hit"."server" END AS "server", CASE WHEN substr("hit"."id", 1, 3) <> 'ow.' THEN "conversions"
			WHEN (SELECT 1 FROM "analytics"."analytics_hits" AS "twin"
				WHERE "twin"."id" = 'os.' || substr("hit"."id", 4)) IS NULL THEN "conversions"
			ELSE (SELECT "conversions" FROM "analytics"."analytics_hits" AS "twin"
				WHERE "twin"."id" = 'os.' || substr("hit"."id", 4) AND "twin"."ts" BETWEEN "hit"."ts" - interval '86400 seconds' AND "hit"."ts" + interval '86400 seconds') END AS "conversions", CASE WHEN substr("hit"."id", 1, 3) <> 'ow.' THEN "revenue"
			WHEN (SELECT 1 FROM "analytics"."analytics_hits" AS "twin"
				WHERE "twin"."id" = 'os.' || substr("hit"."id", 4)) IS NULL THEN "revenue"
			ELSE (SELECT "revenue" FROM "analytics"."analytics_hits" AS "twin"
				WHERE "twin"."id" = 'os.' || substr("hit"."id", 4) AND "twin"."ts" BETWEEN "hit"."ts" - interval '86400 seconds' AND "hit"."ts" + interval '86400 seconds') END AS "revenue", CASE WHEN "type" = 'engagement' THEN 1 ELSE 0 END AS "eng", COALESCE("last_at", "ts") AS "act", "landing", "source" COLLATE "C" AS "source"
		FROM "analytics"."analytics_hits" AS "hit" WHERE "scope" = $2 AND "ts" >= $3 AND "ts" < $4 AND "hostname" = $5
			AND ("hostname", "v") IN (SELECT "hostname", "v" FROM "analytics"."analytics_hits"
				WHERE "scope" = $6 AND "ts" >= $7 AND "ts" < $8 AND "hostname" = $9 AND ("source") COLLATE "default" ILIKE $10 ESCAPE '\')
			AND ("hostname", "v") IN (SELECT "hostname", "v" FROM "analytics"."analytics_hits"
				WHERE "scope" = $11 AND "ts" >= $12 AND "ts" < $13 AND "hostname" = $14 AND "path" = $15)
			AND (substr("hit"."id", 1, 3) <> 'os.'
			OR (SELECT 1 FROM "analytics"."analytics_hits" AS "twin"
				WHERE "twin"."id" = 'ow.' || substr("hit"."id", 4) AND "twin"."ts" BETWEEN "hit"."ts" - interval '86400 seconds' AND "hit"."ts" + interval '86400 seconds') IS NULL)),
	g AS (SELECT *, CASE WHEN "v" = '' THEN NULL
			WHEN MAX("act") OVER gap IS NULL OR "ts" > MAX("act") OVER gap + interval '30 minutes' THEN 1 ELSE 0 END AS "starts"
		FROM h WINDOW gap AS (PARTITION BY "hostname", "v" ORDER BY "ts", "id" COLLATE "C" ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)),
	s AS (SELECT *, SUM("starts") OVER (PARTITION BY "hostname", "v" ORDER BY "ts", "id" COLLATE "C" ROWS UNBOUNDED PRECEDING) AS "sn"
		FROM g),
	e AS (SELECT *, ROW_NUMBER() OVER sess AS "rn",
		SUM(CASE WHEN "type" = 'pageview' THEN 1 ELSE 0 END) OVER whole AS "s_pv",
		SUM(CASE WHEN "type" IN ('event', 'goal') THEN 1 ELSE 0 END) OVER whole AS "s_int",
		SUM(COALESCE("duration_ms", 0)) OVER whole AS "s_ms"
		FROM s WINDOW sess AS (PARTITION BY "hostname", "v", "sn" ORDER BY "eng", "ts", "id" COLLATE "C"),
			whole AS (sess ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)),
	l AS (SELECT *, SUM(CASE WHEN "rn" = 1 AND "eng" = 0 AND "landing" IS TRUE THEN 1 ELSE 0 END)
			OVER (PARTITION BY "hostname", "v" ORDER BY "sn", "eng", "ts", "id" COLLATE "C" ROWS UNBOUNDED PRECEDING) AS "lq"
		FROM e),
	a AS (SELECT *,
		CASE WHEN "sn" IS NULL THEN "source" ELSE FIRST_VALUE("source") OVER land END AS "e_source",
		CASE WHEN "sn" IS NOT NULL AND "rn" = 1 AND "eng" = 0 THEN 1 ELSE 0 END AS "entry",
		CASE WHEN "sn" IS NOT NULL AND "rn" = 1 AND "eng" = 0 AND "s_pv" = 1 AND "s_int" = 0 THEN 1 ELSE 0 END AS "bounce"
		FROM l WINDOW land AS (PARTITION BY "hostname", "v", CASE WHEN "lq" > 0 THEN "lq" ELSE -"sn" END
			ORDER BY "sn", "eng", "ts", "id" COLLATE "C")),
	q AS (SELECT "t"."e_source" AS "gv",
		"t"."scope",
		"t"."hostname",
		"t"."v",
		"t"."sn",
		CASE WHEN "t"."type" = 'pageview' THEN 1 ELSE 0 END AS "pageviews",
		CASE WHEN "t"."type" IN ('event', 'goal') THEN 1 ELSE 0 END AS "events",
		CASE WHEN "t"."eng" = 0 AND "t"."v" <> '' THEN 1 ELSE 0 END AS "visitors",
		CASE WHEN "t"."eng" = 0 AND "t"."sn" IS NOT NULL THEN 1 ELSE 0 END AS "sessions",
		"t"."entry" AS "entries",
		"t"."bounce" AS "bounces",
		"t"."s_ms" AS "sessionMs",
		COALESCE("t"."duration_ms", 0) AS "durationMs",
		COALESCE("t"."scroll_depth", 0) AS "scrollSum",
		CASE WHEN "t"."type" = 'pageview' AND "t"."scroll_depth" IS NOT NULL THEN 1 ELSE 0 END AS "scrollSamples",
		COALESCE("t"."conversions", 0) AS "conversions",
		COALESCE("t"."revenue", 0) AS "revenue",
		CASE WHEN "t"."type" = 'event' AND "t"."name" = 'item_click' AND "t"."item" IS NOT NULL AND "t"."item" <> '' THEN 1 ELSE 0 END AS "interactions"
		FROM "a" AS "t"
		WHERE "t"."ts" >= $16
			AND ("t"."e_source") COLLATE "default" ILIKE $17 ESCAPE '\'
			AND "t"."path" = $18
			AND "t"."e_source" IS NOT NULL AND "t"."e_source" <> ''),
	k AS (SELECT "gv",
		"scope",
		"hostname",
		"v",
		"sn",
		SUM("pageviews") AS "pageviews",
		SUM("events") AS "events",
		MAX("visitors") AS "visitors",
		MAX("sessions") AS "sessions",
		SUM("entries") AS "entries",
		SUM("bounces") AS "bounces",
		MAX("sessionMs") AS "sessionMs",
		SUM("durationMs") AS "durationMs",
		SUM("scrollSum") AS "scrollSum",
		SUM("scrollSamples") AS "scrollSamples",
		SUM("conversions") AS "conversions",
		SUM("revenue") AS "revenue",
		SUM("interactions") AS "interactions"
		FROM q GROUP BY "gv", "scope", "hostname", "v", "sn"),
	p AS (SELECT "gv",
		"scope",
		"hostname",
		"v",
		SUM("pageviews") AS "pageviews",
		SUM("events") AS "events",
		MAX("visitors") AS "visitors",
		SUM("sessions") AS "sessions",
		SUM("entries") AS "entries",
		SUM("bounces") AS "bounces",
		SUM(CASE WHEN "sessions" = 1 THEN "sessionMs" ELSE 0 END) AS "sessionMs",
		SUM("durationMs") AS "durationMs",
		SUM("scrollSum") AS "scrollSum",
		SUM("scrollSamples") AS "scrollSamples",
		SUM("conversions") AS "conversions",
		SUM("revenue") AS "revenue",
		SUM("interactions") AS "interactions"
		FROM k GROUP BY "gv", "scope", "hostname", "v"),
	r AS (SELECT "gv" AS "value",
		SUM("pageviews") AS "pageviews",
		SUM("events") AS "events",
		SUM("visitors") AS "visitors",
		SUM("sessions") AS "sessions",
		SUM("entries") AS "entries",
		SUM("bounces") AS "bounces",
		SUM("sessionMs") AS "sessionMs",
		SUM("durationMs") AS "durationMs",
		SUM("scrollSum") AS "scrollSum",
		SUM("scrollSamples") AS "scrollSamples",
		SUM("conversions") AS "conversions",
		SUM("revenue") AS "revenue",
		SUM("interactions") AS "interactions"
		FROM p GROUP BY "gv")
	SELECT * FROM r
	WHERE "pageviews" + "events" > 0
	ORDER BY "pageviews" DESC NULLS LAST, "value" COLLATE "C" ASC
	LIMIT $19

-- parameters
-- 1: true
-- 2: "tenant-a"
-- 3: "2026-10-06T00:00:00.000Z"
-- 4: "2026-10-07T00:00:00.000Z"
-- 5: "a.example"
-- 6: "tenant-a"
-- 7: "2026-10-06T00:00:00.000Z"
-- 8: "2026-10-07T00:00:00.000Z"
-- 9: "a.example"
-- 10: "%50\\%\\_Off%"
-- 11: "tenant-a"
-- 12: "2026-10-06T09:00:00.000Z"
-- 13: "2026-10-07T00:00:00.000Z"
-- 14: "a.example"
-- 15: "/pricing"
-- 16: "2026-10-06T09:00:00.000Z"
-- 17: "%50\\%\\_Off%"
-- 18: "/pricing"
-- 19: 5
