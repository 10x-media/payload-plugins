import type { Field, Payload } from 'payload'
import { describe, expect, it } from 'vitest'
import { validateScopeField } from './scopeFieldBoot'

const payloadWith = (fields: Field[]): Payload =>
	({ config: { collections: [{ slug: 'analytics-goals', fields }] } }) as unknown as Payload

const args = {
	option: 'goals.collection.scopeField',
	slug: 'analytics-goals',
	scopeField: 'tenant',
}

describe('validateScopeField', () => {
	it('accepts a field the host registered after the plugin ran', () => {
		expect(() =>
			validateScopeField(
				payloadWith([{ name: 'tenant', type: 'relationship', relationTo: 'tenants' }]),
				args
			)
		).not.toThrow()
	})

	it('accepts one the host nested in a presentational row', () => {
		expect(() =>
			validateScopeField(
				payloadWith([{ type: 'row', fields: [{ name: 'tenant', type: 'text' }] }]),
				args
			)
		).not.toThrow()
	})

	it('names the option, the field and the collection when nothing registered it', () => {
		expect(() => validateScopeField(payloadWith([{ name: 'slug', type: 'text' }]), args)).toThrow(
			'analytics: goals.collection.scopeField "tenant" does not exist on analytics-goals; register the collection with your tenant plugin or use the default scope field'
		)
	})

	it('says nothing about a collection the config does not carry', () => {
		expect(() =>
			validateScopeField(payloadWith([]), { ...args, slug: 'somewhere-else' })
		).not.toThrow()
	})

	it('does not accept a field of the same name nested under another', () => {
		expect(() =>
			validateScopeField(
				payloadWith([{ name: 'meta', type: 'group', fields: [{ name: 'tenant', type: 'text' }] }]),
				args
			)
		).toThrow(/does not exist/)
	})
})
