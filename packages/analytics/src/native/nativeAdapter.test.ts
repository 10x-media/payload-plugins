import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'
import { type NativeOptions, native } from './nativeAdapter'
import { PRUNE_TASK_SLUG } from './retention/pruneTask'

const registeredTasks = (options: NativeOptions = {}): string[] => {
	const config = {} as Config
	native(options).register?.(config)
	return (config.jobs?.tasks ?? []).map((task) => task.slug)
}

describe('native adapter', () => {
	it('advertises visitors, sessions, and the country dimension', () => {
		const caps = native().capabilities
		expect(caps.metrics.has('pageviews')).toBe(true)
		expect(caps.metrics.has('visitors')).toBe(true)
		expect(caps.metrics.has('sessions')).toBe(true)
		expect(caps.dimensions.has('country')).toBe(true)
	})

	it('serves and filters every dimension the tracker can know', () => {
		const caps = native().capabilities
		for (const dimension of [
			'referrer',
			'region',
			'city',
			'browser',
			'os',
			'language',
			'utmSource',
			'utmMedium',
			'utmCampaign',
			'utmContent',
			'utmTerm',
		] as const) {
			expect(caps.dimensions.has(dimension)).toBe(true)
			expect(caps.filters.has(dimension)).toBe(true)
		}
		expect([...caps.filterOperators].sort()).toEqual(['contains', 'eq'])
	})

	it('is configured', () => {
		expect(native().isConfigured()).toBe(true)
	})

	it('throws when queried before init', async () => {
		await expect(
			native().query(
				{ metrics: ['pageviews'], dateRange: { start: new Date(), end: new Date() } },
				{}
			)
		).rejects.toThrow(/before init/i)
	})

	it('still constructs with a (possibly missing) geo database path', () => {
		expect(typeof native({ geoDbPath: '/nonexistent/GeoLite2-City.mmdb' }).query).toBe('function')
	})
})

describe('native retention options', () => {
	// A task registers the payload-jobs collection and, with a schedule, the stats global, so an
	// install that asked for no retention must not be handed jobs it never configured.
	it('registers the prune task only once a retention window is configured', () => {
		expect(registeredTasks()).not.toContain(PRUNE_TASK_SLUG)
		expect(registeredTasks({ retentionDays: 0 })).not.toContain(PRUNE_TASK_SLUG)
		expect(registeredTasks({ retentionDays: 30 })).toContain(PRUNE_TASK_SLUG)
		expect(registeredTasks({ retentionDays: 30, rollupRetentionDays: 365 })).toContain(
			PRUNE_TASK_SLUG
		)
	})

	it('leaves the jobs config untouched on an install with no retention window', () => {
		const config = {} as Config
		native().register?.(config)
		expect(config.jobs).toBeUndefined()
	})

	it('rejects a rollup window that is not a whole number of days above zero', () => {
		for (const rollupRetentionDays of [0, -1, 1.5, Number.NaN]) {
			expect(() => native({ retentionDays: 1, rollupRetentionDays })).toThrow(/rollupRetentionDays/)
		}
	})

	it('rejects a rollup window without a raw-event window', () => {
		expect(() => native({ rollupRetentionDays: 365 })).toThrow(
			/rollupRetentionDays requires retentionDays/
		)
		expect(() => native({ retentionDays: 0, rollupRetentionDays: 365 })).toThrow(
			/rollupRetentionDays requires retentionDays/
		)
	})

	it('rejects a rollup window shorter than the raw-event window', () => {
		expect(() => native({ retentionDays: 90, rollupRetentionDays: 30 })).toThrow(
			/rollupRetentionDays/
		)
		expect(() => native({ retentionDays: 90, rollupRetentionDays: 90 })).not.toThrow()
	})
})

describe('native capture', () => {
	it('declares no proxy routes and no snippet scripts', () => {
		const capture = native().capture
		expect(capture?.proxy.routes).toEqual([])
		expect(capture?.snippet({ path: '/na' })).toEqual({ scripts: [] })
	})

	it('client is just the native kind, no ingestPath', () => {
		const capture = native({ ingestPath: '/custom/ingest' }).capture
		expect(capture?.client).toEqual({ kind: 'native' })
		expect(JSON.parse(JSON.stringify(capture?.client))).toEqual({ kind: 'native' })
	})

	it('declares where its ingest endpoint listens, default and overridden', () => {
		expect(native().ingest?.path).toBe('/analytics/ingest')
		expect(native({ ingestPath: '/custom/ingest' }).ingest?.path).toBe('/custom/ingest')
	})

	it('accepts server events alongside the endpoint', () => {
		expect(typeof native().ingest?.track).toBe('function')
	})
})
