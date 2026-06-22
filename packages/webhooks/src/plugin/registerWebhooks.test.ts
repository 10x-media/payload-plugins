import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'
import { registerWebhooks } from './registerWebhooks'

const makeConfig = (): Config =>
	({
		collections: [],
		routes: { api: '/api' },
		serverURL: 'http://localhost:3000',
	}) as unknown as Config

const getRedeliverEndpoint = (config: Config) => {
	const deliveries = config.collections?.find((c) => c.slug === 'webhook-deliveries')
	const endpoints = Array.isArray(deliveries?.endpoints) ? deliveries.endpoints : []
	return endpoints.find((e) => e.path === '/:id/redeliver' && e.method === 'post')
}

describe('redeliver endpoint access', () => {
	it('returns 401 for unauthenticated requests (default behavior)', async () => {
		const config = makeConfig()
		registerWebhooks({ config, options: {}, hasJobsPlugin: false })
		const endpoint = getRedeliverEndpoint(config)
		const res = await endpoint?.handler?.({ user: undefined, routeParams: { id: '1' } } as never)
		expect(res).toBeInstanceOf(Response)
		expect((res as Response).status).toBe(401)
	})

	it('uses redeliverAccess when provided and returns 403 when it returns false', async () => {
		const config = makeConfig()
		registerWebhooks({
			config,
			options: { redeliverAccess: () => false },
			hasJobsPlugin: false,
		})
		const endpoint = getRedeliverEndpoint(config)
		const res = await endpoint?.handler?.({
			user: { id: '1' },
			routeParams: { id: '1' },
		} as never)
		expect(res).toBeInstanceOf(Response)
		expect((res as Response).status).toBe(403)
	})
})
