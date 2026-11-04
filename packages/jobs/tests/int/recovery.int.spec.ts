import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { TaskConfig, WorkflowConfig } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { jobs } from '../../src/index'
import { releaseClaims } from '../../src/reliability/recovery'

// biome-ignore lint/plugin/noProcessEnv: test env boundary (Payload dev-push cache across containers)
process.env.PAYLOAD_FORCE_DRIZZLE_PUSH = 'true'

type Row = {
	claimedBy?: null | string
	completedAt?: null | string
	error?: { message?: string } | null
	hasError?: boolean | null
	processingUntil?: null | string
	recoveryAttempts?: null | number
	startedAt?: null | string
}

const NODE = 'node-under-test'
let ran = 0
let seenMark: null | string | undefined

const probeTask: TaskConfig<'probe'> = {
	slug: 'probe',
	handler: async ({ job, req }) => {
		ran += 1
		const row = (await req.payload.db.findOne({
			collection: 'payload-jobs',
			where: { id: { equals: job.id } },
		})) as Row | null
		seenMark = row?.claimedBy
		return { output: {} }
	},
}

const pipeline: WorkflowConfig<'pipeline'> = {
	slug: 'pipeline',
	handler: async ({ job, req, tasks }) => {
		const runProbe = tasks.probe
		if (!runProbe) {
			throw new Error('probe task is not registered')
		}
		await runProbe('1', { input: {} })
		const row = (await req.payload.db.findOne({
			collection: 'payload-jobs',
			where: { id: { equals: job.id } },
		})) as Row | null
		// The task returned: the workflow's own mark must still be there.
		seenMark = row?.claimedBy
	},
}

describeForDb('recovery layer', {}, (db) => {
	let booted: BootedPayload

	const read = async (id: number | string): Promise<Row> =>
		(await booted.payload.db.findOne({
			collection: 'payload-jobs',
			where: { id: { equals: id } },
		})) as Row

	/** A queued job left behind by a run that died mid-handler. */
	const crashed = async (recoveryAttempts: number): Promise<number | string> => {
		const job = await booted.payload.jobs.queue({ input: {}, overrideAccess: true, task: 'probe' })
		await booted.payload.db.updateOne({
			collection: 'payload-jobs',
			data: { claimedBy: 'dead-node', recoveryAttempts },
			id: job.id,
			returning: false,
		})
		return job.id
	}

	const runAll = () => booted.payload.jobs.run({ allQueues: true, overrideAccess: true })

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: jobs({ reliability: { leaderId: NODE, maxRecoveries: 2 } }),
			db,
			configOverrides: {
				jobs: { deleteJobOnComplete: false, tasks: [probeTask], workflows: [pipeline] },
			},
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('marks a run while it executes and clears the mark when it returns', async () => {
		ran = 0
		const job = await booted.payload.jobs.queue({ input: {}, overrideAccess: true, task: 'probe' })
		await runAll()
		expect(ran).toBe(1)
		expect(seenMark).toBeTruthy()
		const row = await read(job.id)
		expect(row.claimedBy ?? null).toBeNull()
		expect(row.startedAt).toBeTruthy()
		expect(row.recoveryAttempts ?? 0).toBe(0)
		expect(row.completedAt).toBeTruthy()
	})

	it('counts a recovery when the previous run never finished', async () => {
		ran = 0
		const id = await crashed(0)
		await runAll()
		expect(ran).toBe(1)
		const row = await read(id)
		expect(row.recoveryAttempts).toBe(1)
		expect(row.claimedBy ?? null).toBeNull()
		expect(row.completedAt).toBeTruthy()
	})

	it('dead-letters a job at the recovery cap instead of running it', async () => {
		ran = 0
		const id = await crashed(2)
		await runAll()
		expect(ran).toBe(0)
		const row = await read(id)
		expect(row.hasError).toBe(true)
		expect(row.error?.message).toContain('dead-lettered')
		expect(row.completedAt ?? null).toBeNull()
		expect(row.processingUntil ?? null).toBeNull()
		// A dead letter is never claimed again.
		await runAll()
		expect(ran).toBe(0)
	})

	it('keeps the workflow mark while the workflow runs its tasks', async () => {
		seenMark = undefined
		const job = await booted.payload.jobs.queue({
			input: {},
			overrideAccess: true,
			workflow: 'pipeline',
		})
		await runAll()
		expect(seenMark).toBeTruthy()
		expect((await read(job.id)).claimedBy ?? null).toBeNull()
	})

	it('releaseClaims hands leased jobs back and keeps their run mark', async () => {
		const held = await booted.payload.jobs.queue({ input: {}, overrideAccess: true, task: 'probe' })
		const other = await booted.payload.jobs.queue({
			input: {},
			overrideAccess: true,
			task: 'probe',
		})
		const leased = new Date(Date.now() + 60_000).toISOString()
		for (const id of [held.id, other.id]) {
			await booted.payload.db.updateOne({
				collection: 'payload-jobs',
				data: { claimedBy: NODE, processingToken: 'token', processingUntil: leased },
				id,
				returning: false,
			})
		}
		expect(await releaseClaims(booted.payload, [held.id])).toBe(1)
		const released = await read(held.id)
		expect(released.processingUntil ?? null).toBeNull()
		expect(released.claimedBy).toBe(NODE)
		expect((await read(other.id)).processingUntil).toBeTruthy()
		expect(await releaseClaims(booted.payload, [])).toBe(0)
	})
})
