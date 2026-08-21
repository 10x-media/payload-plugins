import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
	AuthenticationFailedError,
	decryptFieldValue,
	encryptedField,
	readEncryptedField,
	rotateEncryptedFields,
} from '../../src/exports/encrypted'
import { fields } from '../../src/index'

const SCOPE = 'acme:vault'

// `null` opts the apiKey out of the scope; `undefined` would trip the default.
const vault = (slug: string, apiKeyScope: null | string = SCOPE): CollectionConfig => ({
	slug,
	// The stable storage location: what lets two boots with different slugs see
	// one collection's rows, which is the shape of a slug rename in production.
	dbName: 'vault',
	fields: [
		{ name: 'title', type: 'text' },
		...encryptedField(
			{ name: 'apiKey', type: 'text' },
			{ aadScope: apiKeyScope ?? undefined, protection: 'writeOnly' }
		),
		...encryptedField({ name: 'unpinned', type: 'text' }, { protection: 'writeOnly' }),
		...encryptedField({ name: 'pinnedMasked', type: 'text' }, { aadScope: SCOPE }),
		...encryptedField(
			{ localized: true, name: 'localSecret', type: 'text' },
			{ aadScope: SCOPE, protection: 'writeOnly' }
		),
	],
})

describeForDb('encrypted aadScope', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			collections: [vault('vault')],
			configOverrides: {
				localization: { defaultLocale: 'en', fallback: true, locales: ['en', 'de'] },
			},
			db,
			plugin: fields({}),
		})
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	it('seals and reads back under a pinned scope, masked and write-only alike', async () => {
		const created = await booted.payload.create({
			collection: 'vault',
			data: { apiKey: 'sk-pinned', pinnedMasked: 'visible-on-read', title: 'roundtrip' },
		})
		const read = await booted.payload.findByID({ collection: 'vault', id: created.id })
		expect(read.pinnedMasked).toBe('visible-on-read')

		const handle = await readEncryptedField(booted.payload, {
			collection: 'vault',
			id: created.id,
			path: 'apiKey',
		})
		expect(await handle?.decrypt()).toBe('sk-pinned')
	})

	it('keeps the locale component of the binding under a pinned scope', async () => {
		const created = await booted.payload.create({
			collection: 'vault',
			data: { localSecret: 'english', title: 'localized' },
			locale: 'en',
		})
		await booted.payload.update({
			collection: 'vault',
			data: { localSecret: 'deutsch' },
			id: created.id,
			locale: 'de',
		})
		const en = await readEncryptedField(booted.payload, {
			collection: 'vault',
			id: created.id,
			locale: 'en',
			path: 'localSecret',
		})
		const de = await readEncryptedField(booted.payload, {
			collection: 'vault',
			id: created.id,
			locale: 'de',
			path: 'localSecret',
		})
		expect(await en?.decrypt()).toBe('english')
		expect(await de?.decrypt()).toBe('deutsch')
	})

	/**
	 * The scope must actually be in the binding, not merely accepted: the same
	 * schema minus the scope, reading the same rows, has to fail authentication.
	 * Same slug and columns on both boots, so this runs on both databases.
	 */
	it('is part of the AAD: a config without the scope cannot open the value', async () => {
		const created = await booted.payload.create({
			collection: 'vault',
			data: { apiKey: 'sk-bound', title: 'bound' },
		})
		const other = await bootPayload({
			attachTo: booted,
			collections: [vault('vault', null)],
			configOverrides: {
				localization: { defaultLocale: 'en', fallback: true, locales: ['en', 'de'] },
			},
			db,
			plugin: fields({}),
		})
		try {
			const handle = await readEncryptedField(other.payload, {
				collection: 'vault',
				id: created.id,
				path: 'apiKey',
			})
			await expect(handle?.decrypt()).rejects.toThrow(AuthenticationFailedError)
		} finally {
			await other.stop()
		}
	})

	/**
	 * Key rotation re-seals through the rotate branch, whose unseal candidates
	 * and re-seal AAD both have to honour the scope, or rotation would fail on
	 * exactly the fields the scope protects.
	 */
	it('rotates data keys under a pinned scope', async () => {
		const bootedK1 = await bootPayload({
			collections: [vault('vault')],
			configOverrides: {
				localization: { defaultLocale: 'en', fallback: true, locales: ['en', 'de'] },
			},
			db,
			plugin: fields({
				encrypted: { keys: { active: 'k1', keys: { k1: 'old-material-secret' } } },
			}),
		})
		try {
			const created = await bootedK1.payload.create({
				collection: 'vault',
				data: { apiKey: 'sk-rotates', title: 'rotates' },
			})
			const bootedK2 = await bootPayload({
				attachTo: bootedK1,
				collections: [vault('vault')],
				configOverrides: {
					localization: { defaultLocale: 'en', fallback: true, locales: ['en', 'de'] },
				},
				db,
				plugin: fields({
					encrypted: {
						keys: { active: 'k2', keys: { k1: 'old-material-secret', k2: 'new-material-secret' } },
					},
				}),
			})
			try {
				await rotateEncryptedFields(bootedK2.payload, { collections: ['vault'] })
				const handle = await readEncryptedField(bootedK2.payload, {
					collection: 'vault',
					id: created.id,
					path: 'apiKey',
				})
				expect((handle?.ciphertext as string).split('.')[1]).toBe('k2')
				expect(await handle?.decrypt()).toBe('sk-rotates')
			} finally {
				await bootedK2.stop()
			}
		} finally {
			await bootedK1.stop()
		}
	})
})

/**
 * The story the option exists for: a plugin-owned collection whose slug the
 * consumer renames after secrets exist. `dbName` keeps the rows findable, and
 * the pinned scope keeps them decryptable; the unpinned field on the same rows
 * shows what the rename costs without it.
 *
 * Mongo only: the second boot's different slug diverges the relationship
 * columns Payload derives per collection (locked documents, preferences), and
 * on Postgres that is a schema change the attach-time push cannot apply
 * non-interactively. The binding under test lives in the hooks, not the
 * adapter, and the cross-database block above already proves the scope on both.
 */
describe('encrypted aadScope survives a slug rename (mongo)', () => {
	let bootedA: BootedPayload

	beforeAll(async () => {
		bootedA = await bootPayload({
			collections: [vault('vault-a')],
			configOverrides: {
				localization: { defaultLocale: 'en', fallback: true, locales: ['en', 'de'] },
			},
			db: 'mongo',
			plugin: fields({}),
		})
	}, 240_000)

	afterAll(async () => {
		await bootedA.stop()
	})

	it('keeps pinned values readable and shows the unpinned ones failing', async () => {
		const created = await bootedA.payload.create({
			collection: 'vault-a',
			data: { apiKey: 'sk-survives', title: 'renamed', unpinned: 'sk-lost' },
		})

		const bootedB = await bootPayload({
			attachTo: bootedA,
			collections: [vault('vault-b')],
			configOverrides: {
				localization: { defaultLocale: 'en', fallback: true, locales: ['en', 'de'] },
			},
			db: 'mongo',
			plugin: fields({}),
		})
		try {
			const pinned = await readEncryptedField(bootedB.payload, {
				collection: 'vault-b',
				id: created.id,
				path: 'apiKey',
			})
			expect(await pinned?.decrypt()).toBe('sk-survives')

			const lost = await readEncryptedField(bootedB.payload, {
				collection: 'vault-b',
				id: created.id,
				path: 'unpinned',
			})
			await expect(lost?.decrypt()).rejects.toThrow(AuthenticationFailedError)

			// The cacheable primitive resolves the same binding from config alone.
			expect(
				await decryptFieldValue(bootedB.payload, {
					collection: 'vault-b',
					path: 'apiKey',
					value: pinned?.ciphertext as string,
				})
			).toBe('sk-survives')
		} finally {
			await bootedB.stop()
		}
	})
})
