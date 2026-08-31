import { type BootedPayload, bootPayload } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { auditLogs } from '../../src/index'
import { posts, tags, users } from './fixtures'

type IndexedCollection = {
	collection: { indexes: () => Promise<{ key: Record<string, number> }[]> }
}

/** Reads the index list straight off the driver, so this asserts what the database has. */
const readIndexKeys = async (booted: BootedPayload): Promise<string[]> => {
	const collections = (booted.payload.db as unknown as Record<string, unknown>)
		.collections as Record<string, IndexedCollection>
	const indexes = await collections['audit-logs']?.collection.indexes()
	return (indexes ?? []).map((index) => Object.keys(index.key).join(','))
}

/**
 * Indexes are invisible from the outside and easy to drop in a refactor, so they get
 * asserted rather than assumed. Mongo only: the index list is read through the driver.
 */
describe('audit-logs indexes', () => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: auditLogs({ collections: { posts: { auditLog: true } } }),
			db: 'mongo',
			collections: [posts, tags, users],
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('pairs each filter the view offers with the sort key', async () => {
		const keys = await readIndexKeys(booted)

		expect(keys).toContain('relationTo,documentId,createdAt')
		expect(keys).toContain('user,createdAt')
	})

	it('leaves the tenant pair out when multi-tenancy is off', async () => {
		expect(await readIndexKeys(booted)).not.toContain('tenant,createdAt')
	})
})

describe('audit-logs indexes with multi-tenancy', () => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: auditLogs({ collections: { posts: { auditLog: true } }, multiTenancy: true }),
			db: 'mongo',
			collections: [
				posts,
				tags,
				users,
				{ slug: 'tenants', fields: [{ name: 'name', type: 'text' }] },
			],
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('adds the tenant pair', async () => {
		expect(await readIndexKeys(booted)).toContain('tenant,createdAt')
	})
})
