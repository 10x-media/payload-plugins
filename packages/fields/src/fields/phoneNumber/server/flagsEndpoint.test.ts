import { describe, expect, it, vi } from 'vitest'
import { makeFlagsHandler } from './flagsEndpoint'

const call = (code: unknown) =>
	makeFlagsHandler()({ routeParams: { code } } as never) as Promise<Response>

describe('flags handler', () => {
	it('serves an SVG for a known country', async () => {
		const res = await call('de')
		expect(res.status).toBe(200)
		expect(res.headers.get('Content-Type')).toContain('image/svg+xml')
		expect(await res.text()).toContain('<svg')
	})

	it('accepts a .svg suffix riding inside the parameter', async () => {
		expect((await call('de.svg')).status).toBe(200)
	})

	it('is case insensitive', async () => {
		expect((await call('DE')).status).toBe(200)
	})

	it('caches immutably, since the URL is the version', async () => {
		expect((await call('de')).headers.get('Cache-Control')).toContain('immutable')
	})

	it('denies script in the SVG document and blocks sniffing', async () => {
		const res = await call('de')
		expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'none'")
		expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
	})

	it('rejects a malformed code before loading any artwork', async () => {
		expect((await call('toolong')).status).toBe(400)
		expect((await call('')).status).toBe(400)
		expect((await call(undefined)).status).toBe(400)
	})

	it('404s a well-formed code with no flag', async () => {
		expect((await call('zz')).status).toBe(404)
	})

	// Status alone doesn't prove ordering: load-then-validate would pass it too.
	// This mocks the dependency to prove the import never runs on bad input.
	it('never imports the flag artwork module for a malformed code', async () => {
		vi.resetModules()
		const load = vi.fn(() => ({ DE: '<svg>mock</svg>' }))
		vi.doMock('country-flag-icons/string/3x2', load)
		try {
			const fresh = await import('./flagsEndpoint')
			const badRes = await fresh.makeFlagsHandler()({
				routeParams: { code: 'toolong' },
			} as never)
			expect(badRes.status).toBe(400)
			expect(load).not.toHaveBeenCalled()

			const goodRes = await fresh.makeFlagsHandler()({
				routeParams: { code: 'de' },
			} as never)
			expect(goodRes.status).toBe(200)
			expect(load).toHaveBeenCalled()
		} finally {
			vi.doUnmock('country-flag-icons/string/3x2')
			vi.resetModules()
		}
	})
})
