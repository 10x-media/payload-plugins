import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import type { AnalyticsAdapter, AnalyticsQuery } from '../../src/core/contract'
import { GOALS_SLUG } from '../../src/goals/collection'
import { analytics } from '../../src/index'
import { getRuntime } from '../../src/plugin/runtime'
import { PROVIDERS_SLUG } from '../../src/providers/collection'
import { createEpochStore, epochKeyFor } from '../../src/surfacing/epoch'
import { memoryAdapter } from '../../src/testing/memoryAdapter'

const providerData = (name: string, scope: string) => ({
	name,
	provider: 'plausible',
	enabled: true,
	scope,
	plausible: { siteId: 'example.com', apiKey: 'plausible-key' },
})

describeForDb('analytics cache epoch: bump on change', {}, (db) => {
	let booted: BootedPayload
	let providerId: string | number
	let otherId: string | number
	const seen: AnalyticsQuery[] = []

	const recording: AnalyticsAdapter = {
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

	// A fresh store with no memo each time, so every reading is what KV actually holds.
	const epochOf = (scope: string | null) =>
		createEpochStore(booted.payload, { memoMs: 0 }).get(scope)

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [memoryAdapter()],
				scopeResolver: ({ req }) => req.headers.get('x-tenant'),
				access: { platformRead: () => true },
				providers: { collection: true },
				goals: { collection: true },
			}),
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('bumps only the created document scope', async () => {
		const [a, b, global] = await Promise.all([
			epochOf('tenant-a'),
			epochOf('tenant-b'),
			epochOf(null),
		])
		const created = await booted.payload.create({
			collection: PROVIDERS_SLUG as never,
			data: providerData('Tenant A provider', 'tenant-a') as never,
			overrideAccess: true,
		})
		providerId = (created as { id: string | number }).id
		expect(await epochOf('tenant-a')).not.toBe(a)
		expect(await epochOf('tenant-b')).toBe(b)
		expect(await epochOf(null)).toBe(global)
	})

	it('bumps on update', async () => {
		const before = await epochOf('tenant-a')
		await booted.payload.update({
			collection: PROVIDERS_SLUG as never,
			id: providerId,
			data: { name: 'Renamed' } as never,
			overrideAccess: true,
		})
		expect(await epochOf('tenant-a')).not.toBe(before)
	})

	it('bumps both scopes when a document moves between them', async () => {
		const created = await booted.payload.create({
			collection: PROVIDERS_SLUG as never,
			data: providerData('Mover', 'tenant-a') as never,
			overrideAccess: true,
		})
		const moverId = (created as { id: string | number }).id
		const [a, b] = await Promise.all([epochOf('tenant-a'), epochOf('tenant-b')])
		await booted.payload.update({
			collection: PROVIDERS_SLUG as never,
			id: moverId,
			data: { scope: 'tenant-b' } as never,
			overrideAccess: true,
		})
		expect(await epochOf('tenant-a')).not.toBe(a)
		expect(await epochOf('tenant-b')).not.toBe(b)
		otherId = moverId
	})

	it('bumps on delete', async () => {
		const before = await epochOf('tenant-b')
		await booted.payload.delete({
			collection: PROVIDERS_SLUG as never,
			id: otherId,
			overrideAccess: true,
		})
		expect(await epochOf('tenant-b')).not.toBe(before)
	})

	it('bumps on a goal change', async () => {
		const [a, b] = await Promise.all([epochOf('tenant-a'), epochOf('tenant-b')])
		const created = await booted.payload.create({
			collection: GOALS_SLUG as never,
			data: {
				name: 'Signup',
				slug: 'signup',
				enabled: true,
				scope: 'tenant-a',
				match: { kind: 'goal' },
			} as never,
			overrideAccess: true,
		})
		expect(await epochOf('tenant-a')).not.toBe(a)
		expect(await epochOf('tenant-b')).toBe(b)

		const afterCreate = await epochOf('tenant-a')
		await booted.payload.update({
			collection: GOALS_SLUG as never,
			id: (created as { id: string | number }).id,
			data: { name: 'Signup renamed' } as never,
			overrideAccess: true,
		})
		expect(await epochOf('tenant-a')).not.toBe(afterCreate)
	})

	it('bumps both scopes when a goal moves between them', async () => {
		const created = await booted.payload.create({
			collection: GOALS_SLUG as never,
			data: {
				name: 'Mover goal',
				slug: 'mover-goal',
				enabled: true,
				scope: 'tenant-a',
				match: { kind: 'goal' },
			} as never,
			overrideAccess: true,
		})
		const [a, b] = await Promise.all([epochOf('tenant-a'), epochOf('tenant-b')])
		await booted.payload.update({
			collection: GOALS_SLUG as never,
			id: (created as { id: string | number }).id,
			data: { scope: 'tenant-b' } as never,
			overrideAccess: true,
		})
		expect(await epochOf('tenant-a')).not.toBe(a)
		expect(await epochOf('tenant-b')).not.toBe(b)
	})

	// The save succeeding proves nothing on its own: it would pass with no bump attempted at
	// all, so the write to the scope's epoch key is asserted too.
	const bumpedKeys = (set: { mock: { calls: unknown[][] } }): unknown[] =>
		set.mock.calls.map((call) => call[0])

	it('keeps the save when the bump throws', async () => {
		const set = vi
			.spyOn(booted.payload.kv, 'set')
			.mockRejectedValue(new Error('kv down for the bump'))
		try {
			const created = await booted.payload.create({
				collection: PROVIDERS_SLUG as never,
				data: providerData('Saved despite a broken bump', 'tenant-a') as never,
				overrideAccess: true,
			})
			expect((created as { id: string | number }).id).toBeDefined()
			expect(bumpedKeys(set)).toContain(epochKeyFor('tenant-a'))
		} finally {
			set.mockRestore()
		}
	})

	// A KV that hangs rather than failing would otherwise hold the save open indefinitely.
	it('keeps the save when the bump never settles', async () => {
		const set = vi.spyOn(booted.payload.kv, 'set').mockImplementation(() => new Promise(() => {}))
		try {
			const created = await booted.payload.create({
				collection: PROVIDERS_SLUG as never,
				data: providerData('Saved despite a hanging bump', 'tenant-a') as never,
				overrideAccess: true,
			})
			expect((created as { id: string | number }).id).toBeDefined()
			expect(bumpedKeys(set)).toContain(epochKeyFor('tenant-a'))
		} finally {
			set.mockRestore()
		}
	}, 30_000)

	it('sends the next read of that scope back to the adapter, and leaves other scopes cached', async () => {
		const runtime = getRuntime(booted.payload)
		if (!runtime) throw new Error('runtime missing')
		const query: AnalyticsQuery = {
			metrics: ['pageviews'],
			dateRange: { start: new Date('2026-01-01'), end: new Date('2026-01-31') },
			scope: 'tenant-a',
		}

		await runtime.engine.read(recording, query)
		await runtime.engine.read(recording, query)
		expect(seen.length).toBe(1)

		await booted.payload.update({
			collection: PROVIDERS_SLUG as never,
			id: providerId,
			data: { name: 'Renamed again' } as never,
			overrideAccess: true,
		})
		await runtime.engine.read(recording, query)
		expect(seen.length).toBe(2)

		await booted.payload.create({
			collection: PROVIDERS_SLUG as never,
			data: providerData('Tenant B provider', 'tenant-b') as never,
			overrideAccess: true,
		})
		await runtime.engine.read(recording, query)
		expect(seen.length).toBe(2)
	})
})

describeForDb('analytics cache epoch: unscoped install', {}, (db) => {
	let booted: BootedPayload
	const seen: AnalyticsQuery[] = []

	const recording: AnalyticsAdapter = {
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

	const globalEpoch = () => createEpochStore(booted.payload, { memoMs: 0 }).get(null)

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [memoryAdapter()],
				providers: { collection: true },
			}),
		})
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	// A document carries no scope at all here, and a read stamps none, so both sides key on
	// the install-wide token.
	it('bumps the install-wide token and sends the next read back to the adapter', async () => {
		const runtime = getRuntime(booted.payload)
		if (!runtime) throw new Error('runtime missing')
		const query: AnalyticsQuery = {
			metrics: ['pageviews'],
			dateRange: { start: new Date('2026-03-01'), end: new Date('2026-03-31') },
		}
		await runtime.engine.read(recording, query)
		await runtime.engine.read(recording, query)
		expect(seen.length).toBe(1)

		const before = await globalEpoch()
		await booted.payload.create({
			collection: PROVIDERS_SLUG as never,
			data: {
				name: 'Install provider',
				provider: 'plausible',
				enabled: true,
				plausible: { siteId: 'example.com', apiKey: 'plausible-key' },
			} as never,
			overrideAccess: true,
		})
		expect(await globalEpoch()).not.toBe(before)

		await runtime.engine.read(recording, query)
		expect(seen.length).toBe(2)
	})
})
