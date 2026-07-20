import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig, Payload, Plugin, TextField } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { encryptedField, withEncryptedQueryRewrite } from '../../src/exports/encrypted'
import { fields } from '../../src/index'

const members: CollectionConfig = {
	slug: 'members',
	fields: [
		{ name: 'title', type: 'text' },
		...encryptedField({ name: 'contact', type: 'email', unique: true }, { queryable: true }),
		...encryptedField({ name: 'handle', type: 'text' }, { queryable: true }),
		...encryptedField({ name: 'ssn', type: 'text' }),
	],
}

describeForDb('encrypted queryability (plugin-registered rewrite)', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ collections: [members], db, plugin: fields({}) })
		await booted.payload.create({
			collection: 'members',
			data: { contact: 'Jane.Doe@Example.com', handle: 'Jane', ssn: 's-1', title: 'jane' },
		})
		await booted.payload.create({
			collection: 'members',
			data: { contact: 'bob@x.com', handle: 'bob', ssn: 's-2', title: 'bob' },
		})
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	it('equals matches with trim + case-fold normalization for email', async () => {
		const found = await booted.payload.find({
			collection: 'members',
			where: { contact: { equals: '  jane.doe@EXAMPLE.com ' } },
		})
		expect(found.totalDocs).toBe(1)
		expect(found.docs[0]?.title).toBe('jane')
	})

	it('standard normalization trims but keeps case', async () => {
		const exact = await booted.payload.find({
			collection: 'members',
			where: { handle: { equals: ' Jane ' } },
		})
		expect(exact.totalDocs).toBe(1)
		const wrongCase = await booted.payload.find({
			collection: 'members',
			where: { handle: { equals: 'jane' } },
		})
		expect(wrongCase.totalDocs).toBe(0)
	})

	it('in matches any listed value', async () => {
		const found = await booted.payload.find({
			collection: 'members',
			where: { contact: { in: ['jane.doe@example.com', 'nobody@x.com'] } },
		})
		expect(found.totalDocs).toBe(1)
	})

	it('misses cleanly on unknown values', async () => {
		const found = await booted.payload.find({
			collection: 'members',
			where: { contact: { equals: 'ghost@x.com' } },
		})
		expect(found.totalDocs).toBe(0)
	})

	it('recurses and/or combinations', async () => {
		const found = await booted.payload.find({
			collection: 'members',
			where: {
				or: [
					{ and: [{ contact: { equals: 'jane.doe@example.com' } }, { title: { equals: 'jane' } }] },
					{ contact: { equals: 'bob@x.com' } },
				],
			},
		})
		expect(found.totalDocs).toBe(2)
	})

	it('rewrites count and bulk delete wheres', async () => {
		const counted = await booted.payload.count({
			collection: 'members',
			where: { contact: { equals: 'jane.doe@example.com' } },
		})
		expect(counted.totalDocs).toBe(1)

		const victim = await booted.payload.create({
			collection: 'members',
			data: { contact: 'delete-me@x.com', handle: 'del', ssn: 's-3', title: 'del' },
		})
		const deleted = await booted.payload.delete({
			collection: 'members',
			where: { contact: { equals: 'delete-me@x.com' } },
		})
		expect(deleted.docs).toHaveLength(1)
		expect(deleted.docs[0]?.id).toBe(victim.id)
	})

	it('non-queryable encrypted fields match nothing by plaintext equals', async () => {
		const found = await booted.payload.find({
			collection: 'members',
			where: { ssn: { equals: 's-1' } },
		})
		expect(found.totalDocs).toBe(0)
	})

	it('enforces unique through the blind index on both DBs', async () => {
		await expect(
			booted.payload.create({
				collection: 'members',
				data: { contact: 'JANE.DOE@example.com', handle: 'imposter', ssn: 'x', title: 'dup' },
			})
		).rejects.toThrow()
	})

	it('hides the bidx sibling from reads (hidden field strip)', async () => {
		const found = await booted.payload.find({ collection: 'members', where: {} })
		const doc = found.docs[0] as Record<string, unknown>
		expect('contact_bidx' in doc).toBe(false)
		expect('handle_bidx' in doc).toBe(false)
	})
})

describeForDb('encrypted queryability (standalone, no plugin)', { dbs: ['mongo'] }, (db) => {
	const passthroughPlugin: Plugin = (config) => config
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			collections: [
				withEncryptedQueryRewrite({
					slug: 'standalone',
					fields: [
						{ name: 'title', type: 'text' },
						...encryptedField({ name: 'contact', type: 'email' }, { queryable: true }),
					],
				}),
			],
			db,
			plugin: passthroughPlugin,
		})
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	it('rewrites queries and derives default keys from the config secret without the plugin', async () => {
		await booted.payload.create({
			collection: 'standalone',
			data: { contact: 'solo@x.com', title: 'solo' },
		})
		const found = await booted.payload.find({
			collection: 'standalone',
			where: { contact: { equals: 'solo@x.com' } },
		})
		expect(found.totalDocs).toBe(1)
	})
})

const filterUsers: CollectionConfig = { slug: 'filter-users', auth: true, fields: [] }

const people: CollectionConfig = {
	slug: 'people',
	fields: [
		{ name: 'title', type: 'text' },
		...encryptedField({ name: 'contact', type: 'email' }, { queryable: true }),
		...encryptedField({ name: 'ssn', type: 'text' }),
	],
}

// overrideAccess:false is the load-bearing part: it turns on Payload's query-path
// permission validation, which is what 403'd on the blind-index sibling before the
// redesign moved it from top-level `hidden` to `admin.hidden`. These run as a real
// authenticated user, mirroring how the admin panel queries.
describeForDb('encrypted filtering under access control (overrideAccess:false)', {}, (db) => {
	let booted: BootedPayload
	let user: Awaited<ReturnType<Payload['login']>>['user']

	const titlesOf = (result: { docs: Record<string, unknown>[] }): string[] =>
		result.docs.map((doc) => doc.title as string).sort()

	beforeAll(async () => {
		booted = await bootPayload({ collections: [people, filterUsers], db, plugin: fields({}) })
		const credentials = { email: 'admin@x.com', password: 'test-pass-1234' }
		await booted.payload.create({ collection: 'filter-users', data: credentials })
		const login = await booted.payload.login({ collection: 'filter-users', data: credentials })
		user = login.user
		for (const row of [
			{ contact: 'jane@x.com', ssn: 's-1', title: 'jane' },
			{ contact: 'bob@x.com', ssn: 's-2', title: 'bob' },
			{ contact: 'carol@x.com', ssn: 's-3', title: 'carol' },
			{ title: 'nobody' },
		]) {
			await booted.payload.create({ collection: 'people', data: row })
		}
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	it('equals returns the match (regression: this used to 403 on the blind-index sibling)', async () => {
		const found = await booted.payload.find({
			collection: 'people',
			overrideAccess: false,
			user,
			where: { contact: { equals: 'jane@x.com' } },
		})
		expect(found.totalDocs).toBe(1)
		expect(found.docs[0]?.title).toBe('jane')
	})

	it('not_equals excludes the match and returns the others', async () => {
		const titles = titlesOf(
			await booted.payload.find({
				collection: 'people',
				overrideAccess: false,
				user,
				where: { contact: { not_equals: 'jane@x.com' } },
			})
		)
		expect(titles).toContain('bob')
		expect(titles).toContain('carol')
		expect(titles).not.toContain('jane')
	})

	it('in matches any listed value as an array', async () => {
		const found = await booted.payload.find({
			collection: 'people',
			overrideAccess: false,
			user,
			where: { contact: { in: ['jane@x.com', 'bob@x.com'] } },
		})
		expect(titlesOf(found)).toEqual(['bob', 'jane'])
	})

	it('in accepts a comma-joined string (the REST wire shape)', async () => {
		const found = await booted.payload.find({
			collection: 'people',
			overrideAccess: false,
			user,
			where: { contact: { in: 'jane@x.com,bob@x.com' } },
		})
		expect(titlesOf(found)).toEqual(['bob', 'jane'])
	})

	it('not_in excludes the listed values', async () => {
		const titles = titlesOf(
			await booted.payload.find({
				collection: 'people',
				overrideAccess: false,
				user,
				where: { contact: { not_in: ['jane@x.com', 'bob@x.com'] } },
			})
		)
		expect(titles).toContain('carol')
		expect(titles).not.toContain('jane')
		expect(titles).not.toContain('bob')
	})

	it('exists tracks the presence of the source value through the blind index', async () => {
		const present = await booted.payload.find({
			collection: 'people',
			overrideAccess: false,
			user,
			where: { contact: { exists: true } },
		})
		expect(titlesOf(present)).toEqual(['bob', 'carol', 'jane'])

		const absent = await booted.payload.find({
			collection: 'people',
			overrideAccess: false,
			user,
			where: { contact: { exists: false } },
		})
		expect(absent.totalDocs).toBe(1)
		expect(absent.docs[0]?.title).toBe('nobody')
	})

	// Unsupported operators (contains/like/range/geo) cannot run on a blind index;
	// they resolve to a guaranteed-empty match on both DBs, never an error or a
	// wrong row. The sentinel is a plain space, so Postgres accepts the parameter.
	it('maps an unsupported operator to a guaranteed-empty match, not an error or wrong row', async () => {
		const contains = await booted.payload.find({
			collection: 'people',
			overrideAccess: false,
			user,
			where: { contact: { contains: 'jane' } },
		})
		expect(contains.totalDocs).toBe(0)

		const like = await booted.payload.find({
			collection: 'people',
			overrideAccess: false,
			user,
			where: { contact: { like: 'jane' } },
		})
		expect(like.totalDocs).toBe(0)
	})

	it('never leaks the blind-index sibling in a response', async () => {
		const found = await booted.payload.find({
			collection: 'people',
			overrideAccess: false,
			user,
			where: {},
		})
		for (const doc of found.docs) {
			const keys = Object.keys(doc as Record<string, unknown>)
			expect(keys.some((key) => key.endsWith('_bidx'))).toBe(false)
		}
		expect('contact_bidx' in (found.docs[0] as Record<string, unknown>)).toBe(false)
	})

	it('disables the list filter on a non-queryable field and matches nothing by plaintext', async () => {
		const [ssnStored] = encryptedField({ name: 'ssn', type: 'text' })
		expect((ssnStored as TextField).admin?.disableListFilter).toBe(true)
		const [contactStored] = encryptedField({ name: 'contact', type: 'email' }, { queryable: true })
		expect((contactStored as TextField).admin?.disableListFilter).not.toBe(true)

		const found = await booted.payload.find({
			collection: 'people',
			overrideAccess: false,
			user,
			where: { ssn: { equals: 's-1' } },
		})
		expect(found.totalDocs).toBe(0)
	})
})
