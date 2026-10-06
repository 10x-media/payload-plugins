import type { Payload, SanitizedConfig } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { FIELDS_REGISTRY_KEY } from '../../../plugin/registry'
import type { FieldsPluginRegistry } from '../../../types'
import { resolvePrecisionSafe } from './resolvePrecisionSafe'

const payloadWithRegistry = (registry: FieldsPluginRegistry | undefined): Payload => {
	const logger = { error: vi.fn() }
	const config = { custom: registry ? { [FIELDS_REGISTRY_KEY]: registry } : {} } as SanitizedConfig
	return { config, logger } as unknown as Payload
}

describe('resolvePrecisionSafe', () => {
	it('merges the registry layer with the field layer when both are valid', () => {
		const payload = payloadWithRegistry({ measurement: { precision: { storage: 2 } } })
		expect(resolvePrecisionSafe({ fieldPrecision: 'exact', payload })).toEqual({
			draft: 'faithful',
			entry: 'free',
			mode: 'exact',
			storage: 2,
		})
	})
	it('resolves the field layer alone when the registry has no precision default', () => {
		const payload = payloadWithRegistry(undefined)
		expect(resolvePrecisionSafe({ fieldPrecision: undefined, payload })).toEqual({
			draft: 'display',
			entry: 'quantize',
			mode: 'readable',
			storage: 6,
		})
	})
	it('degrades to the field-only layer and logs when the registry layer is malformed', () => {
		const payload = payloadWithRegistry({ measurement: { precision: { storage: 15 } } })
		// 'exact' sets no storage of its own, so the registry's bad storage value
		// still reaches resolvePrecision unmasked and throws, before the fallback.
		expect(resolvePrecisionSafe({ fieldPrecision: 'exact', payload })).toEqual({
			draft: 'faithful',
			entry: 'free',
			mode: 'exact',
			storage: 6,
		})
		expect(payload.logger.error).toHaveBeenCalledTimes(1)
		expect(payload.logger.error).toHaveBeenCalledWith(
			{ err: expect.any(Error) },
			'[fields] measurement precision registry default is invalid'
		)
	})
})
