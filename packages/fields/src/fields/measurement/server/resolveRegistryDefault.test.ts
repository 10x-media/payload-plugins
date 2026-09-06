import type { Payload, SanitizedConfig } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { FIELDS_REGISTRY_KEY } from '../../../plugin/registry'
import type { FieldsPluginRegistry } from '../../../types'
import { resolveRegistryDefault } from './resolveRegistryDefault'

const payloadWithRegistry = (registry: FieldsPluginRegistry | undefined): Payload => {
	const logger = { error: vi.fn() }
	const config = { custom: registry ? { [FIELDS_REGISTRY_KEY]: registry } : {} } as SanitizedConfig
	return { config, logger } as unknown as Payload
}

describe('resolveRegistryDefault', () => {
	it('returns undefined when the registry has no measurement defaults', () => {
		const payload = payloadWithRegistry(undefined)
		expect(
			resolveRegistryDefault({ payload, preferenceKey: 'bodyWeight', req: undefined })
		).toBeUndefined()
	})

	it('reads the plain map form by preferenceKey', () => {
		const payload = payloadWithRegistry({ measurement: { defaultUnits: { bodyWeight: 'lb' } } })
		expect(resolveRegistryDefault({ payload, preferenceKey: 'bodyWeight', req: undefined })).toBe(
			'lb'
		)
		expect(
			resolveRegistryDefault({ payload, preferenceKey: 'distance', req: undefined })
		).toBeUndefined()
	})

	it('calls the function form with preferenceKey and req', () => {
		const resolver = vi.fn(() => 'kg' as const)
		const payload = payloadWithRegistry({ measurement: { defaultUnits: resolver } })
		const req = { user: null } as unknown as Parameters<typeof resolveRegistryDefault>[0]['req']
		expect(resolveRegistryDefault({ payload, preferenceKey: 'bodyWeight', req })).toBe('kg')
		expect(resolver).toHaveBeenCalledWith({ preferenceKey: 'bodyWeight', req })
	})

	it('calls the function form with req undefined from a list cell', () => {
		const resolver = vi.fn(() => 'st-lb' as const)
		const payload = payloadWithRegistry({ measurement: { defaultUnits: resolver } })
		expect(resolveRegistryDefault({ payload, preferenceKey: 'bodyWeight', req: undefined })).toBe(
			'st-lb'
		)
		expect(resolver).toHaveBeenCalledWith({ preferenceKey: 'bodyWeight', req: undefined })
	})

	it('degrades to undefined and logs when the resolver throws', () => {
		const resolver = vi.fn(() => {
			throw new Error('tenant lookup failed')
		})
		const payload = payloadWithRegistry({ measurement: { defaultUnits: resolver } })
		expect(
			resolveRegistryDefault({ payload, preferenceKey: 'bodyWeight', req: undefined })
		).toBeUndefined()
		expect(payload.logger.error).toHaveBeenCalledTimes(1)
	})
})
