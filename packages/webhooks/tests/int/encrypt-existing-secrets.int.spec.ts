import { type BootedPayload, bootPayload } from '@10x-media/payload-test-harness'
import type { CollectionConfig } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SECRET_MASK, SECRET_PREFIX, SECRET_REVEAL_CONTEXT } from '../../src/constants'
import { encryptExistingSecrets, webhooks } from '../../src/index'
import { isEncryptedSecret } from '../../src/secrets/crypto'

const posts: CollectionConfig = { slug: 'posts', fields: [{ name: 'title', type: 'text' }] }

/** A pre-encryption secret: 24 random bytes as hex, exactly what the old generator produced. */
const LEGACY_SECRET = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718'

describe('encryptExistingSecrets', () => {
	let booted: BootedPayload

	const collection = () => {
		const { connection } = booted.payload.db as unknown as {
			connection: {
				collection: (name: string) => {
					findOne: (filter: Record<string, unknown>) => Promise<Record<string, unknown> | null>
					updateOne: (
						filter: Record<string, unknown>,
						update: Record<string, unknown>
					) => Promise<unknown>
				}
			}
		}
		return connection.collection('webhook-subscriptions')
	}

	/** Force a row back to the legacy shape: plaintext, unprefixed, untagged. */
	const makeLegacy = async (name: string, secret = LEGACY_SECRET) => {
		const created = await booted.payload.create({
			collection: 'webhook-subscriptions',
			data: { name, url: 'https://example.test', events: [] },
			overrideAccess: true,
		})
		await collection().updateOne({ name }, { $set: { secret } })
		return created
	}

	const rawSecret = async (name: string) => (await collection().findOne({ name }))?.secret

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

	const clear = () =>
		booted.payload.delete({ collection: 'webhook-subscriptions', where: {}, overrideAccess: true })

	it('encrypts a legacy plaintext secret in place, keeping its characters', async () => {
		await clear()
		await makeLegacy('legacy')
		expect(await rawSecret('legacy')).toBe(LEGACY_SECRET)

		const report = await encryptExistingSecrets(booted.payload)
		expect(report).toMatchObject({ scanned: 1, migrated: 1, alreadyEncrypted: 0, failed: [] })

		const stored = await rawSecret('legacy')
		expect(isEncryptedSecret(stored)).toBe(true)
		expect(String(stored)).not.toContain(LEGACY_SECRET)
	})

	it('leaves the operator holding a usable secret: the old value plus the prefix', async () => {
		await clear()
		const created = await makeLegacy('recoverable')
		await encryptExistingSecrets(booted.payload)

		const rotated = await booted.payload.findByID({
			collection: 'webhook-subscriptions',
			id: String(created.id),
			overrideAccess: true,
			context: { [SECRET_REVEAL_CONTEXT.forSigning]: true },
		})
		expect(rotated.secret).toBe(`${SECRET_PREFIX}${LEGACY_SECRET}`)
	})

	it('is idempotent, so a repeated run changes nothing', async () => {
		await clear()
		await makeLegacy('twice')
		await encryptExistingSecrets(booted.payload)
		const afterFirst = await rawSecret('twice')

		const report = await encryptExistingSecrets(booted.payload)
		expect(report).toMatchObject({ scanned: 1, migrated: 0, alreadyEncrypted: 1, failed: [] })
		expect(await rawSecret('twice')).toBe(afterFirst)
	})

	it('leaves already-encrypted rows untouched', async () => {
		await clear()
		await booted.payload.create({
			collection: 'webhook-subscriptions',
			data: { name: 'modern', url: 'https://example.test', events: [] },
			overrideAccess: true,
		})
		const before = await rawSecret('modern')

		const report = await encryptExistingSecrets(booted.payload)
		expect(report).toMatchObject({ migrated: 0, alreadyEncrypted: 1, failed: [] })
		expect(await rawSecret('modern')).toBe(before)
	})

	it('reports a secret it cannot normalize instead of rewriting it', async () => {
		await clear()
		await makeLegacy('unusable', 'not base64!!')

		const report = await encryptExistingSecrets(booted.payload)
		expect(report.migrated).toBe(0)
		expect(report.failed).toHaveLength(1)
		expect(report.failed[0]?.reason).toMatch(/base64/)
		expect(await rawSecret('unusable')).toBe('not base64!!')
	})

	it('changes nothing on a dry run', async () => {
		await clear()
		await makeLegacy('dry')

		const report = await encryptExistingSecrets(booted.payload, { dryRun: true })
		expect(report).toMatchObject({ scanned: 1, migrated: 1 })
		expect(await rawSecret('dry')).toBe(LEGACY_SECRET)
	})

	it('pages through more rows than one batch', async () => {
		await clear()
		for (let i = 0; i < 5; i++) {
			await makeLegacy(`batched-${i}`)
		}

		const report = await encryptExistingSecrets(booted.payload, { batchSize: 2 })
		expect(report).toMatchObject({ scanned: 5, migrated: 5, failed: [] })
		for (let i = 0; i < 5; i++) {
			expect(isEncryptedSecret(await rawSecret(`batched-${i}`))).toBe(true)
		}
	})

	it('counts a row carrying no secret separately from one already encrypted', async () => {
		await clear()
		await makeLegacy('empty')
		await collection().updateOne({ name: 'empty' }, { $unset: { secret: '' } })

		const report = await encryptExistingSecrets(booted.payload)
		expect(report).toMatchObject({
			alreadyEncrypted: 0,
			migrated: 0,
			noSecret: 1,
			scanned: 1,
		})
	})

	/**
	 * One unusable field is no reason to leave a recoverable one in plaintext, so the row migrates
	 * what it can and reports the rest by field.
	 */
	it('migrates the fields it can when a sibling field is unusable, reporting that field', async () => {
		await clear()
		await makeLegacy('partial')
		await collection().updateOne({ name: 'partial' }, { $set: { previousSecret: 'not base64!!' } })

		const report = await encryptExistingSecrets(booted.payload)
		expect(report.migrated).toBe(1)
		expect(report.failed).toEqual([
			{ field: 'previousSecret', id: expect.any(String), reason: expect.stringMatching(/base64/) },
		])

		const row = await collection().findOne({ name: 'partial' })
		expect(isEncryptedSecret(row?.secret)).toBe(true)
		expect(row?.previousSecret).toBe('not base64!!')
	})

	it('names the field on a failure so an operator knows which one to rotate', async () => {
		await clear()
		await makeLegacy('named', 'not base64!!')

		const report = await encryptExistingSecrets(booted.payload)
		expect(report.failed[0]?.field).toBe('secret')
		expect(report).toMatchObject({ alreadyEncrypted: 0, migrated: 0, noSecret: 0 })
	})

	it('keeps reads masked after migrating', async () => {
		await clear()
		const created = await makeLegacy('masked-after')
		await encryptExistingSecrets(booted.payload)

		const reread = await booted.payload.findByID({
			collection: 'webhook-subscriptions',
			id: String(created.id),
			overrideAccess: true,
		})
		expect(reread.secret).toBe(SECRET_MASK)
	})
})
