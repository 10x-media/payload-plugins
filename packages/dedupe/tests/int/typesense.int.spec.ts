import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { type CollectionConfig, type CollectionSlug, createLocalReq } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { typesenseAdapter } from '../../dev/helpers/typesenseAdapter'
import { dedupe } from '../../src/index'

const PEOPLE = 'typo-people' as CollectionSlug
// biome-ignore lint/plugin/noProcessEnv: opt-in test against a running Typesense
const URL = process.env.TYPESENSE_URL
const connection = { url: URL ?? '', apiKey: 'dedupe-dev' }
const adapter = typesenseAdapter(connection)

const people: CollectionConfig = {
	slug: 'typo-people',
	fields: [
		{ name: 'name', type: 'text' },
		{ name: 'email', type: 'email' },
	],
}

/** The stand's Typesense adapter against a running Typesense: `TYPESENSE_URL` turns it on. */
describeForDb('typesense adapter', { dbs: URL ? ['mongo'] : [] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		await fetch(`${URL}/collections/${PEOPLE}`, {
			method: 'DELETE',
			headers: { 'X-TYPESENSE-API-KEY': connection.apiKey },
		})
		booted = await bootPayload({
			plugin: dedupe({
				collections: {
					'typo-people': {
						match: {
							fields: [
								{ path: 'name', weight: 40, compare: 'text' },
								{ path: 'email', weight: 45 },
							],
						},
					},
				},
				adapter: () => adapter,
				disableJobsQueue: true,
			}),
			db,
			collections: [people],
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('finds a document by a name typed with typos the blocking keys miss, until it is deleted', async () => {
		const { payload } = booted
		const saved = (await payload.create({
			collection: PEOPLE,
			data: { name: 'Iryna Tkachenko', email: 'iryna@kyiv.example' } as never,
		})) as { id: string }
		const req = await createLocalReq({}, payload)
		const find = () =>
			adapter.findCandidates({
				req,
				collection: PEOPLE,
				doc: { name: 'Iryan Tkahcenko' },
				limit: 10,
			})
		expect(await find()).toEqual([{ id: String(saved.id) }])

		await payload.delete({ collection: PEOPLE, id: saved.id })
		expect(await find()).toEqual([])
	})
})
