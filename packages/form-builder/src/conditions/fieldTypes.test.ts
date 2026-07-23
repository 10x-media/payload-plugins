import { describe, expect, it } from 'vitest'
import {
	conditionOperators,
	defaultConditionType,
	operatorLabelKey,
	operatorValueShape,
} from './fieldTypes'

describe('condition field-type catalog', () => {
	it('only exposes operators the evaluator implements', () => {
		const supported = new Set([
			'equals',
			'not_equals',
			'in',
			'not_in',
			'exists',
			'greater_than',
			'greater_than_equal',
			'less_than',
			'less_than_equal',
			'like',
			'not_like',
			'contains',
		])
		for (const ops of Object.values(conditionOperators)) {
			for (const op of ops) {
				expect(supported.has(op)).toBe(true)
			}
		}
	})

	it('maps value kinds to a default condition type', () => {
		expect(defaultConditionType('text')).toBe('text')
		expect(defaultConditionType('number')).toBe('number')
		expect(defaultConditionType('boolean')).toBe('checkbox')
		expect(defaultConditionType('date')).toBe('date')
		expect(defaultConditionType('text[]')).toBe('select')
		expect(defaultConditionType('file')).toBe('presence')
		expect(defaultConditionType('repeater')).toBe('presence')
	})

	it('numbers support ordering, text supports matching, checkbox is equality-only', () => {
		expect(conditionOperators.number).toContain('greater_than')
		expect(conditionOperators.text).toContain('contains')
		expect(conditionOperators.checkbox).toEqual(['equals', 'not_equals', 'exists'])
		expect(conditionOperators.presence).toEqual(['exists'])
	})

	it('labels operators via Payload operators namespace', () => {
		expect(operatorLabelKey('not_equals')).toBe('operators:isNotEqualTo')
		expect(operatorLabelKey('greater_than_equal')).toBe('operators:isGreaterThanOrEqualTo')
	})

	it('classifies the value control an operator needs', () => {
		expect(operatorValueShape('exists')).toBe('boolean')
		expect(operatorValueShape('in')).toBe('array')
		expect(operatorValueShape('equals')).toBe('scalar')
	})
})
