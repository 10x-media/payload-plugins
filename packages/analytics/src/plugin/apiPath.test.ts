import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiPath, appPath } from './apiPath'

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('apiPath', () => {
	it("hangs a path off the app's routes.api, relative to the page's own origin", () => {
		expect(apiPath({ routes: { api: '/api' } }, '/_x/query')).toBe('/api/_x/query')
		expect(apiPath({ routes: { api: '/custom-api' } }, '/stats/live')).toBe(
			'/custom-api/stats/live'
		)
	})

	it('falls back to /api, and roots a path written without its slash', () => {
		expect(apiPath({}, '/_x/goals')).toBe('/api/_x/goals')
		expect(apiPath({ routes: {} }, '_x/goals')).toBe('/api/_x/goals')
	})

	it('puts the Next basePath withPayload publishes in front, a custom routes.api included', () => {
		vi.stubEnv('NEXT_BASE_PATH', '/docs')
		expect(apiPath({ routes: { api: '/api' } }, '/_x/query')).toBe('/docs/api/_x/query')
		expect(apiPath({ routes: { api: '/custom-api' } }, '/_x/e')).toBe('/docs/custom-api/_x/e')
	})
})

describe('appPath', () => {
	it('is the path itself without a basePath, and behind it with one', () => {
		expect(appPath('/ph')).toBe('/ph')
		vi.stubEnv('NEXT_BASE_PATH', '/docs')
		expect(appPath('/ph')).toBe('/docs/ph')
		expect(appPath('ph/ingest')).toBe('/docs/ph/ingest')
	})
})
