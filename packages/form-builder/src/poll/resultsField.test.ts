import type { PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import { buildDefaultFieldDefinitions } from '../fields/builtin'
import { resolveFieldTypes } from '../fields/registry'
import type { AnyFormFieldDefinition } from '../fields/types'
import { buildValidateResultsField, pollEligibleTypes } from './resultsField'

const athleteVote: AnyFormFieldDefinition = {
	type: 'athleteVote',
	label: 'Athlete vote',
	value: 'text',
	pollEligible: true,
}

describe('pollEligibleTypes', () => {
	it('collects only definitions declaring pollEligible', () => {
		const registry = resolveFieldTypes(buildDefaultFieldDefinitions(true))
		expect(pollEligibleTypes(registry)).toEqual(['select', 'country', 'state'])
	})

	it('includes custom types that declare eligibility', () => {
		const registry = resolveFieldTypes(buildDefaultFieldDefinitions(true), { athleteVote })
		expect(pollEligibleTypes(registry)).toEqual(['select', 'country', 'state', 'athleteVote'])
	})

	it('reflects removal of an eligible built-in', () => {
		const registry = resolveFieldTypes(buildDefaultFieldDefinitions(true), {
			select: false,
			country: false,
			state: false,
		})
		expect(pollEligibleTypes(registry)).toEqual([])
	})
})

describe('buildValidateResultsField', () => {
	const req = { t: (key: string) => key } as unknown as PayloadRequest
	const validate = buildValidateResultsField(['select', 'athleteVote'])
	const fields = [
		{ blockType: 'select', name: 'colour' },
		{ blockType: 'text', name: 'note' },
		{ blockType: 'athleteVote', name: 'winner' },
	]

	it('passes when unset', () => {
		expect(validate(undefined, { data: { fields }, req })).toBe(true)
		expect(validate('', { data: { fields }, req })).toBe(true)
	})

	it('passes when the value names an eligible field, built-in or custom', () => {
		expect(validate('colour', { data: { fields }, req })).toBe(true)
		expect(validate('winner', { data: { fields }, req })).toBe(true)
	})

	it('fails when the value names a non-eligible field', () => {
		expect(validate('note', { data: { fields }, req })).toBe(
			'formBuilder:validation.resultsFieldUnknown'
		)
	})

	it('fails when the value names no field on the form', () => {
		expect(validate('missing', { data: { fields }, req })).toBe(
			'formBuilder:validation.resultsFieldUnknown'
		)
	})

	it('never matches an unnamed or blank-named eligible instance', () => {
		const unnamed = [{ blockType: 'select' }, { blockType: 'select', name: '   ' }]
		expect(validate('undefined', { data: { fields: unnamed }, req })).toBe(
			'formBuilder:validation.resultsFieldUnknown'
		)
		expect(validate('   ', { data: { fields: unnamed }, req })).toBe(
			'formBuilder:validation.resultsFieldUnknown'
		)
	})

	it('does not crash when data.fields is missing or garbled', () => {
		expect(validate('colour', { data: {}, req })).toBe('formBuilder:validation.resultsFieldUnknown')
		expect(validate('colour', { data: { fields: 'not-an-array' }, req })).toBe(
			'formBuilder:validation.resultsFieldUnknown'
		)
		expect(validate('colour', { data: undefined, req })).toBe(
			'formBuilder:validation.resultsFieldUnknown'
		)
	})
})
