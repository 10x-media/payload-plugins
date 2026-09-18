import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { AnalyticsAdapter, AnalyticsQuery } from '../../src/core/contract'
import { GOALS_SLUG } from '../../src/goals/collection'
import { analytics } from '../../src/index'
import { getRuntime } from '../../src/plugin/runtime'
import { PROVIDERS_SLUG } from '../../src/providers/collection'
import { createEpochStore } from '../../src/surfacing/epoch'
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
		expect(await epochOf('tenant-a')).toBe(a + 1)
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
		expect(await epochOf('tenant-a')).toBe(before + 1)
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
		expect(await epochOf('tenant-a')).toBe(a + 1)
		expect(await epochOf('tenant-b')).toBe(b + 1)
		otherId = moverId
	})

	it('bumps on delete', async () => {
		const before = await epochOf('tenant-b')
		await booted.payload.delete({
			collection: PROVIDERS_SLUG as never,
			id: otherId,
			overrideAccess: true,
		})
		expect(await epochOf('tenant-b')).toBe(before + 1)
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
		expect(await epochOf('tenant-a')).toBe(a + 1)
		expect(await epochOf('tenant-b')).toBe(b)

		const afterCreate = await epochOf('tenant-a')
		await booted.payload.update({
			collection: GOALS_SLUG as never,
			id: (created as { id: string | number }).id,
			data: { name: 'Signup renamed' } as never,
			overrideAccess: true,
		})
		expect(await epochOf('tenant-a')).toBe(afterCreate + 1)
	})

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
