import { isSealed, readEncryptedField } from '@10x-media/fields/encrypted'
import { type BootedPayload, bootPayload } from '@10x-media/payload-test-harness'
import type { CollectionConfig } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { GENERATED_SECRET_KEY, SECRET_HINT_SUFFIX, SECRET_PREFIX } from '../../src/constants'
import { webhooks } from '../../src/index'
import { generateSecret } from '../../src/secrets/format'

const posts: CollectionConfig = { slug: 'posts', fields: [{ name: 'title', type: 'text' }] }

/**
 * The stored document straight from the mongo driver, bypassing Payload's field hooks entirely.
 * An API response cannot prove encryption at rest: the write-only strip removes the field either
 * way. Rows are looked up by their unique `name` so the assertion needs no ObjectId construction.
 *
 * This is why the file is Mongo-only: proving what is on disk means reaching past Payload, and
 * the SQL adapters expose nothing equivalent. The cross-database behaviour that matters (signing,
 * rotation, the grace window) is covered in `matrix.int.spec.ts` instead.
 */
const rawDocument = async (
	booted: BootedPayload,
	name: string
): Promise<Record<string, unknown>> => {
	const { connection } = booted.payload.db as unknown as {
		connection: {
			collection: (collection: string) => {
				findOne: (filter: Record<string, unknown>) => Promise<Record<string, unknown> | null>
			}
		}
	}
	const doc = await connection.collection('webhook-subscriptions').findOne({ name })
	if (!doc) {
		throw new Error(`no raw document named ${name}`)
	}
	return doc
}

const create = async (booted: BootedPayload, name: string, data: Record<string, unknown> = {}) =>
	booted.payload.create({
		collection: 'webhook-subscriptions',
		data: { name, url: 'https://example.test', events: [], ...data },
		overrideAccess: true,
	})

describe('webhook secrets are encrypted at rest', () => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: webhooks({ collections: { posts: true }, delivery: { mode: 'inline', retries: 0 } }),
			db: 'mongo',
			collections: [posts],
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('stores a sealed value, not the plaintext secret, for a generated secret', async () => {
		const created = await create(booted, 'generated')
		const plaintext = String(created[GENERATED_SECRET_KEY])
		expect(plaintext.startsWith(SECRET_PREFIX)).toBe(true)

		const raw = await rawDocument(booted, 'generated')
		expect(isSealed(raw.secret)).toBe(true)
		expect(raw.secret).not.toBe(plaintext)
		expect(JSON.stringify(raw)).not.toContain(plaintext)
		expect(JSON.stringify(raw)).not.toContain(plaintext.slice(SECRET_PREFIX.length))
	})

	it('stores a sealed value for a customer-supplied secret too, and reveals nothing', async () => {
		const supplied = generateSecret()
		const created = await create(booted, 'supplied', { secret: supplied })
		// The caller already holds this one, so there is nothing to hand back.
		expect(created[GENERATED_SECRET_KEY]).toBeUndefined()

		const raw = await rawDocument(booted, 'supplied')
		expect(isSealed(raw.secret)).toBe(true)
		expect(JSON.stringify(raw)).not.toContain(supplied.slice(SECRET_PREFIX.length))
	})

	/**
	 * Write-only storage strips the field from every read result, so the one-time reveal cannot
	 * ride on the field and the create response carries it under its own key instead.
	 */
	it('strips the secret from every read while the row holds ciphertext', async () => {
		const created = await create(booted, 'stripped')
		const reread = await booted.payload.findByID({
			collection: 'webhook-subscriptions',
			id: String(created.id),
			overrideAccess: true,
		})
		expect(reread.secret).toBeUndefined()
		expect(reread[GENERATED_SECRET_KEY]).toBeUndefined()
		// The set indicator is the mode's one deliberate leak: existence, not value.
		expect(reread.secret_set).toBe(true)

		const raw = await rawDocument(booted, 'stripped')
		expect(isSealed(raw.secret)).toBe(true)
	})

	/**
	 * Every character of a signing secret is key material rather than an identifier, so the hint
	 * exposes the least that still tells two keys apart.
	 */
	it('stores an identification hint of exactly the configured suffix length', async () => {
		const supplied = generateSecret()
		const created = await create(booted, 'hinted', { secret: supplied })
		const reread = await booted.payload.findByID({
			collection: 'webhook-subscriptions',
			id: String(created.id),
			overrideAccess: true,
		})
		const hint = String(reread.secret_hint)
		expect(hint).toContain(supplied.slice(-SECRET_HINT_SUFFIX))
		expect(hint).not.toContain(supplied.slice(SECRET_PREFIX.length, -SECRET_HINT_SUFFIX))
	})

	it('does not reseal on an unrelated update', async () => {
		const created = await create(booted, 'stable')
		const before = await rawDocument(booted, 'stable')
		await booted.payload.update({
			collection: 'webhook-subscriptions',
			id: String(created.id),
			data: { name: 'stable renamed' },
			overrideAccess: true,
		})
		const after = await rawDocument(booted, 'stable renamed')
		expect(after.secret).toBe(before.secret)
	})

	/**
	 * Payload's duplicate action resubmits a document it read. Write-only storage means that read
	 * carried no secret at all, so the copy is generated a fresh one rather than sharing the
	 * original's key.
	 */
	it('gives a duplicated subscription its own fresh secret', async () => {
		const created = await create(booted, 'original')
		const originalRaw = await rawDocument(booted, 'original')

		// Renamed in the same call: `rawDocument` looks rows up by name, and a duplicate otherwise
		// carries the original's, so the lookup would find the original and prove nothing.
		await booted.payload.duplicate({
			collection: 'webhook-subscriptions',
			data: { name: 'original copy' },
			id: String(created.id),
			overrideAccess: true,
		})

		const raw = await rawDocument(booted, 'original copy')
		expect(isSealed(raw.secret)).toBe(true)
		expect(raw.secret).not.toBe(originalRaw.secret)
	})

	it('gives a duplicate none of the original rotation state', async () => {
		const created = await create(booted, 'mid-rotation')
		await booted.payload.update({
			collection: 'webhook-subscriptions',
			id: String(created.id),
			data: {
				previousSecret: generateSecret(),
				previousSecretExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
			},
			overrideAccess: true,
		})

		await booted.payload.duplicate({
			collection: 'webhook-subscriptions',
			data: { name: 'mid-rotation copy' },
			id: String(created.id),
			overrideAccess: true,
		})

		const raw = await rawDocument(booted, 'mid-rotation copy')
		expect(raw.previousSecret ?? null).toBeNull()
		expect(raw.previousSecretExpiresAt ?? null).toBeNull()

		// And through the admin's own path, where field access rather than overrideAccess decides
		// what the write may carry.
		await booted.payload.duplicate({
			collection: 'webhook-subscriptions',
			data: { name: 'mid-rotation copy 2' },
			id: String(created.id),
			overrideAccess: false,
			user: { id: 'someone', collection: 'users' } as never,
		})
		const rawUnprivileged = await rawDocument(booted, 'mid-rotation copy 2')
		expect(rawUnprivileged.previousSecret ?? null).toBeNull()
		expect(rawUnprivileged.previousSecretExpiresAt ?? null).toBeNull()
		expect(isSealed(rawUnprivileged.secret)).toBe(true)
		expect(rawUnprivileged.secret).not.toBe((await rawDocument(booted, 'mid-rotation')).secret)
	})

	it('clears a retired secret whose grace window has closed on the next write', async () => {
		const created = await create(booted, 'lapsed-cleanup')
		await booted.payload.update({
			collection: 'webhook-subscriptions',
			id: String(created.id),
			data: {
				previousSecret: generateSecret(),
				previousSecretExpiresAt: new Date(Date.now() - 60_000).toISOString(),
			},
			overrideAccess: true,
		})
		expect((await rawDocument(booted, 'lapsed-cleanup')).previousSecret).toBeTruthy()

		await booted.payload.update({
			collection: 'webhook-subscriptions',
			id: String(created.id),
			data: { name: 'lapsed-cleanup renamed' },
			overrideAccess: true,
		})

		const raw = await rawDocument(booted, 'lapsed-cleanup renamed')
		expect(raw.previousSecret).toBeNull()
		expect(raw.previousSecretExpiresAt).toBeNull()
		// The active secret is untouched by the cleanup.
		expect(isSealed(raw.secret)).toBe(true)
	})

	it('survives a fresh Payload initialization against the same database', async () => {
		const created = await create(booted, 'restart')
		const plaintext = String(created[GENERATED_SECRET_KEY])

		const restarted = await bootPayload({
			plugin: webhooks({ collections: { posts: true }, delivery: { mode: 'inline', retries: 0 } }),
			db: 'mongo',
			collections: [posts],
			attachTo: booted,
		})
		try {
			const reread = await restarted.payload.findByID({
				collection: 'webhook-subscriptions',
				id: String(created.id),
				overrideAccess: true,
			})
			expect(reread.secret).toBeUndefined()
			expect(reread.secret_set).toBe(true)

			const raw = await rawDocument(restarted, 'restart')
			expect(isSealed(raw.secret)).toBe(true)
			expect(JSON.stringify(raw)).not.toContain(plaintext.slice(SECRET_PREFIX.length))
		} finally {
			await restarted.stop()
		}
	})
})

/**
 * The key ring is what lets an operator change `PAYLOAD_SECRET` without stranding every stored
 * secret, so the id has to actually reach the wire format and a key that is still in the ring has
 * to keep opening what it sealed.
 */
describe('secretEncryption.keys', () => {
	let booted: BootedPayload

	const withKeys = (keys: Record<string, string>, active: string) =>
		bootPayload({
			plugin: webhooks({
				collections: { posts: true },
				delivery: { mode: 'inline', retries: 0 },
				secretEncryption: { keys: { active, keys } },
			}),
			db: 'mongo',
			collections: [posts],
			attachTo: booted,
		})

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: webhooks({
				collections: { posts: true },
				delivery: { mode: 'inline', retries: 0 },
				secretEncryption: {
					keys: { active: 'k1', keys: { k1: 'k1-key-material-32-bytes-long!!' } },
				},
			}),
			db: 'mongo',
			collections: [posts],
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('seals under the configured active key, naming it in the stored value', async () => {
		await create(booted, 'ringed')
		const raw = await rawDocument(booted, 'ringed')
		expect(String(raw.secret).startsWith('pfe1.k1.')).toBe(true)
	})

	it('keeps opening a value after a newer key becomes active', async () => {
		const created = await create(booted, 'rotated-ring')
		const plaintext = String(created[GENERATED_SECRET_KEY])

		const rotated = await withKeys(
			{ k1: 'k1-key-material-32-bytes-long!!', k2: 'k2-key-material-32-bytes-long!!' },
			'k2'
		)
		try {
			const handle = await readEncryptedField(rotated.payload, {
				collection: 'webhook-subscriptions',
				id: String(created.id),
				path: 'secret',
			})
			expect(await handle?.decrypt()).toBe(plaintext)
		} finally {
			await rotated.stop()
		}
	})

	it('refuses the delivery when the sealing key is dropped from the ring', async () => {
		const created = await create(booted, 'dropped-key')

		const withoutK1 = await withKeys({ k2: 'k2-key-material-32-bytes-long!!' }, 'k2')
		try {
			const handle = await readEncryptedField(withoutK1.payload, {
				collection: 'webhook-subscriptions',
				id: String(created.id),
				path: 'secret',
			})
			await expect(handle?.decrypt()).rejects.toThrow(/no key configured for keyId/)
		} finally {
			await withoutK1.stop()
		}
	})
})
