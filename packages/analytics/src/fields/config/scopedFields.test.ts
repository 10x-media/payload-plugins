import type { Payload, PayloadRequest } from 'payload'
import type { ReactElement } from 'react'
import { renderToReadableStream } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { createRegistry } from '../../core/registry'
import { GoalSelectFieldServer } from '../../goals/GoalSelectFieldServer'
import { setRuntime } from '../../plugin/runtime'
import { memoryAdapter } from '../../testing/memoryAdapter'
import {
	FilterValueFieldServer,
	MetricSelectFieldServer,
	SourceSelectFieldServer,
} from './scopedFields'

/** Stands in for a client picker: what it was handed, and the token its context carries. */
const { picker } = vi.hoisted(() => ({
	picker: async (name: string) => {
		const { createElement: element } = await import('react')
		const { useScopeToken: token } = await import('../../ui/data/scopeTokenContext')
		return (props: Record<string, unknown>) =>
			element('output', {
				'data-name': name,
				'data-token': token() ?? 'none',
				'data-props': Object.keys(props).sort().join(','),
				'data-field': typeof props.field === 'object' && props.field ? 'client' : 'missing',
			})
	},
}))

vi.mock('./SourceSelectField', async () => ({ SourceSelectField: await picker('source') }))
vi.mock('./MetricSelectField', async () => ({ MetricSelectField: await picker('metric') }))
vi.mock('./FilterValueField', async () => ({ FilterValueField: await picker('value') }))
vi.mock('../../goals/GoalSelectField', async () => ({ GoalSelectField: await picker('goal') }))

const requestFor = (tenant: string): PayloadRequest => {
	const payload = { secret: 'test-secret', logger: { warn: () => {} } } as unknown as Payload
	setRuntime(payload, {
		registry: createRegistry([memoryAdapter()]),
		configAdapterIds: new Set(['memory']),
		bindings: {},
		readAccess: () => true,
		engine: { read: (adapter, query) => adapter.query(query, {}) },
		ttl: {},
		comparison: false,
		scoped: true,
		resolveScope: async (req) => req.headers.get('x-tenant'),
	})
	return {
		payload,
		user: { id: 7, collection: 'users' },
		headers: new Headers({ 'x-tenant': tenant }),
	} as unknown as PayloadRequest
}

/** What Payload hands a field server component: every client prop beside server-only ones. */
const serverProps = (req: PayloadRequest) => ({
	req,
	payload: req.payload,
	user: req.user,
	i18n: {},
	data: {},
	siblingData: {},
	formState: {},
	preferences: {},
	fieldSchemaMap: new Map(),
	clientFieldSchemaMap: new Map(),
	collectionSlug: 'campaigns',
	operation: 'update',
	value: 'x',
	id: 1,
	field: { name: 'goal', type: 'text', validate: () => true },
	clientField: { name: 'goal', type: 'text' },
	path: 'goal',
	schemaPath: 'goal',
	readOnly: false,
	permissions: true,
	sourceFieldPath: 'source',
})

const render = async (element: ReactElement): Promise<string> => {
	const stream = await renderToReadableStream(element)
	return new Response(stream).text()
}

const tokenIn = (html: string): string => /data-token="([^"]*)"/.exec(html)?.[1] ?? ''

describe('the pickers server side', () => {
	const cases = [
		['source', SourceSelectFieldServer],
		['metric', MetricSelectFieldServer],
		['value', FilterValueFieldServer],
		['goal', GoalSelectFieldServer],
	] as const

	it.each(
		cases
	)('hands the %s picker its client props alone and the request scope token', async (_name, Field) => {
		const html = await render(Field(serverProps(requestFor('alpha')) as never))
		expect(tokenIn(html)).toMatch(/^[A-Za-z0-9_-]{43}$/)
		expect(html).toContain('data-field="client"')
		expect(html).toContain(
			'data-props="field,path,permissions,readOnly,schemaPath,sourceFieldPath"'
		)
	})

	// The tenant lives in a cookie the page cannot read (HttpOnly): the server tells them apart.
	it('keys each tenant apart where the page sees the same cookies', async () => {
		const as = async (tenant: string) =>
			tokenIn(await render(GoalSelectFieldServer(serverProps(requestFor(tenant)) as never)))
		expect(await as('alpha')).toBe(await as('alpha'))
		expect(await as('alpha')).not.toBe(await as('beta'))
	})
})
