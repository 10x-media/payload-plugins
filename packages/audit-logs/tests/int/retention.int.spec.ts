import { type BootedPayload, bootPayload } from '@10x-media/payload-test-harness'
import type { CollectionConfig, PayloadRequest } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { auditLogs } from '../../src/index'
import { posts, readLogs, seedUser, tags, users } from './fixtures'

const media: CollectionConfig = {
	slug: 'media',
	upload: { disableLocalStorage: true },
	fields: [{ name: 'alt', type: 'text' }],
}

const boot = (options: Parameters<typeof auditLogs>[0], seedReq: (req: PayloadRequest) => void) =>
	bootPayload({
		plugin: auditLogs(options),
		db: 'mongo',
		collections: [posts, tags, media, users],
		seed: async (payload) => {
			const user = await seedUser(payload)
			seedReq({ user: { ...user, collection: 'users' } } as unknown as PayloadRequest)
		},
	})

describe('retention: archive then delete', () => {
	let booted: BootedPayload
	let req: PayloadRequest

	beforeAll(async () => {
		booted = await boot(
			{
				collections: { posts: { auditLog: true } },
				retention: {
					deleteCron: '0 3 1 * *',
					queue: 'audit-retention',
					archive: { cron: '0 2 * * 0', uploadCollection: 'media' },
				},
			},
			(r) => {
				req = r
			}
		)
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('registers both tasks on the configured queue', () => {
		const slugs = (booted.payload.config.jobs?.tasks ?? []).map((t) => t.slug)

		expect(slugs).toContain('audit-logs-archive')
		expect(slugs).toContain('audit-logs-delete')
	})

	it('archives every unarchived entry into one gzipped CSV', async () => {
		await booted.payload.create({ collection: 'posts', data: { title: 'One' }, req })
		await booted.payload.create({ collection: 'posts', data: { title: 'Two' }, req })

		await booted.payload.jobs.queue({
			task: 'audit-logs-archive',
			input: undefined,
			queue: 'audit-retention',
		})
		await booted.payload.jobs.run({ queue: 'audit-retention' })

		const uploads = await booted.payload.find({ collection: 'media', overrideAccess: true })
		expect(uploads.docs).toHaveLength(1)
		expect(uploads.docs[0]?.filename).toMatch(/\.csv\.gz$/)

		const logs = await readLogs(booted.payload)
		expect(logs.every((l) => Boolean(l.archivedAt))).toBe(true)
	})

	it('leaves already archived entries alone on a second run', async () => {
		await booted.payload.jobs.queue({
			task: 'audit-logs-archive',
			input: undefined,
			queue: 'audit-retention',
		})
		await booted.payload.jobs.run({ queue: 'audit-retention' })

		const uploads = await booted.payload.find({ collection: 'media', overrideAccess: true })
		expect(uploads.docs).toHaveLength(1)
	})

	it('deletes only what has been archived', async () => {
		const fresh = await booted.payload.create({
			collection: 'posts',
			data: { title: 'Not yet archived' },
			req,
		})

		await booted.payload.jobs.queue({
			task: 'audit-logs-delete',
			input: undefined,
			queue: 'audit-retention',
		})
		await booted.payload.jobs.run({ queue: 'audit-retention' })

		const remaining = await readLogs(booted.payload)
		expect(remaining).toHaveLength(1)
		expect(remaining[0]?.documentId).toBe(String(fresh.id))
	})
})

describe('retention: delete without archive', () => {
	let booted: BootedPayload
	let req: PayloadRequest

	beforeAll(async () => {
		booted = await boot(
			{
				collections: { posts: { auditLog: true } },
				retention: { deleteCron: '0 3 1 * *', queue: 'audit-retention' },
			},
			(r) => {
				req = r
			}
		)
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('registers only the delete task', () => {
		const slugs = (booted.payload.config.jobs?.tasks ?? []).map((t) => t.slug)

		expect(slugs).toContain('audit-logs-delete')
		expect(slugs).not.toContain('audit-logs-archive')
	})

	it('deletes everything, since there is nothing to archive first', async () => {
		await booted.payload.create({ collection: 'posts', data: { title: 'Ephemeral' }, req })
		expect(await readLogs(booted.payload)).toHaveLength(1)

		await booted.payload.jobs.queue({
			task: 'audit-logs-delete',
			input: undefined,
			queue: 'audit-retention',
		})
		await booted.payload.jobs.run({ queue: 'audit-retention' })

		expect(await readLogs(booted.payload)).toHaveLength(0)
	})
})

describe('retention: archive contents', () => {
	let booted: BootedPayload
	let req: PayloadRequest

	beforeAll(async () => {
		booted = await boot(
			{
				collections: { posts: { auditLog: true } },
				retention: {
					deleteCron: '0 3 1 * *',
					queue: 'audit-retention',
					archive: {
						cron: '0 2 * * 0',
						uploadCollection: 'media',
						generateFilename: () => 'fixed-name',
						populateUploadFields: ({ logCount }) => ({ alt: `entries: ${logCount}` }),
					},
				},
			},
			(r) => {
				req = r
			}
		)
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('honours generateFilename and populateUploadFields', async () => {
		await booted.payload.create({ collection: 'posts', data: { title: 'Archived' }, req })

		await booted.payload.jobs.queue({
			task: 'audit-logs-archive',
			input: undefined,
			queue: 'audit-retention',
		})
		await booted.payload.jobs.run({ queue: 'audit-retention' })

		const uploads = await booted.payload.find({ collection: 'media', overrideAccess: true })
		const upload = uploads.docs[0]

		expect(upload?.filename).toBe('fixed-name.csv.gz')
		expect(upload?.alt).toBe('entries: 1')

		const stored = await booted.payload.findByID({
			collection: 'media',
			id: String(upload?.id),
			overrideAccess: true,
		})
		expect(stored).toBeDefined()
	})
})
