import { type BootedPayload, bootPayload } from '@10x-media/payload-test-harness'
import type { CollectionConfig } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CIPHER_PREFIX, SECRET_MASK, SECRET_PREFIX } from '../../src/constants'
import { webhooks } from '../../src/index'
import { isEncryptedSecret } from '../../src/secrets/crypto'
import { generateSecret } from '../../src/secrets/format'

const posts: CollectionConfig = { slug: 'posts', fields: [{ name: 'title', type: 'text' }] }

/**
 * The stored document straight from the mongo driver, bypassing Payload's field hooks entirely.
 * An API response cannot prove encryption at rest: the mask hook shapes it either way. Rows are
 * looked up by their unique `name` so the assertion needs no ObjectId construction.
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

	it('stores ciphertext, not the plaintext secret, for a generated secret', async () => {
		const created = await booted.payload.create({
			collection: 'webhook-subscriptions',
			data: { name: 'generated', url: 'https://example.test', events: [] },
			overrideAccess: true,
		})
		const plaintext = String(created.secret)
		expect(plaintext.startsWith(SECRET_PREFIX)).toBe(true)

		const raw = await rawDocument(booted, 'generated')
		expect(isEncryptedSecret(raw.secret)).toBe(true)
		expect(String(raw.secret).startsWith(CIPHER_PREFIX)).toBe(true)
		expect(raw.secret).not.toBe(plaintext)
		expect(JSON.stringify(raw)).not.toContain(plaintext)
		expect(JSON.stringify(raw)).not.toContain(plaintext.slice(SECRET_PREFIX.length))
	})

	it('stores ciphertext for a customer-supplied secret too', async () => {
		const supplied = generateSecret()
		const created = await booted.payload.create({
			collection: 'webhook-subscriptions',
			data: { name: 'supplied', url: 'https://example.test', events: [], secret: supplied },
			overrideAccess: true,
		})
		expect(created.secret).toBe(supplied)

		const raw = await rawDocument(booted, 'supplied')
		expect(isEncryptedSecret(raw.secret)).toBe(true)
		expect(JSON.stringify(raw)).not.toContain(supplied.slice(SECRET_PREFIX.length))
	})

	it('keeps normal reads masked while the row holds ciphertext', async () => {
		const created = await booted.payload.create({
			collection: 'webhook-subscriptions',
			data: { name: 'masked', url: 'https://example.test', events: [] },
			overrideAccess: true,
		})
		const reread = await booted.payload.findByID({
			collection: 'webhook-subscriptions',
			id: String(created.id),
			overrideAccess: true,
		})
		expect(reread.secret).toBe(SECRET_MASK)

		const raw = await rawDocument(booted, 'masked')
		expect(raw.secret).not.toBe(SECRET_MASK)
		expect(isEncryptedSecret(raw.secret)).toBe(true)
	})

	it('does not re-encrypt on an unrelated update', async () => {
		const created = await booted.payload.create({
			collection: 'webhook-subscriptions',
			data: { name: 'stable', url: 'https://example.test', events: [] },
			overrideAccess: true,
		})
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

	it('survives a fresh Payload initialization against the same database', async () => {
		const created = await booted.payload.create({
			collection: 'webhook-subscriptions',
			data: { name: 'restart', url: 'https://example.test', events: [] },
			overrideAccess: true,
		})
		const plaintext = String(created.secret)

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
			expect(reread.secret).toBe(SECRET_MASK)

			const raw = await rawDocument(restarted, 'restart')
			expect(isEncryptedSecret(raw.secret)).toBe(true)
			expect(JSON.stringify(raw)).not.toContain(plaintext.slice(SECRET_PREFIX.length))
		} finally {
			await restarted.stop()
		}
	})
})
