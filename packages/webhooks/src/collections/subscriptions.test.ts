import type { CollectionBeforeChangeHook } from 'payload'
import { describe, expect, it } from 'vitest'
import { buildSubscriptionsCollection } from './subscriptions'

const find = (c: ReturnType<typeof buildSubscriptionsCollection>, name: string) =>
	c.fields.find((f) => 'name' in f && f.name === name)

describe('buildSubscriptionsCollection', () => {
	const c = buildSubscriptionsCollection({
		slug: 'webhook-subscriptions',
		events: ['posts.created'],
		hidden: false,
	})

	it('uses the given slug and name title', () => {
		expect(c.slug).toBe('webhook-subscriptions')
		expect(c.admin?.useAsTitle).toBe('name')
	})

	it('derives event options from the catalog', () => {
		const events = find(c, 'events')
		expect(events && 'options' in events ? events.options : undefined).toEqual([
			{ label: 'posts.created', value: 'posts.created' },
		])
	})

	it('locks the secret against updates', () => {
		const secret = find(c, 'secret')
		expect(secret && 'access' in secret ? secret.access?.update?.({} as never) : undefined).toBe(
			false
		)
	})

	it('generates a secret on create only', async () => {
		const hook = c.hooks?.beforeChange?.[0] as CollectionBeforeChangeHook
		const created = await hook({ data: {}, operation: 'create' } as never)
		expect(typeof created.secret).toBe('string')
		expect((created.secret as string).length).toBeGreaterThanOrEqual(32)
		const updated = await hook({ data: { secret: 'keep' }, operation: 'update' } as never)
		expect(updated.secret).toBe('keep')
	})
})
