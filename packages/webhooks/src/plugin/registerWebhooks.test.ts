import type { Config } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { registerWebhooks } from './registerWebhooks'

const makeConfig = (): Config => ({
	collections: [],
	routes: { api: '/api' },
	serverURL: 'http://localhost:3000',
})

const getRedeliverEndpoint = (config: Config) => {
	const deliveries = config.collections?.find((c) => c.slug === 'webhook-deliveries')
	return deliveries?.endpoints?.find((e) => e.path === '/:id/redeliver' && e.method === 'post')
}

describe('redeliver endpoint access', () => {
	it('returns 401 for unauthenticated requests (default behavior)', async () => {
		const config = makeConfig()
		registerWebhooks({ config, options: {}, hasJobsPlugin: false })
		const endpoint = getRedeliverEndpoint(config)
		const res = await endpoint?.handler?.({ user: undefined, routeParams: { id: '1' } } as never)
		expect(res).toBeInstanceOf(Response)
		const r = res as Response
		expect(r.status).toBe(401)
	})

	it('uses redeliverAccess when provided and returns 403 when it returns false', async () => {
		const config = makeConfig()
		registerWebhooks({
			config,
			options: { redeliverAccess: () => false },
			hasJobsPlugin: false,
		})
		const endpoint = getRedeliverEndpoint(config)
		// Pass a logged-in user so the default loggedIn check would have passed
		const res = await endpoint?.handler?.({
			user: { id: '1' },
			routeParams: { id: '1' },
		} as never)
		expect(res).toBeInstanceOf(Response)
		const r = res as Response
		expect(r.status).toBe(403)
	})
})
