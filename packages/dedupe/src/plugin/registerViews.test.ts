import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'

import { resolveOptions } from '../options'
import { registerViews } from './registerViews'

const bareConfig = (): Config =>
	({ collections: [{ slug: 'customers', fields: [] }] }) as unknown as Config

describe('registerViews', () => {
	it('mounts the queue and the merge screen, and no link in the nav', () => {
		const config = bareConfig()
		registerViews(config, resolveOptions({ collections: { customers: true } }))
		const views = config.admin?.components?.views as Record<string, { path: string }>
		expect(Object.keys(views)).toEqual(['dedupeQueue', 'dedupeMerge'])
		expect(views.dedupeQueue?.path).toBe('/dedupe')
		expect(views.dedupeMerge?.path).toBe('/dedupe/merge')
		expect(config.admin?.components?.afterNavLinks).toBeUndefined()
	})

	it('follows a custom view path', () => {
		const config = bareConfig()
		registerViews(config, resolveOptions({ view: { path: '/duplicates' } }))
		const views = config.admin?.components?.views as Record<string, { path: string }>
		expect(views.dedupeQueue?.path).toBe('/duplicates')
		expect(views.dedupeMerge?.path).toBe('/duplicates/merge')
	})

	it('adds the list menu item only to configured collections', () => {
		const config = {
			collections: [
				{ slug: 'customers', fields: [] },
				{ slug: 'posts', fields: [] },
			],
		} as unknown as Config
		registerViews(config, resolveOptions({ collections: { customers: true } }))
		const [customers, posts] = config.collections ?? []
		expect(customers?.admin?.components?.listMenuItems).toHaveLength(1)
		expect(posts?.admin?.components?.listMenuItems).toBeUndefined()
	})

	it('registers the queue slot components for the import map', () => {
		const config = bareConfig()
		registerViews(
			config,
			resolveOptions({
				view: {
					queue: {
						components: {
							beforeList: ['/components/Stats#Stats'],
							afterList: [{ path: '/components/Footer', exportName: 'QueueFooter' }],
						},
					},
				},
			})
		)
		const paths = Object.values(config.admin?.dependencies ?? {}).map((entry) => entry.path)
		expect(paths).toEqual(['/components/Stats#Stats', '/components/Footer#QueueFooter'])
	})

	it('registers only the merge screen and the list menu on queue: false', () => {
		const config = bareConfig()
		registerViews(
			config,
			resolveOptions({ collections: { customers: true }, view: { queue: false } })
		)
		const views = config.admin?.components?.views ?? {}
		expect(Object.keys(views)).toEqual(['dedupeMerge'])
		expect(views.dedupeMerge?.path).toBe('/dedupe/merge')
		const customers = config.collections?.find((entry) => entry.slug === 'customers')
		expect(customers?.admin?.components?.listMenuItems).toHaveLength(1)
	})

	it('registers nothing when the view is disabled', () => {
		const config = bareConfig()
		registerViews(config, resolveOptions({ view: false }))
		expect(config.admin).toBeUndefined()
	})
})
