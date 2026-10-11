import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import {
	type CollectionConfig,
	createLocalReq,
	Forbidden,
	handleEndpoints,
	type Payload,
} from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { TASK_SLUGS } from '../../src/core/jobs'
import { analytics } from '../../src/index'
import { native } from '../../src/native/nativeAdapter'
import { JOB_STATS_GLOBAL } from '../../src/plugin/jobsAccess'

/** The admin collection: the first one with auth, so `admin.user` names it. */
const users: CollectionConfig = { slug: 'users', auth: true, fields: [] }

/** Shoppers who sign in to the site itself, never to the admin. */
const customers: CollectionConfig = { slug: 'customers', auth: true, fields: [] }

const PASSWORD = 'test-pass-1234'

/** A queue nothing else uses, so a run the admin starts here finds only what this spec queued. */
const QUEUE = 'jobs-access-spec'

const login = async (payload: Payload, collection: 'users' | 'customers', email: string) => {
	const user = await payload.create({ collection, data: { email, password: PASSWORD } })
	const { token } = await payload.login({ collection, data: { email, password: PASSWORD } })
	return { user, token }
}

describeForDb('Payload job controls once the plugin turns jobs on', {}, (db) => {
	let booted: BootedPayload
	let admin: Awaited<ReturnType<typeof login>>
	let customer: Awaited<ReturnType<typeof login>>
	let jobId: string | number

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			collections: [users, customers],
			plugin: analytics({ adapters: [native()], capture: { gate: 'off' } }),
		})
		const { payload } = booted
		admin = await login(payload, 'users', `admin-${db}@jobs.test`)
		customer = await login(payload, 'customers', `shopper-${db}@jobs.test`)
		const job = await payload.jobs.queue({ task: TASK_SLUGS.maintain, input: {}, queue: QUEUE })
		jobId = job.id
	}, 240_000)

	afterAll(async () => {
		await booted?.stop()
	})

	const call = (
		path: string,
		token: string | undefined,
		init: { method?: string; body?: unknown } = {}
	): Promise<Response> =>
		handleEndpoints({
			config: booted.payload.config,
			payloadInstanceCacheKey: booted.cacheKey,
			request: new Request(`http://localhost:3000/api${path}`, {
				method: init.method ?? 'GET',
				headers: {
					...(token ? { cookie: `payload-token=${token}` } : {}),
					...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
				},
				...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
			}),
		})

	const later = { waitUntil: '2100-01-01T00:00:00.000Z' }

	it(`refuses a user of a second auth collection every job control on ${db}`, async () => {
		const token = customer.token
		const calls: Array<[string, string, unknown?]> = [
			['POST', '/payload-jobs', { taskSlug: TASK_SLUGS.maintain, input: {}, queue: QUEUE }],
			['GET', '/payload-jobs'],
			['GET', `/payload-jobs/${jobId}`],
			['PATCH', `/payload-jobs/${jobId}`, later],
			['DELETE', `/payload-jobs/${jobId}`],
			['GET', `/globals/${JOB_STATS_GLOBAL}`],
			['POST', `/globals/${JOB_STATS_GLOBAL}`, { stats: {} }],
		]
		for (const [method, path, body] of calls) {
			const response = await call(path, token, { method, body })
			expect(response.status, `${method} ${path}`).toBe(403)
		}
		for (const path of [
			`/payload-jobs/run?queue=${QUEUE}`,
			`/payload-jobs/handle-schedules?queue=${QUEUE}`,
		]) {
			expect((await call(path, token)).status, path).toBe(401)
		}
		const job = await booted.payload.findByID({ collection: 'payload-jobs', id: jobId })
		expect(job.waitUntil ?? null).toBeNull()
		expect(await booted.payload.count({ collection: 'payload-jobs' })).toEqual({ totalDocs: 1 })
	})

	it(`refuses that user payload.jobs.queue and cancel without overrideAccess on ${db}`, async () => {
		const { payload } = booted
		const req = await createLocalReq(
			{ user: { ...customer.user, collection: 'customers' } },
			payload
		)
		await expect(
			payload.jobs.queue({
				task: TASK_SLUGS.maintain,
				input: {},
				queue: QUEUE,
				req,
				overrideAccess: false,
			})
		).rejects.toBeInstanceOf(Forbidden)
		await expect(
			payload.jobs.cancel({ where: { queue: { equals: QUEUE } }, req, overrideAccess: false })
		).rejects.toBeInstanceOf(Forbidden)
	})

	it(`admits a user of the admin collection to the same controls on ${db}`, async () => {
		const token = admin.token
		const created = await call('/payload-jobs', token, {
			method: 'POST',
			body: { taskSlug: TASK_SLUGS.maintain, input: {}, queue: QUEUE },
		})
		expect(created.status).toBe(201)
		expect((await call('/payload-jobs', token)).status).toBe(200)
		expect((await call(`/payload-jobs/${jobId}`, token)).status).toBe(200)
		const patched = await call(`/payload-jobs/${jobId}`, token, { method: 'PATCH', body: later })
		expect(patched.status).toBe(200)
		expect((await call(`/globals/${JOB_STATS_GLOBAL}`, token)).status).toBe(200)
		const stats = await call(`/globals/${JOB_STATS_GLOBAL}`, token, { method: 'POST', body: {} })
		expect(stats.status).toBe(200)
		const schedules = await call(`/payload-jobs/handle-schedules?queue=${QUEUE}`, token)
		expect(schedules.status).toBe(200)
		const run = await call(`/payload-jobs/run?queue=${QUEUE}&disableScheduling=true`, token)
		expect(run.status).toBe(200)
		const { payload } = booted
		const req = await createLocalReq({ user: { ...admin.user, collection: 'users' } }, payload)
		const queued = await payload.jobs.queue({
			task: TASK_SLUGS.maintain,
			input: {},
			queue: QUEUE,
			req,
			overrideAccess: false,
		})
		expect(queued.id).toBeDefined()
	})
})
