SELECT 1 AS "hit" FROM "analytics"."analytics_hits" WHERE "scope" = $1 AND "ts" >= $2 AND "ts" < $3 LIMIT 1

-- parameters
-- 1: "s"
-- 2: "2026-10-06T00:00:00.000Z"
-- 3: "2026-10-07T00:00:00.000Z"

WITH RECURSIVE "s"("scope") AS (SELECT MIN("scope") FROM "analytics"."analytics_hits"
		UNION ALL
		SELECT (SELECT MIN("h"."scope") FROM "analytics"."analytics_hits" AS "h" WHERE "h"."scope" > "s"."scope") FROM "s" WHERE "s"."scope" IS NOT NULL)
	SELECT "scope" FROM "s" WHERE "scope" IS NOT NULL

-- parameters


SELECT COUNT(*) AS "n" FROM (SELECT 1 FROM "analytics"."analytics_hits" WHERE "scope" = $1 AND "ts" >= $2 AND "ts" < $3 LIMIT $4) AS "c"

-- parameters
-- 1: "s"
-- 2: "2026-10-06T00:00:00.000Z"
-- 3: "2026-10-07T00:00:00.000Z"
-- 4: 1001
