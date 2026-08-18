import {
	APIError,
	type CollectionAfterChangeHook,
	type CollectionBeforeChangeHook,
	type FieldHook,
	type RequestContext,
} from 'payload'
import { describe, expect, it } from 'vitest'
import {
	SECRET_BYTES,
	SECRET_MASK,
	SECRET_PREFIX,
	SECRET_REVEAL_CONTEXT,
	SECRET_UNUSABLE,
} from '../constants'
import { isEncryptedSecret } from '../secrets/crypto'
import { generateSecret, isNormalizedSecret, secretKey } from '../secrets/format'
import { keys } from '../translations/keys'
import { buildSubscriptionsCollection } from './subscriptions'

const find = (c: ReturnType<typeof buildSubscriptionsCollection>, name: string) =>
	c.fields.find((f) => 'name' in f && f.name === name)

const secretAfterRead = (
	c: ReturnType<typeof buildSubscriptionsCollection>,
	name = 'secret'
): FieldHook => {
	const field = find(c, name)
	const hook = field && 'hooks' in field ? field.hooks?.afterRead?.[0] : undefined
	if (!hook) {
		throw new Error(`${name} afterRead hook missing`)
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

/** The create-time reveal stash, which binds plaintext to the ciphertext it was stored as. */
const stash = (context: RequestContext) =>
	context[SECRET_REVEAL_CONTEXT.plaintext] as { ciphertext: string; plaintext: string } | undefined

const runBeforeChange = (
	c: ReturnType<typeof buildSubscriptionsCollection>,
	args: {
		data: Record<string, unknown>
		operation: 'create' | 'update'
		context: RequestContext
		originalDoc?: Record<string, unknown>
	}
) => {
	const hook = c.hooks?.beforeChange?.[0] as CollectionBeforeChangeHook
	return hook({
		data: args.data,
		operation: args.operation,
		originalDoc: args.originalDoc,
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
		const revealed = stash(context)?.plaintext as string
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
		expect(stash(context)?.plaintext).toBe(`${SECRET_PREFIX}${bare}`)
		expect(stash(context)?.ciphertext).toBe(created.secret)
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
		expect(stash(context)?.plaintext).toBe(`${SECRET_PREFIX}${bare}`)
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
		const ciphertext = 'whenc1_stored'
		expect(
			runMask(hook, ciphertext, {
				[SECRET_REVEAL_CONTEXT.once]: true,
				[SECRET_REVEAL_CONTEXT.plaintext]: { ciphertext, plaintext },
			})
		).toBe(plaintext)
	})

	it('masks when the stash belongs to a different document', () => {
		const hook = secretAfterRead(c)
		expect(
			runMask(hook, 'whenc1_this_document', {
				[SECRET_REVEAL_CONTEXT.once]: true,
				[SECRET_REVEAL_CONTEXT.plaintext]: {
					ciphertext: 'whenc1_a_failed_create',
					plaintext: generateSecret(),
				},
			})
		).toBe(SECRET_MASK)
	})

	it('never reveals the create stash through previousSecret', () => {
		const hook = secretAfterRead(c, 'previousSecret')
		const plaintext = generateSecret()
		const ciphertext = 'whenc1_stored'
		expect(
			runMask(hook, ciphertext, {
				[SECRET_REVEAL_CONTEXT.once]: true,
				[SECRET_REVEAL_CONTEXT.plaintext]: { ciphertext, plaintext },
			})
		).toBe(SECRET_MASK)
	})

	it('locks both rotation fields against create as well as update', () => {
		for (const name of ['previousSecret', 'previousSecretExpiresAt']) {
			const field = find(c, name)
			const access = field && 'access' in field ? field.access : undefined
			expect(access?.create?.({} as never)).toBe(false)
			expect(access?.update?.({} as never)).toBe(false)
		}
	})

	it('clears the reveal window when a create fails after beforeChange', () => {
		const hook = c.hooks?.afterError?.[0] as (args: never) => unknown
		const context: RequestContext = {
			[SECRET_REVEAL_CONTEXT.once]: true,
			[SECRET_REVEAL_CONTEXT.plaintext]: { ciphertext: 'c', plaintext: generateSecret() },
		}
		hook({ req: { context } } as never)
		expect(context[SECRET_REVEAL_CONTEXT.once]).toBe(false)
		expect(context[SECRET_REVEAL_CONTEXT.plaintext]).toBeUndefined()
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

	it('flags a signing read it cannot decrypt, rather than reading as no secret', () => {
		const hook = secretAfterRead(c)
		const result = runMask(hook, 'not-decryptable', {
			[SECRET_REVEAL_CONTEXT.forSigning]: true,
		})
		expect(result).toBe(SECRET_UNUSABLE)
		expect(result).not.toBeNull()
	})

	it('returns the stored value verbatim for a raw read', () => {
		const hook = secretAfterRead(c)
		const stored = 'whenc1_deadbeef'
		expect(runMask(hook, stored, { [SECRET_REVEAL_CONTEXT.raw]: true })).toBe(stored)
	})

	it('passes through nullish secrets without masking', () => {
		const hook = secretAfterRead(c)
		expect(runMask(hook, undefined, {})).toBeUndefined()
		expect(runMask(hook, null, {})).toBeNull()
	})

	describe('custom header names', () => {
		/**
		 * A custom `validate` replaces Payload's built-in field validation rather than running
		 * alongside it, so without the empty check `required: true` on this field is inert.
		 */
		const validateKey = () => {
			const headers = find(c, 'headers')
			const key =
				headers && 'fields' in headers
					? headers.fields.find((f) => 'name' in f && f.name === 'key')
					: undefined
			if (!key || !('validate' in key) || !key.validate) {
				throw new Error('header key validate missing')
			}
			return (value: unknown) =>
				(key.validate as (v: unknown, o: unknown) => string | true)(value, {
					req: { t: (k: string) => k },
				})
		}

		it('still rejects an empty or missing name, which required alone no longer covers', () => {
			const validate = validateKey()
			expect(validate(undefined)).toBe('validation:required')
			expect(validate(null)).toBe('validation:required')
			expect(validate('')).toBe('validation:required')
			expect(validate('   ')).toBe('validation:required')
		})

		it('rejects a reserved name through a translation key', () => {
			expect(validateKey()('webhook-signature')).toBe(keys.headerReserved)
		})

		it('accepts an ordinary header name', () => {
			expect(validateKey()('X-Custom')).toBe(true)
		})
	})

	it('clears the one-time reveal flag and stashed plaintext after the create write settles', () => {
		const hook = c.hooks?.afterChange?.[0] as CollectionAfterChangeHook
		const context: RequestContext = {
			[SECRET_REVEAL_CONTEXT.once]: true,
			[SECRET_REVEAL_CONTEXT.plaintext]: { ciphertext: 'c', plaintext: generateSecret() },
		}
		hook({ doc: { id: '1' }, req: { context } } as never)
		expect(context[SECRET_REVEAL_CONTEXT.once]).toBe(false)
		expect(context[SECRET_REVEAL_CONTEXT.plaintext]).toBeUndefined()
	})

	/**
	 * Payload runs collection `afterError` from its HTTP layer only, so a Local API create that
	 * throws after `beforeChange` reaches no cleanup hook. The reveal has to close itself.
	 */
	it('consumes the reveal on the first matching read, so a second read is masked', async () => {
		const context: RequestContext = {}
		const created = await runBeforeChange(c, { data: {}, operation: 'create', context })
		const hook = secretAfterRead(c)
		const plaintext = stash(context)?.plaintext

		expect(runMask(hook, created.secret, context)).toBe(plaintext)
		expect(runMask(hook, created.secret, context)).toBe(SECRET_MASK)
		expect(context[SECRET_REVEAL_CONTEXT.plaintext]).toBeUndefined()
	})

	it('generates a fresh secret when a read document is resubmitted, as duplicate does', async () => {
		for (const placeholder of [SECRET_MASK, SECRET_UNUSABLE]) {
			const context: RequestContext = {}
			const created = await runBeforeChange(c, {
				data: { name: 'copy', secret: placeholder },
				operation: 'create',
				context,
			})
			expect(isEncryptedSecret(created.secret)).toBe(true)
			expect(isNormalizedSecret(stash(context)?.plaintext)).toBe(true)
		}
	})

	it('drops a resubmitted placeholder on update rather than storing it as the key', async () => {
		for (const placeholder of [SECRET_MASK, SECRET_UNUSABLE]) {
			const updated = await runBeforeChange(c, {
				data: { name: 'n', secret: placeholder },
				operation: 'update',
				context: {},
			})
			expect('secret' in updated).toBe(false)
		}
	})

	describe('lapsed rotation cleanup', () => {
		const lapsed = { previousSecret: 'whenc1_abc', previousSecretExpiresAt: '2020-01-01T00:00:00Z' }

		it('clears a retired secret whose window has closed on the next write', async () => {
			const updated = await runBeforeChange(c, {
				data: { name: 'renamed' },
				operation: 'update',
				context: {},
				originalDoc: lapsed,
			})
			expect(updated.previousSecret).toBeNull()
			expect(updated.previousSecretExpiresAt).toBeNull()
		})

		it('leaves an open window alone', async () => {
			const updated = await runBeforeChange(c, {
				data: { name: 'renamed' },
				operation: 'update',
				context: {},
				originalDoc: {
					previousSecret: 'whenc1_abc',
					previousSecretExpiresAt: new Date(Date.now() + 60_000),
				},
			})
			expect('previousSecret' in updated).toBe(false)
		})

		it('does not fight a rotation writing the fields in the same operation', async () => {
			const incoming = generateSecret()
			const updated = await runBeforeChange(c, {
				data: { previousSecret: incoming, previousSecretExpiresAt: 'later' },
				operation: 'update',
				context: {},
				originalDoc: lapsed,
			})
			expect(isEncryptedSecret(updated.previousSecret)).toBe(true)
			expect(updated.previousSecretExpiresAt).toBe('later')
		})

		it('leaves a row with no retired secret untouched', async () => {
			const updated = await runBeforeChange(c, {
				data: { name: 'renamed' },
				operation: 'update',
				context: {},
				originalDoc: { previousSecret: null, previousSecretExpiresAt: null },
			})
			expect('previousSecret' in updated).toBe(false)
		})
	})
})
