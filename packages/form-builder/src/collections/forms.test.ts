import type { CollectionConfig, Field } from 'payload'
import { describe, expect, it } from 'vitest'
import { buildDefaultFieldDefinitions } from '../fields/builtin'
import { type FieldTypesConfig, resolveFieldTypes } from '../fields/registry'
import type { AnyFormFieldDefinition } from '../fields/types'
import { defaultValidationRules } from '../validation/builtin'
import { resolveValidationRules } from '../validation/registry'
import { buildFormsCollection } from './forms'

const buildCollection = (fields?: FieldTypesConfig): CollectionConfig =>
	buildFormsCollection({
		registry: resolveFieldTypes(buildDefaultFieldDefinitions(true), fields),
		ruleRegistry: resolveValidationRules(defaultValidationRules),
	})

const resultsFieldOf = (collection: CollectionConfig) => {
	const poll = collection.fields.find(
		(field) => 'name' in field && field.name === 'poll'
	) as Extract<Field, { type: 'group' }>
	return poll.fields.find((field) => 'name' in field && field.name === 'resultsField') as Extract<
		Field,
		{ type: 'text' }
	>
}

const clientComponentOf = (field: Extract<Field, { type: 'text' }>) =>
	field.admin?.components?.Field as
		| { path?: string; clientProps?: { types?: string[] } }
		| undefined

describe('forms poll.resultsField', () => {
	it('mounts FieldNameSelect with the poll-eligible types as clientProps', () => {
		const field = resultsFieldOf(buildCollection())
		const component = clientComponentOf(field)
		expect(component?.path).toBe('@10x-media/form-builder/client#FieldNameSelect')
		expect(component?.clientProps?.types).toEqual(['select'])
	})

	it('threads custom pollEligible types into the select options', () => {
		const athleteVote: AnyFormFieldDefinition = {
			type: 'athleteVote',
			label: 'Athlete vote',
			value: 'text',
			pollEligible: true,
		}
		const field = resultsFieldOf(buildCollection({ athleteVote }))
		expect(clientComponentOf(field)?.clientProps?.types).toEqual(['select', 'athleteVote'])
	})

	it('stores a plain text name, keeps the PII description, and stays gated on enabled', () => {
		const field = resultsFieldOf(buildCollection())
		expect(field.type).toBe('text')
		expect(field.admin?.description).toBeDefined()
		expect(typeof field.validate).toBe('function')
		const condition = field.admin?.condition
		expect(condition?.({}, { enabled: true }, {} as never)).toBe(true)
		expect(condition?.({}, { enabled: false }, {} as never)).toBe(false)
		expect(condition?.({}, {}, {} as never)).toBe(false)
	})
})
