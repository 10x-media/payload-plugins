import type {
	CollectionAfterChangeHook,
	CollectionBeforeChangeHook,
	FieldHook,
	RequestContext,
} from 'payload'
import { describe, expect, it } from 'vitest'
import { SECRET_MASK, SECRET_REVEAL_CONTEXT } from '../constants'
import { buildSubscriptionsCollection } from './subscriptions'

const find = (c: ReturnType<typeof buildSubscriptionsCollection>, name: string) =>
	c.fields.find((f) => 'name' in f && f.name === name)

const secretAfterRead = (c: ReturnType<typeof buildSubscriptionsCollection>): FieldHook => {
	const field = find(c, 'secret')
	const hook = field && 'hooks' in field ? field.hooks?.afterRead?.[0] : undefined
	if (!hook) {
		throw new Error('secret afterRead hook missing')
	}
	return hook
}

const runMask = (hook: FieldHook, value: unknown, context: RequestContext) =>
	hook({ value, req: { context } } as never)

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

	it('generates a secret on create only and flags the one-time reveal', async () => {
		const hook = c.hooks?.beforeChange?.[0] as CollectionBeforeChangeHook
		const context: RequestContext = {}
		const created = await hook({ data: {}, operation: 'create', req: { context } } as never)
		expect(typeof created.secret).toBe('string')
		expect((created.secret as string).length).toBe(48)
		expect(context[SECRET_REVEAL_CONTEXT.once]).toBe(true)

		const updateContext: RequestContext = {}
		const updated = await hook({
			data: { secret: 'keep' },
			operation: 'update',
			req: { context: updateContext },
		} as never)
		expect(updated.secret).toBe('keep')
		expect(updateContext[SECRET_REVEAL_CONTEXT.once]).toBeUndefined()
	})

	it('masks the secret on a plain read', () => {
		const hook = secretAfterRead(c)
		expect(runMask(hook, 'a'.repeat(48), {})).toBe(SECRET_MASK)
	})

	it('reveals the raw secret for the one-time create response', () => {
		const hook = secretAfterRead(c)
		const raw = 'b'.repeat(48)
		expect(runMask(hook, raw, { [SECRET_REVEAL_CONTEXT.once]: true })).toBe(raw)
	})

	it('reveals the raw secret for internal signing reads', () => {
		const hook = secretAfterRead(c)
		const raw = 'c'.repeat(48)
		expect(runMask(hook, raw, { [SECRET_REVEAL_CONTEXT.forSigning]: true })).toBe(raw)
	})

	it('passes through nullish secrets without masking', () => {
		const hook = secretAfterRead(c)
		expect(runMask(hook, undefined, {})).toBeUndefined()
		expect(runMask(hook, null, {})).toBeNull()
	})

	it('clears the one-time reveal flag after the create write settles', () => {
		const hook = c.hooks?.afterChange?.[0] as CollectionAfterChangeHook
		const context: RequestContext = { [SECRET_REVEAL_CONTEXT.once]: true }
		hook({ doc: { id: '1' }, req: { context } } as never)
		expect(context[SECRET_REVEAL_CONTEXT.once]).toBe(false)
	})
})
