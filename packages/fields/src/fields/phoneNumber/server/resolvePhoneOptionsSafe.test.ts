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

	it('degrades to the field-only layer and logs when the registry layer throws on read', () => {
		const logger = { error: vi.fn() }
		// A registry slice that throws on property access, simulating a config mutated
		// into a hostile shape after the plugin ran; resolvePhoneOptions reads several
		// of its properties via `??`, any of which would surface this.
		const throwingPhoneNumber = new Proxy(
			{},
			{
				get() {
					throw new Error('boom')
				},
			}
		)
		const config = {
			custom: { [FIELDS_REGISTRY_KEY]: { phoneNumber: throwingPhoneNumber } },
		} as unknown as SanitizedConfig
		const payload = { config, logger } as unknown as Payload
		expect(resolvePhoneOptionsSafe({ fieldOptions: { flags: 'emoji' }, payload })).toMatchObject({
			flags: 'emoji',
			metadata: 'max',
		})
		expect(logger.error).toHaveBeenCalledTimes(1)
		expect(logger.error).toHaveBeenCalledWith(
			{ err: expect.any(Error) },
			'[fields] phoneNumber registry default is invalid'
		)
	})
})
