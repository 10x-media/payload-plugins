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
		const result = await resolveViewProps(reqFor(booted.payload, user), resolveOptions(options))
		expect(result.denied).toBe(false)
		if (result.denied) return
		const { props } = result
		expect(props.sources.defaultId).toBe('memory')
		expect(props.sources.sources.map((s) => s.id)).toEqual(['memory'])
		expect(props.sources.sources[0]?.capabilities.metrics).toContain('pageviews')
		expect(props.goals.map((g) => g.slug).sort()).toEqual(['purchase', 'signup'])
		expect(props.defaults).toEqual({ range: 'last30days', metric: 'pageviews' })
		expect(props.apiRoute).toBe(booted.payload.config.routes.api)
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
		const result = await resolveViewProps(reqFor(booted.payload, user), resolveOptions(options))
		if (result.denied) throw new Error('expected access')
		expect(result.props.goals).toContainEqual({ slug: 'book-demo', name: 'Demo booked' })
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
	let stranger: Awaited<ReturnType<typeof login>>
	const options: AnalyticsPluginOptions = {
		adapters: [memoryAdapter()],
		goals: configGoals,
		scopeResolver: ({ req }) =>
			(req.user as { email?: string })?.email === 'a@t.dev' ? 'tenant-a' : null,
		access: { platformRead: () => false },
	}

	beforeAll(async () => {
		booted = await bootPayload({ collections: [viewers], db, plugin: analytics(options) })
		await login(booted.payload, 'a@t.dev')
		stranger = await login(booted.payload, 'nobody@t.dev')
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	it('keys the client on the scope the request resolved to', async () => {
		const tenant = await booted.payload.login({
			collection: 'viewers',
			data: { email: 'a@t.dev', password: 'test-pass-1234' },
		})
		const result = await resolveViewProps(
			reqFor(booted.payload, tenant.user),
			resolveOptions(options)
		)
		if (result.denied) throw new Error('expected access')
		expect(result.props.scopeKey).toBe('tenant-a')
	})

	it('yields no sources and no goals when the scope does not resolve', async () => {
		const result = await resolveViewProps(reqFor(booted.payload, stranger), resolveOptions(options))
		if (result.denied) throw new Error('expected access')
		expect(result.props.sources).toEqual({ defaultId: null, sources: [] })
		expect(result.props.goals).toEqual([])
		expect(result.props.scopeKey).toBe('')
	})
})
