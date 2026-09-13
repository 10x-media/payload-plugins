import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { MetricKey } from '../../src/core/contract'
import { GOALS_SLUG } from '../../src/goals/collection'
import type { GoalActionRunArgs } from '../../src/goals/trackGoalAction'
import { trackGoalAction } from '../../src/goals/trackGoalAction'
import type { Goal } from '../../src/goals/types'
import { analytics } from '../../src/index'
import { EVENTS_SLUG } from '../../src/native/collections/events'
import { native } from '../../src/native/nativeAdapter'

const DAY_MS = 86_400_000
const HOST = 'shop.example'

const configGoals: Goal[] = [{ slug: 'book-demo', name: 'Book a demo', match: { kind: 'goal' } }]

const metrics: MetricKey[] = ['conversions', 'revenue']

describeForDb('analytics trackGoalAction', { dbs: ['mongo'] }, (db) => {
	const adapter = native()
	let booted: BootedPayload
	let range: { start: Date; end: Date }

	const totalsFor = async (path: string): Promise<Partial<Record<MetricKey, number>>> => {
		const result = await adapter.query({ path, metrics, dateRange: range }, {})
		return result.totals ?? {}
	}

	const runArgs = (overrides: Partial<GoalActionRunArgs>): GoalActionRunArgs => ({
		form: { id: 'demo-form', title: 'Demo request' },
		submissionId: 'sub-1',
		values: [],
		config: {},
		payload: booted.payload,
		...overrides,
	})

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [adapter],
				goals: { collection: true, defaults: configGoals },
			}),
		})
		const now = Date.now()
		range = { start: new Date(now - DAY_MS), end: new Date(now + 60_000) }
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	it('completes a config goal and stamps the form on the event', async () => {
		await trackGoalAction({ hostname: HOST }).run(
			runArgs({ config: { goal: 'book-demo', value: 25, currency: 'EUR' } })
		)

		expect(await totalsFor('/forms/demo-form')).toMatchObject({ conversions: 1, revenue: 25 })

		const stored = await booted.payload.find({
			collection: EVENTS_SLUG as never,
			where: { path: { equals: '/forms/demo-form' } },
		})
		expect(stored.docs).toHaveLength(1)
		expect((stored.docs[0] as { props?: Record<string, unknown> }).props).toMatchObject({
			formId: 'demo-form',
			formTitle: 'Demo request',
			submissionId: 'sub-1',
		})
	})

	it('completes a goal stored in the goals collection, valued from the submission', async () => {
		await booted.payload.create({
			collection: GOALS_SLUG as never,
			data: {
				name: 'Quote requested',
				slug: 'quote-requested',
				enabled: true,
				match: { kind: 'goal' },
				currency: 'EUR',
			} as never,
		})

		await trackGoalAction({ hostname: HOST }).run(
			runArgs({
				form: { id: 'quote-form', title: 'Quote' },
				submissionId: 'sub-2',
				config: { goal: 'quote-requested', valueFrom: 'budget' },
				values: [{ field: 'budget', value: '1500' }],
			})
		)

		expect(await totalsFor('/forms/quote-form')).toMatchObject({
			conversions: 1,
			revenue: 1500,
		})
	})
})
