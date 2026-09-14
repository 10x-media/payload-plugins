import type { Payload, PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import type { QueryError } from '../query/errors'
import { makeQueryHandler } from './queryEndpoint'

const reqWithoutRuntime = (): PayloadRequest =>
	({ user: { id: 1 }, payload: {} as unknown as Payload }) as unknown as PayloadRequest

describe('makeQueryHandler without a runtime', () => {
	it('answers 503 unavailable with the same Retry-After a provider outage carries', async () => {
		const res = await makeQueryHandler()(reqWithoutRuntime())

		expect(res.status).toBe(503)
		expect(res.headers.get('Retry-After')).toBe('30')
		expect(res.headers.get('Cache-Control')).toBe('private, no-store')
		const { error } = (await res.json()) as { error: QueryError }
		expect(error.code).toBe('unavailable')
	})
})
