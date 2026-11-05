import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'
import type { WebhooksPluginOptions } from '../options'
import { registerWebhooks } from './registerWebhooks'

const register = (options: WebhooksPluginOptions) =>
	registerWebhooks({
		config: { collections: [{ slug: 'posts', fields: [] }] } as unknown as Config,
		options: { collections: { posts: true } as never, ...options },
		hasJobsPlugin: false,
	})

const allow = () => true
const explicit: WebhooksPluginOptions = {
	subscriptionsCollection: {
		overrides: { access: { read: allow, create: allow, update: allow, delete: allow } },
	},
	deliveriesLog: { overrides: { access: { read: allow, delete: allow } } },
}

describe('enforceOwnerAccess config guards', () => {
	it('needs an owner resolver', () => {
		expect(() => register({ ...explicit, enforceOwnerAccess: true })).toThrow(/owner\.resolve/)
	})

	it('needs every access rule stated, and names the ones that are missing', () => {
		expect(() => register({ enforceOwnerAccess: true, owner: { resolve: () => null } })).toThrow(
			/subscriptionsCollection\.overrides\.access\.read.*deliveriesLog\.overrides\.access\.delete/s
		)
	})

	it('boots once both are given', () => {
		expect(() =>
			register({ ...explicit, enforceOwnerAccess: true, owner: { resolve: () => null } })
		).not.toThrow()
	})

	it('leaves an install that does not opt in alone', () => {
		expect(() => register({})).not.toThrow()
	})
})
