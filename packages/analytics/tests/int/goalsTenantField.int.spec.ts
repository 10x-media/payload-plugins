import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig, Payload, PayloadRequest, Where } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { PLATFORM_SCOPE } from '../../src/core/contract'
import { GOALS_SLUG } from '../../src/goals/collection'
import type { Goal } from '../../src/goals/types'
import { analytics } from '../../src/index'
import { native } from '../../src/native/nativeAdapter'
import { getRuntime, goalNamesFor, resolveGoalsDetailedFor } from '../../src/plugin/runtime'
import { readForWidgetGoals } from '../../src/widgets/readForWidgetGoals'

const configGoals: Goal[] = [{ slug: 'signup', name: 'Signup (config)', match: { kind: 'goal' } }]

const tenants: CollectionConfig = { slug: 'tenants', fields: [{ name: 'name', type: 'text' }] }

const STAFF = 'staff@t.dev'

const editors: CollectionConfig = {
	slug: 'editors',
	auth: true,
	fields: [{ name: 'tenant', type: 'relationship', relationTo: 'tenants' }],
}

/**
 * What `@payloadcms/plugin-multi-tenant` does to a collection it is given: a tenant relationship
 * first in the fields, and every read narrowed to the tenants the user belongs to.
 */
const asTenantOwned = (collection: CollectionConfig): CollectionConfig => {
	const read = collection.access?.read
	return {
		...collection,
		fields: [
			{ name: 'tenant', type: 'relationship', relationTo: 'tenants', index: true },
			...collection.fields,
		],
		access: {
			...collection.access,
			read: async (args) => {
				const own = read ? await read(args) : Boolean(args.req.user)
				// The plugin's `userHasAccessToAllTenants`: platform staff read every tenant's rows.
				if ((args.req.user as { email?: string } | null)?.email === STAFF) {
					return own
				}
				const assigned = (args.req.user as { tenant?: unknown } | null)?.tenant
				// The relationship arrives populated or as the id, as the plugin reads it either way.
				const tenant =
					assigned !== null && typeof assigned === 'object' && 'id' in assigned
						? assigned.id
						: assigned
				if (own === false || tenant === undefined || tenant === null) {
					return false
				}
				const mine: Where = { tenant: { in: [tenant] } }
				return own === true ? mine : { and: [own, mine] }
			},
		},
	}
}

/** The tenant a request selected, as the selector cookie names it; no selection throws. */
const SELECTED = 'x-selected-tenant'

describeForDb('analytics goals owned through a tenant relationship', {}, (db) => {
	let booted: BootedPayload
	/** The tenants' ids as the database types them, and as the scope resolver names them. */
	let alphaId: string | number
	let betaId: string | number
	let alpha: string
	let beta: string
	let editor: Record<string, unknown>
	let staffUser: Record<string, unknown>

	const requestFor = (selected?: string, user = editor): PayloadRequest =>
		({
			payload: booted.payload,
			user: { ...user, collection: 'editors' },
			headers: new Headers(selected === undefined ? {} : { [SELECTED]: selected }),
			i18n: { t: (key: string) => key, language: 'en' },
		}) as unknown as PayloadRequest

	/** Written by platform staff, as a seed is: the stamp only takes a named tenant from them. */
	const goal = (
		payload: Payload,
		staff: Record<string, unknown>,
		data: { tenant: string | number; slug: string; name: string }
	) =>
		payload.create({
			collection: GOALS_SLUG as never,
			data: { ...data, match: { kind: 'goal' } } as never,
			user: { ...staff, collection: 'editors' },
		})

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			collections: [tenants, editors],
			plugin: analytics({
				adapters: [native()],
				capture: { gate: 'off' },
				scope: {
					member: () => true,
					resolve: ({ req, callSite }) => {
						if (callSite === 'capture') {
							return null
						}
						const selected = req.headers.get(SELECTED)
						if (!selected) {
							throw new Error('no tenant selected yet')
						}
						return selected
					},
				},
				access: {
					read: () => true,
					crossScope: ({ req }) => (req.user as { email?: string } | null)?.email === STAFF,
				},
				goals: {
					defaults: configGoals,
					collection: { scopeField: 'tenant', overrides: asTenantOwned },
				},
			}),
		})
		const { payload } = booted
		alphaId = (await payload.create({ collection: 'tenants' as never, data: {} })).id
		betaId = (await payload.create({ collection: 'tenants' as never, data: {} })).id
		alpha = String(alphaId)
		beta = String(betaId)
		editor = (await payload.create({
			collection: 'editors' as never,
			data: { email: `alpha-${db}@t.dev`, password: 'test-password', tenant: alphaId } as never,
		})) as unknown as Record<string, unknown>
		const staff = (await payload.create({
			collection: 'editors' as never,
			data: { email: STAFF, password: 'test-password' } as never,
		})) as unknown as Record<string, unknown>
		staffUser = staff
		await goal(payload, staff, { tenant: alphaId, slug: 'newsletter', name: 'Alpha newsletter' })
		await goal(payload, staff, { tenant: betaId, slug: 'quote', name: 'Beta quote' })
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	it('resolves each tenant only its own goals, beside the config ones', async () => {
		const runtime = getRuntime(booted.payload)
		if (!runtime) {
			throw new Error('runtime missing')
		}
		const slugs = async (scope: string) =>
			(await resolveGoalsDetailedFor(runtime, requestFor(scope), scope)).map(
				(entry) => entry.goal.slug
			)
		expect(await slugs(alpha)).toEqual(['signup', 'newsletter', 'purchase'])
		expect(await slugs(beta)).toEqual(['signup', 'quote', 'purchase'])
	})

	it('answers an install-wide read with the config goals and no failed read', async () => {
		const runtime = getRuntime(booted.payload)
		if (!runtime) {
			throw new Error('runtime missing')
		}
		const warn = vi.spyOn(booted.payload.logger, 'warn')
		const resolved = await resolveGoalsDetailedFor(runtime, requestFor(), null)
		expect(resolved.map((entry) => entry.goal.slug)).toEqual(['signup', 'purchase'])
		expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('goals collection read failed'))
		warn.mockRestore()
	})

	it('lists the selected tenant’s goals to its editor through the collection’s access', async () => {
		const runtime = getRuntime(booted.payload)
		const listed = await runtime?.listGoals?.(requestFor(alpha), alpha)
		expect(listed?.map((entry) => entry.goal.slug)).toEqual(['signup', 'newsletter', 'purchase'])
	})

	// All sites reads every tenant's goals, so their rows need every tenant's names, as far as
	// the reader may see them, rather than their slugs.
	it('names every tenant’s goals for a read across tenants, as the reader may see them', async () => {
		const runtime = getRuntime(booted.payload)
		if (!runtime) {
			throw new Error('runtime missing')
		}
		const names = async (scope: string | null, user = staffUser) =>
			Object.fromEntries(
				(await goalNamesFor({ runtime, req: requestFor(undefined, user), scope })).map((goal) => [
					goal.slug,
					goal.name,
				])
			)
		expect(await names(PLATFORM_SCOPE)).toMatchObject({
			signup: 'Signup (config)',
			newsletter: 'Alpha newsletter',
			quote: 'Beta quote',
		})
		expect(await names(null)).toMatchObject({ quote: 'Beta quote' })
		// The collection's access still decides: alpha's editor never learns beta's goal name.
		expect(await names(PLATFORM_SCOPE, editor)).not.toHaveProperty('quote')
		const own = await goalNamesFor({ runtime, req: requestFor(alpha, staffUser), scope: alpha })
		expect(own.map((goal) => goal.slug)).toEqual(['signup', 'newsletter', 'purchase'])
	})

	it('answers the goals widget at once when no tenant is selected yet', async () => {
		const startedAt = Date.now()
		const result = await readForWidgetGoals({
			req: requestFor(),
			timeframe: 'last7days',
			limit: 10,
			compare: false,
			now: new Date(),
		})
		expect(result.status).not.toBe('ok')
		expect(Date.now() - startedAt).toBeLessThan(5_000)
	})

	it('reads the goals widget for the selected tenant', async () => {
		const result = await readForWidgetGoals({
			req: requestFor(alpha),
			timeframe: 'last7days',
			limit: 10,
			compare: false,
			now: new Date(),
		})
		expect(result.status).toBe('ok')
		expect(result.noGoals).not.toBe(true)
	})
})
