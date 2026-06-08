import { describe, expect, it } from 'vitest'
import { noopResolver } from '../geo/geoResolver'
import { makeIngestHandler } from './endpoint'

describe('makeIngestHandler', () => {
	it('returns 400 for an invalid body', async () => {
		const handler = makeIngestHandler(noopResolver)
		const res = await handler({
			headers: new Headers({ 'content-type': 'application/json' }),
			json: async () => ({}),
		} as never)
		expect(res.status).toBe(400)
	})
})
