import type { PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import { readError } from './errors'
import { makeFlagsHandler } from './flagsEndpoint'
import { DEFAULT_ROUTE_BASE, routePaths } from './routes'

const handler = makeFlagsHandler()

const req = (code?: string): PayloadRequest =>
	({ routeParams: code === undefined ? {} : { code } }) as unknown as PayloadRequest

const answer = async (code?: string): Promise<Response> => await handler(req(code))

describe('flags endpoint', () => {
	it('mounts one code under the flags path', () => {
		const routes = routePaths(DEFAULT_ROUTE_BASE)
		expect(routes.flagsPattern).toBe(`${routes.flags}/:code`)
	})

	it('serves the SVG for a known code', async () => {
		const res = await answer('DE')
		expect(res.status).toBe(200)
		const body = await res.text()
		expect(body.startsWith('<svg')).toBe(true)
		expect(body).toContain('viewBox')
	})

	it('reads a lower-case code and an optional .svg suffix as the same flag', async () => {
		const [upper, lower, suffixed] = await Promise.all([
			answer('DE').then((res) => res.text()),
			answer('de').then((res) => res.text()),
			answer('de.svg').then((res) => res.text()),
		])
		expect(lower).toBe(upper)
		expect(suffixed).toBe(upper)
	})

	it('answers with immutable, sniff-proof, script-free SVG headers', async () => {
		const res = await answer('de.svg')
		expect(res.headers.get('content-type')).toBe('image/svg+xml; charset=utf-8')
		expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
		expect(res.headers.get('x-content-type-options')).toBe('nosniff')
		expect(res.headers.get('content-security-policy')).toBe(
			"default-src 'none'; style-src 'unsafe-inline'"
		)
	})

	it('answers 404 through the error envelope for a code with no flag', async () => {
		const res = await answer('zz')
		expect(res.status).toBe(404)
		expect(readError(await res.json())?.code).toBe('not_found')
		// A miss is never cached: only the artwork is immutable.
		expect(res.headers.get('cache-control')).toBe('private, no-store')
	})

	it('answers 400 through the error envelope for anything that is not two letters', async () => {
		for (const bad of ['DEU', 'D1', '', '..svg', '../../etc/passwd']) {
			const res = await answer(bad)
			expect(res.status).toBe(400)
			const error = readError(await res.json())
			expect(error?.code).toBe('invalid_param')
			expect(error?.param).toBe('code')
		}
	})

	it('answers 400 when the route matched no code at all', async () => {
		expect((await answer()).status).toBe(400)
	})
})
