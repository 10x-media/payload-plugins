import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import type { MetricKey, MetricValues } from '../../src/core/contract'
import { GOALS_SLUG } from '../../src/goals/collection'
import type { GoalActionRunArgs } from '../../src/goals/trackGoalAction'
import { GOAL_ACTION_TYPE, trackGoalAction } from '../../src/goals/trackGoalAction'
import type { Goal } from '../../src/goals/types'
import { analytics } from '../../src/index'
import { native } from '../../src/native/nativeAdapter'
import { DAY_MS } from '../../src/timeframe/tz'
import { ACTION_HOST_SLUG, actionHost } from './actionHost'
import { storedHits } from './nativeHelpers'

const HOST = 'shop.example'

const configGoals: Goal[] = [{ slug: 'book-demo', name: 'Book a demo', match: { kind: 'goal' } }]

const metrics: MetricKey[] = ['conversions', 'revenue']

describeForDb('analytics trackGoalAction', {}, (db) => {
	const adapter = native()
	let booted: BootedPayload
	let range: { start: Date; end: Date }

	const totalsFor = async (path: string): Promise<MetricValues> => {
		const result = await adapter.query(
			{ path, metrics, dateRange: range },
			{ payload: booted.payload }
		)
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
				capture: { gate: 'off' },
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

		const stored = await storedHits(booted.payload, { path: { equals: '/forms/demo-form' } })
		expect(stored).toHaveLength(1)
		expect(stored[0]?.props).toMatchObject({
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

	it(`records a submission as no visitor's when identity says 'none', on ${db}`, async () => {
		const submitter = (consented: boolean): PayloadRequest =>
			({
				payload: booted.payload,
				headers: new Headers({
					host: HOST,
					'x-forwarded-for': '9.9.9.9',
					'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148',
					...(consented ? { cookie: 'measured=1' } : {}),
				}),
			}) as unknown as PayloadRequest
		const action = trackGoalAction({
			hostname: HOST,
			identity: ({ req }) =>
				req?.headers.get('cookie')?.includes('measured=1') ? 'request' : 'none',
		})
		const form = { id: 'identity-form', title: 'Identity' }
		await action.run(runArgs({ form, config: { goal: 'book-demo' }, req: submitter(true) }))
		await action.run(runArgs({ form, config: { goal: 'book-demo' }, req: submitter(false) }))

		expect(await totalsFor('/forms/identity-form')).toMatchObject({ conversions: 2 })
		const stored = await storedHits(booted.payload, { path: { equals: '/forms/identity-form' } })
		expect(stored.map((hit) => hit.v === '')).toEqual([false, true])
		expect(stored.map((hit) => hit.device ?? '')).toEqual(['mobile', ''])
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

	const hostnameOf = async (path: string): Promise<unknown> =>
		(await storedHits(booted.payload, { path: { equals: path } }))[0]?.hostname

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			configOverrides: { serverURL: 'https://cms.example' },
			plugin: analytics({
				adapters: [adapter],
				capture: { gate: 'off' },
				goals: { defaults: configGoals },
			}),
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
			plugin: analytics({
				adapters: [native()],
				capture: { gate: 'off' },
				goals: { defaults: configGoals },
			}),
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

		expect(await storedHits(booted.payload, { path: { equals: '/hostless' } })).toHaveLength(0)
		expect(warn).toHaveBeenCalledTimes(1)
		warn.mockRestore()
	})
})
