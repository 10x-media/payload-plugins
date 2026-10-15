import type { Payload, PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import type { AdapterLabelArgs, AnalyticsAdapter } from '../core/contract'
import { createRegistry } from '../core/registry'
import { adapterLabel } from '../core/sourceLabel'
import type { SourcesResponse } from '../fields/config/fetchSources'
import type { QueryResponse } from '../query/response'
import { memoryAdapter } from '../testing/memoryAdapter'
import { makeQueryHandler } from './queryEndpoint'
import { type AnalyticsRuntime, setRuntime } from './runtime'
import { makeSourcesHandler } from './sourcesEndpoint'

const labelled = (option: Parameters<typeof adapterLabel>[0]): AnalyticsAdapter => {
	const base = memoryAdapter()
	return {
		...base,
		capabilities: { ...base.capabilities, scopedQueries: true },
		...adapterLabel(option, 'Memory', 'memory({ label })'),
	}
}

const reqFor = (
	adapter: AnalyticsAdapter,
	args: { language?: string; url?: string; scope?: string } = {}
): PayloadRequest => {
	const { scope } = args
	const payload = { logger: { warn: vi.fn() } } as unknown as Payload
	const runtime: AnalyticsRuntime = {
		registry: createRegistry([adapter]),
		configAdapterIds: new Set([adapter.id]),
		bindings: {},
		readAccess: () => true,
		engine: { read: async (source, query) => source.query(query, {}) },
		ttl: {},
		comparison: true,
		...(scope ? { scoped: true, resolveScope: async () => scope, member: () => true } : {}),
	}
	setRuntime(payload, runtime)
	return {
		user: { id: 1 },
		payload,
		i18n: { language: args.language ?? 'en' },
		url: args.url ?? '/api/_x/sources',
	} as unknown as PayloadRequest
}

const listed = async (req: PayloadRequest): Promise<string[]> => {
	const body = (await (await makeSourcesHandler()(req)).json()) as SourcesResponse
	return body.sources.map((source) => source.label)
}

describe('source labels a reader sees', () => {
	it('lists a source under its plain label when it names none per reader', async () => {
		expect(await listed(reqFor(memoryAdapter()))).toEqual([memoryAdapter().label])
	})

	it('lists a mapped label in the reader language', async () => {
		const adapter = labelled({ en: 'Traffic', de: 'Verkehr' })
		expect(await listed(reqFor(adapter, { language: 'de' }))).toEqual(['Verkehr'])
		expect(await listed(reqFor(adapter, { language: 'es' }))).toEqual(['Traffic'])
	})

	it('lists what the label function names for the reader scope', async () => {
		const labelFor = vi.fn(({ scope }: AdapterLabelArgs) => `${scope} analytics`)
		expect(await listed(reqFor(labelled(labelFor), { scope: 'paddle' }))).toEqual([
			'paddle analytics',
		])
		expect(labelFor).toHaveBeenCalledWith(expect.objectContaining({ scope: 'paddle' }))
	})

	it('lists the plain label when the function fails', async () => {
		const adapter = labelled(() => {
			throw new Error('down')
		})
		expect(await listed(reqFor(adapter))).toEqual(['Memory'])
	})

	it('names the source a query answered through by the same label', async () => {
		const adapter = labelled({ en: 'Traffic', de: 'Verkehr' })
		const req = reqFor(adapter, {
			language: 'de',
			url: '/api/_x/query?metrics=pageviews&from=2026-09-01&to=2026-09-07',
		})
		const res = await makeQueryHandler()(req)
		expect(res.status).toBe(200)
		const body = (await res.json()) as QueryResponse
		expect(body.source.label).toBe('Verkehr')
	})
})
