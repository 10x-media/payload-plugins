import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig, GlobalConfig } from 'payload'
import { createLocalReq, initTransaction, killTransaction } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
	decryptFieldValue,
	encryptedField,
	readEncryptedField,
	withRawEncrypted,
} from '../../src/exports/encrypted'
import { WIRE_PREFIX } from '../../src/fields/encrypted/crypto/wire'
import { fields } from '../../src/index'

const LEXICAL = {
	root: {
		children: [
			{
				children: [{ text: 'server notes', type: 'text', version: 1 }],
				direction: null,
				format: '',
				indent: 0,
				type: 'paragraph',
				version: 1,
			},
		],
		direction: null,
		format: '',
		indent: 0,
		type: 'root',
		version: 1,
	},
}

const sealedShape = (value: unknown): boolean =>
	typeof value === 'string' && value.startsWith(`${WIRE_PREFIX}.`) && value.split('.').length === 5

const credentials: CollectionConfig = {
	slug: 'credentials',
	fields: [
		{ name: 'title', type: 'text' },
		...encryptedField({ name: 'apiKey', type: 'text' }, { protection: 'writeOnly' }),
		...encryptedField(
			{ name: 'hintedKey', type: 'text' },
			{ hint: { prefix: 4, suffix: 4 }, protection: 'writeOnly' }
		),
		...encryptedField({ name: 'config', type: 'json' }, { protection: 'writeOnly' }),
		...encryptedField({ hasMany: true, name: 'tokens', type: 'text' }, { protection: 'writeOnly' }),
		...encryptedField(
			{ localized: true, name: 'localSecret', type: 'text' },
			{ protection: 'writeOnly' }
		),
		...encryptedField(
			{
				name: 'guardedSecret',
				type: 'text',
				validate: (value: unknown) => (value === 'forbidden' ? 'guarded says no' : true),
			},
			{ protection: 'writeOnly' }
		),
		...encryptedField({ name: 'visible', type: 'text' }),
	],
}

const services: CollectionConfig = {
	slug: 'services',
	fields: [
		{ name: 'name', type: 'text' },
		{ name: 'credential', relationTo: 'credentials', type: 'relationship' },
	],
}

const smtp: GlobalConfig = {
	slug: 'smtp',
	fields: [
		{ name: 'host', type: 'text' },
		{
			name: 'auth',
			type: 'group',
			fields: [...encryptedField({ name: 'password', type: 'text' }, { protection: 'writeOnly' })],
		},
		...encryptedField({ name: 'notes', type: 'richText' }),
	],
}

describeForDb('encrypted write-only protection', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			collections: [credentials, services],
			configOverrides: {
				globals: [smtp],
				localization: { defaultLocale: 'en', fallback: true, locales: ['en', 'de'] },
			},
			db,
			plugin: fields({}),
		})
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	describe('read results never carry the field', () => {
		it('strips the value from create and findByID results, exposing set-ness only', async () => {
			const created = await booted.payload.create({
				collection: 'credentials',
				data: { apiKey: 'sk-live-123', title: 'stripped', visible: 'plain' },
			})
			expect(created.apiKey).toBeUndefined()
			expect(created.apiKey_set).toBe(true)

			const read = await booted.payload.findByID({ collection: 'credentials', id: created.id })
			expect(read.apiKey).toBeUndefined()
			expect(read.apiKey_set).toBe(true)
			// A sibling masked field still decrypts: writeOnly is per-field.
			expect(read.visible).toBe('plain')
		})

		it('strips across list reads and reports unset docs as such', async () => {
			const unset = await booted.payload.create({
				collection: 'credentials',
				data: { title: 'unset' },
			})
			const list = await booted.payload.find({
				collection: 'credentials',
				where: { title: { in: ['stripped', 'unset'] } },
			})
			for (const doc of list.docs) {
				expect(doc.apiKey).toBeUndefined()
			}
			const unsetDoc = list.docs.find((doc) => doc.id === unset.id)
			expect(unsetDoc?.apiKey_set).toBe(false)
		})

		it('strips write-only and richText ciphertext paths from global reads', async () => {
			await booted.payload.updateGlobal({
				slug: 'smtp',
				data: { auth: { password: 'hunter2' }, host: 'mail.example.com', notes: LEXICAL },
			})
			const settings = await booted.payload.findGlobal({ slug: 'smtp' })
			expect(settings.host).toBe('mail.example.com')
			expect(settings.auth?.password).toBeUndefined()
			expect(settings.auth?.password_set).toBe(true)
			// The richText ciphertext sibling is stripped from globals too.
			expect(settings.notes_encrypted).toBeUndefined()
			expect(settings.notes).toEqual(LEXICAL)
		})
	})

	describe('write semantics', () => {
		it('an untouched update preserves the stored secret', async () => {
			const created = await booted.payload.create({
				collection: 'credentials',
				data: { apiKey: 'keep-me', title: 'untouched' },
			})
			await booted.payload.update({
				collection: 'credentials',
				data: { title: 'renamed' },
				id: created.id,
			})
			const secret = await readEncryptedField(booted.payload, {
				collection: 'credentials',
				id: created.id,
				path: 'apiKey',
			})
			expect(await secret?.decrypt()).toBe('keep-me')
		})

		it('a new value replaces the secret; an explicit null clears it', async () => {
			const created = await booted.payload.create({
				collection: 'credentials',
				data: { apiKey: 'first', title: 'replace-clear' },
			})
			await booted.payload.update({
				collection: 'credentials',
				data: { apiKey: 'second' },
				id: created.id,
			})
			const replaced = await readEncryptedField(booted.payload, {
				collection: 'credentials',
				id: created.id,
				path: 'apiKey',
			})
			expect(await replaced?.decrypt()).toBe('second')

			const cleared = await booted.payload.update({
				collection: 'credentials',
				data: { apiKey: null },
				id: created.id,
			})
			expect(cleared.apiKey_set).toBe(false)
			const gone = await readEncryptedField(booted.payload, {
				collection: 'credentials',
				id: created.id,
				path: 'apiKey',
			})
			expect(gone).toBeNull()
		})

		it('maintains the identification hint through set, replace, and clear', async () => {
			const created = await booted.payload.create({
				collection: 'credentials',
				data: { hintedKey: 'sk_demo_a1b2c3d4e5f6a7b8c9d0e1f2a3b49d3f', title: 'hinted' },
			})
			// The hint is the identification surface: present in reads, not stripped.
			expect(created.hintedKey).toBeUndefined()
			expect(created.hintedKey_hint).toBe('sk_d····9d3f')

			const replaced = await booted.payload.update({
				collection: 'credentials',
				data: { hintedKey: 'sk_next_00000000000000000000000000ffff' },
				id: created.id,
			})
			expect(replaced.hintedKey_hint).toBe('sk_n····ffff')

			// An untouched update leaves the hint (and the value) alone.
			const untouched = await booted.payload.update({
				collection: 'credentials',
				data: { title: 'renamed' },
				id: created.id,
			})
			expect(untouched.hintedKey_hint).toBe('sk_n····ffff')

			const cleared = await booted.payload.update({
				collection: 'credentials',
				data: { hintedKey: null },
				id: created.id,
			})
			expect(cleared.hintedKey_hint).toBeNull()
			expect(cleared.hintedKey_set).toBe(false)
		})

		it('stores no hint for a value too short to hint safely', async () => {
			const created = await booted.payload.create({
				collection: 'credentials',
				data: { hintedKey: 'tiny-secret', title: 'short-hint' },
			})
			expect(created.hintedKey_hint).toBeNull()
			expect(created.hintedKey_set).toBe(true)
		})

		it('treats an empty-string write as a clear, like null', async () => {
			// The admin never submits '' (its empty input means "keep"), so this
			// covers direct API writers: '' must not become a sealed empty secret
			// that reads as set but can never be diagnosed.
			const created = await booted.payload.create({
				collection: 'credentials',
				data: { hintedKey: 'sk_demo_a1b2c3d4e5f6a7b8c9d0e1f2a3b49d3f', title: 'empty-string' },
			})
			const emptied = await booted.payload.update({
				collection: 'credentials',
				data: { hintedKey: '' },
				id: created.id,
			})
			expect(emptied.hintedKey_set).toBe(false)
			expect(emptied.hintedKey_hint).toBeNull()
			const gone = await readEncryptedField(booted.payload, {
				collection: 'credentials',
				id: created.id,
				path: 'hintedKey',
			})
			expect(gone).toBeNull()
		})

		it('still validates the incoming plaintext', async () => {
			// Payload surfaces the field's own validate message inside the
			// ValidationError's per-field errors, not the generic top-level message.
			await expect(
				booted.payload.create({
					collection: 'credentials',
					data: { guardedSecret: 'forbidden', title: 'guarded' },
				})
			).rejects.toMatchObject({
				data: {
					errors: expect.arrayContaining([
						expect.objectContaining({ message: 'guarded says no', path: 'guardedSecret' }),
					]),
				},
			})
		})
	})

	describe('deliberate server-side reads', () => {
		it('readEncryptedField hands out cacheable ciphertext and on-demand decrypt', async () => {
			const created = await booted.payload.create({
				collection: 'credentials',
				data: { apiKey: 'sk-cache', title: 'handle' },
			})
			const secret = await readEncryptedField(booted.payload, {
				collection: 'credentials',
				id: created.id,
				path: 'apiKey',
			})
			expect(sealedShape(secret?.ciphertext)).toBe(true)
			expect(await secret?.decrypt()).toBe('sk-cache')
			// The cached wire string decrypts later without another read.
			const fromCache = await decryptFieldValue(booted.payload, {
				collection: 'credentials',
				path: 'apiKey',
				value: secret?.ciphertext as string,
			})
			expect(fromCache).toBe('sk-cache')
		})

		it('round-trips non-string plaintext (json) through decrypt', async () => {
			const config = { retries: 3, urls: ['https://a', 'https://b'] }
			const created = await booted.payload.create({
				collection: 'credentials',
				data: { config, title: 'json' },
			})
			const secret = await readEncryptedField(booted.payload, {
				collection: 'credentials',
				id: created.id,
				path: 'config',
			})
			expect(await secret?.decrypt()).toEqual(config)
		})

		it('hasMany fields decrypt item-wise', async () => {
			const created = await booted.payload.create({
				collection: 'credentials',
				data: { title: 'many', tokens: ['tok-1', 'tok-2'] },
			})
			const secret = await readEncryptedField(booted.payload, {
				collection: 'credentials',
				id: created.id,
				path: 'tokens',
			})
			expect(Array.isArray(secret?.ciphertext)).toBe(true)
			expect(await secret?.decrypt()).toEqual(['tok-1', 'tok-2'])
		})

		it('localized values decrypt per locale', async () => {
			const created = await booted.payload.create({
				collection: 'credentials',
				data: { localSecret: 'english', title: 'localized' },
				locale: 'en',
			})
			await booted.payload.update({
				collection: 'credentials',
				data: { localSecret: 'deutsch' },
				id: created.id,
				locale: 'de',
			})
			const en = await readEncryptedField(booted.payload, {
				collection: 'credentials',
				id: created.id,
				locale: 'en',
				path: 'localSecret',
			})
			const de = await readEncryptedField(booted.payload, {
				collection: 'credentials',
				id: created.id,
				locale: 'de',
				path: 'localSecret',
			})
			expect(await en?.decrypt()).toBe('english')
			expect(await de?.decrypt()).toBe('deutsch')
		})

		it('reads a group-nested global secret by dot path', async () => {
			const secret = await readEncryptedField(booted.payload, {
				global: 'smtp',
				path: 'auth.password',
			})
			expect(await secret?.decrypt()).toBe('hunter2')
		})

		it('rejects ambiguous or unknown targets with clear errors', async () => {
			await expect(
				readEncryptedField(booted.payload, { collection: 'credentials', path: 'apiKey' })
			).rejects.toThrow(/needs an 'id'/)
			await expect(
				readEncryptedField(booted.payload, {
					collection: 'credentials',
					global: 'smtp',
					id: 1,
					path: 'apiKey',
				})
			).rejects.toThrow(/exactly one/)
			await expect(
				readEncryptedField(booted.payload, { global: 'nope', path: 'x' })
			).rejects.toThrow(/no global/)
			await expect(
				decryptFieldValue(booted.payload, {
					collection: 'credentials',
					path: 'title',
					value: 'pfe1.a.b.c.d',
				})
			).rejects.toThrow(/not an encrypted field/)
		})
	})
	describe("reads that join the caller's request", () => {
		it('sees a secret written in the same open transaction', async () => {
			const req = await createLocalReq({}, booted.payload)
			const opened = await initTransaction(req)
			expect(opened).toBe(true)
			try {
				const created = await booted.payload.create({
					collection: 'credentials',
					data: { apiKey: 'sk-in-flight', title: 'in-flight' },
					req,
				})
				const handle = await readEncryptedField(booted.payload, {
					collection: 'credentials',
					id: created.id,
					path: 'apiKey',
					req,
				})
				expect(await handle?.decrypt()).toBe('sk-in-flight')
			} finally {
				await killTransaction(req)
			}
		})

		/**
		 * Without the request the read runs on its own, outside the transaction, so
		 * the row it is asked for does not exist yet. That is the failure the `req`
		 * argument exists to prevent, and pinning it here keeps the two paths from
		 * quietly converging.
		 */
		it('cannot see that same secret without the request', async () => {
			const req = await createLocalReq({}, booted.payload)
			const opened = await initTransaction(req)
			expect(opened).toBe(true)
			try {
				const created = await booted.payload.create({
					collection: 'credentials',
					data: { apiKey: 'sk-invisible', title: 'invisible' },
					req,
				})
				// Specifically not-found. A bare rejection would also be satisfied by the
				// helper failing for some unrelated reason, which would make this pass
				// while proving nothing about isolation.
				await expect(
					readEncryptedField(booted.payload, {
						collection: 'credentials',
						id: created.id,
						path: 'apiKey',
					})
				).rejects.toMatchObject({ status: 404 })
			} finally {
				await killTransaction(req)
			}
		})

		/**
		 * A request reading every locale at once hands documents back as
		 * `{ [locale]: value }` maps, which a single handle cannot address. Passing
		 * a request chooses the transaction to read in, so it must not also change
		 * which value comes back: the read falls back to the default locale, the
		 * same one it uses with no request at all.
		 */
		it('resolves a localized field at the default locale when the request reads all of them', async () => {
			const created = await booted.payload.create({
				collection: 'credentials',
				data: { localSecret: 'english', title: 'all-locales' },
				locale: 'en',
			})
			await booted.payload.update({
				collection: 'credentials',
				data: { localSecret: 'deutsch' },
				id: created.id,
				locale: 'de',
			})

			const req = await createLocalReq({ locale: 'all' }, booted.payload)
			const handle = await readEncryptedField(booted.payload, {
				collection: 'credentials',
				id: created.id,
				path: 'localSecret',
				req,
			})
			expect(await handle?.decrypt()).toBe('english')
		})

		it("still honours an explicit locale over the request's", async () => {
			const created = await booted.payload.create({
				collection: 'credentials',
				data: { localSecret: 'english', title: 'explicit-locale' },
				locale: 'en',
			})
			await booted.payload.update({
				collection: 'credentials',
				data: { localSecret: 'deutsch' },
				id: created.id,
				locale: 'de',
			})

			const req = await createLocalReq({ locale: 'en' }, booted.payload)
			const handle = await readEncryptedField(booted.payload, {
				collection: 'credentials',
				id: created.id,
				locale: 'de',
				path: 'localSecret',
				req,
			})
			expect(await handle?.decrypt()).toBe('deutsch')
		})

		it('leaves the request able to read normally afterwards', async () => {
			const created = await booted.payload.create({
				collection: 'credentials',
				data: { apiKey: 'sk-restored', title: 'restored', visible: 'plain' },
			})
			const req = await createLocalReq({}, booted.payload)
			await readEncryptedField(booted.payload, {
				collection: 'credentials',
				id: created.id,
				path: 'apiKey',
				req,
			})

			const after = await booted.payload.findByID({
				collection: 'credentials',
				id: created.id,
				req,
			})
			expect(after.apiKey).toBeUndefined()
			expect(after.apiKey_set).toBe(true)
			expect(after.visible).toBe('plain')
		})
	})

	describe('batch reads through withRawEncrypted', () => {
		const seed = async (titles: string[]) => {
			for (const title of titles) {
				await booted.payload.create({
					collection: 'credentials',
					data: { apiKey: `sk-${title}`, title, visible: `v-${title}` },
				})
			}
		}

		it('recovers a write-only field across many rows in one query', async () => {
			const titles = ['batch-a', 'batch-b', 'batch-c']
			await seed(titles)
			const req = await createLocalReq({}, booted.payload)

			const found = await withRawEncrypted(req, () =>
				booted.payload.find({
					collection: 'credentials',
					depth: 0,
					overrideAccess: true,
					req,
					sort: 'title',
					where: { title: { in: titles } },
				})
			)

			expect(found.docs).toHaveLength(3)
			const recovered = await Promise.all(
				found.docs.map(async (doc) => ({
					secret: await decryptFieldValue(booted.payload, {
						collection: 'credentials',
						path: 'apiKey',
						value: doc.apiKey as string,
					}),
					// Plain fields ride along, which is the point of running the caller's
					// own query rather than one lookup per row.
					title: doc.title,
				}))
			)
			expect(recovered).toEqual(titles.map((title) => ({ secret: `sk-${title}`, title })))
		})

		/**
		 * The mode travels on the request, so it suspends decrypt-on-read for every
		 * encrypted field the query touches, not only the write-only one the caller
		 * came for. Pinned because a caller reaching for one secret still has to
		 * decrypt the masked fields it reads alongside it.
		 */
		it('leaves masked fields sealed inside the window too', async () => {
			await seed(['batch-masked-inside'])
			const req = await createLocalReq({}, booted.payload)
			const found = await withRawEncrypted(req, () =>
				booted.payload.find({
					collection: 'credentials',
					depth: 0,
					overrideAccess: true,
					req,
					where: { title: { equals: 'batch-masked-inside' } },
				})
			)
			expect(sealedShape(found.docs[0]?.visible)).toBe(true)
			await expect(
				decryptFieldValue(booted.payload, {
					collection: 'credentials',
					path: 'visible',
					value: found.docs[0]?.visible as string,
				})
			).resolves.toBe('v-batch-masked-inside')
		})

		it('hands back wire strings, not plaintext, inside the window', async () => {
			await seed(['batch-wire'])
			const req = await createLocalReq({}, booted.payload)
			const found = await withRawEncrypted(req, () =>
				booted.payload.find({
					collection: 'credentials',
					depth: 0,
					overrideAccess: true,
					req,
					where: { title: { equals: 'batch-wire' } },
				})
			)
			expect(sealedShape(found.docs[0]?.apiKey)).toBe(true)
		})

		it('strips the field again on the same request once the window closes', async () => {
			await seed(['batch-closed'])
			const req = await createLocalReq({}, booted.payload)
			await withRawEncrypted(req, () =>
				booted.payload.find({
					collection: 'credentials',
					depth: 0,
					overrideAccess: true,
					req,
					where: { title: { equals: 'batch-closed' } },
				})
			)

			const after = await booted.payload.find({
				collection: 'credentials',
				req,
				where: { title: { equals: 'batch-closed' } },
			})
			expect(after.docs[0]?.apiKey).toBeUndefined()
			expect(after.docs[0]?.apiKey_set).toBe(true)
		})

		/**
		 * Relationship population at depth > 0 runs through the request dataloader,
		 * whose cache key does not include the context. The window swaps the loader
		 * for a private one, so a document populated inside it is cached as
		 * ciphertext only there: the normal read before primes the real loader, the
		 * raw read must not be served from that cache, and the normal read after
		 * must not be served from the window's.
		 */
		it('isolates relationship population from the request dataloader', async () => {
			const cred = await booted.payload.create({
				collection: 'credentials',
				data: { apiKey: 'sk-rel', title: 'rel', visible: 'v-rel' },
			})
			const service = await booted.payload.create({
				collection: 'services',
				data: { credential: cred.id, name: 'rel-svc' },
			})
			const req = await createLocalReq({}, booted.payload)

			const before = await booted.payload.findByID({
				collection: 'services',
				depth: 1,
				id: service.id,
				req,
			})
			const populatedBefore = before.credential as Record<string, unknown>
			expect(populatedBefore.visible).toBe('v-rel')
			expect(populatedBefore.apiKey).toBeUndefined()

			const during = await withRawEncrypted(req, () =>
				booted.payload.findByID({
					collection: 'services',
					depth: 1,
					id: service.id,
					overrideAccess: true,
					req,
				})
			)
			const populatedDuring = during.credential as Record<string, unknown>
			expect(sealedShape(populatedDuring.visible)).toBe(true)
			expect(sealedShape(populatedDuring.apiKey)).toBe(true)

			const after = await booted.payload.findByID({
				collection: 'services',
				depth: 1,
				id: service.id,
				req,
			})
			const populatedAfter = after.credential as Record<string, unknown>
			expect(populatedAfter.visible).toBe('v-rel')
			expect(populatedAfter.apiKey).toBeUndefined()
			expect(populatedAfter.apiKey_set).toBe(true)
		})

		it('leaves a masked field decrypting normally after the window', async () => {
			await seed(['batch-masked'])
			const req = await createLocalReq({}, booted.payload)
			await withRawEncrypted(req, () =>
				booted.payload.find({
					collection: 'credentials',
					depth: 0,
					overrideAccess: true,
					req,
					where: { title: { equals: 'batch-masked' } },
				})
			)

			const after = await booted.payload.find({
				collection: 'credentials',
				req,
				where: { title: { equals: 'batch-masked' } },
			})
			expect(after.docs[0]?.visible).toBe('v-batch-masked')
		})
	})
})
