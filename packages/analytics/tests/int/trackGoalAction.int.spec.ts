import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import type { MetricKey } from '../../src/core/contract'
import { GOALS_SLUG } from '../../src/goals/collection'
import type { GoalActionRunArgs } from '../../src/goals/trackGoalAction'
import { GOAL_ACTION_TYPE, trackGoalAction } from '../../src/goals/trackGoalAction'
import type { Goal } from '../../src/goals/types'
import { analytics } from '../../src/index'
import { EVENTS_SLUG } from '../../src/native/collections/events'
import { native } from '../../src/native/nativeAdapter'
import { ACTION_HOST_SLUG, actionHost } from './actionHost'

const DAY_MS = 86_400_000
const HOST = 'shop.example'

const configGoals: Goal[] = [{ slug: 'book-demo', name: 'Book a demo', match: { kind: 'goal' } }]

const metrics: MetricKey[] = ['conversions', 'revenue']

describeForDb('analytics trackGoalAction', {}, (db) => {
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
			collections: [actionHost()],
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

	it('stores the action config as a block under the action type', async () => {
		const created = await booted.payload.create({
			collection: ACTION_HOST_SLUG as never,
			data: {
				actions: [{ blockType: GOAL_ACTION_TYPE, goal: 'book-demo', value: 40, currency: 'EUR' }],
			} as never,
		})

		const read = await booted.payload.findByID({
			collection: ACTION_HOST_SLUG as never,
			id: (created as { id: string | number }).id,
		})
		expect((read as { actions?: Array<Record<string, unknown>> }).actions?.[0]).toMatchObject({
			blockType: GOAL_ACTION_TYPE,
			goal: 'book-demo',
			value: 40,
			currency: 'EUR',
		})
	})

	it('refuses an action block whose goal slug is not a slug', async () => {
		await expect(
			booted.payload.create({
				collection: ACTION_HOST_SLUG as never,
				data: {
					actions: [{ blockType: GOAL_ACTION_TYPE, goal: 'Not A Slug' }],
				} as never,
			})
		).rejects.toThrow()
	})
})

// A form submission carries a `Host` the visitor chose, so the action is held to the same
// hostname policy the ingest endpoint applies rather than storing what the request claimed.
describeForDb('analytics trackGoalAction hostname policy', {}, (db) => {
	const adapter = native({ hostname: [HOST] })
	let booted: BootedPayload

	const reqWithHost = (host: string): PayloadRequest =>
		({ payload: booted.payload, headers: new Headers({ host }) }) as unknown as PayloadRequest

	const hostnameOf = async (path: string): Promise<string | undefined> => {
		const { docs } = await booted.payload.find({
			collection: EVENTS_SLUG as never,
			where: { path: { equals: path } },
			pagination: false,
		})
		return (docs as unknown as Array<{ hostname: string }>)[0]?.hostname
	}

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			configOverrides: { serverURL: 'https://cms.example' },
			plugin: analytics({ adapters: [adapter], goals: { defaults: configGoals } }),
		})
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	it('stores the listed host a real submission carried', async () => {
		await trackGoalAction({ path: '/listed' }).run({
			form: { id: 'listed-form' },
			submissionId: 'sub-listed',
			values: [],
			config: { goal: 'book-demo' },
			payload: booted.payload,
			req: reqWithHost(`${HOST}:3000`),
		})
		expect(await hostnameOf('/listed')).toBe(HOST)
	})

	it('stores the serverURL host when the policy refuses a forged one', async () => {
		await trackGoalAction({ path: '/forged' }).run({
			form: { id: 'forged-form' },
			submissionId: 'sub-forged',
			values: [],
			config: { goal: 'book-demo' },
			payload: booted.payload,
			req: reqWithHost('attacker.example'),
		})
		expect(await hostnameOf('/forged')).toBe('cms.example')
	})
})

// With no `serverURL` and a request carrying no usable host, nothing names the site the
// conversion happened on. The submission is what matters, so the goal is skipped quietly.
describeForDb('analytics trackGoalAction with nothing to attribute to', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: analytics({ adapters: [native()], goals: { defaults: configGoals } }),
		})
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	it('writes nothing, warns once per process, and still returns', async () => {
		const warn = vi.spyOn(booted.payload.logger, 'warn')
		const action = trackGoalAction({ path: '/hostless' })
		const args: GoalActionRunArgs = {
			form: { id: 'hostless-form' },
			submissionId: 'sub-hostless',
			values: [],
			config: { goal: 'book-demo' },
			payload: booted.payload,
			req: { payload: booted.payload, headers: new Headers() } as unknown as PayloadRequest,
		}

		await expect(action.run(args)).resolves.toBeUndefined()
		await expect(action.run({ ...args, submissionId: 'sub-hostless-2' })).resolves.toBeUndefined()

		const { docs } = await booted.payload.find({
			collection: EVENTS_SLUG as never,
			where: { path: { equals: '/hostless' } },
			pagination: false,
		})
		expect(docs).toHaveLength(0)
		expect(warn).toHaveBeenCalledTimes(1)
		warn.mockRestore()
	})
})
