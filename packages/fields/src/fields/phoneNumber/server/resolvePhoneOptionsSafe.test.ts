import type { Payload, SanitizedConfig } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { FIELDS_REGISTRY_KEY } from '../../../plugin/registry'
import type { FieldsPluginRegistry } from '../../../types'
import { resolvePhoneOptionsSafe } from './resolvePhoneOptionsSafe'

const payloadWithRegistry = (registry: FieldsPluginRegistry | undefined): Payload => {
	const logger = { error: vi.fn() }
	const config = { custom: registry ? { [FIELDS_REGISTRY_KEY]: registry } : {} } as SanitizedConfig
	return { config, logger } as unknown as Payload
}

describe('resolvePhoneOptionsSafe', () => {
	it('merges the registry layer with the field layer, field winning', () => {
		const payload = payloadWithRegistry({ phoneNumber: { flags: 'emoji', metadata: 'min' } })
		expect(resolvePhoneOptionsSafe({ fieldOptions: { flags: 'svg' }, payload })).toMatchObject({
			flags: 'svg',
			metadata: 'min',
		})
	})

	it('resolves the field layer alone when the registry has no phoneNumber default', () => {
		const payload = payloadWithRegistry(undefined)
		expect(resolvePhoneOptionsSafe({ fieldOptions: { flags: 'emoji' }, payload })).toMatchObject({
			flags: 'emoji',
			metadata: 'max',
		})
	})

	// normalizeRegistry rejects this set, so reaching here means a config assembled without
	// the plugin or mutated after it ran. Left alone it rejects in loadMetadata, which the
	// read hook and both validators await with no degrade path of their own.
	it('drops a metadata set the loader cannot carry, and logs, rather than passing it on', () => {
		const logger = { error: vi.fn() }
		const config = {
			custom: { [FIELDS_REGISTRY_KEY]: { phoneNumber: { flags: 'none', metadata: 'nope' } } },
		} as unknown as SanitizedConfig
		const payload = { config, logger } as unknown as Payload
		// The rest of the layer survives: only the unloadable key is dropped.
		expect(resolvePhoneOptionsSafe({ fieldOptions: {}, payload })).toMatchObject({
			flags: 'none',
			metadata: 'max',
		})
		expect(logger.error).toHaveBeenCalledTimes(1)
	})

	it('keeps every set the loader does carry', () => {
		for (const set of ['max', 'min', 'mobile'] as const) {
			const payload = payloadWithRegistry({ phoneNumber: { metadata: set } })
			expect(resolvePhoneOptionsSafe({ fieldOptions: {}, payload }).metadata).toBe(set)
		}
	})

	// Exact equality over the whole bag rather than one key at a time: countries,
	// priorityCountries and priorityCountriesLabel each had no case of their own, so
	// dropping any of their `?? global?.` fallbacks left the suite green.
	it('falls back to the plugin layer for every key the field leaves unset', () => {
		const payload = payloadWithRegistry({
			phoneNumber: {
				cellFormat: 'national',
				countries: ['AT', 'CH', 'DE'],
				defaultCountry: 'AT',
				flags: 'emoji',
				metadata: 'mobile',
				priorityCountries: ['CH'],
				priorityCountriesLabel: 'Popular',
				validation: 'possible',
			},
		})
		expect(resolvePhoneOptionsSafe({ fieldOptions: {}, payload })).toEqual({
			cellFormat: 'national',
			countries: ['AT', 'CH', 'DE'],
			defaultCountry: 'AT',
			flags: 'emoji',
			isClearable: true,
			metadata: 'mobile',
			priorityCountries: ['CH'],
			priorityCountriesLabel: 'Popular',
			storage: 'object',
			validation: 'possible',
		})
	})
})
