import type { PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import { noopResolver } from '../geo/geoResolver'
import type { HitRow } from '../store/types'
import { makeIngestHandler } from './endpoint'

const VISITOR_UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

const req = (): PayloadRequest =>
	Object.assign(
		new Request('http://localhost/api/_x/e', {
			method: 'POST',
			body: JSON.stringify({ type: 'pageview', path: '/home' }),
			headers: {
				'content-type': 'application/json',
				host: 'site.example',
				'user-agent': VISITOR_UA,
			},
		}),
		{ payload: { logger: { warn: () => {} } } }
	) as unknown as PayloadRequest

const handlerWith = (granted: boolean) => {
	const hits: HitRow[] = []
	const handler = makeIngestHandler({
		geoResolver: noopResolver,
		target: () => ({
			salts: {
				forHit: async () => ({ day: 20261006, tz: 'UTC', salt: 'salt' }),
				forDay: async () => 'salt',
			},
			writer: {
				write: async (hit) => {
					hits.push(hit)
					return undefined
				},
			},
		}),
		resolvers: { scope: async () => 'alpha', granted: async () => granted },
	})
	return { handler, hits }
}

describe('ingest native grant', () => {
	it('stores a beacon for a scope whose provider documents grant native', async () => {
		const { handler, hits } = handlerWith(true)
		expect((await handler(req())).status).toBe(202)
		expect(hits).toHaveLength(1)
		expect(hits[0]?.scope).toBe('alpha')
	})

	// Turning native off for one tenant must look exactly like every other outcome on this
	// public path, or the response becomes a way to enumerate which tenants exist.
	it('drops it for a scope with no native document, answering the same 202', async () => {
		const { handler, hits } = handlerWith(false)
		expect((await handler(req())).status).toBe(202)
		expect(hits).toHaveLength(0)
	})
})
