import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { encryptedField, rotateEncryptedFields } from '../../src/exports/encrypted'
import { validateEncryptedBoot } from '../../src/fields/encrypted/boot'
import { resolveKeys } from '../../src/fields/encrypted/crypto/keys'
import { seal, WIRE_PREFIX } from '../../src/fields/encrypted/crypto/wire'
import { fields } from '../../src/index'

const LEXICAL = {
	root: {
		children: [
			{
				children: [{ text: 'classified', type: 'text', version: 1 }],
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

const vault: CollectionConfig = {
	slug: 'vault',
	fields: [
		{ name: 'title', type: 'text' },
		...encryptedField({ name: 'ssn', required: true, type: 'text' }),
		...encryptedField({ name: 'bio', type: 'textarea' }),
		...encryptedField({ name: 'contact', type: 'email' }),
		...encryptedField({ name: 'salary', type: 'number' }),
		...encryptedField({ name: 'vip', type: 'checkbox' }),
		...encryptedField({ name: 'birthday', type: 'date' }),
		...encryptedField({ name: 'tier', options: ['free', 'pro', 'max'], type: 'select' }),
		...encryptedField({
			hasMany: true,
			name: 'channels',
			options: ['mail', 'sms', 'push'],
			type: 'select',
		}),
		...encryptedField({ name: 'source', options: ['ad', 'friend'], type: 'radio' }),
		...encryptedField({ name: 'snippet', type: 'code' }),
		...encryptedField({ name: 'meta', type: 'json' }),
		...encryptedField({ name: 'location', type: 'point' }),
		...encryptedField({ name: 'story', type: 'richText' }),
		...encryptedField({ hasMany: true, name: 'aliases', type: 'text' }),
		...encryptedField({ localized: true, name: 'localNote', type: 'text' }),
		...encryptedField({
			name: 'guarded',
			type: 'text',
			validate: (value: unknown) => (value === 'forbidden' ? 'guarded says no' : true),
		}),
		...encryptedField({ name: 'fragileNull', type: 'text' }, { onDecryptFailure: 'null' }),
		...encryptedField({ name: 'fragilePass', type: 'text' }, { onDecryptFailure: 'passthrough' }),
		...encryptedField(
			{ name: 'fragileFn', type: 'text' },
			{ onDecryptFailure: () => '[unavailable]' }
		),
	],
}

const vaultDrafts: CollectionConfig = {
	slug: 'vault-drafts',
	fields: [{ name: 'title', type: 'text' }, ...encryptedField({ name: 'secret', type: 'text' })],
	versions: { drafts: true },
}

const FULL_DATA = {
	aliases: ['neo', 'anderson'],
	bio: 'multi\nline bio',
	birthday: '2001-02-03T04:05:06.000Z',
	channels: ['mail', 'push'],
	contact: 'Jane.Doe@Example.com',
	location: [13.405, 52.52],
	meta: { nested: { deep: true }, tags: ['a', 'b'] },
	salary: 123456.78,
	snippet: 'const x = 1',
	source: 'friend',
	ssn: '123-45-6789',
	story: LEXICAL,
	tier: 'pro',
	title: 'subject-1',
	vip: true,
}

describeForDb('encrypted fields', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			collections: [vault, vaultDrafts],
			configOverrides: {
				localization: { defaultLocale: 'en', fallback: true, locales: ['en', 'de'] },
			},
			db,
			plugin: fields({}),
		})
		// Mongo's init ensureIndexes covers config.collections but not the lazily
		// built `_<slug>_versions` models, so the first transactional version write
		// can race collection/index creation on a fresh replica set ("catalog
		// changes; please retry"). Build them up front to keep the drafts test
		// deterministic. Postgres pushes its full schema at boot, so this is a no-op.
		const versionsModel = (
			booted.payload.db as {
				versions?: Record<string, { ensureIndexes: () => Promise<unknown> } | undefined>
			}
		).versions?.['vault-drafts']
		await versionsModel?.ensureIndexes()
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	describe('per-type round-trip with ciphertext at rest', () => {
		it('round-trips every supported type through the local API', async () => {
			const created = await booted.payload.create({ collection: 'vault', data: FULL_DATA })
			const read = await booted.payload.findByID({ collection: 'vault', id: created.id })
			expect(read.ssn).toBe(FULL_DATA.ssn)
			expect(read.bio).toBe(FULL_DATA.bio)
			expect(read.contact).toBe(FULL_DATA.contact)
			expect(read.salary).toBe(FULL_DATA.salary)
			expect(read.vip).toBe(FULL_DATA.vip)
			expect(read.birthday).toBe(FULL_DATA.birthday)
			expect(read.tier).toBe(FULL_DATA.tier)
			expect(read.channels).toEqual(FULL_DATA.channels)
			expect(read.source).toBe(FULL_DATA.source)
			expect(read.snippet).toBe(FULL_DATA.snippet)
			expect(read.meta).toEqual(FULL_DATA.meta)
			expect(read.location).toEqual(FULL_DATA.location)
			expect(read.story).toEqual(LEXICAL)
			expect(read.aliases).toEqual(FULL_DATA.aliases)
		})

		it('stores sealed text at rest for every encrypted field (adapter-agnostic)', async () => {
			const created = await booted.payload.create({ collection: 'vault', data: FULL_DATA })
			const raw = await booted.payload.db.findOne<
				{ id: number | string } & Record<string, unknown>
			>({
				collection: 'vault',
				where: { id: { equals: created.id } },
			})
			expect(raw).not.toBeNull()
			for (const key of [
				'ssn',
				'bio',
				'contact',
				'birthday',
				'tier',
				'source',
				'snippet',
				'meta',
				'location',
				'story',
			]) {
				expect(sealedShape((raw as Record<string, unknown>)[key]), key).toBe(true)
			}
			// Number and boolean sources are sealed strings too: type survives via JSON.
			expect(sealedShape((raw as Record<string, unknown>).salary)).toBe(true)
			expect(sealedShape((raw as Record<string, unknown>).vip)).toBe(true)
			for (const item of (raw as Record<string, unknown>).aliases as unknown[]) {
				expect(sealedShape(item)).toBe(true)
			}
			for (const item of (raw as Record<string, unknown>).channels as unknown[]) {
				expect(sealedShape(item)).toBe(true)
			}
		})
	})

	describe('localized fields', () => {
		it('seals per locale and reads each locale plus all', async () => {
			const created = await booted.payload.create({
				collection: 'vault',
				data: { ...FULL_DATA, localNote: 'english note' },
				locale: 'en',
			})
			await booted.payload.update({
				collection: 'vault',
				data: { localNote: 'deutsche notiz' },
				id: created.id,
				locale: 'de',
			})
			const en = await booted.payload.findByID({
				collection: 'vault',
				id: created.id,
				locale: 'en',
			})
			const de = await booted.payload.findByID({
				collection: 'vault',
				id: created.id,
				locale: 'de',
			})
			expect(en.localNote).toBe('english note')
			expect(de.localNote).toBe('deutsche notiz')

			const all = await booted.payload.findByID({
				collection: 'vault',
				id: created.id,
				locale: 'all',
			})
			expect(all.localNote).toEqual({ de: 'deutsche notiz', en: 'english note' })

			const raw = await booted.payload.db.findOne<
				{ id: number | string } & Record<string, unknown>
			>({
				collection: 'vault',
				where: { id: { equals: created.id } },
			})
			const rawLocales = (raw as Record<string, unknown>).localNote as Record<string, string>
			expect(sealedShape(rawLocales.en)).toBe(true)
			expect(sealedShape(rawLocales.de)).toBe(true)
			expect(rawLocales.en).not.toBe(rawLocales.de)
		})

		it('serves the fallback locale value through fallback hoisting', async () => {
			const created = await booted.payload.create({
				collection: 'vault',
				data: { ...FULL_DATA, localNote: 'only english' },
				locale: 'en',
			})
			const de = await booted.payload.findByID({
				collection: 'vault',
				fallbackLocale: 'en',
				id: created.id,
				locale: 'de',
			})
			expect(de.localNote).toBe('only english')
		})
	})

	describe('drafts and versions read paths', () => {
		it('decrypts drafts and version snapshots', async () => {
			const draft = await booted.payload.create({
				collection: 'vault-drafts',
				data: { secret: 'draft secret', title: 'd1' },
				draft: true,
			})
			const readDraft = await booted.payload.findByID({
				collection: 'vault-drafts',
				draft: true,
				id: draft.id,
			})
			expect(readDraft.secret).toBe('draft secret')

			await booted.payload.update({
				collection: 'vault-drafts',
				data: { _status: 'published', secret: 'published secret' },
				id: draft.id,
			})
			const versions = await booted.payload.findVersions({
				collection: 'vault-drafts',
				where: { parent: { equals: draft.id } },
			})
			expect(versions.docs.length).toBeGreaterThan(0)
			for (const version of versions.docs) {
				const value = (version.version as { secret?: unknown }).secret
				if (value != null) {
					expect(sealedShape(value)).toBe(false)
				}
			}
		})
	})

	describe('null and undefined semantics', () => {
		it('null clears the value; undefined leaves it unchanged', async () => {
			const created = await booted.payload.create({
				collection: 'vault',
				data: { ...FULL_DATA, bio: 'to be cleared' },
			})
			const untouched = await booted.payload.update({
				collection: 'vault',
				data: { title: 'renamed' },
				id: created.id,
			})
			expect(untouched.bio).toBe('to be cleared')

			const cleared = await booted.payload.update({
				collection: 'vault',
				data: { bio: null },
				id: created.id,
			})
			expect(cleared.bio).toBeNull()
			const raw = await booted.payload.db.findOne<
				{ id: number | string } & Record<string, unknown>
			>({
				collection: 'vault',
				where: { id: { equals: created.id } },
			})
			expect((raw as Record<string, unknown>).bio ?? null).toBeNull()
		})
	})

	describe('validation runs on plaintext', () => {
		it('enforces required', async () => {
			await expect(
				booted.payload.create({ collection: 'vault', data: { title: 'no ssn' } })
			).rejects.toThrow()
		})

		it('enforces the stock email format on the incoming plaintext', async () => {
			await expect(
				booted.payload.create({
					collection: 'vault',
					data: { ...FULL_DATA, contact: 'not-an-email' },
				})
			).rejects.toThrow()
		})

		it('runs a user-provided validate against plaintext, not ciphertext', async () => {
			// Payload surfaces the field's own validate message inside the
			// ValidationError's per-field errors, not the generic top-level message.
			await expect(
				booted.payload.create({
					collection: 'vault',
					data: { ...FULL_DATA, guarded: 'forbidden' },
				})
			).rejects.toMatchObject({
				data: {
					errors: expect.arrayContaining([
						expect.objectContaining({ message: 'guarded says no', path: 'guarded' }),
					]),
				},
			})
			const ok = await booted.payload.create({
				collection: 'vault',
				data: { ...FULL_DATA, guarded: 'allowed' },
			})
			expect(ok.guarded).toBe('allowed')
		})
	})

	describe('onDecryptFailure policies', () => {
		const corrupt = async (id: number | string, field: string) => {
			const raw = await booted.payload.db.findOne<
				{ id: number | string } & Record<string, unknown>
			>({
				collection: 'vault',
				where: { id: { equals: id } },
			})
			const sealed = (raw as Record<string, string>)[field] as string
			const segments = sealed.split('.')
			segments[3] = segments[3]?.endsWith('AA')
				? `${segments[3].slice(0, -2)}BB`
				: `${segments[3]?.slice(0, -2)}AA`
			await booted.payload.db.updateOne({
				collection: 'vault',
				data: { [field]: segments.join('.') },
				where: { id: { equals: id } },
			})
		}

		it("default 'throw' names collection.field and keyId, never plaintext", async () => {
			const doc = await booted.payload.create({ collection: 'vault', data: FULL_DATA })
			await corrupt(doc.id, 'ssn')
			await expect(booted.payload.findByID({ collection: 'vault', id: doc.id })).rejects.toThrow(
				/vault\.ssn.*keyId/
			)
			await expect(
				booted.payload.findByID({ collection: 'vault', id: doc.id })
			).rejects.not.toThrow(/123-45-6789/)
		})

		it("'null', 'passthrough', and function policies apply per field", async () => {
			const doc = await booted.payload.create({
				collection: 'vault',
				data: {
					...FULL_DATA,
					fragileFn: 'fn-secret',
					fragileNull: 'null-secret',
					fragilePass: 'pass-secret',
				},
			})
			await corrupt(doc.id, 'fragileNull')
			await corrupt(doc.id, 'fragilePass')
			await corrupt(doc.id, 'fragileFn')
			const read = await booted.payload.findByID({ collection: 'vault', id: doc.id })
			expect(read.fragileNull).toBeNull()
			expect(sealedShape(read.fragilePass)).toBe(true)
			expect(read.fragileFn).toBe('[unavailable]')
		})
	})

	describe('lazy migration (adoption)', () => {
		it('passthrough reads legacy plaintext; the next update seals it', async () => {
			// fragilePass carries legacy plaintext so passthrough reads it untouched.
			// ssn is required (NOT NULL on Postgres) and keeps the throw policy, so it
			// is seeded already sealed: Payload's update reads the original doc through
			// afterRead, which would trip a throw-policy field holding raw plaintext.
			const ring = await resolveKeys(undefined, booted.payload.config.secret)
			const sealedSsn = seal({
				aad: 'vault.ssn',
				key: ring.dataKeys.get(ring.activeId) as Buffer,
				keyId: ring.activeId,
				plaintext: 'seed-ssn',
			})
			const seeded = await booted.payload.db.create({
				collection: 'vault',
				data: { fragilePass: 'legacy plaintext', ssn: sealedSsn, title: 'legacy' },
			})
			const id = (seeded as { id: number | string }).id
			// Passthrough returns the legacy plaintext untouched.
			const read = await booted.payload.find({
				collection: 'vault',
				select: { fragilePass: true, title: true },
				where: { id: { equals: id } },
			})
			expect(read.docs[0]?.fragilePass).toBe('legacy plaintext')

			await booted.payload.update({
				collection: 'vault',
				data: { fragilePass: 'legacy plaintext', ssn: 'now-sealed' },
				id,
			})
			const raw = await booted.payload.db.findOne<
				{ id: number | string } & Record<string, unknown>
			>({
				collection: 'vault',
				where: { id: { equals: id } },
			})
			expect(sealedShape((raw as Record<string, unknown>).fragilePass)).toBe(true)
			expect(sealedShape((raw as Record<string, unknown>).ssn)).toBe(true)
		})
	})

	describe('startup key validation', () => {
		it('rejects a ring whose active key is missing', async () => {
			await expect(
				validateEncryptedBoot(booted.payload, { active: 'k9', keys: { k1: 'material' } })
			).rejects.toThrow(/active key 'k9'/)
		})

		it('rejects an async provider that yields empty material', async () => {
			await expect(
				validateEncryptedBoot(booted.payload, {
					active: 'kms',
					keys: { kms: async () => new Uint8Array(0) },
				})
			).rejects.toThrow(/0 bytes of material/)
		})
	})
})

describeForDb('encrypted key rotation', {}, (db) => {
	const rotatable: CollectionConfig = {
		slug: 'rotatable',
		fields: [
			{ name: 'title', type: 'text' },
			...encryptedField({ name: 'secret', type: 'text' }),
			...encryptedField({ name: 'lookup', type: 'email' }, { queryable: true }),
		],
	}

	it('re-seals k1 rows under k2 and keeps reads working end to end', async () => {
		const bootedK1 = await bootPayload({
			collections: [rotatable],
			db,
			plugin: fields({
				encrypted: { keys: { active: 'k1', keys: { k1: 'old-material-secret' } } },
			}),
		})
		try {
			const a = await bootedK1.payload.create({
				collection: 'rotatable',
				data: { lookup: 'a@x.com', secret: 'alpha', title: 'a' },
			})
			await bootedK1.payload.create({
				collection: 'rotatable',
				data: { lookup: 'b@x.com', secret: 'beta', title: 'b' },
			})

			const bootedK2 = await bootPayload({
				attachTo: bootedK1,
				collections: [rotatable],
				db,
				plugin: fields({
					encrypted: {
						keys: { active: 'k2', keys: { k1: 'old-material-secret', k2: 'new-material-secret' } },
					},
				}),
			})
			try {
				// Old ciphertext still opens (k1 remains in the ring).
				const before = await bootedK2.payload.findByID({ collection: 'rotatable', id: a.id })
				expect(before.secret).toBe('alpha')

				const dry = await rotateEncryptedFields(bootedK2.payload, { dryRun: true })
				expect(dry.collections.rotatable?.rotated).toBe(2)

				const report = await rotateEncryptedFields(bootedK2.payload, { batchSize: 1 })
				expect(report.collections.rotatable?.rotated).toBe(2)

				const raw = await bootedK2.payload.db.findOne<
					{ id: number | string } & Record<string, unknown>
				>({
					collection: 'rotatable',
					where: { id: { equals: a.id } },
				})
				const rawRow = raw as Record<string, unknown>
				expect((rawRow.secret as string).split('.')[1]).toBe('k2')
				expect((rawRow.lookup as string).split('.')[1]).toBe('k2')

				const after = await bootedK2.payload.findByID({ collection: 'rotatable', id: a.id })
				expect(after.secret).toBe('alpha')

				// Blind index realigned to the k2-derived index key.
				const found = await bootedK2.payload.find({
					collection: 'rotatable',
					where: { lookup: { equals: 'a@x.com' } },
				})
				expect(found.totalDocs).toBe(1)

				const again = await rotateEncryptedFields(bootedK2.payload, { dryRun: true })
				expect(again.collections.rotatable?.rotated).toBe(0)
			} finally {
				await bootedK2.stop()
			}
		} finally {
			await bootedK1.stop()
		}
	}, 300_000)
})
