import { getDataLoader, type PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import { captureRequest } from './captureRequest'

/** A signed-in editor's browser, as Payload hands its beacon to an endpoint. */
const editorBeacon = (): PayloadRequest => {
	const request = new Request('https://beta.example.com/api/_x/e', {
		method: 'POST',
		headers: {
			cookie: 'payload-token=jwt; payload-tenant=alpha',
			authorization: 'JWT abc',
			host: 'beta.example.com',
			'user-agent': 'Mozilla/5.0',
			'x-forwarded-for': '203.0.113.7',
		},
	})
	return Object.assign(request, {
		payload: { config: {} },
		user: { id: 1, collection: 'users', email: 'editor@alpha.test' },
		context: { seen: true },
	}) as unknown as PayloadRequest
}

describe('captureRequest', () => {
	it('carries no user', () => {
		expect(captureRequest(editorBeacon()).user).toBeNull()
	})

	it('carries no cookie and no authorization header', () => {
		const visitor = captureRequest(editorBeacon())
		expect(visitor.headers.get('cookie')).toBeNull()
		expect(visitor.headers.get('authorization')).toBeNull()
	})

	it('keeps every other header, the host first among them', () => {
		const visitor = captureRequest(editorBeacon())
		expect(visitor.headers.get('host')).toBe('beta.example.com')
		expect(visitor.headers.get('user-agent')).toBe('Mozilla/5.0')
		expect(visitor.headers.get('x-forwarded-for')).toBe('203.0.113.7')
	})

	it('leaves the original request as it was', () => {
		const req = editorBeacon()
		captureRequest(req)
		expect(req.user).toMatchObject({ id: 1 })
		expect(req.headers.get('cookie')).toBe('payload-token=jwt; payload-tenant=alpha')
		expect(req.headers.get('authorization')).toBe('JWT abc')
	})

	it('reads everything else through to the original', () => {
		const req = editorBeacon()
		const visitor = captureRequest(req)
		expect(visitor.payload).toBe(req.payload)
		expect(visitor.context).toBe(req.context)
		expect(visitor.url).toBe('https://beta.example.com/api/_x/e')
		expect(visitor.method).toBe('POST')
	})

	it("loads documents through a dataloader of its own, never the signed-in user's", () => {
		const req = editorBeacon()
		req.payloadDataLoader = getDataLoader(req)
		const visitor = captureRequest(req)
		expect(visitor.payloadDataLoader).toBeDefined()
		expect(visitor.payloadDataLoader).not.toBe(req.payloadDataLoader)
	})

	it('strips a request once however many capture call sites hand it on', () => {
		const visitor = captureRequest(editorBeacon())
		expect(captureRequest(visitor)).toBe(visitor)
	})
})
