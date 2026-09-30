import {
	type BootedPayload,
	bootPayload,
	describeForDb,
	installTestClock,
	type TestClock,
} from '@10x-media/payload-test-harness'
import type { CollectionConfig } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { LOCK_STAGES, type LockStage, stageWhere } from '../../src/collection/stage'
import { contentLock } from '../../src/index'

const LOCKS = 'content-locks'
const START = new Date('2026-01-10T10:00:00.000Z')
const EVALUATED = new Date('2026-01-10T12:00:00.000Z')
const hours = (count: number) => new Date(START.getTime() + count * 3_600_000).toISOString()

const posts: CollectionConfig = { slug: 'posts', fields: [{ name: 'title', type: 'text' }] }

describeForDb('content-lock stage filters', {}, (db) => {
	let booted: BootedPayload
	let clock: TestClock
	const expected = new Map<string, LockStage>()

	const create = async (stage: LockStage, data: Record<string, unknown>, draft = false) => {
		const doc = await booted.payload.create({
			collection: LOCKS,
			data: { title: stage, ...data },
			draft,
			overrideAccess: true,
		})
		expected.set(String(doc.id), stage)
		return doc
	}

	beforeAll(async () => {
		clock = installTestClock(START)
		booted = await bootPayload({
			db,
			collections: [posts],
			plugin: contentLock({}),
		})
		await create('active', {})
		await create('ended', { endAtTime: true, endsAt: hours(1) })
		const endedNow = await create('ended', {})
		await booted.payload.update({
			collection: LOCKS,
			data: { endedAt: hours(0.5) },
			id: endedNow.id,
			overrideAccess: true,
		})
		await create('announced', { announce: true, announceAt: hours(1), startsAt: hours(5) })
		await create('pending', { announce: true, announceAt: hours(3), startsAt: hours(5) })
		await create('pending', { startsAt: hours(5) })
		await create('pending', { announce: false, startsAt: hours(5) })
		await create('draft', { startsAt: hours(5) }, true)
		clock.set(EVALUATED)
	})

	afterAll(async () => {
		clock.reset()
		await booted.stop()
	})

	it.each(LOCK_STAGES)('matches the derived %s stage', async (stage) => {
		const { docs } = await booted.payload.find({
			collection: LOCKS,
			depth: 0,
			draft: true,
			limit: 0,
			overrideAccess: true,
			where: stageWhere(stage, EVALUATED),
		})
		const want = [...expected].filter(([, value]) => value === stage).map(([id]) => id)
		expect(docs.map((doc) => String(doc.id)).sort()).toEqual(want.sort())
		for (const doc of docs) {
			expect((doc as { status?: string }).status).toBe(stage)
		}
	})
})
