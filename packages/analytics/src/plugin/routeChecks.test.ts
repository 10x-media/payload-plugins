import { describe, expect, it } from 'vitest'
import { assertRoutesReachable, samplePath, shadowedRoute } from './routeChecks'
import { DEFAULT_ROUTE_BASE, isPluginEndpoint, pluginEndpoint, routePaths } from './routes'

const routes = routePaths(DEFAULT_ROUTE_BASE)

const ours = [
	pluginEndpoint({ method: 'get', path: routes.query }),
	pluginEndpoint({ method: 'post', path: routes.ingest }),
	pluginEndpoint({ method: 'get', path: routes.proxyPattern }),
	pluginEndpoint({ method: 'get', path: routes.flagsPattern }),
]

describe('samplePath', () => {
	it('fills every parameter, a repeated one included', () => {
		expect(samplePath('/_x/query')).toBe('/_x/query')
		expect(samplePath(routes.flagsPattern)).toBe('/_x/flags/sample')
		expect(samplePath(routes.proxyPattern)).toBe('/_x/p/sample/sample')
	})
})

describe('pluginEndpoint', () => {
	it("marks an endpoint as the plugin's, keeping its own custom data", () => {
		const marked = pluginEndpoint({ method: 'get', path: '/x', custom: { owner: 'host' } })
		expect(isPluginEndpoint(marked)).toBe(true)
		expect(marked.custom).toMatchObject({ owner: 'host' })
		expect(isPluginEndpoint({ method: 'get', path: '/x' })).toBe(false)
	})
})

describe('shadowedRoute', () => {
	it.each([
		['a catch-all', { method: 'get', path: '/:anything*' }, routes.query],
		['a pattern over the base', { method: 'get', path: '/_x/:rest*' }, routes.query],
		['the same path', { method: 'post', path: '/_x/e' }, routes.ingest],
		['a pattern over the flags', { method: 'get', path: '/_x/flags/:code' }, routes.flagsPattern],
	])('names %s registered before the plugin', (_label, earlier, path) => {
		expect(shadowedRoute([earlier, ...ours])).toEqual({
			earlier,
			ours: expect.objectContaining({ path }),
		})
	})

	it('lets an earlier endpoint through when its method or path differs', () => {
		expect(
			shadowedRoute([
				{ method: 'post', path: '/_x/query' },
				{ method: 'get', path: '/_x/other' },
				{ method: 'GET', path: '/:anything*' },
				...ours,
			])
		).toBeUndefined()
	})

	it('ignores endpoints registered after the plugin, which Payload never reaches first', () => {
		expect(shadowedRoute([...ours, { method: 'get', path: '/:anything*' }])).toBeUndefined()
	})
})

describe('assertRoutesReachable', () => {
	it('refuses an earlier endpoint that takes a plugin route, naming both', () => {
		expect(() =>
			assertRoutesReachable(DEFAULT_ROUTE_BASE, {
				collections: [],
				endpoints: [{ method: 'get', path: '/:anything*' }, ...ours],
			})
		).toThrow(
			/root endpoint "GET \/:anything\*" is registered before the plugin's "\/_x\/query".*routes\.base/
		)
	})

	it('refuses a collection named like the base, as before', () => {
		expect(() =>
			assertRoutesReachable(DEFAULT_ROUTE_BASE, { collections: [{ slug: '_x' }], endpoints: ours })
		).toThrow(/"_x" collection's slug is the first segment of routes\.base/)
	})

	it('passes an install where nothing comes between Payload and the plugin', () => {
		expect(() =>
			assertRoutesReachable(DEFAULT_ROUTE_BASE, {
				collections: [{ slug: 'users' }],
				endpoints: [{ method: 'get', path: '/health' }, ...ours],
			})
		).not.toThrow()
		expect(() =>
			assertRoutesReachable(DEFAULT_ROUTE_BASE, { collections: [], endpoints: false })
		).not.toThrow()
	})
})
