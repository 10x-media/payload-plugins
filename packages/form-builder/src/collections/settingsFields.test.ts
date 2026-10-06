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

describe('the consent retention notice', () => {
	const condition = (data: Record<string, unknown>): boolean => {
		const field = buildDefaultSettingsFields().consentRetentionNotice
		const evaluate = field.admin?.condition as
			| ((data: Record<string, unknown>) => boolean)
			| undefined
		return evaluate?.(data) ?? false
	}
	const consent = [{ blockType: 'consent', name: 'terms' }]

	it('shows only for a non-persisting form that carries a consent field', () => {
		expect(condition({ persistSubmissions: false, fields: consent })).toBe(true)
	})

	it('stays hidden while submissions persist, or with no consent field', () => {
		expect(condition({ persistSubmissions: true, fields: consent })).toBe(false)
		expect(condition({ persistSubmissions: false, fields: [{ blockType: 'text' }] })).toBe(false)
		expect(condition({ persistSubmissions: false })).toBe(false)
	})
})

describe('composeSettingsFields', () => {
	it('returns the defaults in order when no override is set', () => {
		expect(named(composeSettingsFields(undefined))).toEqual([
			'multistep',
			'pollEnabled',
			'persistSubmissions',
			'consentRetentionNotice',
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
