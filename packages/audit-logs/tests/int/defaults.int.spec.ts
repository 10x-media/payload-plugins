import { type BootedPayload, bootPayload } from '@10x-media/payload-test-harness'
import type { PayloadRequest } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { auditLogs } from '../../src/index'
import {
	pages,
	posts,
	readLogs,
	seedUser,
	siteSettings,
	TEST_EMAIL,
	TEST_PASSWORD,
	tags,
	users,
} from './fixtures'

/**
 * Auditing is opt-in with no exceptions: an empty option object must leave every
 * collection and global alone, auth events included.
 */
describe('nothing is audited by default', () => {
	let booted: BootedPayload
	let req: PayloadRequest

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: auditLogs({}),
			db: 'mongo',
			collections: [posts, pages, tags, users],
			configOverrides: { globals: [siteSettings] },
			seed: async (payload) => {
				const user = await seedUser(payload)
				req = { user: { ...user, collection: 'users' } } as unknown as PayloadRequest
			},
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('adds no audit fields to any collection', () => {
		for (const slug of ['posts', 'pages', 'tags', 'users']) {
			const names = (booted.payload.collections[slug]?.config.fields ?? []).map((f) =>
				'name' in f ? f.name : undefined
			)
			expect(names, slug).not.toContain('createdBy')
			expect(names, slug).not.toContain('lastModifiedBy')
		}
	})

	it('adds no audit fields to any global', () => {
		const global = booted.payload.config.globals.find((g) => g.slug === 'site-settings')
		const names = (global?.fields ?? []).map((f) => ('name' in f ? f.name : undefined))

		expect(names).not.toContain('createdBy')
		expect(names).not.toContain('lastModifiedBy')
	})

	it('writes no entry for creates, updates or deletes', async () => {
		const post = await booted.payload.create({ collection: 'posts', data: { title: 'A' }, req })
		await booted.payload.update({
			collection: 'posts',
			id: post.id,
			data: { title: 'B' },
			req,
		})
		await booted.payload.delete({ collection: 'posts', id: post.id, req })

		const tag = await booted.payload.create({ collection: 'tags', data: { name: 'x' }, req })
		await booted.payload.update({ collection: 'tags', id: tag.id, data: { name: 'y' }, req })

		expect(await readLogs(booted.payload)).toHaveLength(0)
	})

	it('writes no entry for a global update', async () => {
		await booted.payload.updateGlobal({
			slug: 'site-settings',
			data: { siteName: 'Quiet' },
			req,
		})

		expect(await readLogs(booted.payload)).toHaveLength(0)
	})

	it('registers the audit-logs collection even though nothing is audited', () => {
		expect(booted.payload.collections['audit-logs']).toBeDefined()
	})

	it('writes no entry for a login either', async () => {
		await booted.payload.login({
			collection: 'users',
			data: { email: TEST_EMAIL, password: TEST_PASSWORD },
		})

		expect(await readLogs(booted.payload)).toHaveLength(0)
	})

	it('skips draft saves, which is the default now', async () => {
		const enabled = await bootPayload({
			plugin: auditLogs({ collections: { pages: { auditLog: true } } }),
			db: 'mongo',
			collections: [posts, pages, tags, users],
		})
		try {
			const page = await enabled.payload.create({
				collection: 'pages',
				data: { title: 'Draft' },
				draft: true,
			})
			await enabled.payload.update({
				collection: 'pages',
				id: page.id,
				data: { title: 'Still a draft' },
				draft: true,
			})

			// The create is always logged; the draft update is the part `ignore` drops.
			expect((await readLogs(enabled.payload)).map((l) => l.operation)).toEqual(['create'])

			await enabled.payload.update({
				collection: 'pages',
				id: page.id,
				data: { title: 'Published', _status: 'published' },
			})

			expect((await readLogs(enabled.payload)).map((l) => l.operation)).toEqual([
				'create',
				'update',
			])
		} finally {
			await enabled.stop()
		}
	})
})
