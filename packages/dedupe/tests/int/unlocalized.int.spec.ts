import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { type CollectionConfig, type CollectionSlug, createLocalReq } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { KEYS_SLUG, PAIRS_SLUG } from '../../src/collections/slugs'
import { dedupe } from '../../src/index'
import { applyMerge } from '../../src/merge/apply'
import { getCollectionContext, getContext } from '../../src/plugin/context'

const PEOPLE = 'people' as CollectionSlug
const VAULTS = 'vaults' as CollectionSlug

const limited = ({ req }: { req: { user?: unknown } }) =>
	String((req.user as { email?: string } | null)?.email ?? '').startsWith('limited')

/** `email` is a match field that readers whose email starts with `limited` may not read. */
const people: CollectionConfig = {
	slug: 'people',
	fields: [
		{ name: 'name', type: 'text' },
		{ name: 'email', type: 'email', access: { read: (args) => !limited(args) } },
		{ name: 'note', type: 'text' },
	],
}

/** Update access that takes the id in the form Payload hands it: a number on SQL. */
const vaultsFor = (db: string): CollectionConfig => ({
	slug: 'vaults',
	access: {
		update: ({ id }) => id === undefined || typeof id === (db === 'postgres' ? 'number' : 'string'),
	},
	fields: [{ name: 'name', type: 'text' }],
})

/** A Payload without localization, where the hooks hand over the document as saved. */
describeForDb('dedupe without localization', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: dedupe({
				collections: {
					people: {
						absorbed: 'delete',
						match: {
							fields: [
								{ path: 'email', weight: 45 },
								{ path: 'name', weight: 40, compare: 'text' },
							],
						},
					},
					vaults: { absorbed: 'delete' },
				},
				disableJobsQueue: true,
			}),
			db,
			collections: [people, vaultsFor(db)],
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('indexes a document saved by someone who may not read a match field by all its fields', async () => {
		const { payload } = booted
		await payload.create({
			collection: PEOPLE,
			data: { name: 'Alpha Person', email: 'same@people.test' } as never,
		})
		const b = (await payload.create({
			collection: PEOPLE,
			data: { name: 'Beta Person', email: 'same@people.test' } as never,
		})) as { id: number | string }
		const state = async () => ({
			pairs: (
				await payload.db.find<{ status: string }>({
					collection: PAIRS_SLUG,
					where: { target: { equals: PEOPLE } },
					pagination: false,
				})
			).docs.map((row) => row.status),
			keys: (
				await payload.db.find<{ key: string }>({
					collection: KEYS_SLUG,
					where: { doc: { equals: String(b.id) } },
					pagination: false,
				})
			).docs
				.map((row) => row.key)
				.sort(),
		})
		const before = await state()
		expect(before.pairs).toEqual(['open'])

		const user = await payload.create({
			collection: 'users' as CollectionSlug,
			data: { email: 'limited@people.test', password: 'password' } as never,
		})
		await payload.update({
			collection: PEOPLE,
			id: b.id,
			data: { note: 'touched' } as never,
			overrideAccess: false,
			user,
			req: await createLocalReq({ user: user as never }, payload),
		})
		expect(await state()).toEqual(before)
	})

	it('asks the collection access with the id in the form Payload gives it', async () => {
		const { payload } = booted
		const [a, b] = (await Promise.all(
			['Vault', 'Vault'].map((name) =>
				payload.create({ collection: VAULTS, data: { name } as never })
			)
		)) as Array<{ id: number | string }>
		const user = await payload.create({
			collection: 'users' as CollectionSlug,
			data: { email: 'vault@people.test', password: 'password' } as never,
		})
		// As the endpoints hand them over, read from a request body or a query string.
		await expect(
			applyMerge({
				req: await createLocalReq({ user: user as never }, payload),
				ctx: getContext(payload),
				col: getCollectionContext(payload, VAULTS),
				survivorId: String(a?.id),
				absorbedIds: [String(b?.id)],
				choices: {},
			})
		).resolves.toMatchObject({ survivorId: expect.anything() })
	})
})
