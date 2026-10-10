import { type BootedPayload, bootPayload } from '@10x-media/payload-test-harness'
import type { CollectionConfig, JsonObject } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { webhooks } from '../../src/index'
import { LOCAL_SINK } from './localSink'

const posts: CollectionConfig = { slug: 'posts', fields: [{ name: 'title', type: 'text' }] }

/** One past the old scan cap, and several pages of the new walk. */
const SUBSCRIBERS = 1_001

describe('more subscriptions than the old scan cap', () => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: webhooks({
				collections: { posts: true },
				delivery: { mode: 'queue', retries: 0, ...LOCAL_SINK },
			}),
			db: 'mongo',
			collections: [posts],
		})
		// Written through the adapter: 1,001 creates through the Local API would each seal a secret.
		for (let start = 0; start < SUBSCRIBERS; start += 50) {
			await Promise.all(
				Array.from({ length: Math.min(50, SUBSCRIBERS - start) }, (_, i) =>
					booted.payload.db.create({
						collection: 'webhook-subscriptions',
						data: {
							name: `s${start + i}`,
							url: 'http://127.0.0.1:1/hook',
							enabled: true,
							events: ['posts.created'],
						},
					})
				)
			)
		}
	}, 120_000)

	afterAll(async () => {
		await booted.stop()
	})

	it('queues a delivery for every one of them, each exactly once', async () => {
		await booted.payload.create({ collection: 'posts', data: { title: 'x' }, overrideAccess: true })
		const rows = await booted.payload.find({
			collection: 'webhook-deliveries',
			overrideAccess: true,
			limit: SUBSCRIBERS + 10,
			pagination: false,
		})
		const docs: JsonObject[] = rows.docs
		expect(docs).toHaveLength(SUBSCRIBERS)
		expect(new Set(docs.map((d) => d.subscriptionId)).size).toBe(SUBSCRIBERS)
	}, 120_000)
})
