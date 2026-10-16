SELECT DISTINCT "gen" FROM "analytics"."analytics_aggregates"
		WHERE "scope" = $1 AND "day" = $2
			AND "dim" IN ($3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
			AND "dim2" IN ($24, $25, $26, $27, $28)

-- parameters
-- 1: "tenant-a"
-- 2: 20261006
-- 3: ""
-- 4: "referrer"
-- 5: "source"
-- 6: "channel"
-- 7: "utmSource"
-- 8: "utmMedium"
-- 9: "utmCampaign"
-- 10: "utmContent"
-- 11: "utmTerm"
-- 12: "country"
-- 13: "region"
-- 14: "city"
-- 15: "language"
-- 16: "device"
-- 17: "browser"
-- 18: "os"
-- 19: "page"
-- 20: "event"
-- 21: "currency"
-- 22: "goal"
-- 23: "item"
-- 24: ""
-- 25: "channel"
-- 26: "source"
-- 27: "utmCampaign"
-- 28: "page"

INSERT INTO "analytics"."analytics_aggregates" ("id", "scope", "day", "hostname", "dim", "value", "dim2", "value2", "gen", "pageviews", "events", "visitors", "sessions", "entries", "bounces", "session_ms", "duration_ms", "scroll_sum", "scroll_samples", "conversions", "revenue", "impressions", "interactions", "pageviews_without_visitor", "pageviews_without_consent")
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, NULL, $22, $23, $24)
		ON CONFLICT ("id") DO NOTHING

-- parameters
-- 1: "8vgc5boA62aIzyscuZmtAQ"
-- 2: "tenant-a"
-- 3: 20261006
-- 4: "a.example"
-- 5: "page"
-- 6: "/pricing"
-- 7: ""
-- 8: ""
-- 9: "G1"
-- 10: 3
-- 11: 1
-- 12: 2
-- 13: 2
-- 14: 1
-- 15: 0
-- 16: 9000
-- 17: 4000
-- 18: 80
-- 19: 2
-- 20: 0
-- 21: 0
-- 22: 0
-- 23: 1
-- 24: 2

DELETE FROM "analytics"."analytics_aggregates"
		WHERE "id" IN (SELECT "id" FROM "analytics"."analytics_aggregates"
			WHERE "scope" = $1 AND "day" = $2
			AND "dim" IN ($3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
			AND "dim2" IN ($24, $25, $26, $27, $28)
				AND "gen" IN ($29)
			LIMIT 2000)

-- parameters
-- 1: "tenant-a"
-- 2: 20261006
-- 3: ""
-- 4: "referrer"
-- 5: "source"
-- 6: "channel"
-- 7: "utmSource"
-- 8: "utmMedium"
-- 9: "utmCampaign"
-- 10: "utmContent"
-- 11: "utmTerm"
-- 12: "country"
-- 13: "region"
-- 14: "city"
-- 15: "language"
-- 16: "device"
-- 17: "browser"
-- 18: "os"
-- 19: "page"
-- 20: "event"
-- 21: "currency"
-- 22: "goal"
-- 23: "item"
-- 24: ""
-- 25: "channel"
-- 26: "source"
-- 27: "utmCampaign"
-- 28: "page"
-- 29: "G0"

DELETE FROM "analytics"."analytics_aggregates"
		WHERE "id" IN (SELECT "id" FROM "analytics"."analytics_aggregates"
			WHERE "scope" = $1 AND "day" = $2
			AND "dim" IN ($3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
			AND "dim2" IN ($24, $25, $26, $27, $28)
				AND "gen" <> $29
			LIMIT 2000)

-- parameters
-- 1: "tenant-a"
-- 2: 20261006
-- 3: ""
-- 4: "referrer"
-- 5: "source"
-- 6: "channel"
-- 7: "utmSource"
-- 8: "utmMedium"
-- 9: "utmCampaign"
-- 10: "utmContent"
-- 11: "utmTerm"
-- 12: "country"
-- 13: "region"
-- 14: "city"
-- 15: "language"
-- 16: "device"
-- 17: "browser"
-- 18: "os"
-- 19: "page"
-- 20: "event"
-- 21: "currency"
-- 22: "goal"
-- 23: "item"
-- 24: ""
-- 25: "channel"
-- 26: "source"
-- 27: "utmCampaign"
-- 28: "page"
-- 29: "G1"
