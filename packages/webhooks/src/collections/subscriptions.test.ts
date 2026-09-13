import {
	type CollectionAfterChangeHook,
	type CollectionBeforeValidateHook,
	type RequestContext,
	ValidationError,
} from 'payload'
import { describe, expect, it } from 'vitest'
import { GENERATED_SECRET_KEY, SECRET_BYTES, SECRET_PREFIX } from '../constants'
import { isNormalizedSecret, secretKey } from '../secrets/format'
import { secretHintName, secretSetName } from '../secrets/secretFields'
import { keys } from '../translations/keys'
import { buildSubscriptionsCollection } from './subscriptions'

/** A wire string in `@10x-media/fields` sealed form, which is what a duplicate resubmits. */
const SEALED = 'pfe1.k0.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA'

const find = (c: ReturnType<typeof buildSubscriptionsCollection>, name: string) =>
	c.fields.find((f) => 'name' in f && f.name === name)

const fakeReq = (context: RequestContext) => ({ context })

/** Found by name rather than position, so adding a hook does not silently retarget a test. */
const hookNamed = <T extends { name: string }>(hooks: T[] | undefined, name: string): T => {
	const hook = hooks?.find((h) => h.name === name)
	if (!hook) {
		throw new Error(`no hook named ${name}`)
	}
	return hook
}

const runCreate = (
	c: ReturnType<typeof buildSubscriptionsCollection>,
	args: { data: Record<string, unknown>; operation?: 'create' | 'update'; context: RequestContext }
) => {
	const hook = hookNamed(
		c.hooks?.beforeValidate,
		'generateOnCreate'
	) as CollectionBeforeValidateHook
	return hook({
		collection: { slug: c.slug },
		data: args.data,
		operation: args.operation ?? 'create',
		req: fakeReq(args.context),
	} as never) as Record<string, unknown>
}

const runAfterChange = (
	c: ReturnType<typeof buildSubscriptionsCollection>,
	args: {
		doc: Record<string, unknown>
		operation: 'create' | 'update'
		context: RequestContext
	}
) => {
	const hook = c.hooks?.afterChange?.[0] as CollectionAfterChangeHook
	return hook({
		doc: args.doc,
		operation: args.operation,
		req: fakeReq(args.context),
	} as never) as Record<string, unknown>
}

const runBeforeChange = (
	c: ReturnType<typeof buildSubscriptionsCollection>,
	args: { data: Record<string, unknown>; originalDoc?: Record<string, unknown> }
) => {
	const hook = hookNamed(c.hooks?.beforeChange, 'clearLapsedRotation')
	return hook({
		data: args.data,
		operation: 'update',
		originalDoc: args.originalDoc,
		req: fakeReq({}),
	} as never) as Record<string, unknown>
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

	it('locks both rotation fields against create as well as update', () => {
		for (const name of ['previousSecret', 'previousSecretExpiresAt']) {
			const field = find(c, name)
			const access = field && 'access' in field ? field.access : undefined
			expect(access?.create?.({} as never)).toBe(false)
			expect(access?.update?.({} as never)).toBe(false)
		}
	})

	/**
	 * The write-only editor renders Replace and Generate actions and does not consult Payload's
	 * `readOnly`, so leaving the field on the edit view would put a live control over a write that
	 * field access drops: the operator would type a new secret, save, see no error, and still be
	 * signing with the old one. Rotation is the only path, and it has its own button.
	 */
	it('renders the secret field on create only, so rotation is the single control', () => {
		const secret = find(c, 'secret')
		const condition = secret && 'admin' in secret ? secret.admin?.condition : undefined
		if (!condition) {
			throw new Error('secret admin.condition missing')
		}
		expect(condition({}, {}, { operation: 'create' } as never)).toBe(true)
		expect(condition({}, {}, { operation: 'update' } as never)).toBe(false)
	})

	/**
	 * The resolver reads these siblings by name, and they are `encryptedField`'s to define. Pinning
	 * them against the fields the factory actually emitted is what keeps a rename over there from
	 * turning into a subscription that silently resolves as having no secret.
	 */
	it('emits the set-indicator and hint siblings the resolver reads by name', () => {
		expect(find(c, secretSetName('secret'))).toBeDefined()
		expect(find(c, secretSetName('previousSecret'))).toBeDefined()
		expect(find(c, secretHintName('secret'))).toBeDefined()
	})

	describe('generated secrets', () => {
		it('generates a whsec_ secret on a create that supplies none', () => {
			const context: RequestContext = {}
			const data = runCreate(c, { data: {}, operation: 'create', context })
			expect(isNormalizedSecret(data.secret)).toBe(true)
			expect(secretKey(data.secret as string)).toHaveLength(SECRET_BYTES)
		})

		it('returns the generated secret once, under its own key', () => {
			const context: RequestContext = {}
			const data = runCreate(c, { data: {}, operation: 'create', context })
			const doc = runAfterChange(c, { doc: { id: '1' }, operation: 'create', context })
			expect(doc[GENERATED_SECRET_KEY]).toBe(data.secret)
		})

		it('closes the reveal after one read, so a second afterChange carries nothing', () => {
			const context: RequestContext = {}
			runCreate(c, { data: {}, operation: 'create', context })
			runAfterChange(c, { doc: { id: '1' }, operation: 'create', context })
			const second = runAfterChange(c, { doc: { id: '1' }, operation: 'create', context })
			expect(GENERATED_SECRET_KEY in second).toBe(false)
		})

		it('leaves a supplied secret alone, and reveals nothing: the caller already holds it', () => {
			const context: RequestContext = {}
			const supplied = `${SECRET_PREFIX}${'A'.repeat(44)}`
			const data = runCreate(c, {
				data: { secret: supplied },
				operation: 'create',
				context,
			})
			expect(data.secret).toBe(supplied)
			const doc = runAfterChange(c, { doc: { id: '1' }, operation: 'create', context })
			expect(GENERATED_SECRET_KEY in doc).toBe(false)
		})

		/**
		 * Payload's admin omits the field rather than sending an empty one, so an empty string is an
		 * API caller who meant to supply a secret. Generating one silently would hand that caller a
		 * subscription signed with a secret they never saw, and the field validator cannot catch it:
		 * `encryptedField` seals before it validates, and its seal hook reads a write-only `''` as a
		 * clear, so the value reaches the validator as null and the row is stored with no secret at
		 * all. Refusing here is what turns it into a 400 naming the problem.
		 */
		it('refuses an explicitly empty secret rather than generating or clearing one', () => {
			let error: unknown
			try {
				runCreate(c, { data: { secret: '' }, operation: 'create', context: {} })
			} catch (err) {
				error = err
			}
			expect(error).toBeInstanceOf(ValidationError)
			expect((error as ValidationError).data.errors[0]?.path).toBe('secret')
		})

		/**
		 * Payload merges the stored document into `data` before this hook runs, so a duplicate
		 * arrives carrying the original's ciphertext. Two subscriptions sharing one signing key is
		 * exactly what must not happen.
		 */
		it('treats a sealed value on create as absent, so a duplicate gets its own key', () => {
			const context: RequestContext = {}
			const data = runCreate(c, {
				data: { secret: SEALED, previousSecret: SEALED, previousSecretExpiresAt: 'later' },
				operation: 'create',
				context,
			})
			expect(isNormalizedSecret(data.secret)).toBe(true)
			expect(data.secret).not.toBe(SEALED)
			// A copy inherits no rotation state either: the retired key belongs to the original.
			expect(data.previousSecret).toBeNull()
			expect(data.previousSecretExpiresAt).toBeNull()
		})

		/**
		 * A create that throws between the two hooks leaves its secret on the request. Without the
		 * reset, the next create on that request would be handed the dead value as its
		 * `generatedSecret`, and a caller who trusted it would hold a secret that signs nothing.
		 */
		it('does not carry the secret of a failed create onto the next one', () => {
			const context: RequestContext = {}
			runCreate(c, { data: {}, operation: 'create', context })
			const supplied = `${SECRET_PREFIX}${'A'.repeat(44)}`
			runCreate(c, { data: { secret: supplied }, operation: 'create', context })
			const doc = runAfterChange(c, { doc: { id: '2' }, operation: 'create', context })
			expect(GENERATED_SECRET_KEY in doc).toBe(false)
		})

		it('generates nothing on an update', () => {
			const context: RequestContext = {}
			const data = runCreate(c, { data: { name: 'n' }, operation: 'update', context })
			expect('secret' in data).toBe(false)
			const doc = runAfterChange(c, { doc: { id: '1' }, operation: 'update', context })
			expect(GENERATED_SECRET_KEY in doc).toBe(false)
		})
	})

	describe('lapsed rotation cleanup', () => {
		const lapsed = { previousSecretExpiresAt: '2020-01-01T00:00:00Z' }

		it('clears a retired secret whose window has closed on the next write', () => {
			const updated = runBeforeChange(c, { data: { name: 'renamed' }, originalDoc: lapsed })
			expect(updated.previousSecret).toBeNull()
			expect(updated.previousSecretExpiresAt).toBeNull()
		})

		it('leaves an open window alone', () => {
			const updated = runBeforeChange(c, {
				data: { name: 'renamed' },
				originalDoc: { previousSecretExpiresAt: new Date(Date.now() + 60_000) },
			})
			expect('previousSecret' in updated).toBe(false)
		})

		it('does not fight a rotation writing the fields in the same operation', () => {
			const updated = runBeforeChange(c, {
				data: { previousSecret: 'incoming', previousSecretExpiresAt: 'later' },
				originalDoc: lapsed,
			})
			expect(updated.previousSecret).toBe('incoming')
			expect(updated.previousSecretExpiresAt).toBe('later')
		})

		it('leaves a row with no retired secret untouched', () => {
			const updated = runBeforeChange(c, {
				data: { name: 'renamed' },
				originalDoc: { previousSecretExpiresAt: null },
			})
			expect('previousSecret' in updated).toBe(false)
		})
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
			expect(validateKey()('Content-Type')).toBe(keys.headerReserved)
		})

		/**
		 * A name with a space saves fine and then makes `fetch` throw at delivery time, so the
		 * operator would find out from a dead delivery row instead of from the form.
		 */
		it('rejects a name that is not a valid HTTP token', () => {
			for (const name of ['X Custom', 'X:Custom', 'X\tCustom', 'Ünicode']) {
				expect(validateKey()(name)).toBe(keys.headerInvalid)
			}
		})

		it('accepts an ordinary header name', () => {
			expect(validateKey()('X-Custom')).toBe(true)
			expect(validateKey()('X_Custom.1')).toBe(true)
		})
	})
})
