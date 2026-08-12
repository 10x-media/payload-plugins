import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import {
	type CollectionSlug,
	createLocalReq,
	type PayloadHandler,
	type PayloadRequest,
	type TypedUser,
} from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { adminWiki } from '../../src/index'
import type { WikiOrphansResponse } from '../../src/shared/orphanedTargets'
import type { WikiTargetEntry, WikiTargetsResponse } from '../../src/shared/targetKeys'
import { fixtureCollections, fixtureConfig } from './fixtures'

const PAGES = 'wiki-pages' as CollectionSlug

type GuideInput = {
	featured?: boolean
	featuredOrder?: number
	published?: boolean
	slug: string
	targetCollections?: string[]
	targetFields?: string[]
	title: string
}

/** The handler the plugin registered on the wiki pages collection, by path. */
const handlerFor = (booted: BootedPayload, path: string): PayloadHandler => {
	const collection = booted.payload.config.collections.find((entity) => entity.slug === PAGES)
	const endpoint = (collection?.endpoints || []).find((candidate) => candidate.path === path)
	if (!endpoint) {
		throw new Error(`the plugin registered no endpoint at ${path}`)
	}
	return endpoint.handler
}

/**
 * The two read endpoints, driven through the handlers the plugin actually
 * registered rather than through hand-built ones, so the access map and slug
 * they were wired with are part of what is under test.
 */
describeForDb('wiki endpoints', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload
	let reader: TypedUser

	beforeAll(async () => {
		booted = await bootPayload({
			collections: fixtureCollections,
			configOverrides: fixtureConfig,
			db,
			plugin: adminWiki({ localeMap: { 'de-DE': 'de' } }),
		})
		reader = (await booted.payload.create({
			collection: 'users' as CollectionSlug,
			data: { email: 'reader@10xmedia.de', password: 'password' },
		})) as unknown as TypedUser
	})

	afterAll(async () => {
		await booted.stop()
	})

	const createGuide = async ({ published = true, ...guide }: GuideInput): Promise<string> => {
		const created = await booted.payload.create({
			collection: PAGES,
			data: {
				_status: published ? 'published' : 'draft',
				featured: guide.featured ?? false,
				...(guide.featuredOrder !== undefined ? { featuredOrder: guide.featuredOrder } : {}),
				slug: guide.slug,
				targetCollections: guide.targetCollections ?? [],
				targetFields: guide.targetFields ?? [],
				title: guide.title,
			} as never,
			draft: !published,
		})
		return String(created.id)
	}

	const call = async (
		path: string,
		{ query = '', user }: { query?: string; user?: null | TypedUser } = {}
	): Promise<Response> => {
		const req: PayloadRequest = await createLocalReq(
			{ urlSuffix: `/api/${PAGES}${path}${query}`, ...(user ? { user } : {}) },
			booted.payload
		)
		return handlerFor(booted, path)(req)
	}

	const targetsMap = async (options?: Parameters<typeof call>[1]): Promise<WikiTargetsResponse> => {
		const response = await call('/targets-map', options)
		return (await response.json()) as WikiTargetsResponse
	}

	const orphans = async (options?: Parameters<typeof call>[1]): Promise<WikiOrphansResponse> => {
		const response = await call('/orphaned-targets', options)
		return (await response.json()) as WikiOrphansResponse
	}

	const slugsOf = (entries: undefined | WikiTargetEntry[]): Array<null | string> =>
		(entries ?? []).map((entry) => entry.slug)

	it('maps every target kind a guide carries onto its own key', async () => {
		await createGuide({
			slug: 'kinds-guide',
			targetCollections: ['posts'],
			targetFields: ['collection:posts.title'],
			title: 'Kinds guide',
		})

		const body = await targetsMap({ user: reader })
		expect(slugsOf(body.targets['collection:posts'])).toContain('kinds-guide')
		expect(slugsOf(body.targets['field:collection:posts.title'])).toContain('kinds-guide')
	})

	it('leaves drafts out of the map', async () => {
		await createGuide({
			published: false,
			slug: 'unpublished-guide',
			targetCollections: ['posts'],
			title: 'Unpublished guide',
		})

		const body = await targetsMap({ user: reader })
		expect(slugsOf(body.targets['collection:posts'])).not.toContain('unpublished-guide')
	})

	it('orders a key featured-first by order, then by title', async () => {
		const key = 'field:collection:posts.layout'
		await createGuide({
			slug: 'order-plain-b',
			targetFields: ['collection:posts.layout'],
			title: 'B plain',
		})
		await createGuide({
			slug: 'order-plain-a',
			targetFields: ['collection:posts.layout'],
			title: 'A plain',
		})
		await createGuide({
			featured: true,
			featuredOrder: 2,
			slug: 'order-featured-second',
			targetFields: ['collection:posts.layout'],
			title: 'Z featured second',
		})
		await createGuide({
			featured: true,
			featuredOrder: 1,
			slug: 'order-featured-first',
			targetFields: ['collection:posts.layout'],
			title: 'Y featured first',
		})

		const body = await targetsMap({ user: reader })
		expect(slugsOf(body.targets[key])).toEqual([
			'order-featured-first',
			'order-featured-second',
			'order-plain-a',
			'order-plain-b',
		])
	})

	it('reports the permissions the plugin resolved for the reader', async () => {
		const body = await targetsMap({ user: reader })
		expect(body.canCreate).toBe(true)
		expect(body.canUpdate).toBe(true)
	})

	it('tells an anonymous reader nothing', async () => {
		// Read access is the collection's own and is never overridden, so an
		// unauthenticated request fails the find rather than leaking the map, and
		// the endpoint answers with the collection's own status.
		const response = await call('/targets-map')
		const body = (await response.json()) as WikiTargetsResponse
		expect(response.status).toBe(403)
		expect(body.targets).toEqual({})
		expect(body.canCreate).toBe(false)
		expect(body.canUpdate).toBe(false)
	})

	it('resolves the reader locale through the localeMap', async () => {
		const id = await createGuide({
			slug: 'locale-guide',
			targetCollections: ['posts'],
			title: 'English title',
		})
		await booted.payload.update({
			collection: PAGES,
			data: { title: 'Deutscher Titel' },
			id,
			locale: 'de',
		})

		const body = await targetsMap({ query: '?language=de-DE', user: reader })
		expect(body.locale).toBe('de')
		const entry = (body.targets['collection:posts'] ?? []).find(
			(candidate) => candidate.slug === 'locale-guide'
		)
		expect(entry?.title).toBe('Deutscher Titel')
	})

	it('falls back to the default locale for a language it cannot map', async () => {
		const body = await targetsMap({ query: '?language=fr', user: reader })
		expect(body.locale).toBe('en')
		const entry = (body.targets['collection:posts'] ?? []).find(
			(candidate) => candidate.slug === 'locale-guide'
		)
		expect(entry?.title).toBe('English title')
	})

	it('reports a stored target that no longer resolves, with the offending key', async () => {
		await createGuide({
			slug: 'orphan-guide',
			targetCollections: ['posts', 'gone'],
			targetFields: ['collection:posts.removed'],
			title: 'Orphan guide',
		})

		const body = await orphans({ user: reader })
		const entry = body.orphans.find((candidate) => candidate.slug === 'orphan-guide')
		expect(entry?.orphanedKeys).toEqual(['collection:gone', 'field:collection:posts.removed'])
		// The target that still resolves is not reported alongside them.
		expect(entry?.orphanedKeys).not.toContain('collection:posts')
	})

	it('reports orphans on drafts too', async () => {
		await createGuide({
			published: false,
			slug: 'orphan-draft-guide',
			targetCollections: ['also-gone'],
			title: 'Orphan draft guide',
		})

		const body = await orphans({ user: reader })
		const entry = body.orphans.find((candidate) => candidate.slug === 'orphan-draft-guide')
		expect(entry?.orphanedKeys).toEqual(['collection:also-gone'])
	})

	it('leaves a guide whose targets all resolve out of the report', async () => {
		await createGuide({
			slug: 'resolved-guide',
			targetCollections: ['posts'],
			targetFields: ['collection:posts.title'],
			title: 'Resolved guide',
		})

		const body = await orphans({ user: reader })
		expect(body.orphans.map((candidate) => candidate.slug)).not.toContain('resolved-guide')
	})
})

/**
 * The orphan report is an authoring surface, so it is gated on update access
 * rather than on read access like the map beside it.
 */
describeForDb('wiki endpoints under a restricted access map', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			collections: fixtureCollections,
			configOverrides: fixtureConfig,
			db,
			plugin: adminWiki({ access: { update: () => false } }),
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('refuses the orphan report to a reader who cannot update guides', async () => {
		const user = (await booted.payload.create({
			collection: 'users' as CollectionSlug,
			data: { email: 'restricted@10xmedia.de', password: 'password' },
		})) as unknown as TypedUser
		const req: PayloadRequest = await createLocalReq(
			{ urlSuffix: `/api/${PAGES}/orphaned-targets`, user },
			booted.payload
		)

		const response = await handlerFor(booted, '/orphaned-targets')(req)
		expect(response.status).toBe(403)
		expect(((await response.json()) as WikiOrphansResponse).orphans).toEqual([])
	})

	it('still reports the reader cannot update through the targets map', async () => {
		const user = (await booted.payload.create({
			collection: 'users' as CollectionSlug,
			data: { email: 'restricted-2@10xmedia.de', password: 'password' },
		})) as unknown as TypedUser
		const req: PayloadRequest = await createLocalReq(
			{ urlSuffix: `/api/${PAGES}/targets-map`, user },
			booted.payload
		)

		const body = (await (
			await handlerFor(booted, '/targets-map')(req)
		).json()) as WikiTargetsResponse
		expect(body.canCreate).toBe(true)
		expect(body.canUpdate).toBe(false)
	})
})
