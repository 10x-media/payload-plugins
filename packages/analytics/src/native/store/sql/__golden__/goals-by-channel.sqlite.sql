WITH h AS (SELECT "id", "scope", "ts", "hostname", "v", "type", "path", "name", "duration_ms", "scroll_depth", CASE WHEN substr("hit"."id", 1, 3) = 'ow.' THEN COALESCE((SELECT "item" FROM "analytics_hits" AS "twin"
				WHERE "twin"."id" = 'os.' || substr("hit"."id", 4) AND "twin"."ts" BETWEEN strftime('%Y-%m-%dT%H:%M:%fZ', "hit"."ts", '-86400 seconds') AND strftime('%Y-%m-%dT%H:%M:%fZ', "hit"."ts", '+86400 seconds')), "hit"."item") ELSE "hit"."item" END AS "item", CASE WHEN substr("hit"."id", 1, 3) = 'ow.' AND (SELECT "item" FROM "analytics_hits" AS "twin"
				WHERE "twin"."id" = 'os.' || substr("hit"."id", 4) AND "twin"."ts" BETWEEN strftime('%Y-%m-%dT%H:%M:%fZ', "hit"."ts", '-86400 seconds') AND strftime('%Y-%m-%dT%H:%M:%fZ', "hit"."ts", '+86400 seconds')) IS NOT NULL THEN ? ELSE "hit"."server" END AS "server", CASE WHEN substr("hit"."id", 1, 3) <> 'ow.' THEN "conversions"
			WHEN (SELECT 1 FROM "analytics_hits" AS "twin"
				WHERE "twin"."id" = 'os.' || substr("hit"."id", 4)) IS NULL THEN "conversions"
			ELSE (SELECT "conversions" FROM "analytics_hits" AS "twin"
				WHERE "twin"."id" = 'os.' || substr("hit"."id", 4) AND "twin"."ts" BETWEEN strftime('%Y-%m-%dT%H:%M:%fZ', "hit"."ts", '-86400 seconds') AND strftime('%Y-%m-%dT%H:%M:%fZ', "hit"."ts", '+86400 seconds')) END AS "conversions", CASE WHEN substr("hit"."id", 1, 3) <> 'ow.' THEN "revenue"
			WHEN (SELECT 1 FROM "analytics_hits" AS "twin"
				WHERE "twin"."id" = 'os.' || substr("hit"."id", 4)) IS NULL THEN "revenue"
			ELSE (SELECT "revenue" FROM "analytics_hits" AS "twin"
				WHERE "twin"."id" = 'os.' || substr("hit"."id", 4) AND "twin"."ts" BETWEEN strftime('%Y-%m-%dT%H:%M:%fZ', "hit"."ts", '-86400 seconds') AND strftime('%Y-%m-%dT%H:%M:%fZ', "hit"."ts", '+86400 seconds')) END AS "revenue", CASE WHEN "type" = 'engagement' THEN 1 ELSE 0 END AS "eng", COALESCE("last_at", "ts") AS "act", "landing", CASE WHEN substr("hit"."id", 1, 3) <> 'ow.' THEN "goals"
			WHEN (SELECT 1 FROM "analytics_hits" AS "twin"
				WHERE "twin"."id" = 'os.' || substr("hit"."id", 4)) IS NULL THEN "goals"
			ELSE (SELECT "goals" FROM "analytics_hits" AS "twin"
				WHERE "twin"."id" = 'os.' || substr("hit"."id", 4) AND "twin"."ts" BETWEEN strftime('%Y-%m-%dT%H:%M:%fZ', "hit"."ts", '-86400 seconds') AND strftime('%Y-%m-%dT%H:%M:%fZ', "hit"."ts", '+86400 seconds')) END AS "goals"
		FROM "analytics_hits" AS "hit" WHERE "scope" = ? AND "ts" >= ? AND "ts" < ?
			AND ("hostname", "v") IN (SELECT "hostname", "v" FROM "analytics_hits"
				WHERE "scope" = ? AND "ts" >= ? AND "ts" < ? AND ("goals" IS NOT NULL OR substr("id", 1, 3) = 'ow.'))
			AND (substr("hit"."id", 1, 3) <> 'os.'
			OR (SELECT 1 FROM "analytics_hits" AS "twin"
				WHERE "twin"."id" = 'ow.' || substr("hit"."id", 4) AND "twin"."ts" BETWEEN strftime('%Y-%m-%dT%H:%M:%fZ', "hit"."ts", '-86400 seconds') AND strftime('%Y-%m-%dT%H:%M:%fZ', "hit"."ts", '+86400 seconds')) IS NULL)),
	g AS (SELECT *, CASE WHEN "v" = '' THEN NULL
			WHEN MAX("act") OVER gap IS NULL OR "ts" > strftime('%Y-%m-%dT%H:%M:%fZ', MAX("act") OVER gap, '+30 minutes') THEN 1 ELSE 0 END AS "starts"
		FROM h WINDOW gap AS (PARTITION BY "hostname", "v" ORDER BY "ts", "id" ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)),
	s AS (SELECT *, SUM("starts") OVER (PARTITION BY "hostname", "v" ORDER BY "ts", "id" ROWS UNBOUNDED PRECEDING) AS "sn"
		FROM g),
	e AS (SELECT *, ROW_NUMBER() OVER sess AS "rn",
		SUM(CASE WHEN "type" = 'pageview' THEN 1 ELSE 0 END) OVER whole AS "s_pv",
		SUM(CASE WHEN "type" IN ('event', 'goal') THEN 1 ELSE 0 END) OVER whole AS "s_int",
		SUM(COALESCE("duration_ms", 0)) OVER whole AS "s_ms"
		FROM s WINDOW sess AS (PARTITION BY "hostname", "v", "sn" ORDER BY "eng", "ts", "id"),
			whole AS (sess ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)),
	vs AS (SELECT "e"."scope", "e"."hostname", "e"."v", "e"."sn",
		CASE WHEN "e"."eng" = 0 AND "e"."landing" = 1 THEN 1 ELSE 0 END AS "landed",
		"x"."channel"
		FROM e JOIN "analytics_hits" AS "x" ON "x"."id" = "e"."id"
		WHERE "e"."sn" IS NOT NULL AND "e"."rn" = 1),
	vl AS (SELECT *, SUM("landed") OVER (PARTITION BY "hostname", "v" ORDER BY "sn" ROWS UNBOUNDED PRECEDING) AS "lq"
		FROM vs),
	va AS (SELECT "scope", "hostname", "v", "sn",
		CASE WHEN "lq" > 0 THEN FIRST_VALUE("channel") OVER land ELSE "channel" END AS "e_channel"
		FROM vl WINDOW land AS (PARTITION BY "hostname", "v", "lq" ORDER BY "sn")),
	a AS (SELECT "e".*,
		COALESCE("va"."e_channel", "o"."channel") AS "e_channel",
		CASE WHEN "e"."sn" IS NOT NULL AND "e"."rn" = 1 AND "e"."eng" = 0 THEN 1 ELSE 0 END AS "entry",
		CASE WHEN "e"."sn" IS NOT NULL AND "e"."rn" = 1 AND "e"."eng" = 0 AND "e"."s_pv" = 1 AND "e"."s_int" = 0 THEN 1 ELSE 0 END AS "bounce"
		FROM e LEFT JOIN va ON "va"."scope" = "e"."scope" AND "va"."hostname" = "e"."hostname" AND "va"."v" = "e"."v" AND "va"."sn" = "e"."sn"
			LEFT JOIN "analytics_hits" AS "o" ON "e"."sn" IS NULL AND "o"."id" = "e"."id"),
	q AS (SELECT "t"."e_channel" AS "gv",
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
		CASE WHEN COALESCE("t"."conversions", 0) > 0 THEN 1 ELSE 0 END AS "conversions",
		COALESCE(CAST(json_extract("gl"."value", '$.value') AS REAL), 0) AS "revenue",
		CASE WHEN "t"."type" = 'event' AND "t"."name" = 'item_click' AND "t"."item" IS NOT NULL AND "t"."item" <> '' THEN 1 ELSE 0 END AS "interactions"
		FROM "a" AS "t" CROSS JOIN json_each("t"."goals") AS "gl"
		WHERE json_extract("gl"."value", '$.slug') = ?
			AND "t"."e_channel" IS NOT NULL AND "t"."e_channel" <> ''),
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
	ORDER BY "value" ASC

-- parameters
-- 1: 1
-- 2: "tenant-a"
-- 3: "2026-10-06T00:00:00.000Z"
-- 4: "2026-10-07T00:00:00.000Z"
-- 5: "tenant-a"
-- 6: "2026-10-06T00:00:00.000Z"
-- 7: "2026-10-07T00:00:00.000Z"
-- 8: "purchase"
