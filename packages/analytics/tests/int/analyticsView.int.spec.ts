import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig, Payload, PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { type AnalyticsPluginOptions, resolveOptions } from '../../src/core/options'
import { GOALS_SLUG } from '../../src/goals/collection'
import type { Goal } from '../../src/goals/types'
import { analytics } from '../../src/index'
import { memoryAdapter } from '../../src/testing/memoryAdapter'
import { resolveViewProps } from '../../src/view/viewProps'

const viewers: CollectionConfig = { slug: 'viewers', auth: true, fields: [] }

const configGoals: Goal[] = [
	{ slug: 'purchase', name: 'Purchase', match: { kind: 'goal' } },
	{ slug: 'signup', name: 'Signup', match: { kind: 'event', name: 'signup_done' } },
]

const login = async (payload: Payload, email: string) => {
	const password = 'test-pass-1234'
	await payload.create({ collection: 'viewers', data: { email, password } })
	const { user } = await payload.login({ collection: 'viewers', data: { email, password } })
	return user
}

const reqFor = (payload: Payload, user: unknown): PayloadRequest =>
	({ user, payload, i18n: { language: 'de' } }) as unknown as PayloadRequest

/** The view's props for `user`, failing the test when the view denies them. */
const allowedProps = async (payload: Payload, user: unknown, options: AnalyticsPluginOptions) => {
	const result = await resolveViewProps(reqFor(payload, user), resolveOptions(options))
	if (result.denied) throw new Error('expected access')
	return result.props
}

describeForDb('analytics view props: unscoped install', {}, (db) => {
	let booted: BootedPayload
	let user: Awaited<ReturnType<typeof login>>
	const options: AnalyticsPluginOptions = {
		adapters: [memoryAdapter()],
		goals: { defaults: configGoals, collection: true },
		reportingTimezone: 'Europe/Berlin',
	}

	beforeAll(async () => {
		booted = await bootPayload({ collections: [viewers], db, plugin: analytics(options) })
		user = await login(booted.payload, 'admin@t.dev')
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	it('resolves sources, goals, defaults, routes and timezone for an admin', async () => {
		const props = await allowedProps(booted.payload, user, options)
		expect(props.sources.defaultId).toBe('memory')
		expect(props.sources.sources.map((s) => s.id)).toEqual(['memory'])
		expect(props.sources.sources[0]?.capabilities.metrics).toContain('pageviews')
		expect(props.goals.map((g) => g.slug).sort()).toEqual(['purchase', 'signup'])
		expect(props.defaults).toEqual({ range: 'last30days', metric: 'pageviews' })
		const api = booted.payload.config.routes.api
		expect(props.endpoints).toEqual({
			query: `${api}/_x/query`,
			refresh: `${api}/_x/refresh`,
			live: `${api}/_x/live`,
		})
		expect(props.adminRoute).toBe(booted.payload.config.routes.admin)
		expect(props.timezone).toBe('Europe/Berlin')
		expect(props.locale).toBe('de')
		expect(props.scopeKey).toBe('')
	})

	it('lists a collection goal alongside the config goals', async () => {
		await booted.payload.create({
			collection: GOALS_SLUG as never,
			data: { name: 'Demo booked', slug: 'book-demo', match: { kind: 'goal' } } as never,
		})
		const props = await allowedProps(booted.payload, user, options)
		expect(props.goals).toContainEqual({ slug: 'book-demo', name: 'Demo booked' })
	})

	it('reports a denied access.view without resolving anything', async () => {
		const denying = { ...options, access: { view: () => false } }
		const result = await resolveViewProps(reqFor(booted.payload, user), resolveOptions(denying))
		expect(result).toEqual({ denied: true })
	})

	it('denies the view when access.read denies and access.view is unset', async () => {
		const denying = { ...options, access: { read: () => false } }
		const result = await resolveViewProps(reqFor(booted.payload, user), resolveOptions(denying))
		expect(result).toEqual({ denied: true })
	})
})

describeForDb('analytics view props: scoped install', {}, (db) => {
	let booted: BootedPayload
	let tenant: Awaited<ReturnType<typeof login>>
	let stranger: Awaited<ReturnType<typeof login>>
	const options: AnalyticsPluginOptions = {
		adapters: [memoryAdapter()],
		goals: configGoals,
		scope: {
			member: () => true,
			resolve: ({ req }) =>
				(req.user as { email?: string })?.email === 'a@t.dev' ? 'tenant-a' : null,
		},
		access: { crossScope: () => false },
	}

	beforeAll(async () => {
		booted = await bootPayload({ collections: [viewers], db, plugin: analytics(options) })
		tenant = await login(booted.payload, 'a@t.dev')
		stranger = await login(booted.payload, 'nobody@t.dev')
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	it('keys the client on the scope the request resolved to', async () => {
		const props = await allowedProps(booted.payload, tenant, options)
		expect(props.scopeKey).toBe('tenant-a')
	})

	it('yields no sources and no goals when the scope does not resolve', async () => {
		const props = await allowedProps(booted.payload, stranger, options)
		expect(props.sources).toEqual({ defaultId: null, sources: [] })
		expect(props.goals).toEqual([])
		expect(props.scopeKey).toBe('')
	})
})
