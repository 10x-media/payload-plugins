import type { CollectionConfig, Config, GlobalConfig } from 'payload'
import { describe, expect, it } from 'vitest'

import { undoRedo } from './index'
import { UNDO_REDO_COMPONENT_PATH } from './plugin/withUndoRedo'
import { keys } from './translations'

const collection = (overrides: Partial<CollectionConfig> = {}): CollectionConfig =>
	({ slug: 'posts', fields: [], ...overrides }) as CollectionConfig

const global = (overrides: Partial<GlobalConfig> = {}): GlobalConfig =>
	({ slug: 'settings', fields: [], ...overrides }) as GlobalConfig

const fakeConfig = (overrides: Partial<Config> = {}) =>
	({ collections: [collection()], ...overrides }) as Config

const apply = (config: Config, options: Parameters<typeof undoRedo>[0] = {}): Config =>
	undoRedo(options)(config) as Config

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
		for (const each of out.collections ?? []) {
			expect(each.admin?.components?.edit?.beforeDocumentControls).toEqual([
				UNDO_REDO_COMPONENT_PATH,
			])
		}
	})

	it('preserves components the collection already declares', () => {
		const existing = collection({
			admin: { components: { edit: { beforeDocumentControls: ['app/Existing#Existing'] } } },
		})
		const out = apply(fakeConfig({ collections: [existing] }))
		expect(out.collections?.[0]?.admin?.components?.edit?.beforeDocumentControls).toEqual([
			'app/Existing#Existing',
			UNDO_REDO_COMPONENT_PATH,
		])
	})

	it('adds the controls to globals via the elements slot', () => {
		const out = apply(fakeConfig({ globals: [global()] }))
		expect(out.globals?.[0]?.admin?.components?.elements?.beforeDocumentControls).toEqual([
			UNDO_REDO_COMPONENT_PATH,
		])
	})

	it('applies the translations option', () => {
		const out = apply(fakeConfig(), { translations: { de: { [keys.undo]: 'Zurück' } } })
		const i18n = out.i18n?.translations as Record<string, Record<string, Record<string, string>>>
		expect(i18n.de?.undoRedo?.undo).toBe('Zurück')
		expect(i18n.en?.undoRedo?.undo).toBe('Undo')
	})
})
