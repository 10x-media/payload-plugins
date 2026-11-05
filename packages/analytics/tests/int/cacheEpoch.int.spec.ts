import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import type { AnalyticsAdapter, AnalyticsQuery } from '../../src/core/contract'
import { GOALS_SLUG } from '../../src/goals/collection'
import { analytics } from '../../src/index'
import { type AnalyticsRuntime, getRuntime } from '../../src/plugin/runtime'
import { PROVIDERS_SLUG } from '../../src/providers/collection'
import { memoryAdapter } from '../../src/testing/memoryAdapter'

const providerData = (name: string, scope: string) => ({
	name,
	provider: 'plausible',
	enabled: true,
	scope,
	plausible: { siteId: 'example.com', apiKey: 'plausible-key' },
})

/** An adapter outside every registry that counts how often a read reaches it. */
const recordingAdapter = () => {
	const seen: AnalyticsQuery[] = []
	const adapter: AnalyticsAdapter = {
		id: 'recording',
		label: 'Recording',
		capabilities: memoryAdapter().capabilities,
		isConfigured: () => true,
		query: async (q) => {
			seen.push(q)
			return {
				rows: [],
				totals: { pageviews: 1 },
				meta: { provider: 'recording', fetchedAt: q.dateRange.end.toISOString() },
			}
		},
	}
	return { adapter, seen }
}

const runtimeOf = (booted: BootedPayload): AnalyticsRuntime => {
	const runtime = getRuntime(booted.payload)
	if (!runtime) throw new Error('runtime missing')
	return runtime
}

const queryFor = (scope?: string): AnalyticsQuery => ({
	metrics: ['pageviews'],
	dateRange: { start: new Date('2026-01-01'), end: new Date('2026-01-31') },
	...(scope ? { scope } : {}),
})

describeForDb('analytics config epoch: saves retire cached reads', {}, (db) => {
	let booted: BootedPayload
	const { adapter: recording, seen } = recordingAdapter()

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [memoryAdapter()],
				capture: { gate: 'off' },
				scope: { member: () => true, resolve: ({ req }) => req.headers.get('x-tenant') },
				access: { crossScope: () => true },
				providers: { collection: true },
				goals: { collection: true },
			}),
		})
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	/** How many reads of a scope reached the adapter, after one more read of it. */
	const readsAfterRead = async (scope: string): Promise<number> => {
		await runtimeOf(booted).engine.read(recording, queryFor(scope))
		return seen.filter((q) => q.scope === scope).length
	}

	const configEpoch = (scope: string | null) => {
		const epoch = runtimeOf(booted).configEpoch
		if (!epoch) throw new Error('config epoch missing')
		return epoch(scope)
	}

	it(`writes nothing anywhere when a document is saved on ${db}`, async () => {
		const set = vi.spyOn(booted.payload.kv, 'set')
		try {
			await booted.payload.create({
				collection: PROVIDERS_SLUG,
				data: providerData('Quiet save', 'quiet'),
				overrideAccess: true,
			})
			await booted.payload.create({
				collection: GOALS_SLUG,
				data: {
					name: 'Quiet',
					slug: 'quiet',
					enabled: true,
					scope: 'quiet',
					match: { kind: 'goal' },
				},
				overrideAccess: true,
			})
			expect(set).not.toHaveBeenCalled()
		} finally {
			set.mockRestore()
		}
	})

	it(`keeps a scope's epoch while nothing in it changes on ${db}`, async () => {
		const before = await configEpoch('steady')
		await booted.payload.create({
			collection: PROVIDERS_SLUG,
			data: providerData('Elsewhere', 'not-steady'),
			overrideAccess: true,
		})
		expect(await configEpoch('steady')).toBe(before)
	})

	it(`retires the saved scope's reads on the instance that saved, and only that scope's, on ${db}`, async () => {
		expect(await readsAfterRead('tenant-a')).toBe(1)
		expect(await readsAfterRead('tenant-a')).toBe(1)
		expect(await readsAfterRead('tenant-b')).toBe(1)
		const created = await booted.payload.create({
			collection: PROVIDERS_SLUG,
			data: providerData('Tenant A provider', 'tenant-a'),
			overrideAccess: true,
		})
		expect(await readsAfterRead('tenant-a')).toBe(2)
		expect(await readsAfterRead('tenant-b')).toBe(1)

		await booted.payload.update({
			collection: PROVIDERS_SLUG,
			id: created.id,
			data: { name: 'Renamed' },
			overrideAccess: true,
		})
		expect(await readsAfterRead('tenant-a')).toBe(3)
		expect(await readsAfterRead('tenant-b')).toBe(1)
	})

	it(`retires a scope's reads when one of its documents is deleted on ${db}`, async () => {
		await booted.payload.create({
			collection: PROVIDERS_SLUG,
			data: providerData('Kept', 'delete-a'),
			overrideAccess: true,
		})
		const gone = await booted.payload.create({
			collection: PROVIDERS_SLUG,
			data: providerData('Gone', 'delete-a'),
			overrideAccess: true,
		})
		expect(await readsAfterRead('delete-a')).toBe(1)
		await booted.payload.delete({ collection: PROVIDERS_SLUG, id: gone.id, overrideAccess: true })
		expect(await readsAfterRead('delete-a')).toBe(2)
	})

	// The epoch is the committed documents themselves, so a scope put back exactly as it was keys
	// its reads as they were keyed then: those entries were read from that same configuration.
	it(`serves what was cached for a configuration the scope returns to on ${db}`, async () => {
		expect(await readsAfterRead('return-a')).toBe(1)
		const created = await booted.payload.create({
			collection: PROVIDERS_SLUG,
			data: providerData('Brief', 'return-a'),
			overrideAccess: true,
		})
		expect(await readsAfterRead('return-a')).toBe(2)
		await booted.payload.delete({
			collection: PROVIDERS_SLUG,
			id: created.id,
			overrideAccess: true,
		})
		expect(await readsAfterRead('return-a')).toBe(2)
	})

	it(`retires both scopes when a document moves between them on ${db}`, async () => {
		const created = await booted.payload.create({
			collection: PROVIDERS_SLUG,
			data: providerData('Mover', 'move-a'),
			overrideAccess: true,
		})
		expect(await readsAfterRead('move-a')).toBe(1)
		expect(await readsAfterRead('move-b')).toBe(1)
		await booted.payload.update({
			collection: PROVIDERS_SLUG,
			id: created.id,
			data: { scope: 'move-b' },
			overrideAccess: true,
		})
		expect(await readsAfterRead('move-a')).toBe(2)
		expect(await readsAfterRead('move-b')).toBe(2)
	})

	it(`retires a scope's reads when one of its goals is saved on ${db}`, async () => {
		const stays = await booted.payload.create({
			collection: GOALS_SLUG,
			data: {
				name: 'Stays',
				slug: 'stays',
				enabled: true,
				scope: 'goal-a',
				match: { kind: 'goal' },
			},
			overrideAccess: true,
		})
		expect(await readsAfterRead('goal-a')).toBe(1)
		expect(await readsAfterRead('goal-b')).toBe(1)
		const created = await booted.payload.create({
			collection: GOALS_SLUG,
			data: {
				name: 'Signup',
				slug: 'signup',
				enabled: true,
				scope: 'goal-a',
				match: { kind: 'goal' },
			},
			overrideAccess: true,
		})
		expect(await readsAfterRead('goal-a')).toBe(2)
		expect(await readsAfterRead('goal-b')).toBe(1)
		await booted.payload.update({
			collection: GOALS_SLUG,
			id: created.id,
			data: { name: 'Signup renamed' },
			overrideAccess: true,
		})
		expect(await readsAfterRead('goal-a')).toBe(3)
		await booted.payload.update({
			collection: GOALS_SLUG,
			id: stays.id,
			data: { name: 'Stays renamed' },
			overrideAccess: true,
		})
		expect(await readsAfterRead('goal-a')).toBe(4)
		await booted.payload.update({
			collection: GOALS_SLUG,
			id: created.id,
			data: { scope: 'goal-b' },
			overrideAccess: true,
		})
		expect(await readsAfterRead('goal-a')).toBe(5)
		expect(await readsAfterRead('goal-b')).toBe(2)
	})
})

describeForDb('analytics config epoch: unscoped install', {}, (db) => {
	let booted: BootedPayload
	const { adapter: recording, seen } = recordingAdapter()

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [memoryAdapter()],
				providers: { collection: true },
				goals: { collection: true },
			}),
		})
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	// A document carries no scope at all here, and a read stamps none, so both sides key on the
	// install-wide epoch.
	it(`retires the install-wide reads when a provider or a goal is saved on ${db}`, async () => {
		const { engine } = runtimeOf(booted)
		await engine.read(recording, queryFor())
		await engine.read(recording, queryFor())
		expect(seen).toHaveLength(1)

		await booted.payload.create({
			collection: PROVIDERS_SLUG,
			data: {
				name: 'Install provider',
				provider: 'plausible',
				enabled: true,
				plausible: { siteId: 'example.com', apiKey: 'plausible-key' },
			},
			overrideAccess: true,
		})
		await engine.read(recording, queryFor())
		expect(seen).toHaveLength(2)

		await booted.payload.create({
			collection: GOALS_SLUG,
			data: { name: 'Lead', slug: 'lead', enabled: true, match: { kind: 'goal' } },
			overrideAccess: true,
		})
		await engine.read(recording, queryFor())
		expect(seen).toHaveLength(3)
	})
})
