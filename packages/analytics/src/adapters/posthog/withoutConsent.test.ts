import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import type { Config } from 'payload'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { AdapterRegisterContext, AnalyticsQuery } from '../../core/contract'
import { type PosthogConfig, posthog } from './posthog'
import { forgetProjectChecks } from './projectCheck'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
	server.resetHandlers()
	forgetProjectChecks()
})
afterAll(() => server.close())

const QUERY = 'https://us.posthog.com/api/projects/123/query/'
const PROJECT = 'https://us.posthog.com/api/projects/123/'
const COOKIELESS = "countIf(toString(properties.$cookieless_mode) = 'true') AS c"
const PAGEVIEW_COOKIELESS =
	"countIf(event = '$pageview' AND toString(properties.$cookieless_mode) = 'true') AS c"

const q = (over: Partial<AnalyticsQuery> = {}): AnalyticsQuery => ({
	metrics: ['pageviews', 'visitors', 'sessions'],
	dateRange: { start: new Date('2026-01-01T00:00:00Z'), end: new Date('2026-01-31T00:00:00Z') },
	...over,
})

/** Answers every HogQL query with `row`, keeping each query's SQL. */
const answering = (row: unknown[]): string[] => {
	const sqls: string[] = []
	server.use(
		http.post(QUERY, async ({ request }) => {
			const body = (await request.json()) as { query?: { query?: string } }
			sqls.push(body.query?.query ?? '')
			return HttpResponse.json({ columns: [], types: [], results: [row] })
		})
	)
	return sqls
}

const reader = () => posthog({ projectId: '123', apiKey: 'phx_k' })

describe('posthog reads counted without consent', () => {
	it('counts the pageviews counted without consent on the totals query itself', async () => {
		const sqls = answering([1000, 400, 300, 380])
		const result = await reader().query(q(), {})
		expect(sqls).toHaveLength(1)
		expect(sqls[0]).toContain(`, ${COOKIELESS} FROM events`)
		expect(result.totals).toEqual({ pageviews: 1000, visitors: 400, sessions: 300 })
		expect(result.meta.withoutConsent).toEqual({ pageviews: 380 })
	})

	it('says visitors are counted per day when the range holds cookieless pageviews', async () => {
		answering([1000, 400, 300, 1])
		expect((await reader().query(q(), {})).meta.visitorsAre).toBe('sumOfDaily')
	})

	it('says nothing more when no pageview was counted without consent', async () => {
		answering([1000, 400, 300, 0])
		const { meta } = await reader().query(q(), {})
		expect(meta.visitorsAre).toBeUndefined()
		expect(meta.withoutConsent).toBeUndefined()
	})

	it('counts only pageviews when the read scans every event', async () => {
		const sqls = answering([50, 20, 9])
		const result = await reader().query(q({ metrics: ['pageviews', 'events'] }), {})
		expect(sqls[0]).toContain(PAGEVIEW_COOKIELESS)
		expect(result.meta.withoutConsent).toEqual({ pageviews: 9 })
	})

	it('adds nothing to a read that needs neither the flag nor the count', async () => {
		const sqls = answering([50])
		const result = await reader().query(q({ metrics: ['events'] }), {})
		expect(sqls[0]).not.toContain('$cookieless_mode')
		expect(result.meta.withoutConsent).toBeUndefined()
	})

	it('flags a breakdown with visitors from its rows, without a range count', async () => {
		const sqls = answering(['/', 10, 4, 2])
		const result = await reader().query(
			q({ metrics: ['pageviews', 'visitors'], dimensions: ['page'] }),
			{}
		)
		expect(sqls[0]).toContain(`, ${COOKIELESS} FROM events`)
		expect(result.rows).toEqual([
			{ dimensions: { page: '/' }, metrics: { pageviews: 10, visitors: 4 } },
		])
		expect(result.meta.visitorsAre).toBe('sumOfDaily')
		expect(result.meta.withoutConsent).toBeUndefined()
	})

	it('leaves a pageview-only breakdown as it was', async () => {
		const sqls = answering(['/', 10])
		await reader().query(q({ metrics: ['pageviews'], dimensions: ['page'] }), {})
		expect(sqls[0]).not.toContain('$cookieless_mode')
	})

	it('reads the flag from the totals of a series, never a query of its own', async () => {
		const sqls: string[] = []
		server.use(
			http.post(QUERY, async ({ request }) => {
				const body = (await request.json()) as { query?: { query?: string } }
				const sql = body.query?.query ?? ''
				sqls.push(sql)
				return HttpResponse.json({
					columns: [],
					types: [],
					results: sql.includes('GROUP BY day') ? [['2026-01-01 00:00:00', 10, 7]] : [[10, 7, 3]],
				})
			})
		)
		const result = await reader().query(
			q({ metrics: ['pageviews', 'visitors'], granularity: 'day' }),
			{}
		)
		expect(sqls).toHaveLength(2)
		expect(sqls.find((sql) => sql.includes('GROUP BY day'))).not.toContain('$cookieless_mode')
		expect(result.rows[0]?.metrics).toEqual({ pageviews: 10, visitors: 7 })
		expect(result.meta).toMatchObject({
			visitorsAre: 'sumOfDaily',
			withoutConsent: { pageviews: 3 },
		})
	})
})

describe('posthog project check', () => {
	/** Answers the project's settings with `answer`, counting the requests. */
	const project = (answer: () => Response): { calls: number } => {
		const seen = { calls: 0 }
		server.use(
			http.get(PROJECT, ({ request }) => {
				expect(request.headers.get('authorization')).toBe('Bearer phx_k')
				seen.calls += 1
				return answer()
			})
		)
		return seen
	}

	const capturing = (over: Partial<PosthogConfig> = {}) =>
		posthog({ projectId: '123', apiKey: 'phx_k', projectToken: 'phc_t', ...over })

	const registerWith = (adapterCountsWithoutConsent: boolean): AdapterRegisterContext => ({
		scoped: false,
		resolveScope: async () => null,
		resolveTimezone: async () => 'UTC',
		resolveTimezoneStrict: async () => 'UTC',
		revenue: { enabled: true, dimension: true, currency: async () => undefined },
		resolveGoals: async () => [],
		adapterCountsWithoutConsent,
	})

	it('says PostHog drops what is counted without consent while the setting is off', async () => {
		answering([10, 4, 3, 0])
		const seen = project(() => HttpResponse.json({ id: 123, cookieless_server_hash_mode: 0 }))
		const adapter = capturing()
		expect((await adapter.query(q(), {})).meta.withoutConsentDropped).toBe(true)
		await adapter.query(q(), {})
		expect(seen.calls).toBe(1)
	})

	it('reads a project that never set it as off', async () => {
		answering([10, 4, 3, 0])
		project(() => HttpResponse.json({ id: 123, cookieless_server_hash_mode: null }))
		expect((await capturing().query(q(), {})).meta.withoutConsentDropped).toBe(true)
	})

	it('says nothing while the setting is on', async () => {
		answering([10, 4, 3, 0])
		project(() => HttpResponse.json({ id: 123, cookieless_server_hash_mode: 2 }))
		expect((await capturing().query(q(), {})).meta.withoutConsentDropped).toBeUndefined()
	})

	it('keeps reading when the check fails, and says nothing', async () => {
		answering([10, 4, 3, 0])
		project(() => HttpResponse.json({ detail: 'missing scope project:read' }, { status: 403 }))
		const result = await capturing().query(q(), {})
		expect(result.totals).toEqual({ pageviews: 10, visitors: 4, sessions: 3 })
		expect(result.meta.withoutConsentDropped).toBeUndefined()
	})

	it('asks again once an answer is an hour old, and a few minutes after a failure', async () => {
		answering([10, 4, 3, 0])
		let fail = true
		const seen = project(() =>
			fail
				? HttpResponse.json({}, { status: 503 })
				: HttpResponse.json({ cookieless_server_hash_mode: 0 })
		)
		const adapter = capturing()
		const at = (iso: string) => ({ now: () => new Date(iso) })
		await adapter.query(q(), at('2026-02-01T10:00:00Z'))
		await adapter.query(q(), at('2026-02-01T10:04:00Z'))
		expect(seen.calls).toBe(1)
		fail = false
		const retried = await adapter.query(q(), at('2026-02-01T10:05:00Z'))
		expect(retried.meta.withoutConsentDropped).toBe(true)
		await adapter.query(q(), at('2026-02-01T11:04:00Z'))
		expect(seen.calls).toBe(2)
		await adapter.query(q(), at('2026-02-01T11:05:00Z'))
		expect(seen.calls).toBe(3)
	})

	it('skips the check where nothing is counted without consent', async () => {
		answering([10, 4, 3, 0])
		const seen = project(() => HttpResponse.json({ cookieless_server_hash_mode: 0 }))
		await posthog({ projectId: '123', apiKey: 'phx_k' }).query(q(), {})
		await capturing({ withoutConsent: 'off' }).query(q(), {})
		const strictInstall = capturing()
		strictInstall.register?.({} as Config, registerWith(false))
		await strictInstall.query(q(), {})
		expect(seen.calls).toBe(0)
	})

	it('skips the check for a source the boot says fills no slot counting without consent', async () => {
		answering([10, 4, 3, 0])
		const seen = project(() => HttpResponse.json({ cookieless_server_hash_mode: 0 }))
		const opted = capturing({ withoutConsent: 'cookieless' })
		opted.register?.({} as Config, registerWith(false))
		await opted.query(q(), {})
		expect(seen.calls).toBe(0)
		const counting = capturing({ withoutConsent: 'cookieless' })
		counting.register?.({} as Config, registerWith(true))
		expect((await counting.query(q(), {})).meta.withoutConsentDropped).toBe(true)
	})

	it('asks once per project however many adapters read it, as providers.resolve builds per read', async () => {
		answering([10, 4, 3, 0])
		const seen = project(() => HttpResponse.json({ cookieless_server_hash_mode: 2 }))
		for (let read = 0; read < 3; read++) {
			await capturing().query(q(), {})
		}
		expect(seen.calls).toBe(1)
	})
})
