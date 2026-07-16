import { describe, expect, it } from 'vitest'
import { defaultFieldDefinitions } from '../fields/builtin'
import { buildRegistry } from '../fields/registry'
import { buildConditionTypeMap, conditionTypeForDefinition } from './conditionType'

describe('conditionType resolution', () => {
	it('derives the default from value kind when not declared', () => {
		expect(conditionTypeForDefinition({ value: 'number' })).toBe('number')
		expect(conditionTypeForDefinition({ value: 'boolean' })).toBe('checkbox')
	})

	it('honors a declared conditionType', () => {
		expect(conditionTypeForDefinition({ value: 'text', conditionType: 'select' })).toBe('select')
	})

	it('builds a slug -> condition type map for the built-in registry', () => {
		const map = buildConditionTypeMap(buildRegistry(defaultFieldDefinitions))
		expect(map.text).toBe('text')
		expect(map.textarea).toBe('text')
		expect(map.email).toBe('text')
		expect(map.number).toBe('number')
		expect(map.select).toBe('select')
		expect(map.checkbox).toBe('checkbox')
		expect(map.calculation).toBe('number')
		expect(map.consent).toBe('checkbox')
	})

	it('excludes valueless (display-only) types like message from the map', () => {
		const map = buildConditionTypeMap(buildRegistry(defaultFieldDefinitions))
		expect('message' in map).toBe(false)
	})

	it('keeps a valueless type that explicitly declares a conditionType', () => {
		const map = buildConditionTypeMap(
			new Map([
				['banner', { type: 'banner', label: 'Banner', value: 'none', conditionType: 'text' }],
			])
		)
		expect(map.banner).toBe('text')
	})
})
