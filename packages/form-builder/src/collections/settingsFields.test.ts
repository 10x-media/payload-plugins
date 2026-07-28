import type { CheckboxField, Field } from 'payload'
import { describe, expect, it } from 'vitest'
import { buildDefaultSettingsFields, composeSettingsFields } from './settingsFields'

const named = (fields: Field[]): string[] =>
	fields.map((field) => ('name' in field ? field.name : field.type))

describe('buildDefaultSettingsFields', () => {
	it('returns the three flags as stacked sidebar checkboxes without widths', () => {
		const defaults = buildDefaultSettingsFields()
		for (const field of [defaults.multistep, defaults.pollEnabled, defaults.persistSubmissions]) {
			expect(field.type).toBe('checkbox')
			expect(field.admin?.position).toBe('sidebar')
			expect(field.admin && 'width' in field.admin ? field.admin.width : undefined).toBeUndefined()
		}
		expect((defaults.persistSubmissions as CheckboxField).defaultValue).toBe(true)
		expect((defaults.persistSubmissions as CheckboxField).admin?.description).toBeUndefined()
	})
})

describe('composeSettingsFields', () => {
	it('returns the defaults in order when no override is set', () => {
		expect(named(composeSettingsFields(undefined))).toEqual([
			'multistep',
			'pollEnabled',
			'persistSubmissions',
		])
	})
	it('lets a host reorder, drop, and extend', () => {
		const fields = composeSettingsFields({
			fields: ({ defaultFields }) => [
				defaultFields.persistSubmissions,
				{ name: 'archived', type: 'checkbox', admin: { position: 'sidebar' } },
			],
		})
		expect(named(fields)).toEqual(['persistSubmissions', 'archived'])
	})
})
