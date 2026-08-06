import type { CollectionConfig, Config, GlobalConfig, PayloadComponent } from 'payload'
import { describe, expect, it } from 'vitest'

import { undoRedo } from './index'
import type { UndoRedoPluginOptions } from './plugin/options'
import { UNDO_REDO_COMPONENT_PATH } from './plugin/withUndoRedo'
import { keys } from './translations'

const collection = (overrides: Partial<CollectionConfig> = {}): CollectionConfig =>
	({ slug: 'posts', fields: [], ...overrides }) as CollectionConfig

const global = (overrides: Partial<GlobalConfig> = {}): GlobalConfig =>
	({ slug: 'settings', fields: [], ...overrides }) as GlobalConfig

const fakeConfig = (overrides: Partial<Config> = {}) =>
	({ collections: [collection()], ...overrides }) as Config

const apply = (config: Config, options: UndoRedoPluginOptions = {}): Config =>
	undoRedo(options)(config) as Config

/** The controls entry mounted on a collection, or undefined when none is. */
const mountedOn = (config: Config, index = 0): PayloadComponent | undefined => {
	const mounted = config.collections?.[index]?.admin?.components?.edit?.beforeDocumentControls
	return mounted?.[mounted.length - 1]
}

const pathOf = (component: PayloadComponent | undefined): string | undefined => {
	if (typeof component === 'string') return component
	// A component entry can also be `false`, which Payload reads as "not mounted".
	if (component && typeof component === 'object') return component.path
	return undefined
}

const clientPropsOf = (component: PayloadComponent | undefined): Record<string, unknown> => {
	if (!component || typeof component !== 'object') return {}
	return (component.clientProps as Record<string, unknown>) ?? {}
}

describe('undoRedo factory', () => {
	it('returns a Payload plugin function', () => {
		expect(typeof undoRedo({})).toBe('function')
	})

	it('returns the incoming config when disabled', () => {
		const cfg = fakeConfig()
		expect(undoRedo({ disabled: true })(cfg)).toBe(cfg)
	})

	it('adds the controls to every collection edit view', () => {
		const out = apply(fakeConfig({ collections: [collection(), collection({ slug: 'pages' })] }))
		expect(pathOf(mountedOn(out, 0))).toBe(UNDO_REDO_COMPONENT_PATH)
		expect(pathOf(mountedOn(out, 1))).toBe(UNDO_REDO_COMPONENT_PATH)
	})

	it('preserves components the collection already declares', () => {
		const existing = collection({
			admin: { components: { edit: { beforeDocumentControls: ['app/Existing#Existing'] } } },
		})
		const out = apply(fakeConfig({ collections: [existing] }))
		const mounted = out.collections?.[0]?.admin?.components?.edit?.beforeDocumentControls
		expect(mounted).toHaveLength(2)
		expect(mounted?.[0]).toBe('app/Existing#Existing')
	})

	it('adds the controls to globals via the elements slot', () => {
		const out = apply(fakeConfig({ globals: [global()] }))
		const mounted = out.globals?.[0]?.admin?.components?.elements?.beforeDocumentControls
		expect(pathOf(mounted?.[0])).toBe(UNDO_REDO_COMPONENT_PATH)
	})

	it('applies the translations option', () => {
		const out = apply(fakeConfig(), { translations: { de: { [keys.undo]: 'Zurück' } } })
		const i18n = out.i18n?.translations as Record<string, Record<string, Record<string, string>>>
		expect(i18n.de?.undoRedo?.undo).toBe('Zurück')
		expect(i18n.en?.undoRedo?.undo).toBe('Undo')
	})
})

describe('undoRedo mounting', () => {
	it('passes the resolved settings through as client props', () => {
		const out = apply(fakeConfig(), { debug: true, maxHistory: 10, captureDebounce: 250 })
		expect(clientPropsOf(mountedOn(out))).toMatchObject({
			debug: true,
			maxHistory: 10,
			captureDebounce: 250,
		})
	})

	it('mounts nothing on a collection that opted out', () => {
		const out = apply(fakeConfig(), { collections: { posts: false } })
		expect(out.collections?.[0]?.admin?.components?.edit?.beforeDocumentControls).toBeUndefined()
	})

	it('mounts nothing when autoMount is off, leaving the config untouched', () => {
		const cfg = fakeConfig()
		const out = apply(cfg, { autoMount: false })
		expect(out.collections?.[0]).toBe(cfg.collections?.[0])
	})

	it('honours a per-collection autoMount override', () => {
		const out = apply(fakeConfig({ collections: [collection(), collection({ slug: 'pages' })] }), {
			collections: { pages: { autoMount: false } },
		})
		expect(pathOf(mountedOn(out, 0))).toBe(UNDO_REDO_COMPONENT_PATH)
		expect(mountedOn(out, 1)).toBeUndefined()
	})

	it('gives each collection its own resolved settings', () => {
		const out = apply(fakeConfig({ collections: [collection(), collection({ slug: 'pages' })] }), {
			maxHistory: 50,
			collections: { pages: { maxHistory: 5 } },
		})
		expect(clientPropsOf(mountedOn(out, 0))).toMatchObject({ maxHistory: 50 })
		expect(clientPropsOf(mountedOn(out, 1))).toMatchObject({ maxHistory: 5 })
	})

	it('leaves globals alone when only collections are disabled', () => {
		const out = apply(fakeConfig({ globals: [global()] }), { collections: false })
		expect(out.collections?.[0]?.admin?.components?.edit?.beforeDocumentControls).toBeUndefined()
		const mounted = out.globals?.[0]?.admin?.components?.elements?.beforeDocumentControls
		expect(pathOf(mounted?.[0])).toBe(UNDO_REDO_COMPONENT_PATH)
	})
})
