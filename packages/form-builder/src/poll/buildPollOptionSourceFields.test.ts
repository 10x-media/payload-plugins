import type { Field } from 'payload'
import { describe, expect, it } from 'vitest'
import { buildPollOptionSourceFields } from './buildPollOptionSourceFields'
import { definePollOptionSource } from './definePollOptionSource'
import { resolvePollOptionSources } from './registry'

type NamedField = Field & { name: string; options?: { value: string }[]; fields?: Field[] }
type ConditionFn = (data: unknown, siblingData?: unknown) => boolean

const conditionOf = (field: Field): ConditionFn =>
	(field as { admin: { condition: ConditionFn } }).admin.condition

const fieldNamed = (fields: Field[], name: string): NamedField => {
	const found = fields.find((field) => 'name' in field && field.name === name)
	if (!found) {
		throw new Error(`missing field ${name}`)
	}
	return found as NamedField
}

const athletes = definePollOptionSource({
	type: 'athletes',
	label: 'Athletes',
	config: [{ name: 'eventId', type: 'text' }],
	resolve: () => [],
})

const teams = definePollOptionSource({
	type: 'teams',
	label: 'Teams',
	resolve: () => [],
})

describe('buildPollOptionSourceFields', () => {
	it('returns no fields for an empty registry', () => {
		expect(buildPollOptionSourceFields(new Map())).toEqual([])
		expect(buildPollOptionSourceFields(resolvePollOptionSources())).toEqual([])
	})

	it('builds an optionSource select listing every registered type', () => {
		const fields = buildPollOptionSourceFields(resolvePollOptionSources({ athletes, teams }))
		const select = fieldNamed(fields, 'optionSource')
		expect(select.options?.map((option) => option.value)).toEqual(['athletes', 'teams'])
		expect(conditionOf(select)({}, { enabled: true })).toBe(true)
		expect(conditionOf(select)({}, { enabled: false })).toBe(false)
	})

	it('gates sourceConfig on an enabled poll with a selected source', () => {
		const fields = buildPollOptionSourceFields(resolvePollOptionSources({ athletes }))
		const group = fieldNamed(fields, 'sourceConfig')
		expect(conditionOf(group)({}, { enabled: true, optionSource: 'athletes' })).toBe(true)
		expect(conditionOf(group)({}, { enabled: true })).toBe(false)
		expect(conditionOf(group)({}, { enabled: false, optionSource: 'athletes' })).toBe(false)
	})

	it('shows a source config field only while its own type is selected', () => {
		const fields = buildPollOptionSourceFields(resolvePollOptionSources({ athletes, teams }))
		const group = fieldNamed(fields, 'sourceConfig')
		const eventId = fieldNamed(group.fields ?? [], 'eventId')
		expect(conditionOf(eventId)({ poll: { optionSource: 'athletes' } })).toBe(true)
		expect(conditionOf(eventId)({ poll: { optionSource: 'teams' } })).toBe(false)
		expect(conditionOf(eventId)({})).toBe(false)
	})
})
