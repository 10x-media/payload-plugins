import { contentLock, isContentLocked } from '@10x-media/content-lock'
import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { type CollectionConfig, createLocalReq } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { auditLogs, createAuditEvent } from '../../src/index'
import { readLogs, seedUser, TEST_EMAIL, TEST_PASSWORD, users } from './fixtures'

/** Written by the public site, so the lock leaves it open. */
const submissions: CollectionConfig = {
	slug: 'submissions',
	fields: [{ name: 'body', type: 'text' }],
}

/**
 * `@10x-media/content-lock` rejects every Local API write to a collection it freezes,
 * `overrideAccess` or not. The override below attaches a hook, which sends every entry
 * through that pipeline; custom events and the retention jobs always take it.
 */
describeForDb('audit-logs under a content lock on everything', {}, (db) => {
	let booted: BootedPayload
	const piped = new Set<string>()

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: auditLogs({
				collections: { submissions: { auditLog: true }, users: { auth: true } },
				logs: {
					override: (collection) => ({
						...collection,
						hooks: {
							...collection.hooks,
							afterChange: [
								...(collection.hooks?.afterChange ?? []),
								({ doc }) => {
									piped.add(String(doc.id))
									return doc
								},
							],
						},
					}),
				},
				retention: { deleteCron: '0 3 1 * *', queue: 'audit-retention' },
			}),
			db,
			collections: [users, submissions],
			configOverrides: { plugins: [contentLock({ exempt: ['submissions'] })] },
			seed: async (payload) => {
				await seedUser(payload)
				await payload.create({ collection: 'submissions', data: { body: 'before the lock' } })
			},
		})

		await booted.payload.create({
			collection: 'content-locks',
			data: { title: 'Maintenance' },
			overrideAccess: true,
		})
		expect(await isContentLocked(booted.payload, { collection: 'users' })).toBe(true)
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('reports the log collection as never locked', async () => {
		expect(await isContentLocked(booted.payload, { collection: 'audit-logs' })).toBe(false)
	})

	it('lets a login through and writes its entry through the pipeline', async () => {
		const result = await booted.payload.login({
			collection: 'users',
			data: { email: TEST_EMAIL, password: TEST_PASSWORD },
		})

		const [entry] = await readLogs(booted.payload, { eventType: { equals: 'login' } })

		expect(result.token).toBeTruthy()
		expect(entry?.relationTo).toBe('users')
		expect(piped.has(String(entry?.id))).toBe(true)
	})

	it('keeps the entry for a write to a collection the lock leaves open', async () => {
		const doc = await booted.payload.create({ collection: 'submissions', data: { body: 'hi' } })

		const [entry] = await readLogs(booted.payload, { documentId: { equals: String(doc.id) } })

		expect(entry?.operation).toBe('create')
		expect(entry?.relationTo).toBe('submissions')
	})

	it('writes a custom event', async () => {
		await createAuditEvent(await createLocalReq({}, booted.payload), {
			collection: 'submissions',
			eventType: 'reviewed',
		})

		expect(await readLogs(booted.payload, { eventType: { equals: 'reviewed' } })).toHaveLength(1)
	})

	it('lets the retention job delete entries written before the lock', async () => {
		expect((await readLogs(booted.payload)).length).toBeGreaterThan(0)

		await booted.payload.jobs.queue({
			task: 'audit-logs-delete',
			input: undefined,
			queue: 'audit-retention',
		})
		await booted.payload.jobs.run({ queue: 'audit-retention' })

		expect(await readLogs(booted.payload)).toHaveLength(0)
	})
})
