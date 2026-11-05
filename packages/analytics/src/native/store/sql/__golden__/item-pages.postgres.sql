WITH h AS (SELECT "id", "scope" COLLATE "C" AS "scope", "ts", "hostname" COLLATE "C" AS "hostname", "v" COLLATE "C" AS "v", "type", "path" COLLATE "C" AS "path", "name" COLLATE "C" AS "name", "duration_ms", "scroll_depth", "mode", CASE WHEN substr("hit"."id", 1, 3) = 'ow.' THEN COALESCE((SELECT "item" FROM "analytics"."analytics_hits" AS "twin"
				WHERE "twin"."id" = 'os.' || substr("hit"."id", 4) AND "twin"."ts" BETWEEN "hit"."ts" - interval '86400 seconds' AND "hit"."ts" + interval '86400 seconds'), "hit"."item") ELSE "hit"."item" END COLLATE "C" AS "item", CASE WHEN substr("hit"."id", 1, 3) = 'ow.' AND (SELECT "item" FROM "analytics"."analytics_hits" AS "twin"
				WHERE "twin"."id" = 'os.' || substr("hit"."id", 4) AND "twin"."ts" BETWEEN "hit"."ts" - interval '86400 seconds' AND "hit"."ts" + interval '86400 seconds') IS NOT NULL THEN $1 ELSE "hit"."server" END AS "server", CASE WHEN substr("hit"."id", 1, 3) <> 'ow.' THEN "conversions"
			WHEN (SELECT 1 FROM "analytics"."analytics_hits" AS "twin"
				WHERE "twin"."id" = 'os.' || substr("hit"."id", 4)) IS NULL THEN "conversions"
			ELSE (SELECT "conversions" FROM "analytics"."analytics_hits" AS "twin"
				WHERE "twin"."id" = 'os.' || substr("hit"."id", 4) AND "twin"."ts" BETWEEN "hit"."ts" - interval '86400 seconds' AND "hit"."ts" + interval '86400 seconds') END AS "conversions", CASE WHEN substr("hit"."id", 1, 3) <> 'ow.' THEN "revenue"
			WHEN (SELECT 1 FROM "analytics"."analytics_hits" AS "twin"
				WHERE "twin"."id" = 'os.' || substr("hit"."id", 4)) IS NULL THEN "revenue"
			ELSE (SELECT "revenue" FROM "analytics"."analytics_hits" AS "twin"
				WHERE "twin"."id" = 'os.' || substr("hit"."id", 4) AND "twin"."ts" BETWEEN "hit"."ts" - interval '86400 seconds' AND "hit"."ts" + interval '86400 seconds') END AS "revenue", CASE WHEN "type" = 'engagement' THEN 1 ELSE 0 END AS "eng", "impressions"
		FROM "analytics"."analytics_hits" AS "hit" WHERE "scope" = $2 AND "ts" >= $3 AND "ts" < $4
			AND (substr("hit"."id", 1, 3) <> 'os.'
			OR (SELECT 1 FROM "analytics"."analytics_hits" AS "twin"
				WHERE "twin"."id" = 'ow.' || substr("hit"."id", 4) AND "twin"."ts" BETWEEN "hit"."ts" - interval '86400 seconds' AND "hit"."ts" + interval '86400 seconds') IS NULL)),
	f AS (SELECT "t".*, "t"."item" AS "x", 0 AS "imp" FROM "h" AS "t"
			WHERE "t"."eng" = 0 AND "t"."item" IS NOT NULL AND "t"."item" <> ''
		UNION ALL
		SELECT "t".*, "i"."value" AS "x", 1 AS "imp" FROM "h" AS "t"
			CROSS JOIN LATERAL jsonb_array_elements_text("t"."impressions") AS "i"(value)
			WHERE "t"."eng" = 1),
	q AS (SELECT CASE WHEN "t"."server" IS TRUE THEN NULL ELSE "t"."path" END AS "gv",
		"t"."scope",
		"t"."hostname",
		"t"."v",
		CASE WHEN "t"."type" IN ('event', 'goal') THEN 1 ELSE 0 END AS "events",
		CASE WHEN "t"."v" <> '' THEN 1 ELSE 0 END AS "visitors",
		COALESCE("t"."conversions", 0) AS "conversions",
		COALESCE("t"."revenue", 0) AS "revenue",
		"t"."imp" AS "impressions",
		CASE WHEN "t"."type" = 'event' AND "t"."name" = 'item_click' AND "t"."item" IS NOT NULL AND "t"."item" <> '' THEN 1 ELSE 0 END AS "interactions"
		FROM "f" AS "t"
		WHERE "t"."x" = $5
			AND CASE WHEN "t"."server" IS TRUE THEN NULL ELSE "t"."path" END IS NOT NULL AND CASE WHEN "t"."server" IS TRUE THEN NULL ELSE "t"."path" END <> ''),
	p AS (SELECT "gv",
		"scope",
		"hostname",
		"v",
		SUM("events") AS "events",
		MAX("visitors") AS "visitors",
		SUM("conversions") AS "conversions",
		SUM("revenue") AS "revenue",
		SUM("impressions") AS "impressions",
		SUM("interactions") AS "interactions"
		FROM q GROUP BY "gv", "scope", "hostname", "v"),
	r AS (SELECT "gv" AS "value",
		SUM("events") AS "events",
		SUM("visitors") AS "visitors",
		SUM("conversions") AS "conversions",
		SUM("revenue") AS "revenue",
		SUM("impressions") AS "impressions",
		SUM("interactions") AS "interactions"
		FROM p GROUP BY "gv")
	SELECT * FROM r
	WHERE "events" + "impressions" > 0
	ORDER BY "value" COLLATE "C" ASC

-- parameters
-- 1: true
-- 2: "tenant-a"
-- 3: "2026-10-06T00:00:00.000Z"
-- 4: "2026-10-07T00:00:00.000Z"
-- 5: "offers:1"
