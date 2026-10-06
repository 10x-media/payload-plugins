import type { Config, SanitizedConfig } from 'payload'
import { describe, expect, it } from 'vitest'

import { lucideAdapter } from './fields/icon/adapters/lucide/adapter'
import type { MetadataSet } from './fields/phoneNumber/engine/metadata'
import type { CountryCode } from './fields/phoneNumber/engine/phone'
import { FLAGS_ENDPOINT_PATH } from './fields/phoneNumber/server/flagsEndpoint'
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

	it('throws at plugin build on a malformed measurement.precision', () => {
		expect(() => fields({ measurement: { precision: { storage: 15 } } })(fakeConfig())).toThrow(
			/measurement\.precision/
		)
	})

	it('accepts a valid measurement.precision', () => {
		const out = fields({ measurement: { precision: 'exact' } })(fakeConfig()) as Config
		expect(getFieldsRegistry(asSanitized(out))?.measurement?.precision).toBe('exact')
	})

	it('throws at plugin build when phoneNumber.validation is mobile with metadata min', () => {
		expect(() =>
			fields({ phoneNumber: { validation: 'mobile', metadata: 'min' } })(fakeConfig())
		).toThrow(/phoneNumber\.validation/)
	})

	it('throws at plugin build when phoneNumber.defaultCountry is outside phoneNumber.countries', () => {
		expect(() =>
			fields({ phoneNumber: { countries: ['US', 'CA'], defaultCountry: 'FR' } })(fakeConfig())
		).toThrow(/phoneNumber\.defaultCountry/)
	})

	it('throws at plugin build when a phoneNumber.countries entry is not a supported country', () => {
		expect(() =>
			fields({ phoneNumber: { countries: ['US', 'ZZ' as CountryCode] } })(fakeConfig())
		).toThrow(/phoneNumber\.countries/)
	})

	it('throws at plugin build when phoneNumber.defaultCountry is not a supported country', () => {
		expect(() =>
			fields({ phoneNumber: { defaultCountry: 'ZZ' as CountryCode } })(fakeConfig())
		).toThrow(/phoneNumber\.defaultCountry/)
	})

	it('throws at plugin build when phoneNumber.metadata is not a supported set', () => {
		expect(() =>
			fields({ phoneNumber: { metadata: 'nope' as MetadataSet } })(fakeConfig())
		).toThrow(/phoneNumber\.metadata/)
	})

	it('writes a valid phoneNumber config to the registry', () => {
		const phoneNumber = {
			countries: ['US', 'CA'],
			defaultCountry: 'US',
			validation: 'valid',
		} as const
		const out = fields({ phoneNumber })(fakeConfig()) as Config
		expect(getFieldsRegistry(asSanitized(out))?.phoneNumber).toEqual(phoneNumber)
	})

	it('mounts the flags endpoint by default', () => {
		const out = fields({})(fakeConfig()) as Config
		expect(out.endpoints).toContainEqual(
			expect.objectContaining({ method: 'get', path: FLAGS_ENDPOINT_PATH })
		)
	})

	it('skips the flags endpoint when phoneNumber.serveFlags is false', () => {
		const out = fields({ phoneNumber: { serveFlags: false } })(fakeConfig()) as Config
		expect(out.endpoints ?? []).not.toContainEqual(
			expect.objectContaining({ path: FLAGS_ENDPOINT_PATH })
		)
	})
})
