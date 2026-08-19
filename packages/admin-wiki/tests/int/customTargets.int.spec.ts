import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { type CollectionSlug, createLocalReq, type PayloadRequest, type TypedUser } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { adminWiki } from '../../src/index'
import type { WikiOrphansResponse } from '../../src/shared/orphanedTargets'
import type { WikiTargetsResponse } from '../../src/shared/targetKeys'
import { fixtureCollections, fixtureConfig } from './fixtures'

const PAGES = 'wiki-pages' as CollectionSlug

/**
 * Custom targets end to end: a declared key stores, maps, and resolves like any
 * other target, and an undeclared one is an orphan. The declaration is the only
 * thing that makes a custom key valid, since nothing in the config describes the
 * surface it names.
 */
describeForDb('wiki custom targets', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload
	let reader: TypedUser

	beforeAll(async () => {
		booted = await bootPayload({
			collections: fixtureCollections,
			configOverrides: fixtureConfig,
			db,
			plugin: adminWiki({
				customTargets: [{ key: 'dashboard', label: { de: 'Übersicht', en: 'Dashboard' } }],
			}),
		})
		reader = (await booted.payload.create({
			collection: 'users' as CollectionSlug,
			data: { email: 'custom@10xmedia.de', password: 'password' },
		})) as unknown as TypedUser
	})

	afterAll(async () => {
		await booted.stop()
	})

	const call = async (path: string): Promise<Response> => {
		const collection = booted.payload.config.collections.find((entity) => entity.slug === PAGES)
		const endpoint = (collection?.endpoints || []).find((candidate) => candidate.path === path)
		if (!endpoint) {
			throw new Error(`the plugin registered no endpoint at ${path}`)
		}
		const req: PayloadRequest = await createLocalReq(
			{ urlSuffix: `/api/${PAGES}${path}`, user: reader },
			booted.payload
		)
		return endpoint.handler(req)
	}

	it('registers the custom target list on the guide collection', () => {
		const fields = booted.payload.collections[PAGES]?.config.flattenedFields ?? []
		expect(fields.map((field) => field.name)).toContain('targetCustom')
	})

	it('maps a stored custom target onto its namespaced key', async () => {
		await booted.payload.create({
			collection: PAGES,
			data: {
				_status: 'published',
				slug: 'dashboard-guide',
				targetCustom: ['dashboard'],
				title: 'Reading the dashboard',
			} as never,
		})

		const body = (await (await call('/targets-map')).json()) as WikiTargetsResponse
		expect((body.targets['custom:dashboard'] ?? []).map((entry) => entry.slug)).toEqual([
			'dashboard-guide',
		])
	})

	it('reports an undeclared custom key as an orphan and leaves a declared one alone', async () => {
		await booted.payload.create({
			collection: PAGES,
			data: {
				_status: 'published',
				slug: 'stale-custom-guide',
				targetCustom: ['dashboard', 'retired-screen'],
				title: 'Stale custom guide',
			} as never,
		})

		const body = (await (await call('/orphaned-targets')).json()) as WikiOrphansResponse
		const orphan = body.orphans.find((guide) => guide.slug === 'stale-custom-guide')
		expect(orphan?.orphanedKeys).toEqual(['custom:retired-screen'])
		expect(body.orphans.find((guide) => guide.slug === 'dashboard-guide')).toBeUndefined()
	})
})
