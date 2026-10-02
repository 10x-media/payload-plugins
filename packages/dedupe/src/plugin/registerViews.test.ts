import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'

import { resolveOptions } from '../options'
import { DUPLICATES_FIELD_NAME, registerFormWarnings, registerViews } from './registerViews'

const bareConfig = (): Config =>
	({ collections: [{ slug: 'customers', fields: [] }] }) as unknown as Config

describe('registerViews', () => {
	it('mounts the queue, merge and history views and a nav link at the admin-prefixed path', () => {
		const config = bareConfig()
		registerViews(config, resolveOptions({ collections: { customers: true } }))
		const views = config.admin?.components?.views as Record<string, { path: string }>
		expect(views.dedupeQueue?.path).toBe('/dedupe')
		expect(views.dedupeMerge?.path).toBe('/dedupe/merge')
		expect(views.dedupeMerges?.path).toBe('/dedupe/merges')
		expect(views.dedupeMergeRecord?.path).toBe('/dedupe/merges/:id')
		expect(config.admin?.components?.afterNavLinks).toEqual([
			{ path: '@10x-media/dedupe/client#DedupeNavLink', clientProps: { href: '/admin/dedupe' } },
		])
	})

	it('follows a custom view path, the app admin route and a nav label', () => {
		const config = { ...bareConfig(), routes: { admin: '/cms' } } as Config
		registerViews(
			config,
			resolveOptions({ view: { path: '/duplicates', navLabel: { en: 'Dupes' } } })
		)
		expect(config.admin?.components?.afterNavLinks?.[0]).toMatchObject({
			clientProps: { href: '/cms/duplicates', label: { en: 'Dupes' } },
		})
	})

	it('puts the merge history in the nav only when asked, and the queue link gives way to it', () => {
		const config = bareConfig()
		registerViews(config, resolveOptions({ view: { history: { navLabel: 'Merges' } } }))
		expect(config.admin?.components?.afterNavLinks).toEqual([
			{
				path: '@10x-media/dedupe/client#DedupeNavLink',
				clientProps: { href: '/admin/dedupe', except: '/admin/dedupe/merges' },
			},
			{
				path: '@10x-media/dedupe/client#DedupeNavLink',
				clientProps: { href: '/admin/dedupe/merges', kind: 'history', label: 'Merges' },
			},
		])
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

	it('registers nothing when the view is disabled', () => {
		const config = bareConfig()
		registerViews(config, resolveOptions({ view: false }))
		expect(config.admin).toBeUndefined()
	})
})

describe('registerFormWarnings', () => {
	const match = { fields: [{ path: 'email', weight: 1 }] }
	const withForm = (form: { sidebar?: boolean; confirmCreate?: boolean }) =>
		resolveOptions({ collections: { customers: { match, form } } })

	it('adds the sidebar panel and the save button the collection asked for', () => {
		const config = bareConfig()
		registerFormWarnings(config, withForm({ sidebar: true, confirmCreate: true }))
		const [customers] = config.collections ?? []
		expect(customers?.fields).toContainEqual(
			expect.objectContaining({ name: DUPLICATES_FIELD_NAME, type: 'ui' })
		)
		expect(customers?.admin?.components?.edit?.SaveButton).toEqual({
			path: '@10x-media/dedupe/client#ConfirmSaveButton',
			clientProps: { collection: 'customers', paths: ['email'] },
		})
	})

	it('leaves a collection alone when its form option is off', () => {
		const config = bareConfig()
		registerFormWarnings(config, resolveOptions({ collections: { customers: { match } } }))
		expect(config.collections?.[0]).toEqual({ slug: 'customers', fields: [] })
	})

	it('keeps a field of the same name the host already declared', () => {
		const config = {
			collections: [{ slug: 'customers', fields: [{ name: DUPLICATES_FIELD_NAME, type: 'text' }] }],
		} as unknown as Config
		registerFormWarnings(config, withForm({ sidebar: true }))
		expect(config.collections?.[0]?.fields).toHaveLength(1)
	})

	it('refuses to replace a save button the host set', () => {
		const custom = {
			collections: [
				{
					slug: 'customers',
					fields: [],
					admin: { components: { edit: { SaveButton: '/x#Save' } } },
				},
			],
		} as unknown as Config
		expect(() => registerFormWarnings(custom, withForm({ confirmCreate: true }))).toThrow(
			/already has its own SaveButton/
		)
	})

	it('guards the publish and the draft button on a collection with drafts', () => {
		const config = {
			collections: [{ slug: 'customers', fields: [], versions: { drafts: true } }],
		} as unknown as Config
		registerFormWarnings(config, withForm({ confirmCreate: true }))
		const edit = config.collections?.[0]?.admin?.components?.edit
		expect(edit?.SaveButton).toBeUndefined()
		expect(edit?.PublishButton).toMatchObject({
			path: '@10x-media/dedupe/client#ConfirmPublishButton',
		})
		expect(edit?.SaveDraftButton).toMatchObject({
			path: '@10x-media/dedupe/client#ConfirmSaveDraftButton',
		})
	})

	it('keeps only the panel on drafts with autosave, and says so', () => {
		const config = {
			collections: [{ slug: 'customers', fields: [], versions: { drafts: { autosave: true } } }],
		} as unknown as Config
		const warnings = registerFormWarnings(config, withForm({ sidebar: true, confirmCreate: true }))
		const [customers] = config.collections ?? []
		expect(customers?.admin?.components?.edit).toBeUndefined()
		expect(customers?.fields).toContainEqual(
			expect.objectContaining({ name: DUPLICATES_FIELD_NAME })
		)
		expect(warnings).toEqual([expect.stringMatching(/customers.*autosave/)])
	})
})
