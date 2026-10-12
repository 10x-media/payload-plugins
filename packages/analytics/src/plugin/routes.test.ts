import { describe, expect, it } from 'vitest'
import {
	ANALYTICS_CONFIG_KEY,
	analyticsRoutes,
	assertRouteBaseUnshadowed,
	DEFAULT_ROUTE_BASE,
	isRouteBase,
	resolveRouteBase,
	routeBaseSegment,
	routePaths,
	shadowingCollection,
} from './routes'

describe('routePaths', () => {
	it('hangs every mount off the default base', () => {
		expect(routePaths(DEFAULT_ROUTE_BASE)).toEqual({
			base: '/_x',
			query: '/_x/query',
			document: '/_x/document',
			sources: '/_x/sources',
			goals: '/_x/goals',
			refresh: '/_x/refresh',
			live: '/_x/live',
			exclusion: '/_x/exclusion',
			ingest: '/_x/e',
			config: '/_x/config',
			proxy: '/_x/p',
			proxyPattern: '/_x/p/:slot/:path*',
			flags: '/_x/flags',
			flagsPattern: '/_x/flags/:code',
		})
	})

	it('moves every mount with the base, nested bases included', () => {
		const routes = routePaths('/stats/v1')
		for (const [key, path] of Object.entries(routes)) {
			expect(path.startsWith('/stats/v1'), key).toBe(true)
		}
		expect(routes.ingest).toBe('/stats/v1/e')
		expect(routes.proxyPattern).toBe('/stats/v1/p/:slot/:path*')
	})
})

describe('resolveRouteBase', () => {
	it('defaults when unset and keeps a well-formed base', () => {
		expect(resolveRouteBase(undefined)).toBe('/_x')
		expect(resolveRouteBase('/stats')).toBe('/stats')
		expect(resolveRouteBase('/a.b/c-d_e~f')).toBe('/a.b/c-d_e~f')
	})

	it.each([
		'',
		'/',
		'_x',
		'/_x/',
		'//x',
		'/a//b',
		'/:slot',
		'/x/*',
		'/x?y',
		'/x#y',
		'/café',
		'/.hidden',
		'/x/..',
	])('refuses %j, which Payload cannot route as plain segments', (base) => {
		expect(() => resolveRouteBase(base)).toThrow(/routes\.base must be a path of plain segments/)
	})

	it('refuses a value that is not a string', () => {
		expect(() => resolveRouteBase(42)).toThrow(/routes\.base must be a path.*got number/)
	})

	it('refuses a base Payload would read as a globals route', () => {
		expect(() => resolveRouteBase('/globals')).toThrow(/starts with "\/globals"/)
		expect(() => resolveRouteBase('/globalstats')).toThrow(/starts with "\/globals"/)
		expect(isRouteBase('/globals/x')).toBe(false)
	})

	it.each([
		'/constructor',
		'/__proto__/x',
		'/toString',
		'/hasOwnProperty',
		'/valueOf/stats',
	])('refuses %s, whose first segment every object carries', (base) => {
		expect(() => resolveRouteBase(base)).toThrow(/a name every JavaScript object carries/)
		expect(isRouteBase(base)).toBe(false)
	})

	it('keeps a base that only contains such a name further along', () => {
		expect(resolveRouteBase('/stats/constructor')).toBe('/stats/constructor')
	})
})

describe('shadowing', () => {
	it('compares only the first segment, and the whole of it', () => {
		expect(routeBaseSegment('/stats/v1')).toBe('stats')
		expect(shadowingCollection('/stats/v1', ['pages', 'stats'])).toBe('stats')
		expect(shadowingCollection('/stats/v1', ['v1', 'stat', 'statsx'])).toBeUndefined()
	})

	it('names the collection and the option when a slug takes the base', () => {
		expect(() => assertRouteBaseUnshadowed('/_x', ['users', '_x'])).toThrow(
			/"_x" collection's slug is the first segment of routes\.base "\/_x".*Set routes\.base/
		)
		expect(() => assertRouteBaseUnshadowed('/_x', ['users', 'analytics'])).not.toThrow()
	})
})

describe('analyticsRoutes', () => {
	const configWith = (entry: unknown) => ({ admin: { custom: { [ANALYTICS_CONFIG_KEY]: entry } } })

	it('reads the base the plugin left in admin.custom', () => {
		expect(analyticsRoutes(configWith({ routes: { base: '/stats' } })).query).toBe('/stats/query')
	})

	it('answers the default base for a config the plugin never touched', () => {
		expect(analyticsRoutes(undefined).query).toBe('/_x/query')
		expect(analyticsRoutes(null).config).toBe('/_x/config')
		expect(analyticsRoutes({}).ingest).toBe('/_x/e')
		expect(analyticsRoutes({ admin: {} }).live).toBe('/_x/live')
	})

	it.each([
		'oops',
		{},
		{ routes: null },
		{ routes: { base: 42 } },
		{ routes: { base: 'stats' } },
		{ routes: { base: '/globals' } },
	])('falls back to the default base for an unreadable entry %j', (entry) => {
		expect(analyticsRoutes(configWith(entry)).base).toBe(DEFAULT_ROUTE_BASE)
	})
})
