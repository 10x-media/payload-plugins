import type { PayloadRequest } from 'payload'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { allCrossScope, resolveOptions } from '../core/options'
import { getRuntime, setRuntime } from '../plugin/runtime'
import { memoryAdapter } from '../testing/memoryAdapter'
import { resolveViewProps } from './viewProps'

const adapter = () => {
	const base = memoryAdapter()
	return { ...base, capabilities: { ...base.capabilities, scopedQueries: true } }
}

const reqFor = (crossScope: boolean, member = true): PayloadRequest => {
	const payload = {
		logger: { warn: () => {} },
		config: { routes: { api: '/api', admin: '/admin' } },
	} as unknown as PayloadRequest['payload']
	setRuntime(payload, {
		registry: {
			get: () => adapter(),
			default: adapter,
			all: () => [adapter()],
			isMultiProvider: () => false,
		},
		configAdapterIds: new Set(['memory']),
		bindings: {},
		readAccess: () => true,
		engine: { read: async (a, q) => a.query(q, {}) },
		ttl: {},
		comparison: true,
		scoped: true,
		resolveScope: async () => 'alpha',
		member: () => member,
		scopeLabel: async () => 'Alpha GmbH',
		crossScope: allCrossScope(() => crossScope),
	})
	return { payload, user: { id: 1 }, i18n: { language: 'en' } } as unknown as PayloadRequest
}

const options = resolveOptions({
	adapters: [adapter()],
	scope: { resolve: () => 'alpha', member: () => true },
	access: { read: () => true },
})

describe('resolveViewProps scope authority', () => {
	it('names the request scope and its host label, whatever the URL asked for', async () => {
		const result = await resolveViewProps(reqFor(false), options, { scope: 'beta' })
		expect(result.denied).toBe(false)
		if (result.denied) return
		expect(result.props.scopeKey).toBe('alpha')
		expect(result.props.scopes?.own).toBe('alpha')
		expect(result.props.scopes?.ownLabel).toBe('Alpha GmbH')
		// Nothing for the client to write back: a named scope is not part of the address.
		expect(result.props.scopeParam).toBeUndefined()
	})

	it('serves the wildcard to an aggregate reader and keeps it in the address', async () => {
		const result = await resolveViewProps(reqFor(true), options, { scope: '*:alpha' })
		if (result.denied) return
		expect(result.props.scopeKey).toBe('*')
		expect(result.props.scopeParam).toBe('*:alpha')
		expect(result.props.scopes?.canAggregate).toBe(true)
	})

	// The host's own selector moved while the address stayed open: the aggregate was chosen for
	// alpha, so under beta it is dropped and the view falls back to beta's own numbers.
	it('drops an aggregate chosen from another tenant', async () => {
		const req = reqFor(true)
		const runtime = getRuntime(req.payload)
		if (runtime) runtime.resolveScope = async () => 'beta'
		const result = await resolveViewProps(req, options, { scope: '*:alpha' })
		if (result.denied) return
		expect(result.props.scopeKey).toBe('beta')
		expect(result.props.scopeParam).toBeUndefined()
	})

	// An untagged marker belongs to no tenant, so a reader who resolves one never keeps it.
	it('drops an untagged aggregate marker for a reader with a tenant of their own', async () => {
		const result = await resolveViewProps(reqFor(true), options, { scope: '*' })
		if (result.denied) return
		expect(result.props.scopeKey).toBe('alpha')
		expect(result.props.scopeParam).toBeUndefined()
	})

	// A tenant admin who follows an aggregate link still gets their own tenant's numbers, and
	// the client rewrites the address to say so rather than showing a refusal.
	it('degrades the wildcard to the reader own scope and drops it from the address', async () => {
		const result = await resolveViewProps(reqFor(false), options, { scope: '*:alpha' })
		if (result.denied) return
		expect(result.props.scopeKey).toBe('alpha')
		expect(result.props.scopeParam).toBeUndefined()
		expect(result.props.scopes?.canAggregate).toBe(false)
	})

	// A selector pointed at a tenant the user does not belong to reads nothing there, and the
	// caption does not name that tenant either.
	it('lists nothing for, and never names, a tenant the reader does not belong to', async () => {
		const result = await resolveViewProps(reqFor(false, false), options)
		expect(result.denied).toBe(false)
		if (result.denied) return
		expect(result.props.sources.sources).toEqual([])
		expect(result.props.scopeKey).toBe('')
		expect(result.props.scopes?.own).toBe('')
		expect(result.props.scopes?.ownLabel).toBeUndefined()
		expect(result.props.needsScope).toBeUndefined()
	})

	// Signed in with no site selected, a reader who may not read across sites is asked for one.
	it('asks a reader with no site selected to choose one', async () => {
		const req = reqFor(false)
		const runtime = getRuntime(req.payload)
		if (runtime) runtime.resolveScope = async () => null
		const result = await resolveViewProps(req, options)
		if (result.denied) return
		expect(result.props.sources.sources).toEqual([])
		expect(result.props.needsScope).toBe(true)
	})
})

describe('resolveViewProps exclusion', () => {
	it('offers no exclusion while the link is off', async () => {
		const result = await resolveViewProps(reqFor(false), options)
		if (result.denied) return
		expect(result.props.exclusion).toBeUndefined()
	})

	it("points the view at the exclusion endpoint under the app's routes", async () => {
		const linked = resolveOptions({
			adapters: [adapter()],
			scope: { resolve: () => 'alpha', member: () => true },
			access: { read: () => true },
			capture: { exclusion: {} },
		})
		const result = await resolveViewProps(reqFor(false), linked)
		if (result.denied) return
		expect(result.props.exclusion).toEqual({ endpoint: '/api/_x/exclusion' })
	})

	it('hands nothing to a reader access.view denies', async () => {
		const denied = resolveOptions({
			adapters: [adapter()],
			scope: { resolve: () => 'alpha', member: () => true },
			access: { read: () => true, view: () => false },
			capture: { exclusion: {} },
		})
		expect(await resolveViewProps(reqFor(false), denied)).toEqual({ denied: true })
	})

	it('names no goal and no scope to a reader access.view admits and access.read denies', async () => {
		const req = reqFor(false)
		const runtime = getRuntime(req.payload)
		if (runtime) {
			runtime.readAccess = () => false
			runtime.goals = [{ slug: 'signup', name: 'Signed up', match: { kind: 'goal' } }]
		}
		const result = await resolveViewProps(req, options)
		if (result.denied) return
		expect(result.props.goals).toEqual([])
		expect(result.props.scopes).toBeUndefined()
		expect(JSON.stringify(result.props)).not.toContain('Alpha GmbH')
	})
})

describe('resolveViewProps endpoints', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('hands the view every endpoint behind the Next basePath, the exclusion link included', async () => {
		vi.stubEnv('NEXT_BASE_PATH', '/docs')
		const linked = resolveOptions({
			adapters: [adapter()],
			scope: { resolve: () => 'alpha', member: () => true },
			access: { read: () => true },
			capture: { exclusion: {} },
		})
		const result = await resolveViewProps(reqFor(false), linked)
		if (result.denied) throw new Error('expected access')
		expect(result.props.endpoints).toEqual({
			query: '/docs/api/_x/query',
			refresh: '/docs/api/_x/refresh',
			live: '/docs/api/_x/live',
		})
		expect(result.props.exclusion).toEqual({ endpoint: '/docs/api/_x/exclusion' })
	})
})
