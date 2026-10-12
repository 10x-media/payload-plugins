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
				WHERE "twin"."id" = 'os.' || substr("hit"."id", 4) AND "twin"."ts" BETWEEN strftime('%Y-%m-%dT%H:%M:%fZ', "hit"."ts", '-86400 seconds') AND strftime('%Y-%m-%dT%H:%M:%fZ', "hit"."ts", '+86400 seconds')) END AS "goals", "impressions", CASE WHEN substr("hit"."id", 1, 3) <> 'ow.' THEN COALESCE("original_currency", "currency")
			WHEN (SELECT 1 FROM "analytics_hits" AS "twin"
				WHERE "twin"."id" = 'os.' || substr("hit"."id", 4)) IS NULL THEN COALESCE("original_currency", "currency")
			ELSE (SELECT COALESCE("original_currency", "currency") FROM "analytics_hits" AS "twin"
				WHERE "twin"."id" = 'os.' || substr("hit"."id", 4) AND "twin"."ts" BETWEEN strftime('%Y-%m-%dT%H:%M:%fZ', "hit"."ts", '-86400 seconds') AND strftime('%Y-%m-%dT%H:%M:%fZ', "hit"."ts", '+86400 seconds')) END AS "sent_currency", CASE WHEN substr("hit"."id", 1, 3) <> 'ow.' THEN (SELECT SUM(COALESCE(CAST(json_extract("je"."value", '$.sent') AS REAL), CAST(json_extract("je"."value", '$.value') AS REAL))) FROM json_each("goals") AS "je")
			WHEN (SELECT 1 FROM "analytics_hits" AS "twin"
				WHERE "twin"."id" = 'os.' || substr("hit"."id", 4)) IS NULL THEN (SELECT SUM(COALESCE(CAST(json_extract("je"."value", '$.sent') AS REAL), CAST(json_extract("je"."value", '$.value') AS REAL))) FROM json_each("goals") AS "je")
			ELSE (SELECT (SELECT SUM(COALESCE(CAST(json_extract("je"."value", '$.sent') AS REAL), CAST(json_extract("je"."value", '$.value') AS REAL))) FROM json_each("goals") AS "je") FROM "analytics_hits" AS "twin"
				WHERE "twin"."id" = 'os.' || substr("hit"."id", 4) AND "twin"."ts" BETWEEN strftime('%Y-%m-%dT%H:%M:%fZ', "hit"."ts", '-86400 seconds') AND strftime('%Y-%m-%dT%H:%M:%fZ', "hit"."ts", '+86400 seconds')) END AS "sent_revenue"
		FROM "analytics_hits" AS "hit" WHERE "scope" = ? AND "ts" >= ? AND "ts" < ?
			AND (substr("hit"."id", 1, 3) <> 'os.'
			OR (SELECT 1 FROM "analytics_hits" AS "twin"
				WHERE "twin"."id" = 'ow.' || substr("hit"."id", 4) AND "twin"."ts" BETWEEN strftime('%Y-%m-%dT%H:%M:%fZ', "hit"."ts", '-86400 seconds') AND strftime('%Y-%m-%dT%H:%M:%fZ', "hit"."ts", '+86400 seconds')) IS NULL)),
	g AS (SELECT *, CASE WHEN "v" = '' THEN NULL
			WHEN MAX("act") OVER gap IS NULL OR "ts" > strftime('%Y-%m-%dT%H:%M:%fZ', MAX("act") OVER gap, '+30 minutes') THEN 1 ELSE 0 END AS "starts"
		FROM h WINDOW gap AS (PARTITION BY "hostname", "v" ORDER BY "ts", "id" ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)),
	s AS (SELECT *, SUM("starts") OVER (PARTITION BY "hostname", "v" ORDER BY "ts", "id" ROWS UNBOUNDED PRECEDING) AS "sn"
		FROM g),
	e AS (SELECT *, ROW_NUMBER() OVER sess AS "rn",
		MAX(CASE WHEN "eng" = 0 THEN 1 ELSE 0 END) OVER whole AS "v_act",
		SUM(COALESCE("scroll_depth", 0)) OVER whole AS "v_ss",
		SUM(CASE WHEN "type" = 'pageview' AND "scroll_depth" IS NOT NULL THEN 1 ELSE 0 END) OVER whole AS "v_sc",
		SUM(COALESCE("conversions", 0)) OVER whole AS "v_conv",
		SUM(COALESCE("revenue", 0)) OVER whole AS "v_rev",
		SUM(CASE WHEN "type" = 'event' AND "name" = 'item_click' AND "item" IS NOT NULL AND "item" <> '' THEN 1 ELSE 0 END) OVER whole AS "v_int",
		SUM(CASE WHEN "type" = 'pageview' THEN 1 ELSE 0 END) OVER whole AS "s_pv",
		SUM(CASE WHEN "type" IN ('event', 'goal') THEN 1 ELSE 0 END) OVER whole AS "s_int",
		SUM(COALESCE("duration_ms", 0)) OVER whole AS "s_ms"
		FROM s WINDOW sess AS (PARTITION BY "hostname", "v", "sn", CASE WHEN "sn" IS NULL THEN "id" END ORDER BY "eng", "ts", "id"),
			whole AS (sess ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)),
	a AS MATERIALIZED (SELECT *,
		CASE WHEN "sn" IS NOT NULL AND "rn" = 1 AND "eng" = 0 THEN 1 ELSE 0 END AS "entry",
		CASE WHEN "sn" IS NOT NULL AND "rn" = 1 AND "eng" = 0 AND "s_pv" = 1 AND "s_int" = 0 THEN 1 ELSE 0 END AS "bounce"
		FROM e),
	vs AS (SELECT "t"."hostname",
		"t"."v",
		"t"."sn",
		"t"."type",
		"t"."eng",
		"t"."name",
		"t"."item",
		"t"."duration_ms",
		"t"."scroll_depth",
		"t"."conversions",
		"t"."goals",
		"t"."entry",
		"t"."bounce",
		"t"."s_pv",
		"t"."s_int",
		"t"."s_ms",
		"t"."v_act",
		"t"."v_ss",
		"t"."v_sc",
		"t"."v_conv",
		"t"."v_rev",
		"t"."v_int", 0 AS "w",
		CASE WHEN "t"."eng" = 0 AND "t"."landing" = 1 THEN 1 ELSE 0 END AS "landed",
		"x"."ref" AS "ref",
		"x"."source" AS "source",
		"x"."channel" AS "channel",
		"x"."click_id" AS "click_id",
		"x"."utm_source" AS "utm_source",
		"x"."utm_medium" AS "utm_medium",
		"x"."utm_campaign" AS "utm_campaign",
		"x"."utm_content" AS "utm_content",
		"x"."utm_term" AS "utm_term",
		"x"."country" AS "country",
		"x"."region" AS "region",
		"x"."city" AS "city",
		"x"."language" AS "language",
		"x"."device" AS "device",
		"x"."browser" AS "browser",
		"x"."os" AS "os"
		FROM a AS "t" JOIN "analytics_hits" AS "x" ON "x"."id" = "t"."id" AND "x"."scope" = ? AND "x"."ts" >= ? AND "x"."ts" < ?
		WHERE "t"."rn" = 1
		UNION ALL
		SELECT "t"."hostname",
		"t"."v",
		"t"."sn",
		"t"."type",
		"t"."eng",
		"t"."name",
		"t"."item",
		"t"."duration_ms",
		"t"."scroll_depth",
		"t"."conversions",
		"t"."goals",
		"t"."entry",
		"t"."bounce",
		"t"."s_pv",
		"t"."s_int",
		"t"."s_ms",
		"t"."v_act",
		"t"."v_ss",
		"t"."v_sc",
		"t"."v_conv",
		"t"."v_rev",
		"t"."v_int", 1, 0,
		"x"."ref" AS "ref",
		"x"."source" AS "source",
		"x"."channel" AS "channel",
		"x"."click_id" AS "click_id",
		"x"."utm_source" AS "utm_source",
		"x"."utm_medium" AS "utm_medium",
		"x"."utm_campaign" AS "utm_campaign",
		"x"."utm_content" AS "utm_content",
		"x"."utm_term" AS "utm_term",
		"x"."country" AS "country",
		"x"."region" AS "region",
		"x"."city" AS "city",
		"x"."language" AS "language",
		"x"."device" AS "device",
		"x"."browser" AS "browser",
		"x"."os" AS "os"
		FROM a AS "t" LEFT JOIN "analytics_hits" AS "x" ON "t"."sn" IS NULL AND "x"."id" = "t"."id"
		WHERE "t"."goals" IS NOT NULL),
	vl AS (SELECT *, SUM("landed") OVER (PARTITION BY "hostname", "v" ORDER BY "sn", "w" ROWS UNBOUNDED PRECEDING) AS "lq"
		FROM vs),
	va AS MATERIALIZED (SELECT "hostname",
		"v",
		"sn",
		"type",
		"eng",
		"name",
		"item",
		"duration_ms",
		"scroll_depth",
		"conversions",
		"goals",
		"entry",
		"bounce",
		"s_pv",
		"s_int",
		"s_ms",
		"v_act",
		"v_ss",
		"v_sc",
		"v_conv",
		"v_rev",
		"v_int",
		"w",
		CASE WHEN "sn" IS NULL THEN "ref" ELSE FIRST_VALUE("ref") OVER land END AS "e_ref",
		CASE WHEN "sn" IS NULL THEN "source" ELSE FIRST_VALUE("source") OVER land END AS "e_source",
		CASE WHEN "sn" IS NULL THEN "channel" ELSE FIRST_VALUE("channel") OVER land END AS "e_channel",
		CASE WHEN "sn" IS NULL THEN "click_id" ELSE FIRST_VALUE("click_id") OVER land END AS "e_click_id",
		CASE WHEN "sn" IS NULL THEN "utm_source" ELSE FIRST_VALUE("utm_source") OVER land END AS "e_utm_source",
		CASE WHEN "sn" IS NULL THEN "utm_medium" ELSE FIRST_VALUE("utm_medium") OVER land END AS "e_utm_medium",
		CASE WHEN "sn" IS NULL THEN "utm_campaign" ELSE FIRST_VALUE("utm_campaign") OVER land END AS "e_utm_campaign",
		CASE WHEN "sn" IS NULL THEN "utm_content" ELSE FIRST_VALUE("utm_content") OVER land END AS "e_utm_content",
		CASE WHEN "sn" IS NULL THEN "utm_term" ELSE FIRST_VALUE("utm_term") OVER land END AS "e_utm_term",
		"country" AS "e_country",
		"region" AS "e_region",
		"city" AS "e_city",
		"language" AS "e_language",
		"device" AS "e_device",
		"browser" AS "e_browser",
		"os" AS "e_os"
		FROM vl WINDOW land AS (PARTITION BY "hostname", "v", CASE WHEN "lq" > 0 THEN "lq" ELSE -"sn" END ORDER BY "sn", "w")),
	"ks"("k") AS (VALUES (0), (1), (2), (3), (4), (5), (6), (7), (8), (9), (10), (11), (12), (13), (14), (15)),
	sf AS (SELECT * FROM (SELECT "ks"."k", CASE "ks"."k" WHEN 0 THEN '' WHEN 1 THEN "t"."e_ref" WHEN 2 THEN "t"."e_source" WHEN 3 THEN "t"."e_channel" WHEN 4 THEN "t"."e_utm_source" WHEN 5 THEN "t"."e_utm_medium" WHEN 6 THEN "t"."e_utm_campaign" WHEN 7 THEN "t"."e_utm_content" WHEN 8 THEN "t"."e_utm_term" WHEN 9 THEN "t"."e_country" WHEN 10 THEN "t"."e_region" WHEN 11 THEN "t"."e_city" WHEN 12 THEN "t"."e_language" WHEN 13 THEN "t"."e_device" WHEN 14 THEN "t"."e_browser" WHEN 15 THEN "t"."e_os" END AS "v1",
			"t"."hostname",
		"t"."v",
		"t"."s_pv" AS "pageviews",
		"t"."s_int" AS "events",
		CASE WHEN "t"."v_act" = 1 AND "t"."v" <> '' THEN 1 ELSE 0 END AS "visitors",
		CASE WHEN "t"."v_act" = 1 AND "t"."sn" IS NOT NULL THEN 1 ELSE 0 END AS "sessions",
		"t"."entry" AS "entries",
		"t"."bounce" AS "bounces",
		"t"."s_ms" AS "sessionMs",
		"t"."s_ms" AS "durationMs",
		"t"."v_ss" AS "scrollSum",
		"t"."v_sc" AS "scrollSamples",
		"t"."v_conv" AS "conversions",
		"t"."v_rev" AS "revenue",
		"t"."v_int" AS "interactions"
			FROM va AS "t" CROSS JOIN ks WHERE "t"."w" = 0) AS "f"
		WHERE "v1" IS NOT NULL AND ("v1" <> '' OR "k" = 0)),
	sp AS (SELECT "k", "v1", "hostname", "v",
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
		FROM sf GROUP BY "k", "v1", "hostname", "v"),
	sr AS (SELECT "k", "v1",
		'' AS "v2",
		"hostname",
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
		FROM sp GROUP BY "k", "v1", "hostname"),
	"kg"("k") AS (VALUES (19), (20), (21), (22)),
	hf AS (SELECT * FROM (SELECT 16 AS "k", "t"."path" AS "v1", '' AS "v2",
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
			FROM a AS "t"
		UNION ALL
		SELECT 17 AS "k", "t"."name" AS "v1", '' AS "v2",
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
			FROM a AS "t" WHERE "t"."type" = 'event'
		UNION ALL
		SELECT 18 AS "k", "t"."sent_currency" AS "v1", '' AS "v2",
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
		COALESCE("t"."sent_revenue", 0) AS "revenue",
		CASE WHEN "t"."type" = 'event' AND "t"."name" = 'item_click' AND "t"."item" IS NOT NULL AND "t"."item" <> '' THEN 1 ELSE 0 END AS "interactions"
			FROM a AS "t" WHERE "t"."sent_currency" IS NOT NULL
		UNION ALL
		SELECT "kg"."k", json_extract("gl"."value", '$.slug') AS "v1", CASE "kg"."k" WHEN 19 THEN '' WHEN 20 THEN "t"."e_channel" WHEN 21 THEN "t"."e_source" WHEN 22 THEN "t"."e_utm_campaign" END AS "v2",
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
			FROM va AS "t" CROSS JOIN json_each("t"."goals") AS "gl" CROSS JOIN kg
			WHERE "t"."w" = 1) AS "f"
		WHERE "v1" IS NOT NULL AND "v1" <> '' AND "v2" IS NOT NULL AND ("v2" <> '' OR "k" IN (16, 17, 18, 19))),
	hk AS (SELECT "k", "v1", "v2", "hostname", "v", "sn",
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
		FROM hf GROUP BY "k", "v1", "v2", "hostname", "v", "sn"),
	hp AS (SELECT "k", "v1", "v2", "hostname", "v",
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
		FROM hk GROUP BY "k", "v1", "v2", "hostname", "v"),
	hr AS (SELECT "k", "v1", "v2", "hostname",
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
		FROM hp GROUP BY "k", "v1", "v2", "hostname"),
	xi AS (SELECT "t".*, "t"."item" AS "x", 0 AS "imp" FROM a AS "t"
			WHERE "t"."eng" = 0 AND "t"."item" IS NOT NULL AND "t"."item" <> ''
		UNION ALL
		SELECT "t".*, "i"."value" AS "x", 1 AS "imp" FROM a AS "t"
			CROSS JOIN json_each("t"."impressions") AS "i"
			WHERE "t"."eng" = 1),
	"kx"("k") AS (VALUES (23), (24)),
	xf AS (SELECT * FROM (SELECT "kx"."k", "t"."x" AS "v1", CASE "kx"."k" WHEN 23 THEN '' WHEN 24 THEN CASE WHEN "t"."server" = 1 THEN NULL ELSE "t"."path" END END AS "v2",
			"t"."hostname",
		"t"."v",
		CASE WHEN "t"."type" IN ('event', 'goal') THEN 1 ELSE 0 END AS "events",
		CASE WHEN "t"."v" <> '' THEN 1 ELSE 0 END AS "visitors",
		COALESCE("t"."conversions", 0) AS "conversions",
		COALESCE("t"."revenue", 0) AS "revenue",
		"t"."imp" AS "impressions",
		CASE WHEN "t"."type" = 'event' AND "t"."name" = 'item_click' AND "t"."item" IS NOT NULL AND "t"."item" <> '' THEN 1 ELSE 0 END AS "interactions"
			FROM xi AS "t" CROSS JOIN kx) AS "f"
		WHERE "v1" IS NOT NULL AND "v1" <> '' AND "v2" IS NOT NULL AND ("v2" <> '' OR "k" IN (23))),
	xp AS (SELECT "k", "v1", "v2", "hostname", "v",
		SUM("events") AS "events",
		MAX("visitors") AS "visitors",
		SUM("conversions") AS "conversions",
		SUM("revenue") AS "revenue",
		SUM("impressions") AS "impressions",
		SUM("interactions") AS "interactions"
		FROM xf GROUP BY "k", "v1", "v2", "hostname", "v"),
	xr AS (SELECT "k", "v1", "v2", "hostname",
		SUM("events") AS "events",
		SUM("visitors") AS "visitors",
		SUM("conversions") AS "conversions",
		SUM("revenue") AS "revenue",
		SUM("impressions") AS "impressions",
		SUM("interactions") AS "interactions"
		FROM xp GROUP BY "k", "v1", "v2", "hostname"),
	u AS (SELECT "k", "v1", "v2", "hostname", "pageviews", "events", "visitors", "sessions", "entries", "bounces", "sessionMs", "durationMs", "scrollSum", "scrollSamples", "conversions", "revenue", CAST(NULL AS REAL) AS "impressions", "interactions" FROM sr
		UNION ALL SELECT "k", "v1", "v2", "hostname", "pageviews", "events", "visitors", "sessions", "entries", "bounces", "sessionMs", "durationMs", "scrollSum", "scrollSamples", "conversions", "revenue", CAST(NULL AS REAL) AS "impressions", "interactions" FROM hr
		UNION ALL SELECT "k", "v1", "v2", "hostname", CAST(NULL AS REAL) AS "pageviews", "events", "visitors", CAST(NULL AS REAL) AS "sessions", CAST(NULL AS REAL) AS "entries", CAST(NULL AS REAL) AS "bounces", CAST(NULL AS REAL) AS "sessionMs", CAST(NULL AS REAL) AS "durationMs", CAST(NULL AS REAL) AS "scrollSum", CAST(NULL AS REAL) AS "scrollSamples", "conversions", "revenue", "impressions", "interactions" FROM xr),
	rk AS (SELECT "k", "v1", "v2", "hostname", "pageviews", "events", "visitors", "sessions", "entries", "bounces", "sessionMs", "durationMs", "scrollSum", "scrollSamples", "conversions", "revenue", "impressions", "interactions",
			ROW_NUMBER() OVER (PARTITION BY "k", "hostname", CASE WHEN "k" IN (20, 21, 22, 24) THEN "v1" ELSE '' END ORDER BY COALESCE("pageviews", "impressions", 0) DESC, COALESCE("events", 0) DESC, "v1" ASC, "v2" ASC) AS "rn",
			CASE "k" WHEN 1 THEN 500 WHEN 2 THEN 500 WHEN 4 THEN 300 WHEN 5 THEN 300 WHEN 6 THEN 300 WHEN 7 THEN 300 WHEN 8 THEN 300 WHEN 10 THEN 300 WHEN 11 THEN 500 WHEN 12 THEN 200 WHEN 16 THEN 10000 WHEN 17 THEN 300 WHEN 18 THEN 100 WHEN 20 THEN 300 WHEN 21 THEN 300 WHEN 22 THEN 300 WHEN 24 THEN 2000 END AS "cap"
		FROM u)
	SELECT "k", "v1", "v2", "hostname", "pageviews", "events", "visitors", "sessions", "entries", "bounces", "sessionMs", "durationMs", "scrollSum", "scrollSamples", "conversions", "revenue", "impressions", "interactions", 0 AS "o" FROM rk WHERE "cap" IS NULL OR "rn" <= "cap"
	UNION ALL SELECT "k", CASE WHEN "k" IN (20, 21, 22, 24) THEN "v1" ELSE '' END AS "v1", '' AS "v2", "hostname", SUM("pageviews") AS "pageviews", SUM("events") AS "events", CAST(NULL AS REAL) AS "visitors", CAST(NULL AS REAL) AS "sessions", SUM("entries") AS "entries", SUM("bounces") AS "bounces", CAST(NULL AS REAL) AS "sessionMs", SUM("durationMs") AS "durationMs", SUM("scrollSum") AS "scrollSum", SUM("scrollSamples") AS "scrollSamples", SUM("conversions") AS "conversions", SUM("revenue") AS "revenue", SUM("impressions") AS "impressions", SUM("interactions") AS "interactions", 1 AS "o"
		FROM rk WHERE "rn" > "cap" GROUP BY "k", "hostname", CASE WHEN "k" IN (20, 21, 22, 24) THEN "v1" ELSE '' END
	UNION ALL SELECT -1, '', '', '', COUNT(*), NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0 FROM a

-- parameters
-- 1: 1
-- 2: "tenant-a"
-- 3: "2026-10-05T22:00:00.000Z"
-- 4: "2026-10-06T22:00:00.000Z"
-- 5: "tenant-a"
-- 6: "2026-10-05T22:00:00.000Z"
-- 7: "2026-10-06T22:00:00.000Z"
