import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { auditLogs, createAuditEvent } from '../../src/index'
import { filterConditions } from '../../src/view/filterQuery'
import { posts, readLogs as readAllLogs, seedUser, tags, users } from './fixtures'

type ExtendedLog = Awaited<ReturnType<typeof readAllLogs>>[number] & {
	actorDepartments?: string[] | null
	source?: string | null
}

const readLogs = async (...args: Parameters<typeof readAllLogs>) =>
	(await readAllLogs(...args)) as ExtendedLog[]

/**
 * `logs.extend` on both adapters. The direct write is the one that matters: it skips the
 * pipeline, so the adapter alone has to store the extra fields, and on Postgres a hasMany
 * text field lives in a side table the direct write must still fill.
 */
describeForDb('logs.extend', {}, (db) => {
	let booted: BootedPayload
	let req: PayloadRequest
	const pipelineWrites: string[] = []

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: auditLogs({
				collections: { posts: { auditLog: true }, users: { auth: true } },
				logs: {
					override: (collection) => ({
						...collection,
						fields: [
							...collection.fields,
							{ name: 'actorDepartments', type: 'text', hasMany: true },
							{ name: 'source', type: 'text' },
						],
					}),
					extend: ({ data, req: { context } }) =>
						context.skipExtend
							? undefined
							: {
									actorDepartments: ['sales', 'support'],
									source: `extended:${String(data.operation)}`,
									// Built-in keys, which must be ignored.
									operation: 'delete',
									user: { relationTo: 'users', value: 'someone-else' },
								},
					view: {
						filters: [
							{
								type: 'relationship',
								name: 'department',
								label: 'Department',
								path: 'actorDepartments',
								relationTo: 'posts',
							},
						],
					},
				},
			}),
			db,
			collections: [posts, tags, users],
			seed: async (payload) => {
				const user = await seedUser(payload)
				req = { context: {}, user: { ...user, collection: 'users' } } as unknown as PayloadRequest
			},
		})

		const original = booted.payload.create.bind(booted.payload)
		booted.payload.create = ((args: Parameters<typeof original>[0]) => {
			pipelineWrites.push(args.collection as string)
			return original(args)
		}) as typeof booted.payload.create
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('adds the fields on the direct write and leaves built-in ones alone', async () => {
		pipelineWrites.length = 0
		const doc = await booted.payload.create({ collection: 'posts', data: { title: 'A' }, req })
		const [log] = await readLogs(booted.payload, { documentId: { equals: String(doc.id) } })

		expect(log?.actorDepartments).toEqual(['sales', 'support'])
		expect(log?.source).toBe('extended:create')
		expect(log?.operation).toBe('create')
		expect(log?.user).toEqual({ relationTo: 'users', value: String(req.user?.id) })
		expect(pipelineWrites).not.toContain('audit-logs')
	})

	it('adds them to custom events too', async () => {
		await createAuditEvent(req, { collection: 'posts', eventType: 'extend_check' })
		const [log] = await readLogs(booted.payload, { eventType: { equals: 'extend_check' } })

		expect(log?.source).toBe('extended:custom')
		expect(log?.actorDepartments).toEqual(['sales', 'support'])
	})

	it('adds nothing when it returns undefined', async () => {
		const quiet = { ...req, context: { skipExtend: true } } as unknown as PayloadRequest
		const doc = await booted.payload.create({
			collection: 'posts',
			data: { title: 'B' },
			req: quiet,
		})
		const [log] = await readLogs(booted.payload, { documentId: { equals: String(doc.id) } })

		expect(log?.operation).toBe('create')
		expect(log?.source ?? undefined).toBeUndefined()
	})

	it('is matched by a declared filter, whichever value it names', async () => {
		const where = (values: string[]) => ({
			and: filterConditions(
				{ custom: { department: values } },
				{ customFilters: [{ name: 'department', path: 'actorDepartments' }] }
			),
		})

		const support = await readLogs(booted.payload, where(['support']))
		const none = await readLogs(booted.payload, where(['finance']))

		expect(support.length).toBeGreaterThan(0)
		expect(support.every((log) => log.actorDepartments?.includes('support'))).toBe(true)
		expect(none).toEqual([])
	})
})
