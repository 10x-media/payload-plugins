import type { Config, SanitizedConfig } from 'payload'
import { describe, expect, it } from 'vitest'

import { lucideAdapter } from './fields/icon/adapters/lucide/adapter'
import { fields } from './index'
import { getFieldsRegistry } from './plugin/registry'
import { keys } from './translations'

const fakeConfig = () => ({ collections: [] }) as unknown as Config

const asSanitized = (config: Config) => config as unknown as SanitizedConfig

describe('fields factory', () => {
	it('returns a Payload plugin function', () => {
		expect(typeof fields({})).toBe('function')
	})

	it('returns the incoming config when disabled', () => {
		const cfg = fakeConfig()
		expect(fields({ disabled: true })(cfg)).toBe(cfg)
	})

	it('applies the translations option', () => {
		const out = fields({ translations: { de: { [keys.pluginName]: 'Beispiel' } } })(
			fakeConfig()
		) as Config
		const i18n = out.i18n?.translations as Record<string, Record<string, Record<string, string>>>
		expect(i18n.de?.fields?.pluginName).toBe('Beispiel')
		expect(i18n.en?.fields?.pluginName).toBe('Fields')
	})

	it('writes normalized family options to the registry', () => {
		const presets = ['#ffffff', { key: 'brand', value: '#0f62fe' }]
		const out = fields({ color: { presets, format: 'oklch' } })(fakeConfig()) as Config
		const registry = getFieldsRegistry(asSanitized(out))
		expect(registry?.color?.presets).toEqual(presets)
		expect(registry?.color?.format).toBe('oklch')
		expect(registry?.icon).toBeUndefined()
		expect(registry?.encrypted).toBeUndefined()
	})

	it('normalizes icon options and registers adapter components for the importMap', () => {
		const out = fields({ icon: { adapters: [lucideAdapter()] } })(fakeConfig()) as Config
		const registry = getFieldsRegistry(asSanitized(out))
		expect(registry?.icon?.defaultLibrary).toBe('lucide')
		expect(out.admin?.dependencies?.['fields-icon-lucide-Icon']).toEqual({
			path: '@10x-media/fields/icon/adapters/lucide#LucideAdapterIcon',
			type: 'component',
		})
	})

	it('leaves registry.icon unset when icon options carry no adapters', () => {
		const out = fields({ icon: { defaultLibrary: 'lucide' } })(fakeConfig()) as Config
		expect(getFieldsRegistry(asSanitized(out))?.icon).toBeUndefined()
		expect(out.admin?.dependencies).toBeUndefined()
	})

	it('writes an empty registry when no family options are set', () => {
		const out = fields({})(fakeConfig()) as Config
		expect(getFieldsRegistry(asSanitized(out))).toEqual({})
	})

	it('leaves the registry unset when disabled', () => {
		const out = fields({ disabled: true })(fakeConfig()) as Config
		expect(getFieldsRegistry(asSanitized(out))).toBeUndefined()
	})

	it('registers the measurement provider with persist true by default', () => {
		const out = fields({})(fakeConfig()) as Config
		expect(out.admin?.components?.providers?.[0]).toMatchObject({
			clientProps: { persist: true },
			path: '@10x-media/fields/client#MeasurementUnitsProvider',
		})
	})

	it('registers the measurement provider with persist false when persistPreferences is off', () => {
		const out = fields({ measurement: { persistPreferences: false } })(fakeConfig()) as Config
		expect(out.admin?.components?.providers?.[0]).toMatchObject({
			clientProps: { persist: false },
		})
	})
})
