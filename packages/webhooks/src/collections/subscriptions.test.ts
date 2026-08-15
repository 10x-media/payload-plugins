import {
	APIError,
	type CollectionAfterChangeHook,
	type CollectionBeforeChangeHook,
	type FieldHook,
	type RequestContext,
} from 'payload'
import { describe, expect, it } from 'vitest'
import { SECRET_BYTES, SECRET_MASK, SECRET_PREFIX, SECRET_REVEAL_CONTEXT } from '../constants'
import { generateSecret, isNormalizedSecret, secretKey } from '../secrets/format'
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

	const beforeChange = () => c.hooks?.beforeChange?.[0] as CollectionBeforeChangeHook

	it('generates a whsec_ secret on create only and flags the one-time reveal', async () => {
		const context: RequestContext = {}
		const created = await beforeChange()({
			data: {},
			operation: 'create',
			req: { context },
		} as never)
		expect(isNormalizedSecret(created.secret)).toBe(true)
		expect(secretKey(created.secret as string)).toHaveLength(SECRET_BYTES)
		expect(context[SECRET_REVEAL_CONTEXT.once]).toBe(true)

		const updateContext: RequestContext = {}
		const updated = await beforeChange()({
			data: { secret: 'keep' },
			operation: 'update',
			req: { context: updateContext },
		} as never)
		expect(updated.secret).toBe('keep')
		expect(updateContext[SECRET_REVEAL_CONTEXT.once]).toBeUndefined()
	})

	it('normalizes a customer-supplied secret and reveals it once, like a generated one', async () => {
		const context: RequestContext = {}
		const bare = generateSecret().slice(SECRET_PREFIX.length)
		const created = await beforeChange()({
			data: { secret: bare },
			operation: 'create',
			req: { context },
		} as never)
		expect(created.secret).toBe(`${SECRET_PREFIX}${bare}`)
		expect(context[SECRET_REVEAL_CONTEXT.once]).toBe(true)
	})

	it('collapses a doubly-prefixed customer secret', async () => {
		const bare = generateSecret().slice(SECRET_PREFIX.length)
		const created = await beforeChange()({
			data: { secret: `${SECRET_PREFIX}${SECRET_PREFIX}${bare}` },
			operation: 'create',
			req: { context: {} },
		} as never)
		expect(created.secret).toBe(`${SECRET_PREFIX}${bare}`)
	})

	it('rejects a malformed customer secret with a 400', () => {
		let thrown: unknown
		try {
			beforeChange()({
				data: { secret: 'not base64!' },
				operation: 'create',
				req: { context: {} },
			} as never)
		} catch (err) {
			thrown = err
		}
		expect(thrown).toBeInstanceOf(APIError)
		expect((thrown as APIError).status).toBe(400)
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
