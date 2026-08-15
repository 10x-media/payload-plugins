import {
	APIError,
	type CollectionAfterChangeHook,
	type CollectionBeforeChangeHook,
	type FieldHook,
	type RequestContext,
} from 'payload'
import { describe, expect, it } from 'vitest'
import { SECRET_BYTES, SECRET_MASK, SECRET_PREFIX, SECRET_REVEAL_CONTEXT } from '../constants'
import { isEncryptedSecret } from '../secrets/crypto'
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

/** Reversible stand-in for Payload's aes-256-ctr crypto, enough to exercise the hooks. */
const fakeReq = (context: RequestContext) => ({
	context,
	payload: {
		encrypt: (text: string) => Buffer.from(text, 'utf8').toString('hex'),
		decrypt: (hash: string) => Buffer.from(hash, 'hex').toString('utf8'),
		logger: { error: () => undefined },
	},
})

const runMask = (hook: FieldHook, value: unknown, context: RequestContext) =>
	hook({ value, req: fakeReq(context) } as never)

const runBeforeChange = (
	c: ReturnType<typeof buildSubscriptionsCollection>,
	args: { data: Record<string, unknown>; operation: 'create' | 'update'; context: RequestContext }
) => {
	const hook = c.hooks?.beforeChange?.[0] as CollectionBeforeChangeHook
	return hook({
		data: args.data,
		operation: args.operation,
		req: fakeReq(args.context),
	} as never) as Promise<Record<string, unknown>> | Record<string, unknown>
}

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

	it('generates a whsec_ secret on create, stores it encrypted, and flags the one-time reveal', async () => {
		const context: RequestContext = {}
		const created = await runBeforeChange(c, { data: {}, operation: 'create', context })
		expect(isEncryptedSecret(created.secret)).toBe(true)
		const revealed = context[SECRET_REVEAL_CONTEXT.plaintext] as string
		expect(isNormalizedSecret(revealed)).toBe(true)
		expect(secretKey(revealed)).toHaveLength(SECRET_BYTES)
		expect(String(created.secret)).not.toContain(revealed)
		expect(context[SECRET_REVEAL_CONTEXT.once]).toBe(true)
	})

	it('leaves an update without a secret untouched', async () => {
		const updateContext: RequestContext = {}
		const updated = await runBeforeChange(c, {
			data: { name: 'renamed' },
			operation: 'update',
			context: updateContext,
		})
		expect(updated.secret).toBeUndefined()
		expect(updateContext[SECRET_REVEAL_CONTEXT.once]).toBeUndefined()
	})

	it('encrypts a plaintext secret supplied on update', async () => {
		const plaintext = generateSecret()
		const updated = await runBeforeChange(c, {
			data: { secret: plaintext },
			operation: 'update',
			context: {},
		})
		expect(isEncryptedSecret(updated.secret)).toBe(true)
		expect(String(updated.secret)).not.toContain(plaintext)
	})

	it('does not re-encrypt an already-encrypted secret on update', async () => {
		const created = await runBeforeChange(c, { data: {}, operation: 'create', context: {} })
		const updated = await runBeforeChange(c, {
			data: { secret: created.secret },
			operation: 'update',
			context: {},
		})
		expect(updated.secret).toBe(created.secret)
	})

	it('drops a masked secret written back on update rather than persisting the placeholder', async () => {
		const updated = await runBeforeChange(c, {
			data: { name: 'n', secret: SECRET_MASK },
			operation: 'update',
			context: {},
		})
		expect('secret' in updated).toBe(false)
		expect(updated.name).toBe('n')
	})

	it('normalizes a customer-supplied secret and reveals it once, like a generated one', async () => {
		const context: RequestContext = {}
		const bare = generateSecret().slice(SECRET_PREFIX.length)
		const created = await runBeforeChange(c, {
			data: { secret: bare },
			operation: 'create',
			context,
		})
		expect(isEncryptedSecret(created.secret)).toBe(true)
		expect(context[SECRET_REVEAL_CONTEXT.plaintext]).toBe(`${SECRET_PREFIX}${bare}`)
		expect(context[SECRET_REVEAL_CONTEXT.once]).toBe(true)
	})

	it('collapses a doubly-prefixed customer secret', async () => {
		const context: RequestContext = {}
		const bare = generateSecret().slice(SECRET_PREFIX.length)
		await runBeforeChange(c, {
			data: { secret: `${SECRET_PREFIX}${SECRET_PREFIX}${bare}` },
			operation: 'create',
			context,
		})
		expect(context[SECRET_REVEAL_CONTEXT.plaintext]).toBe(`${SECRET_PREFIX}${bare}`)
	})

	it('rejects a malformed customer secret with a 400', () => {
		let thrown: unknown
		try {
			runBeforeChange(c, { data: { secret: 'not base64!' }, operation: 'create', context: {} })
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

	it('reveals the create-time plaintext for the one-time create response', () => {
		const hook = secretAfterRead(c)
		const plaintext = generateSecret()
		const stored = Buffer.from(plaintext, 'utf8').toString('hex')
		expect(
			runMask(hook, stored, {
				[SECRET_REVEAL_CONTEXT.once]: true,
				[SECRET_REVEAL_CONTEXT.plaintext]: plaintext,
			})
		).toBe(plaintext)
	})

	it('masks rather than leaking ciphertext if the reveal stash is missing', () => {
		const hook = secretAfterRead(c)
		expect(runMask(hook, 'ciphertext', { [SECRET_REVEAL_CONTEXT.once]: true })).toBe(SECRET_MASK)
	})

	it('decrypts the stored secret for internal signing reads', () => {
		const hook = secretAfterRead(c)
		const plaintext = generateSecret()
		const stored = `whenc1_${Buffer.from(plaintext, 'utf8').toString('hex')}`
		expect(runMask(hook, stored, { [SECRET_REVEAL_CONTEXT.forSigning]: true })).toBe(plaintext)
	})

	it('yields null for a signing read it cannot decrypt', () => {
		const hook = secretAfterRead(c)
		expect(runMask(hook, '__redacted__', { [SECRET_REVEAL_CONTEXT.forSigning]: true })).toBeNull()
	})

	it('passes through nullish secrets without masking', () => {
		const hook = secretAfterRead(c)
		expect(runMask(hook, undefined, {})).toBeUndefined()
		expect(runMask(hook, null, {})).toBeNull()
	})

	it('clears the one-time reveal flag and stashed plaintext after the create write settles', () => {
		const hook = c.hooks?.afterChange?.[0] as CollectionAfterChangeHook
		const context: RequestContext = {
			[SECRET_REVEAL_CONTEXT.once]: true,
			[SECRET_REVEAL_CONTEXT.plaintext]: generateSecret(),
		}
		hook({ doc: { id: '1' }, req: { context } } as never)
		expect(context[SECRET_REVEAL_CONTEXT.once]).toBe(false)
		expect(context[SECRET_REVEAL_CONTEXT.plaintext]).toBeUndefined()
	})
})
