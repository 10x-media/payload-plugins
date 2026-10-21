import { isSealed, readEncryptedField } from '@10x-media/fields/encrypted'
import { type BootedPayload, bootPayload } from '@10x-media/payload-test-harness'
import type { CollectionConfig } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SECRET_PREFIX } from '../../src/constants'
import { encryptExistingSecrets, webhooks } from '../../src/index'
import { LOCAL_SINK } from './localSink'

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
			plugin: webhooks({
				collections: { posts: true },
				delivery: { mode: 'inline', retries: 0, ...LOCAL_SINK },
			}),
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
		expect(isSealed(stored)).toBe(true)
		expect(String(stored)).not.toContain(LEGACY_SECRET)
	})

	/**
	 * Header values were plaintext before they were encrypted, and unlike the secret nothing
	 * refuses them at delivery, so without this they would sit in the clear until someone happened
	 * to save the subscription.
	 */
	it('seals custom header values stored before header encryption', async () => {
		await clear()
		await booted.payload.create({
			collection: 'webhook-subscriptions',
			data: {
				name: 'headers',
				url: 'https://example.test',
				events: [],
				headers: [{ key: 'Authorization', value: 'Bearer receiver-t0ken' }],
			},
			overrideAccess: true,
		})
		await collection().updateOne(
			{ name: 'headers' },
			{ $set: { 'headers.0.value': 'Bearer legacy-t0ken' } }
		)

		const dry = await encryptExistingSecrets(booted.payload, { dryRun: true })
		expect(dry.headersSealed).toBe(1)
		const untouched = (await collection().findOne({ name: 'headers' }))?.headers as {
			value: unknown
		}[]
		expect(untouched[0]?.value).toBe('Bearer legacy-t0ken')

		const report = await encryptExistingSecrets(booted.payload)
		expect(report).toMatchObject({ headersSealed: 1, failed: [] })
		const stored = (await collection().findOne({ name: 'headers' }))?.headers as {
			value: unknown
		}[]
		expect(isSealed(stored[0]?.value)).toBe(true)

		const read = await booted.payload.find({
			collection: 'webhook-subscriptions',
			where: { name: { equals: 'headers' } },
			overrideAccess: true,
		})
		expect(read.docs[0]?.headers?.[0]?.value).toBe('Bearer legacy-t0ken')
		// Idempotent: a second run finds nothing left to seal.
		expect((await encryptExistingSecrets(booted.payload)).headersSealed).toBe(0)
	})

	/**
	 * Payload validates the whole stored row on every update. A header name that has since become
	 * reserved is not something this run is changing, so it must not hold the row's secret back.
	 */
	it('migrates the secret of a row whose stored header name has since become reserved', async () => {
		await clear()
		await booted.payload.create({
			collection: 'webhook-subscriptions',
			data: {
				name: 'reserved-header',
				url: 'https://example.test',
				events: [],
				headers: [{ key: 'X-Route', value: 'a' }],
			},
			overrideAccess: true,
		})
		await collection().updateOne(
			{ name: 'reserved-header' },
			{
				$set: {
					secret: LEGACY_SECRET,
					'headers.0.key': 'Host',
					'headers.0.value': 'legacy.internal',
				},
			}
		)

		const report = await encryptExistingSecrets(booted.payload)
		expect(report).toMatchObject({ migrated: 1, headersSealed: 1, failed: [] })
		expect(isSealed(await rawSecret('reserved-header'))).toBe(true)
	})

	/** One row that will not save must be reported by id, not end the run for every row after it. */
	it('reports a row that fails to save and carries on with the rest', async () => {
		await clear()
		const broken = await makeLegacy('broken')
		await makeLegacy('fine')
		// A stored row that no longer satisfies a required field, whatever the reason.
		await collection().updateOne({ name: 'broken' }, { $unset: { url: '' } })

		const report = await encryptExistingSecrets(booted.payload)
		expect(report.scanned).toBe(2)
		expect(report.migrated).toBe(1)
		expect(report.failed).toHaveLength(1)
		expect(report.failed[0]).toMatchObject({ field: 'secret', id: String(broken.id) })
		expect(isSealed(await rawSecret('fine'))).toBe(true)
	})

	it('leaves the operator holding a usable secret: the old value plus the prefix', async () => {
		await clear()
		const created = await makeLegacy('recoverable')
		await encryptExistingSecrets(booted.payload)

		const handle = await readEncryptedField(booted.payload, {
			collection: 'webhook-subscriptions',
			id: String(created.id),
			path: 'secret',
		})
		expect(await handle?.decrypt()).toBe(`${SECRET_PREFIX}${LEGACY_SECRET}`)
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
			expect(isSealed(await rawSecret(`batched-${i}`))).toBe(true)
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
		expect(isSealed(row?.secret)).toBe(true)
		// The unusable retired value is sealed along with the row rather than left in plaintext: it
		// cannot sign either way, and the report is what tells the operator its overlap is gone.
		expect(isSealed(row?.previousSecret)).toBe(true)
	})

	it('names the field on a failure so an operator knows which one to rotate', async () => {
		await clear()
		await makeLegacy('named', 'not base64!!')

		const report = await encryptExistingSecrets(booted.payload)
		expect(report.failed[0]?.field).toBe('secret')
		expect(report).toMatchObject({ alreadyEncrypted: 0, migrated: 0, noSecret: 0 })
	})

	it('keeps the secret out of every read after migrating', async () => {
		await clear()
		const created = await makeLegacy('stripped-after')
		await encryptExistingSecrets(booted.payload)

		const reread = await booted.payload.findByID({
			collection: 'webhook-subscriptions',
			id: String(created.id),
			overrideAccess: true,
		})
		expect(reread.secret).toBeUndefined()
		expect(reread.secret_set).toBe(true)
		expect(JSON.stringify(reread)).not.toContain(LEGACY_SECRET)
	})
})
