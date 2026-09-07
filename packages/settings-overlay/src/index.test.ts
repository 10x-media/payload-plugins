import type { CollectionConfig, Config } from 'payload'
import { describe, expect, it } from 'vitest'

import { settingsOverlay } from './index'
import {
	ACTIONS_PATH,
	DISPATCHER_WIDGET_SLUG,
	REGISTRY_KEY,
	REPORTER_PATH,
} from './plugin/constants'
import type { SettingsOverlayRegistry } from './plugin/registry'
import { keys } from './translations'

const collection = (slug: string, admin?: CollectionConfig['admin']): CollectionConfig => ({
	slug,
	fields: [],
	...(admin ? { admin } : {}),
})

const fakeConfig = (overrides: Partial<Config> = {}): Config =>
	({
		collections: [collection('tags'), collection('sites')],
		globals: [{ slug: 'branding', fields: [] }],
		...overrides,
	}) as unknown as Config

const run = (options: Parameters<typeof settingsOverlay>[0], config = fakeConfig()): Config =>
	settingsOverlay(options)(config) as Config

const registryOf = (config: Config): SettingsOverlayRegistry =>
	(config.custom as Record<string, SettingsOverlayRegistry>)[
		REGISTRY_KEY
	] as SettingsOverlayRegistry

describe('settingsOverlay factory', () => {
	it('returns a Payload plugin function', () => {
		expect(typeof settingsOverlay({ overlays: [] })).toBe('function')
	})

	it('returns the incoming config when disabled', () => {
		const config = fakeConfig()
		expect(settingsOverlay({ disabled: true, overlays: [] })(config)).toBe(config)
	})

	it('applies the translations option', () => {
		const out = run({ overlays: [], translations: { de: { [keys.pluginName]: 'Beispiel' } } })
		const i18n = out.i18n?.translations as Record<string, Record<string, Record<string, string>>>
		expect(i18n.de?.settingsOverlay?.pluginName).toBe('Beispiel')
		expect(i18n.en?.settingsOverlay?.pluginName).toBe('Settings Overlay')
	})

	it('parks the resolved overlays under config.custom', () => {
		const out = run({
			overlays: [{ id: 'system', items: [{ slug: 'tags', type: 'collection' }], label: 'System' }],
		})
		const registry = registryOf(out)
		expect(registry.overlays).toHaveLength(1)
		expect(registry.overlays[0]?.layout).toBe('compact')
		expect(registry.overlays[0]?.hideEntities).toBe(false)
		expect(registry.overlays[0]?.addressable).toBe(true)
	})

	it('applies plugin-level defaults under each overlay own settings', () => {
		const out = run({
			defaults: { layout: 'wide', searchable: true },
			overlays: [
				{ id: 'a', items: [], label: 'A' },
				{ id: 'b', items: [], label: 'B', layout: 'compact' },
			],
		})
		const [a, b] = registryOf(out).overlays
		expect(a?.layout).toBe('wide')
		expect(a?.searchable).toBe(true)
		expect(b?.layout).toBe('compact')
		expect(b?.searchable).toBe(true)
	})

	it('merges the list header by default and takes false as the escape hatch', () => {
		const merged = run({
			overlays: [{ id: 'a', items: [], label: 'A' }],
		})
		expect(registryOf(merged).overlays[0]?.mergeListHeader).toBe(true)

		const original = run({
			defaults: { mergeListHeader: false },
			overlays: [
				{ id: 'a', items: [], label: 'A' },
				{ id: 'b', items: [], label: 'B', mergeListHeader: true },
			],
		})
		const [a, b] = registryOf(original).overlays
		expect(a?.mergeListHeader).toBe(false)
		expect(b?.mergeListHeader).toBe(true)
	})

	it('hides listed entities when asked, and always adds the plugin document controls', () => {
		const out = run({
			overlays: [
				{
					hideEntities: true,
					id: 'system',
					items: [
						{ slug: 'tags', type: 'collection' },
						{ slug: 'branding', type: 'global' },
					],
					label: 'System',
				},
			],
		})
		const tags = out.collections?.find((entry) => entry.slug === 'tags')
		const sites = out.collections?.find((entry) => entry.slug === 'sites')
		const branding = out.globals?.find((entry) => entry.slug === 'branding')

		expect(tags?.admin?.hidden).toBe(true)
		expect(tags?.admin?.components?.edit?.beforeDocumentControls).toEqual([
			REPORTER_PATH,
			ACTIONS_PATH,
		])
		expect(sites?.admin?.hidden).toBeUndefined()
		expect(branding?.admin?.hidden).toBe(true)
		// A global has no delete, duplicate or restore, so it takes the reporter alone.
		expect(branding?.admin?.components?.elements?.beforeDocumentControls).toEqual([REPORTER_PATH])
	})

	it('leaves entities visible by default, because the panel is not a replacement view', () => {
		const out = run({
			overlays: [
				{
					id: 'system',
					items: [{ slug: 'tags', type: 'collection' }],
					label: 'System',
				},
			],
		})
		const tags = out.collections?.find((entry) => entry.slug === 'tags')
		expect(tags?.admin?.hidden).toBeUndefined()
		expect(tags?.admin?.components?.edit?.beforeDocumentControls).toContain(REPORTER_PATH)
	})

	it('lifts a function-valued admin.hidden out so the manifest can still apply it', () => {
		const hidden = () => true
		const config = fakeConfig({
			collections: [collection('tags', { hidden }), collection('sites')],
		})
		const out = run(
			{
				overlays: [
					{
						hideEntities: true,
						id: 'system',
						items: [{ slug: 'tags', type: 'collection' }],
						label: 'S',
					},
				],
			},
			config
		)
		expect(registryOf(out).hiddenPredicates.collections.tags).toBe(hidden)
		expect(out.collections?.find((entry) => entry.slug === 'tags')?.admin?.hidden).toBe(true)
	})

	it('registers the provider and every configured component path', () => {
		const out = run({
			overlays: [
				{
					components: { RailItem: './RailItem#Row' },
					icon: './Icon#Gear',
					id: 'system',
					items: [
						{ component: './Appearance#Tab', label: 'Look', slug: 'look', type: 'component' },
					],
					label: 'System',
				},
			],
		})
		const dependencies = out.admin?.dependencies ?? {}
		expect(out.admin?.components?.providers).toHaveLength(1)
		expect(dependencies['settings-overlay-icon-system']).toEqual({
			path: './Icon#Gear',
			type: 'component',
		})
		expect(dependencies['settings-overlay-slot-system-RailItem']).toBeDefined()
		expect(dependencies['settings-overlay-item-system-look']).toEqual({
			path: './Appearance#Tab',
			type: 'component',
		})
	})

	it('registers the dispatcher widget only when a lazy item exists', () => {
		const eager = run({
			overlays: [
				{
					id: 'system',
					items: [{ component: './A#A', label: 'A', slug: 'a', type: 'component' }],
					label: 'System',
				},
			],
		})
		expect(eager.admin?.dashboard?.widgets).toBeUndefined()

		const lazy = run({
			overlays: [
				{
					id: 'system',
					items: [{ component: './A#A', label: 'A', lazy: true, slug: 'a', type: 'component' }],
					label: 'System',
				},
			],
		})
		expect(lazy.admin?.dashboard?.widgets?.[0]?.slug).toBe(DISPATCHER_WIDGET_SLUG)
	})

	it('registers no widget when the server-function transport is chosen', () => {
		const out = run({
			lazyTransport: 'server-function',
			overlays: [
				{
					id: 'system',
					items: [{ component: './A#A', label: 'A', lazy: true, slug: 'a', type: 'component' }],
					label: 'System',
				},
			],
		})
		expect(out.admin?.dashboard?.widgets).toBeUndefined()
		expect(registryOf(out).lazyTransport).toBe('server-function')
	})

	it('keeps the host dashboard widgets it found', () => {
		const config = fakeConfig({
			admin: { dashboard: { widgets: [{ Component: './Mine#Widget', slug: 'mine' }] } },
		} as Partial<Config>)
		const out = run(
			{
				overlays: [
					{
						id: 'system',
						items: [{ label: 'Audit', slug: 'audit', type: 'view', viewKey: 'audit' }],
						label: 'System',
					},
				],
			},
			{
				...config,
				admin: { ...config.admin, components: { views: { audit: {} } } },
			} as unknown as Config
		)
		expect(out.admin?.dashboard?.widgets?.map((widget) => widget.slug)).toEqual([
			'mine',
			DISPATCHER_WIDGET_SLUG,
		])
	})
})
